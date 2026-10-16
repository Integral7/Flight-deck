/**
 * Pure chunk builders (no three.js) so they can run inside a Web Worker and
 * in Node tests. Output is plain typed arrays ready to become BufferGeometry
 * attributes and InstancedMesh matrices.
 */
import { SEA_LEVEL } from './heightfield.js';
import { hash2, smoothstep, clamp, lerp } from '../engine/random.js';

export const CHUNK_SIZE = 512;
/** Grid segments per chunk side for each LOD level (0 = finest, 8 m spacing). */
export const LOD_SEGMENTS = [64, 32, 16, 8];
/** Skirt depth per LOD level; must exceed the max seam error (see tests). */
export const SKIRT_DEPTH = [12, 30, 70, 140];

// Biome palette (linear-ish sRGB values, tuned for ACES tone mapping).
const C = {
  deepWater: [0.12, 0.16, 0.14],
  sand: [0.76, 0.69, 0.5],
  wetSand: [0.52, 0.47, 0.34],
  grassDry: [0.55, 0.58, 0.3],
  grassLush: [0.27, 0.45, 0.17],
  forestFloor: [0.13, 0.25, 0.1],
  rock: [0.42, 0.39, 0.36],
  rockDark: [0.3, 0.28, 0.27],
  snow: [0.93, 0.95, 0.98],
  pad: [0.36, 0.42, 0.25],
  runway: [0.2, 0.2, 0.21],
};

function mix3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

const tmpA = [0, 0, 0];

/**
 * Smoothly blended terrain colour for a sample. Uses weights rather than hard
 * biome classes so LOD levels and neighbouring vertices transition softly.
 */
export function terrainColor(terrain, s, slope, x, z, out) {
  const h = s.height;
  const v = hash2(Math.floor(x / 23), Math.floor(z / 23), 91) * 0.08 - 0.04;

  // Lowland grass, lush where moist.
  mix3(out, C.grassDry, C.grassLush, clamp(s.moisture * 1.3 - 0.15, 0, 1));
  // Forest floor darkening (trees themselves are instanced near the camera).
  const forest = forestFactor(terrain, s, slope, x, z);
  if (forest > 0) mix3(out, out, C.forestFloor, forest);
  // Airport grass pad.
  if (s.airport > 0) mix3(out, out, C.pad, s.airport * 0.8);
  // Beaches and river banks.
  const beach = 1 - smoothstep(SEA_LEVEL + 1.5, SEA_LEVEL + 5, h);
  if (beach > 0) mix3(out, out, C.sand, beach * (1 - s.airport));
  const wet = 1 - smoothstep(SEA_LEVEL - 1, SEA_LEVEL + 1.2, h);
  if (wet > 0) mix3(out, out, C.wetSand, wet);
  if (h < SEA_LEVEL - 3) mix3(out, out, C.deepWater, smoothstep(SEA_LEVEL - 3, SEA_LEVEL - 25, h));
  // Rock on steep faces and high ground.
  const rock = Math.max(smoothstep(0.2, 0.36, slope), smoothstep(1150, 1450, h));
  if (rock > 0) {
    mix3(tmpA, C.rock, C.rockDark, hash2(Math.floor(x / 61), Math.floor(z / 61), 7));
    mix3(out, out, tmpA, rock);
  }
  // Snow on gentle slopes above a noisy snow line.
  const sl = terrain.snowLine(x, z);
  const snow = smoothstep(sl - 60, sl + 60, h) * (1 - smoothstep(0.45, 0.65, slope));
  if (snow > 0) mix3(out, out, C.snow, snow);
  if (s.runway) mix3(out, out, C.runway, 1);

  out[0] = clamp(out[0] + v, 0, 1);
  out[1] = clamp(out[1] + v, 0, 1);
  out[2] = clamp(out[2] + v * 0.6, 0, 1);
  return out;
}

function forestFactor(terrain, s, slope, x, z) {
  // forestDensity needs a normal; reuse the slope we already have.
  return smoothstep(0.2, 0.55, terrain.forestDensityFromSample(s, slope, x, z));
}

/**
 * Build one terrain chunk.
 * @returns {{positions:Float32Array, normals:Float32Array, colors:Float32Array,
 *   indices:Uint16Array, minY:number, maxY:number, cx:number, cz:number, lod:number}}
 */
export function buildChunk(terrain, cx, cz, lod) {
  const seg = LOD_SEGMENTS[lod];
  const step = CHUNK_SIZE / seg;
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const n = seg + 1;
  const g = n + 2; // one-sample border for normals

  const heights = new Float32Array(g * g);
  const gridVerts = n * n;
  const skirtVerts = 4 * seg;
  const total = gridVerts + skirtVerts;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);

  // Samples: interior gets the full sample (for colour), border just height.
  const samples = new Array(gridVerts);
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const x = ox + (i - 1) * step;
      const z = oz + (j - 1) * step;
      const interior = i >= 1 && i <= n && j >= 1 && j <= n;
      if (interior) {
        const s = terrain.sample(x, z);
        heights[j * g + i] = s.height;
        samples[(j - 1) * n + (i - 1)] = {
          height: s.height,
          river: s.river,
          valley: s.valley,
          moisture: s.moisture,
          airport: s.airport,
          runway: s.runway,
          mountain: s.mountain,
        };
      } else {
        heights[j * g + i] = terrain.heightAt(x, z);
      }
    }
  }

  let minY = Infinity;
  let maxY = -Infinity;
  const col = [0, 0, 0];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gi = (j + 1) * g + (i + 1);
      const h = heights[gi];
      const k = (j * n + i) * 3;
      positions[k] = i * step;
      positions[k + 1] = h;
      positions[k + 2] = j * step;
      let nx = heights[gi - 1] - heights[gi + 1];
      let ny = 2 * step;
      let nz = heights[gi - g] - heights[gi + g];
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      normals[k] = nx;
      normals[k + 1] = ny;
      normals[k + 2] = nz;
      terrainColor(terrain, samples[j * n + i], 1 - ny, ox + i * step, oz + j * step, col);
      colors[k] = col[0];
      colors[k + 1] = col[1];
      colors[k + 2] = col[2];
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  }

  // Perimeter walk (counter-clockwise from above) so skirt faces point outward.
  const perimeter = [];
  for (let i = 0; i < seg; i++) perimeter.push(i); // j = 0, +x
  for (let j = 0; j < seg; j++) perimeter.push(j * n + seg); // i = seg, +z
  for (let i = seg; i > 0; i--) perimeter.push(seg * n + i); // j = seg, -x
  for (let j = seg; j > 0; j--) perimeter.push(j * n); // i = 0, -z
  const depth = SKIRT_DEPTH[lod];
  for (let p = 0; p < perimeter.length; p++) {
    const src = perimeter[p] * 3;
    const dst = (gridVerts + p) * 3;
    positions[dst] = positions[src];
    positions[dst + 1] = positions[src + 1] - depth;
    positions[dst + 2] = positions[src + 2];
    normals[dst] = normals[src];
    normals[dst + 1] = normals[src + 1];
    normals[dst + 2] = normals[src + 2];
    colors[dst] = colors[src] * 0.8;
    colors[dst + 1] = colors[src + 1] * 0.8;
    colors[dst + 2] = colors[src + 2] * 0.8;
  }
  minY -= depth;

  const indices = new Uint16Array(seg * seg * 6 + perimeter.length * 6);
  let t = 0;
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * n + i;
      const b = a + n;
      const c = a + 1;
      const d = b + 1;
      // Alternate the diagonal for a less directional look.
      if ((i + j) & 1) {
        indices[t++] = a;
        indices[t++] = b;
        indices[t++] = d;
        indices[t++] = a;
        indices[t++] = d;
        indices[t++] = c;
      } else {
        indices[t++] = a;
        indices[t++] = b;
        indices[t++] = c;
        indices[t++] = c;
        indices[t++] = b;
        indices[t++] = d;
      }
    }
  }
  const P = perimeter.length;
  for (let p = 0; p < P; p++) {
    const t0 = perimeter[p];
    const t1 = perimeter[(p + 1) % P];
    const b0 = gridVerts + p;
    const b1 = gridVerts + ((p + 1) % P);
    indices[t++] = t0;
    indices[t++] = t1;
    indices[t++] = b0;
    indices[t++] = t1;
    indices[t++] = b1;
    indices[t++] = b0;
  }

  return { positions, normals, colors, indices, minY, maxY, cx, cz, lod };
}

export const TREE_SPACING = 11;
export const TREE_STRIDE = 6; // x, y, z, scale, rotation, kind(0 conifer / 1 broadleaf)

/**
 * Scatter trees on a jittered grid, accepting candidates by forest density.
 * Positions are chunk-local. Deterministic for a given seed and chunk.
 */
export function buildTrees(terrain, cx, cz, densityScale = 1) {
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const cells = Math.floor(CHUNK_SIZE / TREE_SPACING);
  const out = [];
  const nrm = [0, 1, 0];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const gx = cx * cells + i;
      const gz = cz * cells + j;
      const r0 = hash2(gx, gz, terrain.seed + 11);
      if (r0 > densityScale) continue; // cheap reject first
      const lx = (i + 0.15 + 0.7 * hash2(gx, gz, terrain.seed + 12)) * TREE_SPACING;
      const lz = (j + 0.15 + 0.7 * hash2(gx, gz, terrain.seed + 13)) * TREE_SPACING;
      const x = ox + lx;
      const z = oz + lz;
      terrain.normalAt(x, z, nrm, 3);
      const s = terrain.sample(x, z);
      const d = terrain.forestDensityFromSample(s, 1 - nrm[1], x, z);
      // Sparse lone trees outside forests, dense inside.
      const accept = d > 0 ? lerp(0.05, 0.95, d) : 0;
      if (hash2(gx, gz, terrain.seed + 14) > accept) continue;
      const h = s.height;
      const conifer = h > 450 ? 0.9 : s.moisture > 0.62 ? 0.35 : 0.6;
      const kind = hash2(gx, gz, terrain.seed + 15) < conifer ? 0 : 1;
      out.push(lx, h - 0.6, lz, 0.75 + 0.6 * hash2(gx, gz, terrain.seed + 16), hash2(gx, gz, terrain.seed + 17) * Math.PI * 2, kind);
    }
  }
  return new Float32Array(out);
}
