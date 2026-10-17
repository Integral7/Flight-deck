import * as THREE from 'three';

/**
 * Sky dome: gradient from horizon to zenith, sun disc with Mie-style glow,
 * moon disc, horizon haze and overcast tinting. Stars are a separate Points
 * object so their size is resolution-independent. The dome follows the
 * camera and ignores depth/fog.
 */
const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  // The dome's radius is kept inside the far plane (see follow()), so no
  // depth tricks are needed: pinning z to w gets clipped by rounding on
  // GPUs without a reversed depth buffer.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform vec3 uMoonDir;
uniform float uMoon;
uniform float uOvercast;
uniform vec3 uOvercastColor;
uniform vec3 uFog;
uniform float uFogBlend; // 0..1, higher in low visibility
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  // Horizon-weighted gradient (more colour range near the horizon).
  float t = pow(clamp(y, 0.0, 1.0), 0.45);
  vec3 col = mix(uHorizon, uZenith, t);
  // Warm the half of the sky facing the sun at low sun angles.
  float sd = max(dot(d, uSunDir), 0.0);
  float lowSun = 1.0 - smoothstep(0.0, 0.5, uSunDir.y);
  col += uSunColor * pow(sd, 6.0) * 0.35 * lowSun * (1.0 - uOvercast);
  // Below the horizon fade to a ground haze colour.
  col = mix(col, uGround, smoothstep(0.0, -0.12, y));
  // Overcast flattens everything toward a grey layer.
  col = mix(col, uOvercastColor * (0.55 + 0.45 * smoothstep(-0.1, 0.6, y)), uOvercast);
  // Sun: disc + glow (hidden by overcast).
  float sunVisible = (1.0 - uOvercast * 0.95) * smoothstep(-0.06, 0.02, uSunDir.y);
  float disc = smoothstep(uSunSize, uSunSize * 0.85, acos(clamp(sd, -1.0, 1.0)));
  col += uSunColor * (disc * 18.0 + pow(sd, 350.0) * 2.0 + pow(sd, 28.0) * 0.28) * sunVisible;
  // Moon.
  float md = max(dot(d, uMoonDir), 0.0);
  float mdisc = smoothstep(0.0215, 0.0185, acos(clamp(md, -1.0, 1.0)));
  col += vec3(0.85, 0.88, 0.95) * (mdisc * 1.6 + pow(md, 120.0) * 0.15) * uMoon * (1.0 - uOvercast * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Converge on the scene fog colour at the horizon so fully fogged terrain
  // and water never show a silhouette. Applied after tone mapping, exactly
  // where three.js applies fog to every other material.
  float hz = 1.0 - smoothstep(0.0, mix(0.1, 0.55, uFogBlend), y);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFog, clamp(hz + uFogBlend * uFogBlend, 0.0, 1.0));
}`;

export class Sky {
  constructor(scene, starCount = 1500) {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunSize: { value: 0.012 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoon: { value: 0 },
      uOvercast: { value: 0 },
      uOvercastColor: { value: new THREE.Color(0x9aa3ad) },
      uFog: { value: new THREE.Color(0x9cc4e8) },
      uFogBlend: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertex,
      fragmentShader: fragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.material);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
    scene.add(this.mesh);
    this.stars = this._createStars(starCount);
    scene.add(this.stars);
  }

  _createStars(count) {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      // Uniform on the upper hemisphere (plus a little below for tilt).
      const u = rnd() * 2 - 0.15;
      const th = rnd() * Math.PI * 2;
      const y = Math.min(1, Math.max(-0.15, u * 0.5 + 0.35));
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * r * 900;
      pos[i * 3 + 1] = y * 900;
      pos[i * 3 + 2] = Math.sin(th) * r * 900;
      const b = 0.4 + rnd() * 0.6;
      const tint = rnd();
      col[i * 3] = b * (tint > 0.8 ? 1 : 0.85);
      col[i * 3 + 1] = b * 0.9;
      col[i * 3 + 2] = b * (tint < 0.3 ? 1 : 0.8);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = -9;
    pts.frustumCulled = false;
    return pts;
  }

  /**
   * @param {object} st skyState() result (sRGB colours)
   * @param {number[]} sunDir
   * @param {number[]} moonDir
   * @param {number} overcast 0..1
   */
  apply(st, sunDir, moonDir, overcast, hours) {
    const u = this.uniforms;
    u.uZenith.value.setRGB(...st.zenith, THREE.SRGBColorSpace);
    u.uHorizon.value.setRGB(...st.horizon, THREE.SRGBColorSpace);
    u.uGround.value.setRGB(...st.fog, THREE.SRGBColorSpace).multiplyScalar(0.8);
    u.uSunColor.value.setRGB(...st.sunColor, THREE.SRGBColorSpace);
    if (st.sunIntensity < 0.3) u.uSunColor.value.setRGB(1, 0.45, 0.2).multiplyScalar(Math.max(0, st.sunIntensity) * 2.5);
    u.uSunDir.value.set(sunDir[0], sunDir[1], sunDir[2]);
    u.uMoonDir.value.set(moonDir[0], moonDir[1], moonDir[2]);
    u.uMoon.value = st.night;
    u.uOvercast.value = overcast;
    // Overcast grey follows the light level.
    const lvl = 0.25 + 0.75 * Math.min(1, Math.max(0, st.hemiIntensity / 0.9));
    u.uOvercastColor.value.setRGB(0.62 * lvl, 0.66 * lvl, 0.71 * lvl, THREE.SRGBColorSpace);
    this.stars.material.opacity = st.stars * (1 - overcast);
    this.stars.visible = this.stars.material.opacity > 0.01;
    this.stars.rotation.y = (hours / 24) * Math.PI * 2;
  }

  follow(camera) {
    this.mesh.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    // Keep the dome inside the far plane.
    const s = (camera.far * 0.85) / 1000;
    this.mesh.scale.setScalar(s);
    this.stars.scale.setScalar(s);
  }
}
