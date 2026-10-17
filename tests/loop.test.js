import { describe, it, expect } from 'vitest';
import { FixedStepLoop, FrameStats } from '../src/engine/loop.js';

describe('FixedStepLoop', () => {
  it('runs whole steps and carries the remainder', () => {
    const loop = new FixedStepLoop({ step: 0.01 });
    let n = 0;
    const r = loop.advance(0.035, () => n++);
    expect(n).toBe(3);
    expect(r.alpha).toBeCloseTo(0.5, 5);
    loop.advance(0.005, () => n++);
    expect(n).toBe(4);
  });

  it('caps sub-steps after a long stall', () => {
    const loop = new FixedStepLoop({ step: 0.01, maxSubSteps: 5 });
    let n = 0;
    loop.advance(10, () => n++);
    expect(n).toBe(5);
    expect(loop.accumulator).toBeLessThanOrEqual(0.01);
  });

  it('ignores non-positive or NaN dt', () => {
    const loop = new FixedStepLoop();
    let n = 0;
    loop.advance(0, () => n++);
    loop.advance(NaN, () => n++);
    loop.advance(-1, () => n++);
    expect(n).toBe(0);
  });
});

describe('FrameStats', () => {
  it('averages samples', () => {
    const s = new FrameStats(4);
    [10, 20, 30, 40, 50].forEach((v) => s.push(v));
    expect(s.average).toBe(35);
    expect(s.fps).toBeCloseTo(1000 / 35);
  });
});
