import { describe, it, expect } from 'vitest';
import { sunDirection, sunElevation, moonDirection, skyState, wrapHours, formatClock, SUNRISE, SUNSET } from '../src/world/dayNight.js';

const DEG = Math.PI / 180;

describe('sun path', () => {
  it('rises in the east at sunrise and sets in the west at sunset', () => {
    const rise = sunDirection(SUNRISE);
    const set = sunDirection(SUNSET);
    expect(Math.abs(rise[1])).toBeLessThan(0.01);
    expect(Math.abs(set[1])).toBeLessThan(0.01);
    expect(rise[0]).toBeGreaterThan(0.9); // +X is east
    expect(set[0]).toBeLessThan(-0.9);
  });

  it('is highest at noon, due south, and below the horizon at midnight', () => {
    const noon = sunDirection(12);
    expect(noon[0]).toBeCloseTo(0, 6);
    expect(noon[2]).toBeGreaterThan(0); // south is +Z
    for (const h of [7, 9, 11, 13, 15, 17]) expect(sunElevation(12)).toBeGreaterThanOrEqual(sunElevation(h));
    expect(sunElevation(0)).toBeLessThan(-30 * DEG);
  });

  it('returns unit vectors and is periodic', () => {
    for (let h = -24; h <= 48; h += 1.7) {
      const d = sunDirection(h);
      expect(Math.hypot(...d)).toBeCloseTo(1, 9);
      expect(sunDirection(h + 24)[1]).toBeCloseTo(d[1], 9);
      const m = moonDirection(h);
      expect(Math.hypot(...m)).toBeCloseTo(1, 9);
      expect(m[1]).toBeGreaterThan(0);
    }
  });
});

describe('sky state', () => {
  it('day is bright, night is dark and starry', () => {
    const day = skyState(sunElevation(12));
    const night = skyState(sunElevation(0));
    expect(day.sunIntensity).toBeGreaterThan(2);
    expect(night.sunIntensity).toBe(0);
    expect(night.stars).toBe(1);
    expect(day.stars).toBe(0);
    expect(night.night).toBe(1);
    expect(day.night).toBe(0);
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(day.zenith)).toBeGreaterThan(lum(night.zenith) * 4);
  });

  it('sunset horizon is warm', () => {
    const st = skyState(1 * DEG);
    expect(st.horizon[0]).toBeGreaterThan(st.horizon[2]);
  });

  it('changes continuously with elevation (no jumps between keyframes)', () => {
    let prev = skyState(-30 * DEG);
    for (let e = -29.9; e <= 80; e += 0.1) {
      const st = skyState(e * DEG);
      expect(Math.abs(st.sunIntensity - prev.sunIntensity)).toBeLessThan(0.1);
      expect(Math.abs(st.hemiIntensity - prev.hemiIntensity)).toBeLessThan(0.05);
      for (let k = 0; k < 3; k++) expect(Math.abs(st.horizon[k] - prev.horizon[k])).toBeLessThan(0.06);
      prev = st;
    }
  });

  it('colours stay in [0, 1]', () => {
    for (let e = -40; e <= 90; e += 3) {
      const st = skyState(e * DEG);
      for (const key of ['zenith', 'horizon', 'sunColor', 'hemiSky', 'hemiGround', 'fog']) {
        for (const v of st[key]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('clock helpers', () => {
  it('wraps hours and formats a clock', () => {
    expect(wrapHours(25)).toBe(1);
    expect(wrapHours(-1)).toBe(23);
    expect(formatClock(7.5)).toBe('07:30');
    expect(formatClock(23.99)).toBe('23:59');
  });
});
