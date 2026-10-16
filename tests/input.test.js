import { describe, it, expect } from 'vitest';
import { Input } from '../src/input/input.js';
import { stickAxes } from '../src/input/touch.js';

function makeInput() {
  const target = new EventTarget();
  const input = new Input(target);
  const key = (type, code) => {
    const e = new Event(type);
    e.code = code;
    target.dispatchEvent(e);
  };
  const run = (seconds, dt = 1 / 60) => {
    for (let t = 0; t < seconds; t += dt) input.update(dt);
    return input.controls;
  };
  return { input, key, run };
}

describe('keyboard input', () => {
  it('W pitches down and S pitches up, ramping smoothly', () => {
    const { input, key, run } = makeInput();
    key('keydown', 'KeyW');
    const early = run(0.1).pitch;
    expect(early).toBeLessThan(0);
    expect(early).toBeGreaterThan(-1);
    expect(run(1).pitch).toBe(-1);
    key('keyup', 'KeyW');
    expect(run(1).pitch).toBe(0);
    key('keydown', 'ArrowDown');
    expect(run(1).pitch).toBe(1);
    expect(input.controls.roll).toBe(0);
  });

  it('A/D roll, Q/E yaw', () => {
    const { key, run } = makeInput();
    key('keydown', 'KeyD');
    key('keydown', 'KeyQ');
    const c = run(1);
    expect(c.roll).toBe(1);
    expect(c.yaw).toBe(-1);
  });

  it('invert pitch option flips the pitch axis', () => {
    const { input, key, run } = makeInput();
    input.invertPitch = true;
    key('keydown', 'KeyW');
    expect(run(1).pitch).toBe(1);
  });

  it('number keys set throttle, Shift / Z adjust it within [0, 1]', () => {
    const { input, key, run } = makeInput();
    key('keydown', 'Digit5');
    expect(input.controls.throttle).toBe(0.5);
    key('keyup', 'Digit5');
    key('keydown', 'Digit0');
    expect(input.controls.throttle).toBe(1);
    key('keyup', 'Digit0');
    key('keydown', 'KeyZ');
    run(10);
    expect(input.controls.throttle).toBe(0);
    key('keyup', 'KeyZ');
    key('keydown', 'ShiftLeft');
    run(1);
    expect(input.controls.throttle).toBeGreaterThan(0.3);
    expect(input.controls.throttle).toBeLessThan(0.6);
  });

  it('action keys fire once per press, not while held', () => {
    const { input, key } = makeInput();
    key('keydown', 'KeyC');
    key('keydown', 'KeyC'); // auto-repeat
    key('keydown', 'KeyG');
    expect(input.consume()).toEqual(['camera', 'gear']);
    expect(input.consume()).toEqual([]);
    key('keyup', 'KeyC');
    key('keydown', 'KeyC');
    expect(input.consume()).toEqual(['camera']);
  });

  it('brake is held with B or Space', () => {
    const { key, run } = makeInput();
    key('keydown', 'Space');
    expect(run(0.1).brake).toBe(1);
    key('keyup', 'Space');
    expect(run(0.1).brake).toBe(0);
  });

  it('losing focus releases all keys', () => {
    const { input, key, run } = makeInput();
    key('keydown', 'KeyW');
    input.target.dispatchEvent(new Event('blur'));
    expect(run(1).pitch).toBe(0);
  });
});

describe('input merging', () => {
  it('adds touch stick to keyboard and clamps to [-1, 1]', () => {
    const { input, key, run } = makeInput();
    input.touch = { active: true, lookActive: false, state: { pitch: 0.6, roll: -0.4, yaw: 0, throttle: null, brake: 0, lookYaw: null, lookPitch: null } };
    expect(run(0.1).pitch).toBeCloseTo(0.6, 5);
    key('keydown', 'KeyS');
    expect(run(1).pitch).toBe(1);
    expect(input.controls.roll).toBeCloseTo(-0.4, 5);
  });

  it('disabled input outputs neutral axes', () => {
    const { input, key, run } = makeInput();
    key('keydown', 'KeyW');
    input.enabled = false;
    expect(run(1).pitch).toBe(0);
  });
});

describe('touch stick', () => {
  it('has a dead zone', () => {
    expect(stickAxes(2, -2, 100)).toEqual({ roll: 0, pitch: 0 });
  });

  it('drag down means pull back (nose up), right means roll right', () => {
    const a = stickAxes(60, 80, 100);
    expect(a.roll).toBeGreaterThan(0);
    expect(a.pitch).toBeGreaterThan(0);
  });

  it('saturates at the rim', () => {
    const a = stickAxes(0, -500, 100);
    expect(a.pitch).toBeCloseTo(-1, 6);
    const b = stickAxes(300, 300, 100);
    expect(Math.hypot(b.roll, b.pitch)).toBeLessThanOrEqual(Math.SQRT2);
    expect(Math.abs(b.roll)).toBeLessThanOrEqual(1);
  });
});
