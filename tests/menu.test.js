import { describe, it, expect } from 'vitest';
import { aircraftStats, MODE_INFO } from '../src/hud/menu.js';

describe('menu data', () => {
  it('aircraft stats reflect the flight model differences', () => {
    const s = aircraftStats();
    expect(s.aerobatic.speed).toBeGreaterThan(s.trainer.speed);
    expect(s.aerobatic.agility).toBeGreaterThan(s.bush.agility);
    expect(s.bush.shortField).toBeGreaterThan(s.aerobatic.shortField);
    expect(s.bush.stability).toBeGreaterThan(s.aerobatic.stability);
    for (const v of Object.values(s)) for (const x of Object.values(v)) expect(x).toBeGreaterThan(0.2), expect(x).toBeLessThanOrEqual(1);
  });

  it('lists the four modes', () => {
    expect(MODE_INFO.map((m) => m.id)).toEqual(['free', 'landing', 'timetrial', 'scenic']);
  });
});
