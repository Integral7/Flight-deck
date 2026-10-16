import * as THREE from 'three';

const BOX = 55; // metres: rain volume around the camera (wraps)

const vertex = /* glsl */ `
attribute vec3 aSeed;   // random position in [0, 1)^3
attribute float aEnd;   // 0 = streak head, 1 = streak tail
uniform vec3 uCamera;
uniform float uTime;
uniform vec3 uStreak;   // apparent rain velocity * exposure time (world)
uniform float uFall;
varying float vAlpha;
void main() {
  vec3 p = aSeed * ${BOX.toFixed(1)};
  p.y -= uTime * uFall;
  // Wrap into a box centred on the camera so rain is infinite and cheap.
  vec3 origin = uCamera - vec3(${(BOX / 2).toFixed(1)});
  p = origin + mod(p - origin, ${BOX.toFixed(1)});
  p -= uStreak * aEnd;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = length(mv.xyz);
  vAlpha = (1.0 - aEnd * 0.9) * smoothstep(${(BOX / 2).toFixed(1)}, 8.0, d) * smoothstep(2.0, 7.0, d);
  gl_Position = projectionMatrix * mv;
}`;

const fragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  #include <colorspace_fragment>
}`;

/** GPU rain: line segments animated entirely in the vertex shader. */
export class Rain {
  constructor(scene, count) {
    this.scene = scene;
    this.uniforms = {
      uCamera: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uStreak: { value: new THREE.Vector3(0, -1, 0) },
      uFall: { value: 9 },
      uColor: { value: new THREE.Color(0.75, 0.8, 0.9) },
      uOpacity: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.build(count);
    this._v = new THREE.Vector3();
  }

  build(count) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const seeds = new Float32Array(count * 6);
    const ends = new Float32Array(count * 2);
    const pos = new Float32Array(count * 6);
    let s = 4242;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const x = rnd();
      const y = rnd();
      const z = rnd();
      seeds.set([x, y, z, x, y, z], i * 6);
      ends[i * 2] = 0;
      ends[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.mesh = new THREE.LineSegments(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  /**
   * @param {number} intensity 0..1
   * @param {THREE.Vector3} aircraftVel world velocity (streaks slant with speed)
   * @param {{x:number,z:number}} wind
   * @param {THREE.Color} ambient light colour for tinting
   */
  update(dt, camera, intensity, aircraftVel, wind, ambient) {
    const u = this.uniforms;
    u.uOpacity.value += (intensity * 0.8 - u.uOpacity.value) * Math.min(1, dt * 2);
    this.mesh.visible = u.uOpacity.value > 0.01;
    if (!this.mesh.visible) return;
    u.uTime.value += dt;
    u.uCamera.value.copy(camera.position);
    // Apparent velocity of drops relative to the camera, over a short "shutter".
    const fall = 9;
    u.uFall.value = fall;
    this._v.set(wind.x - aircraftVel.x, -fall - aircraftVel.y, wind.z - aircraftVel.z).multiplyScalar(0.045);
    u.uStreak.value.copy(this._v);
    u.uColor.value.copy(ambient).multiplyScalar(1.4);
  }
}
