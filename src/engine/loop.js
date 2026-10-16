/**
 * Fixed-timestep accumulator. The simulation always advances in identical
 * `step`-sized increments regardless of display refresh rate, which keeps the
 * flight model deterministic and stable. Rendering interpolates with `alpha`.
 */
export class FixedStepLoop {
  constructor({ step = 1 / 120, maxSubSteps = 10 } = {}) {
    this.step = step;
    this.maxSubSteps = maxSubSteps;
    this.accumulator = 0;
  }

  /**
   * @param {number} dt real seconds elapsed since the last call
   * @param {(step:number)=>void} simulate called once per fixed step
   * @returns {{ steps:number, alpha:number }}
   */
  advance(dt, simulate) {
    if (!(dt > 0)) return { steps: 0, alpha: this.accumulator / this.step };
    this.accumulator += Math.min(dt, this.step * this.maxSubSteps);
    let steps = 0;
    // Small epsilon so float drift never swallows a whole step.
    while (this.accumulator >= this.step - 1e-9 && steps < this.maxSubSteps) {
      simulate(this.step);
      this.accumulator = Math.max(0, this.accumulator - this.step);
      steps++;
    }
    // Drop backlog we could not catch up on (e.g. after a long tab switch).
    if (steps === this.maxSubSteps) this.accumulator = Math.min(this.accumulator, this.step);
    return { steps, alpha: this.accumulator / this.step };
  }

  reset() {
    this.accumulator = 0;
  }
}

/** Rolling frame-time statistics used by the FPS readout and adaptive resolution. */
export class FrameStats {
  constructor(size = 90) {
    this.samples = new Float32Array(size);
    this.index = 0;
    this.count = 0;
  }

  push(ms) {
    this.samples[this.index] = ms;
    this.index = (this.index + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
  }

  get average() {
    if (!this.count) return 0;
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.samples[i];
    return sum / this.count;
  }

  get fps() {
    const avg = this.average;
    return avg > 0 ? 1000 / avg : 0;
  }

  reset() {
    this.count = 0;
    this.index = 0;
  }
}
