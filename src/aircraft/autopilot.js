/**
 * Scenic autopilot: wanders gently over the landscape, follows the terrain
 * with a comfortable clearance (looking ahead so it climbs before ridges),
 * holds cruise speed and keeps turns shallow. Pure: returns control inputs
 * from flight state and a ground-height function.
 */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Autopilot {
  constructor({ clearance = 260, maxBank = 0.38, seed = 1 } = {}) {
    this.clearance = clearance;
    this.maxBank = maxBank;
    this.targetHeading = null;
    this.targetAlt = null;
    this.t = seed * 13.37;
    this.controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0.6, brake: 0 };
    this._searchTimer = 0;
    this.avoiding = false;
  }

  /** Highest ground along a straight track on `heading` for `seconds` at `speed`. */
  corridorMax(x, z, heading, speed, groundAt, seconds) {
    let maxG = -Infinity;
    const dx = Math.sin(heading);
    const dz = -Math.cos(heading);
    for (let t = 2; t <= seconds; t += 2) {
      for (const off of [-80, 0, 80]) {
        const d = speed * t;
        maxG = Math.max(maxG, groundAt(x + dx * d - dz * off, z + dz * d + dx * off));
      }
    }
    return maxG;
  }

  /**
   * If the terrain ahead is higher than we can climb to in time, pick the
   * heading (within +/-150 degrees) with the lowest corridor instead.
   */
  _avoidTerrain(s, groundAt) {
    const speed = Math.max(s.airspeed, 20);
    const climb = s.type.id === 'aerobatic' ? 12 : 4;
    const horizon = 30;
    const need = this.corridorMax(s.pos.x, s.pos.z, s.heading, speed, groundAt, horizon) + this.clearance * 0.6 - s.pos.y;
    if (need < climb * horizon * 0.5) {
      this.avoiding = false;
      return;
    }
    let best = this.targetHeading;
    let bestG = Infinity;
    for (const d of [0, 25, -25, 50, -50, 80, -80, 115, -115, 150, -150]) {
      const h = s.heading + (d * Math.PI) / 180;
      // Prefer small turns: penalise by turn size.
      const g = this.corridorMax(s.pos.x, s.pos.z, h, speed, groundAt, horizon) + Math.abs(d) * 1.5;
      if (g < bestG) {
        bestG = g;
        best = h;
      }
    }
    this.targetHeading = wrap(best);
    this.avoiding = true;
  }

  reset() {
    this.targetHeading = null;
    this.targetAlt = null;
  }

  /** Highest ground along the projected track over the next `seconds`. */
  lookAhead(s, groundAt, seconds = 14) {
    let maxG = -Infinity;
    const vx = s.vel.x;
    const vz = s.vel.z;
    for (let t = 0; t <= seconds; t += 1) {
      for (const side of [-1, 0, 1]) {
        // Sample a corridor, wider further out, to catch ridges beside the track.
        const off = side * t * 4;
        const x = s.pos.x + vx * t - (vz / (Math.hypot(vx, vz) || 1)) * off;
        const z = s.pos.z + vz * t + (vx / (Math.hypot(vx, vz) || 1)) * off;
        maxG = Math.max(maxG, groundAt(x, z));
      }
    }
    return maxG;
  }

  /**
   * @param {object} s flight state
   * @param {(x:number,z:number)=>number} groundAt surface height (water = 0)
   */
  update(s, groundAt, dt) {
    this.t += dt;
    const T = s.type;
    if (this.targetHeading === null) this.targetHeading = s.heading;
    // Slow, smooth wandering of the desired heading.
    if (!this.avoiding) {
      this.targetHeading = wrap(this.targetHeading + dt * 0.05 * Math.sin(this.t * 0.031) * Math.cos(this.t * 0.017 + 1));
    }

    this._searchTimer -= dt;
    if (this._searchTimer <= 0) {
      this._searchTimer = 1.5;
      this._avoidTerrain(s, groundAt);
    }

    const ahead = this.lookAhead(s, groundAt);
    const desired = ahead + this.clearance;
    if (this.targetAlt === null) this.targetAlt = Math.max(desired, s.pos.y);
    // Climb promptly for terrain, descend lazily.
    const k = desired > this.targetAlt ? 0.6 : 0.05;
    this.targetAlt += (desired - this.targetAlt) * clamp(dt * k, 0, 1);

    const vsTarget = clamp((this.targetAlt - s.pos.y) * 0.06, -3, 7);
    const c = this.controls;
    // Lift needed in a bank: add a little back pressure proportional to bank.
    c.pitch = clamp((vsTarget - s.verticalSpeed) * 0.12 - s.angVel.x * 0.6 + Math.abs(s.bank) * 0.25, -0.8, 0.8);
    const herr = wrap(this.targetHeading - s.heading);
    const bankLimit = this.avoiding ? 0.6 : this.maxBank;
    const bankTarget = clamp(herr * 1.5, -bankLimit, bankLimit);
    c.roll = clamp((bankTarget - s.bank) * 2 + s.angVel.z * 0.3, -0.7, 0.7);
    c.yaw = 0;
    const speedTarget = T.cruiseSpeed * 0.92;
    c.throttle = clamp(0.55 + (speedTarget - s.airspeed) * 0.06 + (vsTarget > 2 ? 0.2 : 0), 0.15, 1);
    c.brake = 0;
    return c;
  }
}
