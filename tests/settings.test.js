import { describe, it, expect } from 'vitest';
import { Settings, QUALITY_PRESETS, DEFAULT_SEED, guessQuality, DAY_CYCLES } from '../src/engine/settings.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

describe('quality presets', () => {
  it('low < medium < high in cost-driving settings', () => {
    const { low, medium, high } = QUALITY_PRESETS;
    for (const k of ['viewRadius', 'treeRadius', 'treeDensity', 'cloudCount', 'rainCount', 'pixelRatioCap']) {
      expect(low[k]).toBeLessThan(medium[k]);
      expect(medium[k]).toBeLessThanOrEqual(high[k]);
    }
    expect(low.shadows).toBe(false);
    expect(high.shadows).toBe(true);
    expect(high.shadowMapSize).toBeGreaterThan(medium.shadowMapSize);
  });

  it('LOD thresholds increase and fit inside the view radius', () => {
    for (const p of Object.values(QUALITY_PRESETS)) {
      for (let i = 1; i < p.lodDistances.length; i++) expect(p.lodDistances[i]).toBeGreaterThan(p.lodDistances[i - 1]);
      expect(p.lodDistances[p.lodDistances.length - 1]).toBeLessThan(p.viewRadius);
    }
  });

  it('guesses low for touch devices and few cores', () => {
    expect(guessQuality({ maxTouchPoints: 5, hardwareConcurrency: 8 })).toBe('low');
    expect(guessQuality({ maxTouchPoints: 0, hardwareConcurrency: 4 })).toBe('low');
    expect(guessQuality({ maxTouchPoints: 0, hardwareConcurrency: 8 })).toBe('medium');
    expect(guessQuality({ maxTouchPoints: 0, hardwareConcurrency: 16 })).toBe('high');
  });
});

describe('settings', () => {
  it('persists values and notifies listeners', () => {
    const storage = memoryStorage();
    const a = new Settings(storage);
    const seen = [];
    a.onChange((k, v) => seen.push([k, v]));
    a.set('quality', 'high');
    a.set('aircraft', 'bush');
    a.set('aircraft', 'bush'); // unchanged: no event
    expect(seen).toEqual([['quality', 'high'], ['aircraft', 'bush']]);
    const b = new Settings(storage);
    expect(b.get('quality')).toBe('high');
    expect(b.get('aircraft')).toBe('bush');
    expect(b.preset).toBe(QUALITY_PRESETS.high);
  });

  it('survives corrupt or unavailable storage', () => {
    const bad = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
    const s = new Settings(bad);
    expect(QUALITY_PRESETS[s.get('quality')]).toBeTruthy();
    expect(() => s.set('quality', 'low')).not.toThrow();
    const none = new Settings(null);
    expect(none.get('seed')).toBe(DEFAULT_SEED);
  });

  it('falls back from an unknown quality name', () => {
    const storage = memoryStorage();
    storage.setItem('flightdeck.settings.v1', JSON.stringify({ quality: 'ultra' }));
    expect(new Settings(storage).get('quality')).toBe('medium');
  });

  it('uses the fixed seed by default and a random one when asked', () => {
    const s = new Settings(memoryStorage());
    expect(s.resolveSeed()).toBe(DEFAULT_SEED);
    s.set('randomSeed', true);
    const a = s.resolveSeed(() => 0.25);
    const b = s.resolveSeed(() => 0.75);
    expect(a).not.toBe(b);
    expect(Number.isInteger(a)).toBe(true);
  });

  it('day cycle rates are ordered', () => {
    expect(DAY_CYCLES.off.rate).toBe(0);
    expect(DAY_CYCLES.slow.rate).toBeLessThan(DAY_CYCLES.normal.rate);
    expect(DAY_CYCLES.normal.rate).toBeLessThan(DAY_CYCLES.fast.rate);
  });
});
