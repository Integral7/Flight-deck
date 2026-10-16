import * as THREE from 'three';
import { SEA_LEVEL } from '../terrain/heightfield.js';

/** Tileable wave normal map built from integer-frequency sine waves. */
function createWaveNormalMap(size = 256, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const waves = [];
  for (let i = 0; i < 24; i++) {
    const kx = Math.round((rnd() - 0.5) * 2 * (2 + i * 0.7));
    const ky = Math.round((rnd() - 0.5) * 2 * (2 + i * 0.7));
    if (!kx && !ky) continue;
    waves.push({ kx, ky, a: 1 / (1 + Math.hypot(kx, ky) * 0.6), p: rnd() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const ph = ((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.p;
        const c = Math.cos(ph) * w.a;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const nx = -dx * 0.06;
      const ny = -dy * 0.06;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      data[o] = ((nx / len) * 0.5 + 0.5) * 255;
      data[o + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Infinite-looking water: one large plane at sea level that follows the
 * camera. Waves come from two scrolling world-space samples of a tileable
 * normal map, injected into MeshStandardMaterial so lighting, fog, shadows
 * and the sky environment map all apply.
 */
export class Water {
  constructor(scene, size = 16000) {
    this.uniforms = { uWaterTime: { value: 0 } };
    const normalMap = createWaveNormalMap();
    this.material = new THREE.MeshStandardMaterial({
      color: 0x1b4a5e,
      roughness: 0.08,
      metalness: 0.0,
      normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      transparent: true,
      opacity: 0.9,
      envMapIntensity: 1.0,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uWaterTime = this.uniforms.uWaterTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWaterWorld;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWaterWorld;\nuniform float uWaterTime;')
        .replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          `vec2 wuv = vWaterWorld * 0.018;
vec3 n1 = texture2D( normalMap, wuv + vec2(uWaterTime * 0.011, uWaterTime * 0.007) ).xyz * 2.0 - 1.0;
vec3 n2 = texture2D( normalMap, wuv * 2.7 + vec2(-uWaterTime * 0.017, uWaterTime * 0.013) ).xyz * 2.0 - 1.0;
vec3 mapN = normalize(vec3(n1.xy + n2.xy * 0.6, n1.z * n2.z));`,
        );
    };
    this.material.customProgramCacheKey = () => 'water-v1';
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = SEA_LEVEL;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'water';
    this.setSize(size);
    scene.add(this.mesh);
  }

  setSize(size) {
    this.mesh.scale.set(size, 1, size);
  }

  update(dt, camPos) {
    this.uniforms.uWaterTime.value += dt;
    this.mesh.position.x = Math.round(camPos.x / 64) * 64;
    this.mesh.position.z = Math.round(camPos.z / 64) * 64;
  }
}
