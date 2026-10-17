import * as THREE from 'three';

/**
 * Terrain material: vertex-coloured MeshStandardMaterial with a procedural
 * world-space detail layer injected into the shader. The detail breaks up
 * the flat vertex colours near the camera and fades out with distance so it
 * never shimmers on far LODs.
 */
export function createTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorld;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTerrainWorld;
float tHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float d = length(vTerrainWorld - cameraPosition);
  vec2 p = vTerrainWorld.xz;
  float coarse = tNoise(p * 0.013) * 0.6 + tNoise(p * 0.041) * 0.4;
  float fine = tNoise(p * 0.19) * 0.5 + tNoise(p * 0.67) * 0.5;
  float fineFade = 1.0 - smoothstep(150.0, 900.0, d);
  float k = 0.88 + 0.22 * coarse + (fine - 0.5) * 0.22 * fineFade;
  diffuseColor.rgb *= k;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-v1';
  return mat;
}
