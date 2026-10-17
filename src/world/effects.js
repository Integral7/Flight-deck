import * as THREE from 'three';

const MAX = 90;

const vertex = /* glsl */ `
attribute float aAge;    // 0..1 life fraction (>= 1: dead)
attribute float aSize;
attribute float aFire;   // 1 = flame, 0 = smoke
varying float vAge;
varying float vFire;
#include <fog_pars_vertex>
void main() {
  vAge = aAge;
  vFire = aFire;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aAge >= 1.0 ? 0.0 : aSize * (600.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragment = /* glsl */ `
uniform vec3 uSmoke;
varying float vAge;
varying float vFire;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0 || vAge >= 1.0) discard;
  float soft = 1.0 - r;
  vec3 fire = mix(vec3(1.0, 0.85, 0.4), vec3(1.0, 0.25, 0.05), vAge);
  vec3 col = mix(uSmoke * (0.6 + 0.4 * vAge), fire * 3.0, vFire);
  float a = soft * (vFire > 0.5 ? (1.0 - vAge) : 0.55 * sin(vAge * 3.14159));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * Crash site effects: a smoke column and a short-lived fire, as GPU points
 * whose ages are advanced on the CPU (only ~90 particles).
 */
export class Effects {
  constructor(scene) {
    this.positions = new Float32Array(MAX * 3);
    this.ages = new Float32Array(MAX).fill(1);
    this.sizes = new Float32Array(MAX);
    this.fire = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAge', new THREE.BufferAttribute(this.ages, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFire', new THREE.BufferAttribute(this.fire, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSmoke: { value: new THREE.Color(0.18, 0.18, 0.19) } }]),
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    scene.add(this.points);
    this.source = null;
    this.emitTimer = 0;
    this.next = 0;
  }

  /** Start a smoking wreck at `pos` for `duration` seconds. */
  wreck(pos, duration = 30) {
    this.source = { x: pos.x, y: pos.y, z: pos.z, t: 0, duration };
    this.points.visible = true;
  }

  clear() {
    this.source = null;
    this.ages.fill(1);
    this.points.visible = false;
  }

  _emit(fire) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const s = this.source;
    this.positions[i * 3] = s.x + (Math.random() - 0.5) * 3;
    this.positions[i * 3 + 1] = s.y + 0.5;
    this.positions[i * 3 + 2] = s.z + (Math.random() - 0.5) * 3;
    this.vel[i * 3] = (Math.random() - 0.5) * 1.5;
    this.vel[i * 3 + 1] = fire ? 2 + Math.random() * 2 : 3 + Math.random() * 2;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    this.ages[i] = 0;
    this.life[i] = fire ? 0.8 + Math.random() * 0.5 : 6 + Math.random() * 3;
    this.sizes[i] = fire ? 2.5 : 4;
    this.fire[i] = fire ? 1 : 0;
    this.points.geometry.attributes.aFire.needsUpdate = true;
  }

  update(dt, wind, ambient) {
    if (!this.points.visible) return;
    const s = this.source;
    if (s) {
      s.t += dt;
      const fading = s.t / s.duration;
      this.emitTimer -= dt;
      if (this.emitTimer <= 0 && fading < 1) {
        this.emitTimer = 0.12 + fading * 0.3;
        this._emit(false);
        if (s.t < 10) this._emit(true);
      }
    }
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.ages[i] >= 1) continue;
      alive++;
      this.ages[i] = Math.min(1, this.ages[i] + dt / this.life[i]);
      const k = this.fire[i] ? 0 : this.ages[i];
      this.positions[i * 3] += (this.vel[i * 3] + wind.x * k) * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += (this.vel[i * 3 + 2] + wind.z * k) * dt;
      if (!this.fire[i]) this.sizes[i] += dt * 2.6;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true;
    a.aAge.needsUpdate = true;
    a.aSize.needsUpdate = true;
    this.material.uniforms.uSmoke.value.copy(ambient).multiplyScalar(0.35);
    if (!alive && (!s || s.t > s.duration)) this.clear();
  }
}
