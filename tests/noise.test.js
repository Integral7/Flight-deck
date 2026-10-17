import { describe, it, expect } from 'vitest';
import { mulberry32, hash2, createNoise2D, fbm, ridged, smoothstep } from '../src/engine/random.js';

describe('mulberry32', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('produces roughly uniform values in [0,1)', () => {
    const r = mulberry32(7);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / n).toBeCloseTo(0.5, 1);
  });
});

describe('hash2', () => {
  it('is stable and seed-dependent', () => {
    expect(hash2(3, 4, 1)).toBe(hash2(3, 4, 1));
    expect(hash2(3, 4, 1)).not.toBe(hash2(3, 4, 2));
    expect(hash2(3, 4, 1)).not.toBe(hash2(4, 3, 1));
  });
});

describe('simplex noise', () => {
  const n = createNoise2D(1);

  it('stays within [-1, 1]', () => {
    for (let i = 0; i < 5000; i++) {
      const v = n(i * 0.731 - 300, i * 1.37 + 50);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
    }
  });

  it('is deterministic and differs between seeds', () => {
    const m = createNoise2D(1);
    const o = createNoise2D(2);
    let diff = 0;
    for (let i = 0; i < 100; i++) {
      expect(n(i * 0.3, i * 0.7)).toBe(m(i * 0.3, i * 0.7));
      diff += Math.abs(n(i * 0.3, i * 0.7) - o(i * 0.3, i * 0.7));
    }
    expect(diff).toBeGreaterThan(1);
  });

  it('is continuous', () => {
    for (let i = 0; i < 1000; i++) {
      const x = i * 0.917;
      const y = i * 0.533;
      expect(Math.abs(n(x, y) - n(x + 1e-4, y))).toBeLessThan(1e-2);
    }
  });

  it('fbm and ridged stay in range', () => {
    for (let i = 0; i < 2000; i++) {
      const f = fbm(n, i * 0.13, i * 0.29, 5);
      const r = ridged(n, i * 0.13, i * 0.29, 5);
      expect(Math.abs(f)).toBeLessThanOrEqual(1.0001);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1.0001);
    }
  });

  it('smoothstep clamps', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });
});
