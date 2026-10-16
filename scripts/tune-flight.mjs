/**
 * Dev tool: fly each aircraft through standard manoeuvres with a simple
 * autopilot and print its performance envelope.
 */
import { AIRCRAFT } from '../src/aircraft/types.js';
import { createFlightState, placeInAir, placeOnGround, stepFlight, flatEnvironment } from '../src/aircraft/flightModel.js';

const dt = 1 / 120;
const env = flatEnvironment(0);
const DEG = 180 / Math.PI;

function run(s, seconds, controlFn) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    stepFlight(s, controlFn(s), dt, env);
    if (s.crashed) break;
  }
}

/** Altitude-hold autopilot via pitch input. */
const holdAlt = (target) => (s) => {
  const vsTarget = Math.max(-5, Math.min(5, (target - s.pos.y) * 0.3));
  return Math.max(-1, Math.min(1, (vsTarget - s.verticalSpeed) * 0.15 - s.angVel.x * 0.5));
};

for (const T of Object.values(AIRCRAFT)) {
  const r = {};
  // Hands-off at cruise with 60% power.
  let s = createFlightState(T);
  placeInAir(s, { x: 0, y: 1000, z: 0, heading: 0, speed: T.cruiseSpeed, throttle: 0.6 });
  run(s, 30, () => ({ pitch: 0, roll: 0, yaw: 0, throttle: 0.6 }));
  r.handsOff30s = `alt ${(s.pos.y - 1000).toFixed(0)} m, V ${s.airspeed.toFixed(1)}, vs ${s.verticalSpeed.toFixed(1)}, pitch ${(s.pitch * DEG).toFixed(1)}`;

  // Top speed in level flight.
  s = createFlightState(T);
  placeInAir(s, { x: 0, y: 1000, z: 0, heading: 0, speed: T.cruiseSpeed, throttle: 1 });
  const hold = holdAlt(1000);
  run(s, 90, (st) => ({ pitch: hold(st), throttle: 1 }));
  r.topSpeed = `${s.airspeed.toFixed(1)} m/s (${(s.airspeed * 1.944).toFixed(0)} kt) alt err ${(s.pos.y - 1000).toFixed(0)}`;

  // Stall speed: idle with altitude hold until stall.
  s = createFlightState(T);
  placeInAir(s, { x: 0, y: 1000, z: 0, heading: 0, speed: T.cruiseSpeed, throttle: 0 });
  let stallV = null;
  run(s, 120, (st) => {
    if (st.stalled && stallV === null) stallV = st.airspeed;
    return { pitch: holdAlt(1000)(st), throttle: 0 };
  });
  r.stallSpeed = stallV ? `${stallV.toFixed(1)} m/s (${(stallV * 1.944).toFixed(0)} kt)` : 'none';

  // Takeoff roll.
  s = createFlightState(T);
  placeOnGround(s, { x: 0, z: 0, heading: 0 }, 0);
  let liftoffDist = null;
  run(s, 60, (st) => {
    if (!st.onGround && liftoffDist === null) liftoffDist = Math.hypot(st.pos.x, st.pos.z);
    // Rotate at Vr, then hold 8 degrees nose-up.
    const pitchCmd = st.airspeed > T.vr ? Math.max(-1, Math.min(1, (8 / DEG - st.pitch) * 3 - st.angVel.x)) : 0;
    return { pitch: pitchCmd, throttle: 1, flaps: T.hasFlaps ? 0.5 : 0 };
  });
  r.takeoff = liftoffDist ? `${liftoffDist.toFixed(0)} m, then alt ${s.pos.y.toFixed(0)} m after 60 s` : 'no liftoff ' + s.crashReason;

  // Climb rate at full power, holding ~1.2 x stall speed-ish via pitch.
  s = createFlightState(T);
  placeInAir(s, { x: 0, y: 500, z: 0, heading: 0, speed: T.cruiseSpeed, throttle: 1 });
  // Climb performance from the specific-energy rate (robust to phugoid swings).
  const vy = T.cruiseSpeed * 0.75;
  const energy = (st) => st.pos.y + (st.airspeed * st.airspeed) / (2 * 9.81);
  const e0 = energy(s);
  run(s, 40, (st) => ({ pitch: Math.max(-1, Math.min(1, (st.airspeed - vy) * 0.04 - st.angVel.x * 0.8)), throttle: 1 }));
  const rate = (energy(s) - e0) / 40;
  r.climb = `${rate.toFixed(1)} m/s (${(rate * 196.85).toFixed(0)} fpm) energy-equivalent`;

  // Roll rate.
  s = createFlightState(T);
  placeInAir(s, { x: 0, y: 1000, z: 0, heading: 0, speed: T.cruiseSpeed, throttle: 0.6 });
  run(s, 1.0, () => ({ roll: 1, throttle: 0.6 }));
  r.rollRate = `${(Math.abs(s.angVel.z) * DEG).toFixed(0)} deg/s, bank after 1 s ${(s.bank * DEG).toFixed(0)}`;

  // 30-degree banked turn hands-off pitch.
  s = createFlightState(T);
  placeInAir(s, { x: 0, y: 1000, z: 0, heading: 0, speed: T.cruiseSpeed, throttle: 0.7 });
  run(s, 20, (st) => ({ roll: Math.max(-1, Math.min(1, (30 / DEG - st.bank) * 2)), pitch: holdAlt(1000)(st), throttle: 0.7 }));
  r.turn = `heading ${(s.heading * DEG).toFixed(0)} deg after 20 s at 30 deg bank, alt err ${(s.pos.y - 1000).toFixed(0)}`;

  console.log(T.name, r);
}
