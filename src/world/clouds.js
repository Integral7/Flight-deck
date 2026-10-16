import * as THREE from 'three';
import { hash2 } from '../engine/random.js';

const CELL = 1400; // metres per cloud cell; at most one cluster per cell

/** Soft, lumpy puff texture generated on a canvas (no image assets). */
function puffTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  let s = 99;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const blobs = Array.from({ length: 14 }, () => ({
    x: 0.5 + (rnd() - 0.5) * 0.45,
    y: 0.52 + (rnd() - 0.5) * 0.35,
    r: 0.16 + rnd() * 0.16,
  }));
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      let d = 0;
      for (const b of blobs) {
        const dd = Math.hypot(u - b.x, v - b.y) / b.r;
        d = Math.max(d, 1 - dd * dd);
      }
      const edge = 1 - Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2);
      const a = Math.max(0, Math.min(1, d * 1.3)) * Math.min(1, edge * 3);
      // Red channel stores a vertical "thickness" term used for self-shading.
      const o = (j * size + i) * 4;
      img.data[o] = Math.round(255 * (1 - v));
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const vertex = /* glsl */ `
attribute vec3 aOffset;
attribute vec2 aSize;   // x = size, y = rotation
attribute float aShade; // per-puff brightness variation
uniform vec3 uDrift;
varying vec2 vUv;
varying float vShade;
varying float vFade;
varying float vHeight;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vShade = aShade;
  vec3 center = aOffset + uDrift;
  vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
  float c = cos(aSize.y), s = sin(aSize.y);
  vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  mvPosition.xy += corner * aSize.x;
  float dist = length(mvPosition.xyz);
  // Fade puffs right in front of the camera instead of clipping through them.
  vFade = smoothstep(aSize.x * 0.35, aSize.x * 1.2, dist);
  vHeight = position.y;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragment = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLit;
uniform vec3 uShadow;
uniform float uOpacity;
varying vec2 vUv;
varying float vShade;
varying float vFade;
varying float vHeight;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * uOpacity * vFade;
  if (a < 0.01) discard;
  // Lit tops, darker bellies.
  float k = clamp(vHeight + 0.5, 0.0, 1.0);
  vec3 col = mix(uShadow, uLit, k * 0.8 + 0.2) * vShade;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * Instanced cloud field. Cells around the camera deterministically spawn a
 * cluster of puffs when a hash is below the weather's cloud cover, so clouds
 * are stable as you fly and thicken smoothly when the weather changes.
 */
export class Clouds {
  constructor(scene, preset, seed = 1) {
    this.scene = scene;
    this.seed = seed;
    this.maxClusters = preset.cloudCount;
    this.puffsPerCluster = 12;
    this.capacity = this.maxClusters * this.puffsPerCluster;
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMap: { value: puffTexture() },
        uLit: { value: new THREE.Color(1, 1, 1) },
        uShadow: { value: new THREE.Color(0.6, 0.65, 0.72) },
        uOpacity: { value: 0.85 },
        uDrift: { value: new THREE.Vector3() },
      },
    ]);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this._build();
    this.drift = new THREE.Vector3();
    this.cellKey = '';
    this.cover = -1;
    this._sortTimer = 0;
  }

  _build() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    this.offsets = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity * 2);
    this.shades = new Float32Array(this.capacity);
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(this.offsets, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.sizes, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aShade', new THREE.InstancedBufferAttribute(this.shades, 1).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = 0;
    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'clouds';
    this.scene.add(this.mesh);
    this.puffs = [];
  }

  applyQuality(preset) {
    this.maxClusters = preset.cloudCount;
    this.capacity = this.maxClusters * this.puffsPerCluster;
    this._build();
    this.cellKey = '';
  }

  setSeed(seed) {
    this.seed = seed;
    this.cellKey = '';
  }

  /** Rebuild the puff list for the cells around the camera. */
  _regenerate(cx, cz, weather, radius) {
    const c = weather;
    const R = Math.ceil(radius / CELL);
    const cells = [];
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) cells.push([cx + i, cz + j, i * i + j * j]);
    cells.sort((a, b) => a[2] - b[2]);
    const puffs = [];
    let clusters = 0;
    for (const [i, j, d2] of cells) {
      if (d2 > R * R + 1 || clusters >= this.maxClusters) break;
      const h = hash2(i, j, this.seed + 3131);
      if (h > c.cover) continue;
      clusters++;
      const ox = (i + 0.2 + 0.6 * hash2(i, j, this.seed + 1)) * CELL;
      const oz = (j + 0.2 + 0.6 * hash2(i, j, this.seed + 2)) * CELL;
      const big = 0.7 + 0.8 * hash2(i, j, this.seed + 3);
      const count = Math.max(4, Math.round(this.puffsPerCluster * (0.5 + 0.5 * big)));
      const baseY = c.cloudBase + 120 * hash2(i, j, this.seed + 4);
      for (let k = 0; k < count && k < this.puffsPerCluster; k++) {
        const r1 = hash2(i * 31 + k, j, this.seed + 5);
        const r2 = hash2(i, j * 31 + k, this.seed + 6);
        const r3 = hash2(i + k, j - k, this.seed + 7);
        const spread = 220 * big * c.puffScale;
        const size = (170 + 230 * r3) * big * c.puffScale;
        puffs.push({
          x: ox + (r1 - 0.5) * spread * 2,
          // Flat bottoms, cauliflower tops.
          y: baseY + size * 0.25 + Math.abs(r2 - 0.5) * size * 0.9 * (1 - Math.abs(r1 - 0.5)),
          z: oz + (r2 - 0.5) * spread * 2,
          size,
          rot: r1 * 6.283,
          shade: 0.82 + 0.25 * r3,
        });
      }
    }
    this.puffs = puffs;
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {object} weather Weather.current
   * @param {{x:number,z:number}} wind m/s
   * @param {object} light { lit: THREE.Color, shadow: THREE.Color }
   */
  update(dt, camera, weather, wind, light, radius) {
    this.drift.x += wind.x * dt;
    this.drift.z += wind.z * dt;
    const px = camera.position.x - this.drift.x;
    const pz = camera.position.z - this.drift.z;
    const cx = Math.floor(px / CELL);
    const cz = Math.floor(pz / CELL);
    const key = `${cx},${cz}`;
    if (key !== this.cellKey || Math.abs(weather.cover - this.cover) > 0.02) {
      this.cellKey = key;
      this.cover = weather.cover;
      this._regenerate(cx, cz, weather, radius);
      this._sortTimer = 0;
    }
    // Back-to-front sort a few times per second for correct blending.
    this._sortTimer -= dt;
    if (this._sortTimer <= 0) {
      this._sortTimer = 0.25;
      const cam = camera.position;
      const dx = this.drift.x;
      const dz = this.drift.z;
      for (const p of this.puffs) p.d = (p.x + dx - cam.x) ** 2 + (p.y - cam.y) ** 2 + (p.z + dz - cam.z) ** 2;
      this.puffs.sort((a, b) => b.d - a.d);
      const n = Math.min(this.puffs.length, this.capacity);
      for (let k = 0; k < n; k++) {
        const p = this.puffs[k];
        this.offsets[k * 3] = p.x;
        this.offsets[k * 3 + 1] = p.y;
        this.offsets[k * 3 + 2] = p.z;
        this.sizes[k * 2] = p.size;
        this.sizes[k * 2 + 1] = p.rot;
        this.shades[k] = p.shade;
      }
      this.geometry.instanceCount = n;
      this.geometry.attributes.aOffset.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aShade.needsUpdate = true;
    }
    this.uniforms.uDrift.value.set(this.drift.x, 0, this.drift.z);
    this.uniforms.uLit.value.copy(light.lit);
    this.uniforms.uShadow.value.copy(light.shadow);
    this.uniforms.uOpacity.value = 0.55 + 0.4 * Math.min(1, weather.cover);
    this.mesh.visible = this.geometry.instanceCount > 0;
  }
}
