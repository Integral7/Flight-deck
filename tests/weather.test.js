import { describe, it, expect } from 'vitest';
import { Weather, WEATHER_PRESETS, WEATHER_ORDER, lerpWeather } from '../src/world/weather.js';

function run(w, seconds, altitude = 500) {
  for (let t = 0; t < seconds; t += 0.1) w.update(0.1, altitude);
  return w;
}

describe('weather', () => {
  it('lerpWeather hits both endpoints and the midpoint', () => {
    const a = WEATHER_PRESETS.clear;
    const b = WEATHER_PRESETS.rain;
    expect(lerpWeather(a, b, 0).visibility).toBe(a.visibility);
    expect(lerpWeather(a, b, 1).rain).toBe(b.rain);
    expect(lerpWeather(a, b, 0.5).cover).toBeCloseTo((a.cover + b.cover) / 2, 9);
    expect(lerpWeather(a, b, 7).rain).toBe(b.rain); // clamped
  });

  it('transitions smoothly to the target preset', () => {
    const w = new Weather('clear');
    w.set('rain');
    run(w, 5);
    expect(w.current.rain).toBeGreaterThan(0);
    expect(w.current.rain).toBeLessThan(1);
    run(w, w.duration + 1);
    expect(w.current.rain).toBe(1);
    expect(w.current.visibility).toBeCloseTo(WEATHER_PRESETS.rain.visibility, 9);
  });

  it('instant set applies immediately', () => {
    const w = new Weather('clear');
    w.set('fog', true);
    expect(w.current.visibility).toBe(WEATHER_PRESETS.fog.visibility);
  });

  it('cycles through every preset and wraps around', () => {
    const w = new Weather(WEATHER_ORDER[0]);
    const seen = [w.name];
    for (let i = 0; i < WEATHER_ORDER.length; i++) seen.push(w.cycle());
    expect(seen.slice(0, WEATHER_ORDER.length)).toEqual(WEATHER_ORDER);
    expect(seen[WEATHER_ORDER.length]).toBe(WEATHER_ORDER[0]);
  });

  it('wind blows away from the direction it comes from', () => {
    const w = new Weather('rain', 0);
    w.windDir = 0; // from the north
    w.update(0.01);
    expect(w.wind.z).toBeGreaterThan(0); // toward the south (+Z)
    expect(Math.abs(w.wind.x)).toBeLessThan(0.5);
    const r = w.windReport();
    expect(r.knots).toBeGreaterThan(10);
    expect(r.from === 0 || r.from === 360).toBe(true);
  });

  it('rain is rougher than clear air, and low level adds turbulence', () => {
    const clear = run(new Weather('clear'), 1);
    const rain = run(new Weather('rain'), 1);
    expect(rain.turbulenceAt(1000)).toBeGreaterThan(clear.turbulenceAt(1000));
    expect(rain.turbulenceAt(20)).toBeGreaterThan(rain.turbulenceAt(1000));
  });

  it('flying inside an overcast layer reduces visibility', () => {
    const w = new Weather('overcast');
    const base = WEATHER_PRESETS.overcast.cloudBase;
    run(w, 5, base - 400);
    const below = w.visibility();
    run(w, 5, base + 100);
    expect(w.inCloud).toBeGreaterThan(0.5);
    expect(w.visibility()).toBeLessThan(below * 0.3);
  });

  it('fog has the lowest visibility of all presets', () => {
    for (const [name, p] of Object.entries(WEATHER_PRESETS)) {
      if (name !== 'fog') expect(p.visibility).toBeGreaterThan(WEATHER_PRESETS.fog.visibility);
    }
  });
});
