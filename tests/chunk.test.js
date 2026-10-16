import { describe, it, expect } from 'vitest';
import { createTerrain, SEA_LEVEL } from '../src/terrain/heightfield.js';
import { buildChunk, buildTrees, CHUNK_SIZE, LOD_SEGMENTS, SKIRT_DEPTH, TREE_STRIDE } from '../src/terrain/chunk.js';

const terrain = createTerrain(1337);

/** Height of grid vertex (i, j) of a built chunk. */
function vh(c, i, j) {
  const n = LOD_SEGMENTS[c.lod] + 1;
  return c.positions[(j * n + i) * 3 + 1];
}

describe('chunk mesh', () => {
  const a = buildChunk(terrain, 2, -1, 0);

  it('has consistent array sizes and valid indices', () => {
    const seg = LOD_SEGMENTS[0];
    const verts = (seg + 1) ** 2 + 4 * seg;
    expect(a.positions.length).toBe(verts * 3);
    expect(a.normals.length).toBe(verts * 3);
    expect(a.colors.length).toBe(verts * 3);
    expect(a.indices.length % 3).toBe(0);
    for (const i of a.indices) expect(i).toBeLessThan(verts);
    for (const v of a.positions) expect(Number.isFinite(v)).toBe(true);
    for (const v of a.colors) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('matches the heightfield exactly at grid vertices', () => {
    const step = CHUNK_SIZE / LOD_SEGMENTS[0];
    for (const [i, j] of [[0, 0], [5, 7], [64, 64], [33, 12]]) {
      const x = 2 * CHUNK_SIZE + i * step;
      const z = -1 * CHUNK_SIZE + j * step;
      expect(vh(a, i, j)).toBeCloseTo(terrain.heightAt(x, z), 3);
    }
  });

  it('is deterministic', () => {
    const b = buildChunk(terrain, 2, -1, 0);
    expect(b.positions).toEqual(a.positions);
    expect(b.colors).toEqual(a.colors);
  });

  it('grid triangles face upward and skirt triangles face outward', () => {
    const seg = LOD_SEGMENTS[0];
    const gridTris = seg * seg;
    const p = a.positions;
    let skirtOutward = 0;
    for (let t = 0; t < a.indices.length / 3; t++) {
      const [i0, i1, i2] = [a.indices[t * 3], a.indices[t * 3 + 1], a.indices[t * 3 + 2]];
      const ax = p[i1 * 3] - p[i0 * 3];
      const ay = p[i1 * 3 + 1] - p[i0 * 3 + 1];
      const az = p[i1 * 3 + 2] - p[i0 * 3 + 2];
      const bx = p[i2 * 3] - p[i0 * 3];
      const by = p[i2 * 3 + 1] - p[i0 * 3 + 1];
      const bz = p[i2 * 3 + 2] - p[i0 * 3 + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      if (t < gridTris * 2) {
        expect(ny).toBeGreaterThan(0);
      } else {
        // Outward = away from the chunk centre.
        const cx = (p[i0 * 3] + p[i1 * 3] + p[i2 * 3]) / 3 - CHUNK_SIZE / 2;
        const cz = (p[i0 * 3 + 2] + p[i1 * 3 + 2] + p[i2 * 3 + 2]) / 3 - CHUNK_SIZE / 2;
        if (nx * cx + nz * cz > 0) skirtOutward++;
      }
    }
    expect(skirtOutward).toBe(a.indices.length / 3 - gridTris * 2);
  });

  it('skirts hang below the edge by the LOD skirt depth', () => {
    const seg = LOD_SEGMENTS[0];
    const gridVerts = (seg + 1) ** 2;
    // First skirt vertex is below grid vertex (0,0).
    expect(a.positions[gridVerts * 3 + 1]).toBeCloseTo(vh(a, 0, 0) - SKIRT_DEPTH[0], 4);
  });
});

describe('chunk seams', () => {
  it('neighbouring chunks at the same LOD share identical edge heights', () => {
    for (let lod = 0; lod < LOD_SEGMENTS.length; lod++) {
      const left = buildChunk(terrain, 0, 0, lod);
      const right = buildChunk(terrain, 1, 0, lod);
      const below = buildChunk(terrain, 0, 1, lod);
      const seg = LOD_SEGMENTS[lod];
      for (let k = 0; k <= seg; k++) {
        expect(vh(right, 0, k)).toBe(vh(left, seg, k));
        expect(vh(below, k, 0)).toBe(vh(left, k, seg));
      }
    }
  });

  it('LOD transitions: coarse vertices coincide with fine ones and gaps are covered by skirts', () => {
    // Search a few rough areas for the worst case.
    const coords = [[0, 0], [4, -3], [-6, 5], [10, 10], [-12, -8], [20, -15]];
    for (let lod = 0; lod < LOD_SEGMENTS.length - 1; lod++) {
      for (const [cx, cz] of coords) {
        const fine = buildChunk(terrain, cx, cz, lod);
        const coarse = buildChunk(terrain, cx + 1, cz, lod + 1);
        const segF = LOD_SEGMENTS[lod];
        const segC = LOD_SEGMENTS[lod + 1];
        const ratio = segF / segC;
        let maxGap = 0;
        for (let k = 0; k <= segF; k++) {
          const hf = vh(fine, segF, k);
          const kc = k / ratio;
          const k0 = Math.floor(kc);
          const k1 = Math.min(segC, k0 + 1);
          const t = kc - k0;
          const hc = vh(coarse, 0, k0) * (1 - t) + vh(coarse, 0, k1) * t;
          if (t === 0) expect(hf).toBe(vh(coarse, 0, k0));
          maxGap = Math.max(maxGap, Math.abs(hf - hc));
        }
        // The finer chunk's skirt (or the coarse one's) must cover any crack.
        expect(maxGap).toBeLessThan(Math.max(SKIRT_DEPTH[lod], SKIRT_DEPTH[lod + 1]));
      }
    }
  });
});

describe('trees', () => {
  const trees = buildTrees(terrain, 3, 2, 1);

  it('are deterministic', () => {
    expect(buildTrees(terrain, 3, 2, 1)).toEqual(trees);
  });

  it('stay inside the chunk, sit on the ground and avoid water', () => {
    expect(trees.length % TREE_STRIDE).toBe(0);
    for (let o = 0; o < trees.length; o += TREE_STRIDE) {
      const x = trees[o];
      const y = trees[o + 1];
      const z = trees[o + 2];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(CHUNK_SIZE);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(CHUNK_SIZE);
      const ground = terrain.heightAt(3 * CHUNK_SIZE + x, 2 * CHUNK_SIZE + z);
      expect(Math.abs(y + 0.6 - ground)).toBeLessThan(0.01);
      expect(ground).toBeGreaterThan(SEA_LEVEL);
      expect([0, 1]).toContain(trees[o + 5]);
    }
  });

  it('scale with the density setting', () => {
    let full = 0;
    let low = 0;
    for (let i = -3; i <= 3; i++) {
      full += buildTrees(terrain, i, 1, 1).length;
      low += buildTrees(terrain, i, 1, 0.4).length;
    }
    expect(full).toBeGreaterThan(0);
    expect(low).toBeLessThan(full * 0.6);
  });
});
