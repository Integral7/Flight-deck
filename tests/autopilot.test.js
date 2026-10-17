import { describe, it, expect } from 'vitest';
import { Autopilot } from '../src/aircraft/autopilot.js';
import { AIRCRAFT, AIRCRAFT_IDS } from '../src/aircraft/types.js';
import { createFlightState, placeInAir, stepFlight } from '../src/aircraft/flightModel.js';
import { createTerrain, SEA_LEVEL } from '../src/terrain/heightfield.js';

function fly(id, groundAt, seconds, startY = 600) {
  const s = createFlightState(AIRCRAFT[id]);
  placeInAir(s, { x: 0, y: startY, z: 0, heading: 0.7 });
  const ap = new Autopilot({ seed: 3 });
  const env = { ground: (x, z) => ({ height: groundAt(x, z), water: false, normalY: 1, runway: false }), turbulence: 0.2 };
  let minClear = Infinity;
  let maxBank = 0;
  const dt = 1 / 120;
  for (let i = 0; i < seconds / dt && !s.crashed; i++) {
    const c = i % 4 === 0 ? ap.update(s, groundAt, dt * 4) : ap.controls;
    stepFlight(s, c, dt, env);
    if (i > 120 * 20) {
      minClear = Math.min(minClear, s.pos.y - groundAt(s.pos.x, s.pos.z));
      maxBank = Math.max(maxBank, Math.abs(s.bank));
    }
  }
  return { s, minClear, maxBank };
}

describe('scenic autopilot', () => {
  for (const id of AIRCRAFT_IDS) {
    it(`${id}: cruises calmly over flat ground`, () => {
      const { s, minClear, maxBank } = fly(id, () => 0, 120);
      expect(s.crashed).toBe(false);
      expect(minClear).toBeGreaterThan(150);
      expect(maxBank).toBeLessThan(0.6);
      expect(s.airspeed).toBeGreaterThan(AIRCRAFT[id].cruiseSpeed * 0.7);
    });
  }

  it('climbs over a steep ridge in its path', () => {
    // A 900 m ridge 3 km ahead across the whole track.
    const ridge = (x, z) => Math.max(0, 900 - Math.abs(Math.hypot(x, z) - 3500) * 1.2);
    const { s, minClear } = fly('trainer', ridge, 150, 400);
    expect(s.crashed).toBe(false);
    expect(minClear).toBeGreaterThan(40);
  });

  it('survives three minutes over the real procedural terrain', () => {
    const terrain = createTerrain(1337);
    const groundAt = (x, z) => Math.max(terrain.heightAt(x, z), SEA_LEVEL);
    for (const id of AIRCRAFT_IDS) {
      const s = createFlightState(AIRCRAFT[id]);
      const home = terrain.nearestAirport(0, 0);
      placeInAir(s, { x: home.x, y: home.elevation + 500, z: home.z, heading: 2.1 });
      const ap = new Autopilot();
      const env = { ground: (x, z) => ({ height: groundAt(x, z), water: false, normalY: 1, runway: false }), turbulence: 0.2 };
      for (let i = 0; i < 180 * 120 && !s.crashed; i++) stepFlight(s, i % 4 === 0 ? ap.update(s, groundAt, 4 / 120) : ap.controls, 1 / 120, env);
      expect(s.crashed).toBe(false);
    }
  });
});
