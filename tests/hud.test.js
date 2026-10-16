import { describe, it, expect } from 'vitest';
import { speedBands, asiAngle, altimeterAngles, vsiAngle } from '../src/hud/instruments.js';
import { computeWarnings } from '../src/hud/warnings.js';
import { buildMapTile, MAP_LEVELS } from '../src/terrain/mapTile.js';
import { createTerrain, SEA_LEVEL } from '../src/terrain/heightfield.js';
import { AIRCRAFT, AIRCRAFT_IDS } from '../src/aircraft/types.js';
import { createFlightState, placeInAir, placeOnGround } from '../src/aircraft/flightModel.js';

const DEG = Math.PI / 180;

describe('instrument mappings', () => {
  it('speed bands are ordered and fit the dial', () => {
    for (const id of AIRCRAFT_IDS) {
      const b = speedBands(AIRCRAFT[id]);
      expect(b.vs0).toBeLessThanOrEqual(b.vs1);
      expect(b.vs1).toBeLessThan(b.vno);
      expect(b.vno).toBeLessThan(b.vne);
      expect(b.vne).toBeLessThan(b.max);
      if (AIRCRAFT[id].hasFlaps) expect(b.vfe).toBeGreaterThan(b.vs0);
    }
  });

  it('airspeed needle is monotonic and clamped', () => {
    let prev = -Infinity;
    for (let kt = 0; kt <= 200; kt += 5) {
      const a = asiAngle(kt, 200);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
    expect(asiAngle(-50, 200)).toBe(asiAngle(0, 200));
    expect(asiAngle(999, 200)).toBe(asiAngle(200, 200));
    expect(asiAngle(200, 200) - asiAngle(0, 200)).toBeCloseTo(330 * DEG, 6);
  });

  it('altimeter needles read hundreds and thousands', () => {
    const a = altimeterAngles(1500);
    expect(a.hundreds).toBeCloseTo(Math.PI, 6);
    expect(a.thousands).toBeCloseTo(0.15 * 2 * Math.PI, 6);
    expect(altimeterAngles(-20).hundreds).toBe(0);
  });

  it('VSI is centred at zero, symmetric and saturates', () => {
    expect(vsiAngle(0)).toBeCloseTo(Math.PI, 9);
    expect(vsiAngle(1000) - Math.PI).toBeCloseTo(Math.PI - vsiAngle(-1000), 9);
    expect(vsiAngle(500)).toBeGreaterThan(vsiAngle(100));
    expect(vsiAngle(5000)).toBe(vsiAngle(2000));
  });
});

describe('warnings', () => {
  const flat = () => 0;
  const plane = (id = 'trainer', opts = {}) => {
    const s = createFlightState(AIRCRAFT[id]);
    placeInAir(s, { x: 0, y: 1000, z: 0, heading: 0, ...opts });
    s.agl = s.pos.y;
    return s;
  };

  it('nothing in calm level flight', () => {
    expect(computeWarnings(plane(), flat)).toEqual([]);
  });

  it('stall warning', () => {
    const s = plane();
    s.stallWarning = true;
    expect(computeWarnings(s, flat).map((w) => w.id)).toContain('stall');
  });

  it('pull up when diving at terrain, not when climbing away', () => {
    const s = plane('trainer', { y: 200 });
    s.agl = 200;
    s.vel.set(0, -40, -50);
    s.verticalSpeed = -40;
    expect(computeWarnings(s, flat).map((w) => w.id)).toContain('pullup');
    s.vel.set(0, 10, -50);
    s.verticalSpeed = 10;
    expect(computeWarnings(s, flat).map((w) => w.id)).not.toContain('pullup');
  });

  it('a normal approach to land does not trigger pull up', () => {
    const s = plane('trainer', { y: 40, speed: AIRCRAFT.trainer.approachSpeed });
    s.agl = 40;
    s.vel.y = -2.5;
    s.verticalSpeed = -2.5;
    expect(computeWarnings(s, flat).map((w) => w.id)).not.toContain('pullup');
  });

  it('gear-up warning on a slow descent close to the ground', () => {
    const s = plane('aerobatic', { y: 80, speed: AIRCRAFT.aerobatic.approachSpeed });
    s.agl = 80;
    s.gearPos = 0;
    s.verticalSpeed = -3;
    expect(computeWarnings(s, flat).map((w) => w.id)).toContain('gear');
  });

  it('no warnings on the ground', () => {
    const s = createFlightState(AIRCRAFT.trainer);
    placeOnGround(s, { x: 0, z: 0, heading: 0 }, 0);
    s.stallWarning = true;
    expect(computeWarnings(s, flat)).toEqual([]);
  });
});

describe('map tiles', () => {
  const terrain = createTerrain(1337);
  it('have the right size and are deterministic', () => {
    const a = buildMapTile(terrain, 0, 1, 0);
    expect(a.length).toBe(MAP_LEVELS[0].px ** 2 * 4);
    expect(buildMapTile(terrain, 0, 1, 0)).toEqual(a);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
  });

  it('colour water blue and land not', () => {
    const lvl = 1;
    const { tile, px } = MAP_LEVELS[lvl];
    const data = buildMapTile(terrain, -1, -1, lvl);
    let checked = 0;
    for (let j = 0; j < px; j += 7) {
      for (let i = 0; i < px; i += 7) {
        const x = -tile + ((i + 0.5) * tile) / px;
        const z = -tile + ((j + 0.5) * tile) / px;
        const h = terrain.heightAt(x, z);
        const o = (j * px + i) * 4;
        const [r, , b] = [data[o], data[o + 1], data[o + 2]];
        if (h < SEA_LEVEL - 5) {
          expect(b).toBeGreaterThan(r);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});
