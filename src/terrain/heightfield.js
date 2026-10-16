/**
 * The world's single source of truth for terrain shape.
 *
 * `createTerrain(seed)` returns pure functions of (x, z) in metres. They are
 * called by the chunk mesh builder (inside a Web Worker), the collision code,
 * the minimap, airport placement and the tests, so all of them agree exactly.
 * Nothing here imports three.js.
 *
 * Layers, from large to small:
 *   continental  - very low-frequency fBm that decides land vs sea
 *   mountains    - ridged multifractal, masked into ranges
 *   hills        - mid-frequency rolling fBm
 *   detail       - small bumps
 *   rivers       - carved along zero-crossings of a low-frequency noise field
 *   airports     - flattened pads blended into the surroundings
 */
import { createNoise2D, fbm, ridged, smoothstep, lerp, clamp, mulberry32, hash2 } from '../engine/random.js';

export const SEA_LEVEL = 0;
export const MIN_HEIGHT = -120;
export const MAX_HEIGHT = 2400;

export const AIRPORT_CELL = 7000;
export const AIRPORT_MARGIN = 1300;
export const RUNWAY_LENGTH = 1100;
export const RUNWAY_WIDTH = 40;
const PAD_HALF_LENGTH = RUNWAY_LENGTH / 2 + 160;
const PAD_HALF_WIDTH = 170;
const PAD_BLEND = 450;

export const BIOME = { WATER: 0, SAND: 1, GRASS: 2, FOREST: 3, ROCK: 4, SNOW: 5, RUNWAY: 6 };

/**
 * @param {number} seed
 */
export function createTerrain(seed = 1337) {
  seed = seed | 0;
  const nWarp = createNoise2D(seed ^ 0x5bd1e995);
  const nCont = createNoise2D(seed + 101);
  const nMount = createNoise2D(seed + 202);
  const nRidge = createNoise2D(seed + 303);
  const nHill = createNoise2D(seed + 404);
  const nDetail = createNoise2D(seed + 505);
  const nRiver = createNoise2D(seed + 606);
  const nMoist = createNoise2D(seed + 707);
  const nSnow = createNoise2D(seed + 808);

  /** Scratch result reused to avoid allocations in hot loops. */
  const raw = { height: 0, river: 0, valley: 0, mountain: 0, continent: 0 };

  function riverField(wx, wz) {
    const s = 1 / 5200;
    const n = nRiver(wx * s, wz * s) + 0.18 * nRiver(wx * s * 3.1 + 17.3, wz * s * 3.1 - 4.1);
    return n;
  }

  /** Terrain before airports are flattened in. Fills and returns `raw`. */
  function rawSample(x, z) {
    // Domain warp gives coastlines and ranges an organic, non-grid look.
    const wx = x + 420 * fbm(nWarp, x / 3200, z / 3200, 2);
    const wz = z + 420 * fbm(nWarp, x / 3200 + 31.7, z / 3200 + 11.3, 2);

    const c = fbm(nCont, wx / 14000, wz / 14000, 3);
    let base = 38 + 120 * c;
    if (base < 0) base *= 1.7; // deeper seas and lakes

    const land = smoothstep(-0.28, 0.02, c);
    const mRaw = smoothstep(0.1, 0.45, fbm(nMount, wx / 11000, wz / 11000, 3) + 0.2 * c);
    const m = mRaw * land;
    const r = ridged(nRidge, wx / 5200, wz / 5200, 5, 2.0, 0.4);
    const mountains = m * (Math.pow(r, 1.6) * 1550 + 160 * m);

    const hillAmt = 0.25 + 0.75 * smoothstep(-0.2, 0.35, c);
    const hills = (fbm(nHill, wx / 1400, wz / 1400, 4) * 0.5 + 0.5) * 80 * hillAmt * land;
    const detail = fbm(nDetail, x / 170, z / 170, 2) * 5;

    let h = base + hills + mountains + detail;

    // Rivers follow the zero contour of a noise field. Dividing by the
    // gradient turns the noise value into an approximate distance in metres.
    const e = 2;
    const rn = riverField(wx, wz);
    const gx = (riverField(wx + e, wz) - rn) / e;
    const gz = (riverField(wx, wz + e) - rn) / e;
    const grad = Math.max(Math.hypot(gx, gz), 1e-7);
    const dist = Math.abs(rn) / grad;
    // Rivers fade out in high ground (their source), and valleys widen with
    // the height they cut through so banks never become cliffs.
    const strength =
      (1 - smoothstep(0.3, 0.7, mRaw)) * smoothstep(-0.32, -0.12, c) * (1 - smoothstep(160, 380, h));
    const halfW = 28 + 20 * (nDetail(wx / 2400, wz / 2400) * 0.5 + 0.5);
    const valleyW = 340 + Math.max(0, h) * 1.6;
    const valley = (1 - smoothstep(halfW, valleyW, dist)) * strength;
    const channel = (1 - smoothstep(halfW * 0.55, halfW, dist)) * strength;
    if (valley > 0) {
      let carved = lerp(h, 2.2, Math.pow(valley, 1.4));
      carved = lerp(carved, -4.5, channel);
      if (carved < h) h = carved;
    }

    raw.height = clamp(h, MIN_HEIGHT, MAX_HEIGHT);
    raw.river = channel;
    raw.valley = valley;
    raw.mountain = m;
    raw.continent = c;
    return raw;
  }

  // ---------------------------------------------------------------------
  // Airports: at most one per AIRPORT_CELL square, placed on flat land.
  // ---------------------------------------------------------------------
  const airportCache = new Map();

  function airportForCell(ci, cj) {
    const key = ci + ',' + cj;
    if (airportCache.has(key)) return airportCache.get(key);
    let result = null;
    const home = ci === 0 && cj === 0;
    if (home || hash2(ci, cj, seed + 999) < 0.72) {
      const rng = mulberry32(Math.floor(hash2(ci, cj, seed + 4242) * 2 ** 31));
      const tries = home ? 40 : 8;
      for (let t = 0; t < tries && !result; t++) {
        const span = AIRPORT_CELL - 2 * AIRPORT_MARGIN;
        const x = ci * AIRPORT_CELL + AIRPORT_MARGIN + rng() * span;
        const z = cj * AIRPORT_CELL + AIRPORT_MARGIN + rng() * span;
        const heading = rng() * Math.PI;
        result = evaluateSite(x, z, heading, ci, cj);
      }
    }
    if (airportCache.size > 4096) airportCache.clear();
    airportCache.set(key, result);
    return result;
  }

  function evaluateSite(x, z, heading, ci, cj) {
    const dx = Math.sin(heading);
    const dz = Math.cos(heading);
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let n = 0;
    for (let i = -5; i <= 5; i++) {
      for (let j = -1; j <= 1; j++) {
        const u = (i / 5) * PAD_HALF_LENGTH;
        const v = j * PAD_HALF_WIDTH;
        const px = x + dx * u + dz * v;
        const pz = z + dz * u - dx * v;
        const s = rawSample(px, pz);
        if (s.valley > 0.05 || s.mountain > 0.25) return null;
        min = Math.min(min, s.height);
        max = Math.max(max, s.height);
        sum += s.height;
        n++;
      }
    }
    if (min < 6 || max - min > 80) return null;
    const elevation = Math.round(sum / n + 1.5);
    return {
      id: `${ci},${cj}`,
      x,
      z,
      heading, // radians, runway direction measured from +Z toward +X
      elevation,
      length: RUNWAY_LENGTH,
      width: RUNWAY_WIDTH,
      name: airportName(ci, cj),
    };
  }

  function airportName(ci, cj) {
    const a = ['North', 'Pine', 'Eagle', 'River', 'Cedar', 'Stone', 'Willow', 'Falcon', 'Lake', 'Summit', 'Copper', 'Bay'];
    const b = ['field', ' Valley', ' Ridge', ' Point', ' Meadows', ' Hollow', 'brook', ' Crossing', ' Downs', ' Flats'];
    const h1 = Math.floor(hash2(ci, cj, seed + 77) * a.length);
    const h2 = Math.floor(hash2(cj, ci, seed + 78) * b.length);
    const code = String.fromCharCode(65 + (Math.abs(ci * 7 + cj * 13) % 26), 65 + (Math.abs(ci * 3 - cj * 5) % 26));
    return { full: a[h1] + b[h2], code: 'K' + code + String.fromCharCode(65 + (Math.abs(ci + cj * 11) % 26)) };
  }

  /** Airport-local coordinates: u along the runway, v across it. */
  function toLocal(ap, x, z) {
    const dx = Math.sin(ap.heading);
    const dz = Math.cos(ap.heading);
    const rx = x - ap.x;
    const rz = z - ap.z;
    return { u: rx * dx + rz * dz, v: rx * dz - rz * dx };
  }

  /** 1 inside the flattened pad, fading to 0 over PAD_BLEND metres. */
  function airportBlend(ap, x, z) {
    const dx = Math.sin(ap.heading);
    const dz = Math.cos(ap.heading);
    const rx = x - ap.x;
    const rz = z - ap.z;
    const u = rx * dx + rz * dz;
    const v = rx * dz - rz * dx;
    const qx = Math.abs(u) - PAD_HALF_LENGTH;
    const qz = Math.abs(v) - PAD_HALF_WIDTH;
    lastU = u;
    lastV = v;
    if (qx > PAD_BLEND || qz > PAD_BLEND) return 0;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
    return 1 - smoothstep(0, PAD_BLEND, outside);
  }
  let lastU = 0;
  let lastV = 0;

  const out = { height: 0, river: 0, valley: 0, mountain: 0, continent: 0, moisture: 0, airport: 0, runway: false };

  /**
   * Full sample at (x, z). Returns a shared object; copy fields you keep.
   */
  function sample(x, z) {
    const r = rawSample(x, z);
    let h = r.height;
    let airport = 0;
    let runway = false;
    const ap = airportForCell(Math.floor(x / AIRPORT_CELL), Math.floor(z / AIRPORT_CELL));
    if (ap) {
      airport = airportBlend(ap, x, z);
      if (airport > 0) {
        h = lerp(h, ap.elevation, airport);
        runway = Math.abs(lastU) <= ap.length / 2 && Math.abs(lastV) <= ap.width / 2;
      }
    }
    out.height = h;
    out.river = r.river * (1 - airport);
    out.valley = r.valley * (1 - airport);
    out.mountain = r.mountain;
    out.continent = r.continent;
    out.airport = airport;
    out.runway = runway;
    out.moisture = clamp(fbm(nMoist, x / 4200, z / 4200, 3) * 0.6 + 0.5 + r.valley * 0.35, 0, 1);
    return out;
  }

  function heightAt(x, z) {
    return sample(x, z).height;
  }

  /** Surface normal via central differences. Writes into `target` [x,y,z]. */
  function normalAt(x, z, target = [0, 1, 0], e = 1.5) {
    const hl = heightAt(x - e, z);
    const hr = heightAt(x + e, z);
    const hd = heightAt(x, z - e);
    const hu = heightAt(x, z + e);
    let nx = hl - hr;
    let ny = 2 * e;
    let nz = hd - hu;
    const len = Math.hypot(nx, ny, nz);
    target[0] = nx / len;
    target[1] = ny / len;
    target[2] = nz / len;
    return target;
  }

  /** Snow line varies so peaks are not capped by a perfectly flat contour. */
  function snowLine(x, z) {
    return 980 + 160 * nSnow(x / 1500, z / 1500);
  }

  /**
   * Classify a point given its sample and slope (1 - normal.y).
   * Shared by the mesh colouring and the tests.
   */
  function biome(s, slope, x, z) {
    if (s.runway) return BIOME.RUNWAY;
    if (s.height < SEA_LEVEL + 0.4) return BIOME.WATER;
    if (s.height < SEA_LEVEL + 3.5 && s.airport < 0.5) return BIOME.SAND;
    if (s.height > snowLine(x, z) && slope < 0.55) return BIOME.SNOW;
    if (slope > 0.32 || s.height > 1350) return BIOME.ROCK;
    if (forestDensityFrom(s, slope, x, z) > 0.35) return BIOME.FOREST;
    return BIOME.GRASS;
  }

  function forestDensityFrom(s, slope, x, z) {
    if (s.height < SEA_LEVEL + 4 || s.airport > 0.02 || s.river > 0.01) return 0;
    const altFade = 1 - smoothstep(750, 1050, s.height);
    const slopeFade = 1 - smoothstep(0.18, 0.32, slope);
    const patch = fbm(nMoist, x / 900 + 50, z / 900 - 20, 3) * 0.5 + 0.5;
    return clamp((s.moisture * 0.9 + patch * 0.7 - 0.75) * 2.2, 0, 1) * altFade * slopeFade;
  }

  /** 0..1 tree density at (x, z). */
  function forestDensity(x, z) {
    const n = normalAt(x, z, scratchN, 3);
    const s = sample(x, z);
    return forestDensityFrom(s, 1 - n[1], x, z);
  }
  const scratchN = [0, 1, 0];

  /** All airports whose cell intersects a square of `radius` around (x, z). */
  function airportsNear(x, z, radius) {
    const list = [];
    const i0 = Math.floor((x - radius) / AIRPORT_CELL);
    const i1 = Math.floor((x + radius) / AIRPORT_CELL);
    const j0 = Math.floor((z - radius) / AIRPORT_CELL);
    const j1 = Math.floor((z + radius) / AIRPORT_CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const ap = airportForCell(i, j);
        if (ap) list.push(ap);
      }
    }
    return list;
  }

  /** Nearest airport, searching outward ring by ring. */
  function nearestAirport(x, z, maxRings = 6) {
    const ci = Math.floor(x / AIRPORT_CELL);
    const cj = Math.floor(z / AIRPORT_CELL);
    let best = null;
    let bestD = Infinity;
    for (let ring = 0; ring <= maxRings; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) {
        for (let j = cj - ring; j <= cj + ring; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
          const ap = airportForCell(i, j);
          if (!ap) continue;
          const d = Math.hypot(ap.x - x, ap.z - z);
          if (d < bestD) {
            bestD = d;
            best = ap;
          }
        }
      }
      // Anything in a further ring is at least ring*cell away.
      if (best && bestD < ring * AIRPORT_CELL) break;
    }
    return best;
  }

  return {
    seed,
    sample,
    heightAt,
    normalAt,
    biome,
    forestDensity,
    snowLine,
    airportForCell,
    airportsNear,
    nearestAirport,
    toLocal,
  };
}
