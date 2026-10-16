import { describe, it, expect } from 'vitest';
import { AIRCRAFT, AIRCRAFT_IDS } from '../src/aircraft/types.js';
import {
  createFlightState,
  placeInAir,
  placeOnGround,
  stepFlight,
  flatEnvironment,
  GRAVITY,
  RHO0,
} from '../src/aircraft/flightModel.js';
import { mulberry32 } from '../src/engine/random.js';

const DT = 1 / 120;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function sim(s, seconds, controlFn, env = flatEnvironment(0)) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && !s.crashed; i++) stepFlight(s, controlFn(s, i * DT), DT, env);
  return s;
}

function airborne(id, opts = {}) {
  const s = createFlightState(AIRCRAFT[id]);
  placeInAir(s, { x: 0, y: 1500, z: 0, heading: 0, speed: AIRCRAFT[id].cruiseSpeed, throttle: 0.6, ...opts });
  return s;
}

/** Simple altitude-hold autopilot on the pitch axis. */
const holdAlt = (target) => (s) => clamp((clamp((target - s.pos.y) * 0.3, -5, 5) - s.verticalSpeed) * 0.15 - s.angVel.x * 0.5, -1, 1);
const holdBank = (target) => (s) => clamp((target - s.bank) * 2 - s.angVel.z * -0.2, -1, 1);

function stallSpeed(id, flaps = 0) {
  const s = airborne(id, { throttle: 0 });
  let v = null;
  sim(s, 150, (st) => {
    if (st.stalled && v === null) v = st.airspeed;
    return { pitch: holdAlt(1500)(st), throttle: 0, flaps };
  });
  return v;
}

function topSpeed(id, throttle = 1) {
  const s = airborne(id, { throttle });
  sim(s, 120, (st) => ({ pitch: holdAlt(1500)(st), throttle }));
  return s.airspeed;
}

function rollRate(id) {
  const s = airborne(id);
  sim(s, 0.8, () => ({ roll: 1, throttle: 0.6 }));
  return Math.abs(s.angVel.z);
}

describe('flight model: basic flight', () => {
  for (const id of AIRCRAFT_IDS) {
    it(`${id}: holds roughly level hands-off at cruise power`, () => {
      const s = airborne(id);
      sim(s, 30, () => ({ pitch: 0, roll: 0, yaw: 0, throttle: 0.6 }));
      expect(s.crashed).toBe(false);
      expect(Math.abs(s.pos.y - 1500)).toBeLessThan(80);
      expect(Math.abs(s.verticalSpeed)).toBeLessThan(2.5);
      expect(Math.abs(s.bank)).toBeLessThan(5 * DEG);
    });
  }

  it('pulling back makes the aircraft climb, pushing makes it descend', () => {
    const up = sim(airborne('trainer'), 4, () => ({ pitch: 0.5, throttle: 0.8 }));
    const down = sim(airborne('trainer'), 4, () => ({ pitch: -0.5, throttle: 0.8 }));
    expect(up.pos.y).toBeGreaterThan(1520);
    expect(down.pos.y).toBeLessThan(1480);
  });

  it('more throttle means more speed in level flight', () => {
    const slow = topSpeed('trainer', 0.45);
    const fast = topSpeed('trainer', 1);
    expect(fast).toBeGreaterThan(slow + 5);
  });

  it('banking causes a turn in the direction of the bank', () => {
    const right = airborne('trainer');
    sim(right, 15, (st) => ({ roll: holdBank(30 * DEG)(st), pitch: holdAlt(1500)(st), throttle: 0.7 }));
    const left = airborne('trainer');
    sim(left, 15, (st) => ({ roll: holdBank(-30 * DEG)(st), pitch: holdAlt(1500)(st), throttle: 0.7 }));
    // Heading is clockwise from north in [0, 2pi).
    expect(right.heading).toBeGreaterThan(20 * DEG);
    expect(right.heading).toBeLessThan(180 * DEG);
    expect(left.heading).toBeLessThan(340 * DEG);
    expect(left.heading).toBeGreaterThan(180 * DEG);
  });

  it('rudder yaws the nose', () => {
    const s = airborne('trainer');
    sim(s, 1.5, () => ({ yaw: 1, throttle: 0.6 }));
    expect(s.heading).toBeGreaterThan(2 * DEG);
    expect(s.heading).toBeLessThan(90 * DEG);
  });
});

describe('flight model: stall', () => {
  it('stalls near the theoretical 1 g stall speed', () => {
    for (const id of AIRCRAFT_IDS) {
      const T = AIRCRAFT[id];
      const clMax = T.cl0 + T.clAlpha * T.stallAlpha;
      const rho = RHO0 * Math.exp(-1500 / 8500);
      const vs = Math.sqrt((2 * T.mass * GRAVITY) / (rho * T.wingArea * clMax));
      const measured = stallSpeed(id);
      expect(measured).not.toBeNull();
      expect(measured).toBeGreaterThan(vs * 0.8);
      expect(measured).toBeLessThan(vs * 1.3);
    }
  });

  it('loses lift when stalled: holding full back stick at low speed sinks', () => {
    const s = airborne('trainer', { speed: 30, throttle: 0 });
    let sawStall = false;
    sim(s, 12, (st) => {
      if (st.stalled) sawStall = true;
      return { pitch: 1, throttle: 0 };
    });
    expect(sawStall).toBe(true);
    expect(s.pos.y).toBeLessThan(1500);
  });

  it('flaps lower the stall speed', () => {
    expect(stallSpeed('bush', 1)).toBeLessThan(stallSpeed('bush', 0) - 1.5);
  });
});

describe('flight model: aircraft differ', () => {
  it('aerobatic rolls fastest, bush plane slowest', () => {
    const a = rollRate('aerobatic');
    const t = rollRate('trainer');
    const b = rollRate('bush');
    expect(a).toBeGreaterThan(t * 1.8);
    expect(t).toBeGreaterThan(b);
  });

  it('bush plane stalls slowest, aerobatic fastest', () => {
    const b = stallSpeed('bush');
    const t = stallSpeed('trainer');
    const a = stallSpeed('aerobatic');
    expect(b).toBeLessThan(t);
    expect(t).toBeLessThan(a);
  });

  it('aerobatic has the highest top speed', () => {
    const a = topSpeed('aerobatic');
    expect(a).toBeGreaterThan(topSpeed('trainer') + 20);
    expect(a).toBeGreaterThan(topSpeed('bush') + 20);
  });

  it('retracting the gear reduces drag on the aerobatic aircraft', () => {
    const run = (gearDown) => {
      const s = airborne('aerobatic', { throttle: 0.8 });
      sim(s, 60, (st) => ({ pitch: holdAlt(1500)(st), throttle: 0.8, gearDown }));
      return s.airspeed;
    };
    expect(run(false)).toBeGreaterThan(run(true) + 2);
  });
});

describe('flight model: ground handling', () => {
  for (const id of AIRCRAFT_IDS) {
    it(`${id}: takes off within a 1100 m runway`, () => {
      const T = AIRCRAFT[id];
      const s = createFlightState(T);
      placeOnGround(s, { x: 0, z: 0, heading: 0 }, 0);
      let dist = null;
      sim(s, 60, (st) => {
        if (!st.onGround && dist === null) dist = Math.hypot(st.pos.x, st.pos.z);
        const pitch = st.airspeed > T.vr ? clamp((8 * DEG - st.pitch) * 3 - st.angVel.x, -1, 1) : 0;
        return { pitch, throttle: 1, flaps: T.hasFlaps ? 0.5 : 0 };
      });
      expect(dist).not.toBeNull();
      expect(dist).toBeLessThan(1100);
      expect(s.crashed).toBe(false);
      expect(s.pos.y).toBeGreaterThan(100);
    });
  }

  it('brakes stop the aircraft sooner', () => {
    const roll = (brake) => {
      const s = createFlightState(AIRCRAFT.trainer);
      placeOnGround(s, { x: 0, z: 0, heading: 0 }, 0);
      s.vel.set(0, 0, -25);
      sim(s, 150, () => ({ throttle: 0, brake }));
      expect(s.groundSpeed).toBeLessThan(0.01);
      return Math.abs(s.pos.z);
    };
    expect(roll(1)).toBeLessThan(roll(0) * 0.35);
  });

  it('cannot retract the gear on the ground', () => {
    const s = createFlightState(AIRCRAFT.aerobatic);
    placeOnGround(s, { x: 0, z: 0, heading: 0 }, 0);
    sim(s, 5, () => ({ throttle: 0, gearDown: false }));
    expect(s.gearPos).toBe(1);
    expect(s.crashed).toBe(false);
  });

  it('steers on the ground with the rudder', () => {
    const s = createFlightState(AIRCRAFT.trainer);
    placeOnGround(s, { x: 0, z: 0, heading: 0 }, 0);
    sim(s, 8, () => ({ throttle: 0.3, yaw: 1 }));
    expect(s.onGround).toBe(true);
    expect(s.heading).toBeGreaterThan(20 * DEG);
  });
});

describe('flight model: touchdown and crashes', () => {
  function descend(id, vs, opts = {}) {
    const T = AIRCRAFT[id];
    const s = createFlightState(T);
    placeInAir(s, { x: 0, y: T.gearHeight + 3, z: 0, heading: 0, speed: T.approachSpeed, throttle: 0.2 });
    if (opts.gearUp) s.gearPos = 0;
    else s.gearPos = 1;
    s.vel.y = vs;
    s.airTime = 30;
    const env = opts.env || flatEnvironment(0);
    const events = [];
    sim(
      s,
      6,
      (st) => {
        events.push(...st.events);
        st.events.length = 0;
        // Hold the flare attitude so only vertical speed matters.
        return { pitch: clamp((3 * DEG - st.pitch) * 2, -1, 1), throttle: 0.2, gearDown: !opts.gearUp };
      },
      env,
    );
    events.push(...s.events);
    return { s, events };
  }

  it('a gentle touchdown is a landing, not a crash', () => {
    const { s, events } = descend('trainer', -1.5);
    expect(s.crashed).toBe(false);
    const td = events.find((e) => e.type === 'touchdown');
    expect(td).toBeTruthy();
    expect(td.vs).toBeLessThan(0);
    expect(td.runway).toBe(true);
  });

  it('hitting the ground hard is a crash', () => {
    const { s } = descend('trainer', -14);
    expect(s.crashed).toBe(true);
    expect(s.crashReason).toMatch(/impact/i);
  });

  it('landing on water ditches the aircraft', () => {
    const water = { height: -10, water: true, normalY: 1, runway: false };
    const { s } = descend('trainer', -1.5, { env: { ...flatEnvironment(0), ground: () => water } });
    expect(s.crashed).toBe(true);
    expect(s.crashReason).toMatch(/water/i);
  });

  it('landing with the gear up is a belly landing', () => {
    const { s } = descend('aerobatic', -1.5, { gearUp: true });
    expect(s.crashed).toBe(true);
    expect(s.crashReason).toMatch(/belly/i);
  });

  it('flying into a hillside crashes', () => {
    const hill = { height: 0, water: false, normalY: 0.7, runway: false };
    const env = { ...flatEnvironment(0), ground: (x, z) => ((hill.height = Math.max(0, -z - 200) * 0.8), hill) };
    const s = airborne('trainer');
    s.pos.y = 50;
    sim(s, 30, () => ({ throttle: 0.6 }), env);
    expect(s.crashed).toBe(true);
  });

  it('invulnerable mode (scenic) never crashes', () => {
    const env = flatEnvironment(0, { invulnerable: true });
    const s = airborne('trainer');
    s.pos.y = 30;
    sim(s, 20, () => ({ pitch: -1, throttle: 1 }), env);
    expect(s.crashed).toBe(false);
    expect(Number.isFinite(s.pos.y)).toBe(true);
  });
});

describe('flight model: robustness', () => {
  it('is deterministic for identical inputs', () => {
    const run = () => {
      const s = airborne('aerobatic');
      sim(s, 20, (_, t) => ({ pitch: Math.sin(t), roll: Math.cos(t * 0.7), yaw: Math.sin(t * 2), throttle: 0.8 }));
      return [s.pos.x, s.pos.y, s.pos.z, s.quat.x, s.quat.y, s.quat.z, s.quat.w];
    };
    expect(run()).toEqual(run());
  });

  it('stays finite under random inputs, wind and turbulence', () => {
    for (const id of AIRCRAFT_IDS) {
      const rnd = mulberry32(id.length * 77);
      const s = airborne(id, { throttle: 1 });
      s.pos.y = 4000;
      const env = flatEnvironment(0, { turbulence: 1 });
      env.wind.set(12, 0, -8);
      let ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 1 };
      sim(
        s,
        90,
        (_, t) => {
          if (Math.floor(t * 4) !== Math.floor((t - DT) * 4)) {
            ctl = { pitch: rnd() * 2 - 1, roll: rnd() * 2 - 1, yaw: rnd() * 2 - 1, throttle: rnd() };
          }
          return ctl;
        },
        env,
      );
      for (const v of [s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z, s.quat.w, s.airspeed, s.gForce]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(Math.abs(s.quat.length() - 1)).toBeLessThan(1e-6);
      expect(s.airspeed).toBeLessThan(250);
    }
  });

  it('crosswind drifts the ground track', () => {
    const env = flatEnvironment(0);
    env.wind.set(10, 0, 0); // wind blowing toward +X (east)
    const s = airborne('trainer');
    sim(s, 20, (st) => ({ pitch: holdAlt(1500)(st), throttle: 0.6 }), env);
    expect(s.pos.x).toBeGreaterThan(50);
  });
});
