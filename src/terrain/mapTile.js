/**
 * Pure map-tile rasteriser for the minimap and the large map. Produces RGBA
 * pixels coloured by elevation/biome with hill shading, north up (+row =
 * +Z = south).
 */
import { SEA_LEVEL } from './heightfield.js';
import { clamp, smoothstep } from '../engine/random.js';

export const MAP_LEVELS = [
  { tile: 2048, px: 64 }, // minimap: 32 m per pixel
  { tile: 8192, px: 128 }, // large map: 64 m per pixel
];

const WATER_DEEP = [28, 64, 104];
const WATER_SHALLOW = [52, 112, 150];
const SAND = [214, 200, 150];
const LOW = [112, 156, 82];
const FOREST = [62, 108, 58];
const HIGH = [150, 140, 112];
const ROCK = [128, 122, 116];
const SNOW = [240, 242, 248];
const RUNWAY = [60, 60, 64];

function mix(a, b, t, out) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

export function mapColor(terrain, s, x, z, out = [0, 0, 0]) {
  const h = s.height;
  if (h < SEA_LEVEL) return mix(WATER_SHALLOW, WATER_DEEP, smoothstep(0, -40, h), out);
  if (s.runway) {
    out[0] = RUNWAY[0];
    out[1] = RUNWAY[1];
    out[2] = RUNWAY[2];
    return out;
  }
  mix(LOW, FOREST, smoothstep(0.25, 0.6, terrain.forestDensityFromSample(s, 0.05, x, z)), out);
  if (h < SEA_LEVEL + 3) mix(out, SAND, 1 - smoothstep(SEA_LEVEL + 1, SEA_LEVEL + 3, h), out);
  mix(out, HIGH, smoothstep(250, 700, h), out);
  mix(out, ROCK, smoothstep(700, 1200, h), out);
  mix(out, SNOW, smoothstep(terrain.snowLine(x, z) - 80, terrain.snowLine(x, z) + 80, h), out);
  return out;
}

/**
 * @returns {Uint8ClampedArray} px*px*4 RGBA
 */
export function buildMapTile(terrain, tx, tz, level) {
  const { tile, px } = MAP_LEVELS[level];
  const step = tile / px;
  const ox = tx * tile;
  const oz = tz * tile;
  const n = px + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = terrain.heightAt(ox + i * step, oz + j * step);
  const out = new Uint8ClampedArray(px * px * 4);
  const c = [0, 0, 0];
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      const x = ox + (i + 0.5) * step;
      const z = oz + (j + 0.5) * step;
      const s = terrain.sample(x, z);
      mapColor(terrain, s, x, z, c);
      // Hill shading from the NW (classic cartographic light).
      const h00 = heights[j * n + i];
      const h10 = heights[j * n + i + 1];
      const h01 = heights[(j + 1) * n + i];
      const dx = (h10 - h00) / step;
      const dz = (h01 - h00) / step;
      const shade = s.height < SEA_LEVEL ? 1 : clamp(1 + (-dx - dz) * 0.9, 0.55, 1.35);
      const o = (j * px + i) * 4;
      out[o] = c[0] * shade;
      out[o + 1] = c[1] * shade;
      out[o + 2] = c[2] * shade;
      out[o + 3] = 255;
    }
  }
  return out;
}
