import { describe, it, expect } from 'vitest';
import {
  localToWorld,
  worldToLocal,
  landingHeading,
  runwayNumber,
  threshold,
  bestLandingDirection,
  approachGuidance,
  papiLights,
  scoreLanding,
  GLIDE_SLOPE,
  PAPI_DISTANCE,
} from '../src/modes/runway.js';
import { createTerrain } from '../src/terrain/heightfield.js';
import { AIRCRAFT } from '../src/aircraft/types.js';
import { createFlightState, placeInAir, stepFlight } from '../src/aircraft/flightModel.js';

const DEG = Math.PI / 180;
// A north-south runway: heading 0 means +u = +Z (south).
const ap = { x: 1000, z: -2000, heading: 0, elevation: 100, length: 1100, width: 40 };

describe('runway geometry', () => {
  it('local <-> world round-trips', () => {
    const rot = { ...ap, heading: 1.234 };
    for (const [u, v] of [[0, 0], [300, -12], [-550, 20]]) {
      const w = localToWorld(rot, u, v);
      const l = worldToLocal(rot, w.x, w.z);
      expect(l.u).toBeCloseTo(u, 9);
      expect(l.v).toBeCloseTo(v, 9);
    }
  });

  it('landing headings and runway numbers are reciprocal', () => {
    // +u is south: landing toward +u is heading 180 (runway 18), the other end 36.
    expect(landingHeading(ap, 1) / DEG).toBeCloseTo(180, 6);
    expect(runwayNumber(ap, 1)).toBe('18');
    expect(runwayNumber(ap, -1)).toBe('36');
    const east = { ...ap, heading: Math.PI / 2 }; // +u = +X (east)
    expect(runwayNumber(east, 1)).toBe('09');
    expect(runwayNumber(east, -1)).toBe('27');
  });

  it('threshold is at the approach end', () => {
    const t = threshold(ap, 1);
    expect(t.z).toBeCloseTo(ap.z - ap.length / 2, 9);
    expect(threshold(ap, -1).z).toBeCloseTo(ap.z + ap.length / 2, 9);
  });

  it('chooses the runway end facing into the wind', () => {
    // Wind blowing toward the south (+Z) comes from the north: land northbound (dir -1).
    expect(bestLandingDirection(ap, { x: 0, z: 8 })).toBe(-1);
    expect(bestLandingDirection(ap, { x: 0, z: -8 })).toBe(1);
  });

  it('runway quads in the real world are flat and dry', () => {
    const terrain = createTerrain(1337);
    const home = terrain.nearestAirport(0, 0);
    for (const dir of [1, -1]) {
      const t = threshold(home, dir);
      expect(terrain.heightAt(t.x, t.z)).toBeCloseTo(home.elevation, 6);
    }
  });
});

describe('approach guidance', () => {
  it('reads zero deviation on the glide path and centreline', () => {
    const d = 2000;
    const t = threshold(ap, 1);
    const y = ap.elevation + Math.tan(GLIDE_SLOPE) * (d + PAPI_DISTANCE);
    const g = approachGuidance(ap, 1, t.x, y, t.z - d);
    expect(g.toThreshold).toBeCloseTo(d, 6);
    expect(g.glideDev).toBeCloseTo(0, 6);
    expect(g.lateral).toBeCloseTo(0, 6);
  });

  it('signs: above path is positive, right of centreline is positive', () => {
    const t = threshold(ap, 1);
    // Landing south (heading 180): the pilot's right is west (-X).
    const g = approachGuidance(ap, 1, t.x - 30, ap.elevation + 300, t.z - 1500);
    expect(g.glideDev).toBeGreaterThan(0);
    expect(g.lateral).toBeGreaterThan(0);
    const g2 = approachGuidance(ap, -1, threshold(ap, -1).x - 30, ap.elevation + 10, threshold(ap, -1).z + 1500);
    // Landing north: pilot's right is east, so 30 m west is left.
    expect(g2.lateral).toBeLessThan(0);
    expect(g2.glideDev).toBeLessThan(0);
  });

  it('PAPI shows two white, two red on the glide path', () => {
    expect(papiLights(3 * DEG)).toEqual([true, true, false, false]);
    expect(papiLights(4 * DEG)).toEqual([true, true, true, true]);
    expect(papiLights(2 * DEG)).toEqual([false, false, false, false]);
  });
});

describe('landing score', () => {
  const base = { vs: -0.5, bank: 0, lateral: 0.5, distanceFromThreshold: 250, bounces: 0, stoppedOnRunway: true, maxVs: 4.2, width: 40, runwayLength: 1100 };

  it('a perfect landing scores 100 and grade S', () => {
    const r = scoreLanding(base);
    expect(r.score).toBe(100);
    expect(r.grade).toBe('S');
    expect(r.failed).toBe(false);
  });

  it('harder touchdowns score lower; at the limit touchdown points are zero', () => {
    const soft = scoreLanding(base).score;
    const firm = scoreLanding({ ...base, vs: -2 }).score;
    const hard = scoreLanding({ ...base, vs: -4.5 });
    expect(firm).toBeLessThan(soft);
    expect(hard.parts.touchdown).toBe(0);
    expect(hard.hard).toBe(true);
  });

  it('penalises centreline offset, long landings, bank, bounces and running off', () => {
    const s = scoreLanding(base).score;
    expect(scoreLanding({ ...base, lateral: 15 }).score).toBeLessThan(s);
    expect(scoreLanding({ ...base, distanceFromThreshold: 800 }).score).toBeLessThan(s);
    expect(scoreLanding({ ...base, bank: 8 * DEG }).score).toBeLessThan(s);
    expect(scoreLanding({ ...base, bounces: 2 }).score).toBe(s - 20);
    expect(scoreLanding({ ...base, stoppedOnRunway: false }).score).toBe(s - 10);
  });

  it('fails short, long or off-runway touchdowns', () => {
    expect(scoreLanding({ ...base, distanceFromThreshold: -5 }).failed).toBe(true);
    expect(scoreLanding({ ...base, distanceFromThreshold: 1200 }).failed).toBe(true);
    expect(scoreLanding({ ...base, lateral: 25 }).failed).toBe(true);
  });

  it('score is always within 0-100', () => {
    for (let vs = 0; vs < 6; vs += 0.5) {
      for (const lat of [0, 5, 19]) {
        const r = scoreLanding({ ...base, vs: -vs, lateral: lat, bounces: 3 });
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('flown approach (flight model + guidance)', () => {
  it('a simple autopilot can fly the glide path to a scored landing', () => {
    const T = AIRCRAFT.trainer;
    const s = createFlightState(T);
    const t = threshold(ap, 1);
    const d0 = 2500;
    placeInAir(s, { x: t.x, y: ap.elevation + Math.tan(GLIDE_SLOPE) * (d0 + PAPI_DISTANCE) + T.gearHeight, z: t.z - d0, heading: Math.PI, speed: T.approachSpeed, throttle: 0.3 });
    s.flaps = 0.5;
    const env = {
      ground: (x, z) => {
        const l = worldToLocal(ap, x, z);
        return { height: ap.elevation, water: false, normalY: 1, runway: Math.abs(l.u) <= ap.length / 2 && Math.abs(l.v) <= ap.width / 2 };
      },
      wind: { x: 0, y: 0, z: 0, clone() { return this; } },
      turbulence: 0,
    };
    env.wind = { x: 0, y: 0, z: 0 };
    let touch = null;
    for (let i = 0; i < 120 * 120 && !s.crashed; i++) {
      const g = approachGuidance(ap, 1, s.pos.x, s.pos.y - T.gearHeight, s.pos.z);
      const h = g.height;
      let vsT = -s.airspeed * Math.tan(GLIDE_SLOPE) - g.glideDev * 2.5;
      if (h < 8) vsT = -0.6 - h * 0.12;
      let hdgErr = Math.PI - s.heading - Math.max(-0.2, Math.min(0.2, g.lateral * 0.004));
      hdgErr = Math.atan2(Math.sin(hdgErr), Math.cos(hdgErr));
      const c = {
        pitch: Math.max(-1, Math.min(1, (vsT - s.verticalSpeed) * 0.25 - s.angVel.x * 0.6)),
        roll: Math.max(-1, Math.min(1, (Math.max(-0.3, Math.min(0.3, hdgErr * 2.5)) - s.bank) * 2.5)),
        yaw: 0,
        throttle: h < 5 ? 0 : Math.max(0, Math.min(1, 0.3 + (T.approachSpeed - s.airspeed) * 0.05)),
        flaps: 0.5,
        brake: s.onGround ? 1 : 0,
      };
      if (s.onGround) c.pitch = c.roll = 0;
      stepFlight(s, c, 1 / 120, env);
      for (const e of s.events) {
        if (e.type === 'touchdown' && !touch) {
          const tg = approachGuidance(ap, 1, e.x, ap.elevation, e.z);
          touch = { vs: e.vs, bank: e.bank, lateral: tg.lateral, distanceFromThreshold: -tg.toThreshold };
        }
      }
      s.events.length = 0;
      if (touch && s.groundSpeed < 0.5) break;
    }
    expect(s.crashed).toBe(false);
    expect(touch).not.toBeNull();
    const r = scoreLanding({ ...touch, bounces: 0, stoppedOnRunway: true, maxVs: T.maxTouchdownVs, width: ap.width, runwayLength: ap.length });
    expect(r.failed).toBe(false);
    expect(r.score).toBeGreaterThan(60);
  });
});
