import { describe, it, expect } from 'vitest';
import {
  createTerrain,
  BIOME,
  MIN_HEIGHT,
  MAX_HEIGHT,
  SEA_LEVEL,
  AIRPORT_CELL,
  AIRPORT_MARGIN,
} from '../src/terrain/heightfield.js';
import { mulberry32 } from '../src/engine/random.js';

const terrain = createTerrain(1337);

function randomPoints(n, range = 30000, seed = 3) {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => [(r() - 0.5) * range, (r() - 0.5) * range]);
}

describe('heightfield', () => {
  it('is deterministic for a given seed', () => {
    const again = createTerrain(1337);
    for (const [x, z] of randomPoints(300)) {
      expect(again.heightAt(x, z)).toBe(terrain.heightAt(x, z));
    }
  });

  it('differs between seeds', () => {
    const other = createTerrain(4242);
    let diff = 0;
    for (const [x, z] of randomPoints(200)) diff += Math.abs(other.heightAt(x, z) - terrain.heightAt(x, z));
    expect(diff / 200).toBeGreaterThan(20);
  });

  it('stays within height bounds and is finite', () => {
    for (const [x, z] of randomPoints(4000, 200000)) {
      const h = terrain.heightAt(x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(MIN_HEIGHT);
      expect(h).toBeLessThanOrEqual(MAX_HEIGHT);
    }
  });

  it('has a mix of sea, lowland and mountains', () => {
    let water = 0;
    let high = 0;
    const pts = randomPoints(4000, 60000, 11);
    for (const [x, z] of pts) {
      const h = terrain.heightAt(x, z);
      if (h < SEA_LEVEL) water++;
      if (h > 500) high++;
    }
    expect(water / pts.length).toBeGreaterThan(0.03);
    expect(water / pts.length).toBeLessThan(0.45);
    expect(high / pts.length).toBeGreaterThan(0.01);
  });

  it('is continuous: height differences shrink linearly with step size', () => {
    for (const [x, z] of randomPoints(3000, 40000, 5)) {
      const h = terrain.heightAt(x, z);
      const big = Math.abs(terrain.heightAt(x + 0.5, z) - h);
      const small = Math.abs(terrain.heightAt(x + 0.05, z) - h);
      // A discontinuity would leave `small` as large as `big`.
      expect(small).toBeLessThanOrEqual(big * 0.2 + 0.02);
    }
  });

  it('keeps slopes plausible: steep faces are rare, sheer cliffs absent', () => {
    let steep = 0;
    const pts = randomPoints(6000, 40000, 6);
    for (const [x, z] of pts) {
      const h = terrain.heightAt(x, z);
      const slope = Math.max(
        Math.abs(terrain.heightAt(x + 0.5, z) - h),
        Math.abs(terrain.heightAt(x, z + 0.5) - h),
      ) / 0.5;
      if (slope > 2) steep++;
      expect(slope).toBeLessThan(14);
    }
    expect(steep / pts.length).toBeLessThan(0.02);
  });

  it('works at large coordinates (infinite world)', () => {
    const far = 3_000_000;
    const h = terrain.heightAt(far, -far);
    expect(Number.isFinite(h)).toBe(true);
    expect(Math.abs(terrain.heightAt(far + 0.5, -far) - h)).toBeLessThan(4);
  });

  it('returns unit normals pointing up', () => {
    const n = [0, 0, 0];
    for (const [x, z] of randomPoints(200)) {
      terrain.normalAt(x, z, n);
      expect(Math.hypot(...n)).toBeCloseTo(1, 6);
      expect(n[1]).toBeGreaterThan(0);
    }
  });
});

describe('rivers', () => {
  // Scan a grid for river channel samples.
  const riverPts = [];
  for (let i = 0; i < 160 && riverPts.length < 60; i++) {
    for (let j = 0; j < 160 && riverPts.length < 60; j++) {
      const x = (i - 80) * 97;
      const z = (j - 80) * 97;
      const s = terrain.sample(x, z);
      if (s.river > 0.95 && s.airport === 0) riverPts.push([x, z, s.height]);
    }
  }

  it('exist near the origin for the default seed', () => {
    expect(riverPts.length).toBeGreaterThan(10);
  });

  it('carve channels below sea level so they fill with water', () => {
    for (const [, , h] of riverPts) expect(h).toBeLessThan(SEA_LEVEL);
  });

  it('sit below the surrounding terrain', () => {
    for (const [x, z, h] of riverPts) {
      const around =
        (terrain.heightAt(x + 400, z) +
          terrain.heightAt(x - 400, z) +
          terrain.heightAt(x, z + 400) +
          terrain.heightAt(x, z - 400)) /
        4;
      expect(around).toBeGreaterThan(h);
    }
  });
});

describe('airports', () => {
  it('the default seed has a home airport near the origin', () => {
    const home = terrain.nearestAirport(0, 0);
    expect(home).toBeTruthy();
    expect(Math.hypot(home.x, home.z)).toBeLessThan(AIRPORT_CELL * 1.5);
  });

  it('are deterministic and stay inside their cell margin', () => {
    const again = createTerrain(1337);
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const a = terrain.airportForCell(i, j);
        const b = again.airportForCell(i, j);
        expect(b).toEqual(a);
        if (!a) continue;
        expect(a.x).toBeGreaterThanOrEqual(i * AIRPORT_CELL + AIRPORT_MARGIN);
        expect(a.x).toBeLessThanOrEqual((i + 1) * AIRPORT_CELL - AIRPORT_MARGIN);
        expect(a.z).toBeGreaterThanOrEqual(j * AIRPORT_CELL + AIRPORT_MARGIN);
        expect(a.z).toBeLessThanOrEqual((j + 1) * AIRPORT_CELL - AIRPORT_MARGIN);
      }
    }
  });

  it('runways are perfectly flat, dry and flagged as runway', () => {
    const list = terrain.airportsNear(0, 0, 20000);
    expect(list.length).toBeGreaterThan(3);
    for (const ap of list) {
      expect(ap.elevation).toBeGreaterThan(SEA_LEVEL);
      const dx = Math.sin(ap.heading);
      const dz = Math.cos(ap.heading);
      for (let k = -10; k <= 10; k++) {
        const u = (k / 10) * (ap.length / 2 - 1);
        for (const v of [-ap.width / 2 + 1, 0, ap.width / 2 - 1]) {
          const x = ap.x + dx * u + dz * v;
          const z = ap.z + dz * u - dx * v;
          const s = terrain.sample(x, z);
          expect(s.height).toBeCloseTo(ap.elevation, 6);
          expect(s.runway).toBe(true);
          expect(s.river).toBe(0);
        }
      }
    }
  });

  it('nearestAirport finds airports from far away too', () => {
    const ap = terrain.nearestAirport(123456, -654321);
    expect(ap).toBeTruthy();
    expect(Math.hypot(ap.x - 123456, ap.z + 654321)).toBeLessThan(AIRPORT_CELL * 6);
  });
});

describe('biomes', () => {
  const n = [0, 1, 0];
  it('classify consistently with height and slope', () => {
    for (const [x, z] of randomPoints(3000, 60000, 9)) {
      terrain.normalAt(x, z, n);
      const slope = 1 - n[1];
      const s = { ...terrain.sample(x, z) };
      const b = terrain.biome(s, slope, x, z);
      if (s.runway) {
        expect(b).toBe(BIOME.RUNWAY);
        continue;
      }
      if (s.height < SEA_LEVEL) expect(b).toBe(BIOME.WATER);
      if (b === BIOME.WATER) expect(s.height).toBeLessThan(SEA_LEVEL + 0.5);
      if (b === BIOME.SNOW) expect(s.height).toBeGreaterThan(terrain.snowLine(x, z));
      if (b === BIOME.FOREST) expect(slope).toBeLessThan(0.35);
    }
  });

  it('forest density is in [0,1] and zero on water and runways', () => {
    for (const [x, z] of randomPoints(1500, 40000, 12)) {
      const d = terrain.forestDensity(x, z);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      const s = terrain.sample(x, z);
      if (s.height < SEA_LEVEL || s.runway) expect(d).toBe(0);
    }
  });
});
