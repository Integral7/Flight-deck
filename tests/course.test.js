import { describe, it, expect } from 'vitest';
import { generateCourse, ringCrossing, formatTime, totalTime, RING_RADIUS, MISS_PENALTY } from '../src/modes/course.js';
import { createTerrain, SEA_LEVEL } from '../src/terrain/heightfield.js';
import { AIRCRAFT } from '../src/aircraft/types.js';
import { createFlightState, placeInAir, stepFlight } from '../src/aircraft/flightModel.js';

const terrain = createTerrain(1337);
const ground = { heightAt: (x, z) => Math.max(terrain.heightAt(x, z), SEA_LEVEL) };
const home = terrain.nearestAirport(0, 0);
const start = { x: home.x, z: home.z, heading: 1.2 };

describe('course generation', () => {
  const course = generateCourse(ground, start, 42, 12);

  it('is deterministic per seed and differs between seeds', () => {
    expect(generateCourse(ground, start, 42, 12)).toEqual(course);
    expect(generateCourse(ground, start, 43, 12)[3]).not.toEqual(course[3]);
  });

  it('has the requested ring count with sensible spacing', () => {
    expect(course).toHaveLength(12);
    for (let i = 1; i < course.length; i++) {
      const d = Math.hypot(course[i].x - course[i - 1].x, course[i].z - course[i - 1].z);
      expect(d).toBeGreaterThan(600);
      expect(d).toBeLessThan(1150);
    }
  });

  it('keeps every ring clear of the terrain', () => {
    for (const r of course) {
      const g = ground.heightAt(r.x, r.z);
      expect(r.y - r.radius).toBeGreaterThan(g + 60);
    }
  });

  it('keeps climbs between rings flyable', () => {
    for (let i = 1; i < course.length; i++) {
      const d = Math.hypot(course[i].x - course[i - 1].x, course[i].z - course[i - 1].z);
      expect(Math.abs(course[i].y - course[i - 1].y) / d).toBeLessThanOrEqual(0.161);
    }
  });

  it('ring normals are unit vectors pointing along the course', () => {
    for (let i = 1; i < course.length; i++) {
      const r = course[i];
      expect(Math.hypot(r.nx, r.ny, r.nz)).toBeCloseTo(1, 9);
      const dx = r.x - course[i - 1].x;
      const dz = r.z - course[i - 1].z;
      expect(r.nx * dx + r.nz * dz).toBeGreaterThan(0);
    }
  });
});

describe('ring crossing', () => {
  const ring = { x: 0, y: 100, z: 0, nx: 0, ny: 0, nz: -1, radius: RING_RADIUS };

  it('detects a hit through the centre', () => {
    const c = ringCrossing({ x: 0, y: 100, z: 5 }, { x: 0, y: 100, z: -5 }, ring);
    expect(c.hit).toBe(true);
    expect(c.distance).toBeCloseTo(0, 9);
  });

  it('detects a miss outside the radius', () => {
    const c = ringCrossing({ x: 40, y: 100, z: 5 }, { x: 40, y: 100, z: -5 }, ring);
    expect(c.hit).toBe(false);
    expect(c.distance).toBeCloseTo(40, 9);
  });

  it('ignores segments that do not cross, or cross backwards', () => {
    expect(ringCrossing({ x: 0, y: 100, z: 50 }, { x: 0, y: 100, z: 10 }, ring)).toBeNull();
    expect(ringCrossing({ x: 0, y: 100, z: -5 }, { x: 0, y: 100, z: 5 }, ring)).toBeNull();
  });

  it('interpolates the crossing point between samples', () => {
    const c = ringCrossing({ x: 0, y: 100, z: 1 }, { x: 0, y: 140, z: -3 }, ring);
    expect(c.distance).toBeCloseTo(10, 6); // crosses at y = 110
    expect(c.hit).toBe(true);
  });
});

describe('timing', () => {
  it('formats times and adds penalties', () => {
    expect(formatTime(65.321)).toBe('1:05.32');
    expect(formatTime(0)).toBe('0:00.00');
    expect(totalTime(60, 2)).toBe(60 + 2 * MISS_PENALTY);
  });
});

describe('a course can actually be flown', () => {
  it('a simple autopilot in the trainer threads every ring', () => {
    const course = generateCourse(ground, start, 7, 12);
    const T = AIRCRAFT.trainer;
    const s = createFlightState(T);
    const r0 = course[0];
    const dx = r0.x - start.x;
    const dz = r0.z - start.z;
    const d = Math.hypot(dx, dz);
    placeInAir(s, { x: r0.x - (dx / d) * 800, y: r0.y, z: r0.z - (dz / d) * 800, heading: Math.atan2(dx, -dz), speed: T.cruiseSpeed, throttle: 1 });
    const env = {
      ground: (x, z) => ({ height: ground.heightAt(x, z), water: false, normalY: 1, runway: false }),
      turbulence: 0,
    };
    let next = 0;
    let hits = 0;
    let prev = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    for (let i = 0; i < 120 * 400 && next < course.length && !s.crashed; i++) {
      const r = course[next];
      // Aim at a point on the ring's approach line so we arrive lined up.
      const dRing = Math.hypot(r.x - s.pos.x, r.z - s.pos.z);
      const lead = Math.min(dRing * 0.45, 260);
      const ax = r.x - r.nx * lead;
      const az = r.z - r.nz * lead;
      const want = Math.atan2(ax - s.pos.x, -(az - s.pos.z));
      let err = want - s.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      const bank = clamp(err * 2.2, -0.8, 0.8);
      const dist = Math.hypot(r.x - s.pos.x, r.z - s.pos.z);
      const vsT = clamp(((r.y - s.pos.y) / Math.max(dist, 50)) * s.airspeed, -10, 10);
      const c = {
        roll: clamp((bank - s.bank) * 2.5, -1, 1),
        pitch: clamp((vsT - s.verticalSpeed) * 0.15 - s.angVel.x * 0.5 + Math.abs(s.bank) * 0.3, -1, 1),
        yaw: 0,
        throttle: 1,
      };
      stepFlight(s, c, 1 / 120, env);
      const cur = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
      const cr = ringCrossing(prev, cur, r);
      if (cr && cr.distance < r.radius * 12) {
        if (cr.hit) hits++;
        next++;
      }
      prev = cur;
    }
    expect(s.crashed).toBe(false);
    expect(next).toBe(course.length);
    expect(hits).toBeGreaterThanOrEqual(10);
  });
});
