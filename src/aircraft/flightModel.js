/**
 * Arcade flight model.
 *
 * Forces (lift, drag, thrust, gravity, a lateral "grip" force) are computed
 * from simple aerodynamic equations and integrated with semi-implicit Euler
 * at a fixed timestep. Rotation is rate-commanded: stick inputs request body
 * rates, weathervane stability pulls the nose toward the relative wind, and
 * the angular velocity follows the target with a first-order lag. The
 * aircraft auto-trims toward 1 g so hands-off flight is calm.
 *
 * Conventions (match three.js cameras so the cockpit can share orientation):
 *   body axes: +X right wing, +Y up, -Z nose
 *   world: +Y up, north = -Z, east = +X; compass heading clockwise from north
 *   angVel (body): x = pitch rate (+nose up), y = yaw rate (+nose left),
 *                  z = roll rate (+left wing down)
 *   controls: pitch +1 = pull (nose up), roll +1 = right, yaw +1 = right
 *
 * Only three.js math classes are used, so this runs in Node for tests.
 */
import { Vector3, Quaternion, Euler } from 'three';

export const GRAVITY = 9.81;
export const RHO0 = 1.225;
export const SEA_LEVEL = 0;
const DEG = Math.PI / 180;
const BELLY_HEIGHT = 0.6;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createFlightState(type) {
  return {
    type,
    pos: new Vector3(),
    vel: new Vector3(),
    quat: new Quaternion(),
    angVel: new Vector3(),
    throttle: 0,
    flaps: 0,
    gearPos: 1,
    gearDown: true,
    brake: 0,
    onGround: false,
    crashed: false,
    crashReason: '',
    airTime: 0,
    groundTime: 0,
    time: 0,
    // Derived values (updated every step) for instruments and game logic.
    airspeed: 0,
    groundSpeed: 0,
    verticalSpeed: 0,
    aoa: 0,
    sideslip: 0,
    gForce: 1,
    stalled: false,
    stallWarning: false,
    agl: 0,
    heading: 0,
    pitch: 0,
    bank: 0,
    groundHeight: 0,
    onRunway: false,
    events: [],
  };
}

const _euler = new Euler(0, 0, 0, 'YXZ');

/** Set orientation from compass heading, pitch and bank (radians). */
export function setAttitude(s, heading, pitch = 0, bank = 0) {
  _euler.set(pitch, -heading, -bank, 'YXZ');
  s.quat.setFromEuler(_euler);
}

/** Start in the air, flying level at `speed` m/s along `heading`. */
export function placeInAir(s, { x, y, z, heading = 0, speed, throttle = 0.6 }) {
  s.pos.set(x, y, z);
  setAttitude(s, heading, 0, 0);
  const v = speed ?? s.type.cruiseSpeed;
  s.vel.set(Math.sin(heading) * v, 0, -Math.cos(heading) * v);
  s.angVel.set(0, 0, 0);
  s.throttle = throttle;
  s.onGround = false;
  s.crashed = false;
  s.crashReason = '';
  s.gearPos = s.type.retractableGear ? 0 : 1;
  s.gearDown = !s.type.retractableGear;
  s.flaps = 0;
  s.airTime = 10;
  s.events.length = 0;
  updateDerived(s, null);
}

/** Start parked on the ground at (x, z) with the wheels on `groundHeight`. */
export function placeOnGround(s, { x, z, heading = 0 }, groundHeight) {
  s.pos.set(x, groundHeight + s.type.gearHeight, z);
  setAttitude(s, heading, 0, 0);
  s.vel.set(0, 0, 0);
  s.angVel.set(0, 0, 0);
  s.throttle = 0;
  s.onGround = true;
  s.crashed = false;
  s.crashReason = '';
  s.gearPos = 1;
  s.gearDown = true;
  s.flaps = 0;
  s.airTime = 0;
  s.events.length = 0;
  updateDerived(s, null);
}

/** Default flat-world environment, used by tests and as a fallback. */
export function flatEnvironment(height = 0, extra = {}) {
  const g = { height, water: false, normalY: 1, runway: true };
  return { ground: () => g, wind: new Vector3(), turbulence: 0, invulnerable: false, ...extra };
}

// Scratch objects: the step function allocates nothing.
const _fwd = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _air = new Vector3();
const _airDir = new Vector3();
const _vb = new Vector3();
const _qInv = new Quaternion();
const _force = new Vector3();
const _lift = new Vector3();
const _tmp = new Vector3();
const _axis = new Vector3();
const _dq = new Quaternion();
const _hf = new Vector3();
const _probe = new Vector3();

function surfaceOf(g) {
  return g.water ? Math.max(g.height, SEA_LEVEL) : g.height;
}

/**
 * Advance the simulation by `dt` seconds.
 * @param {ReturnType<typeof createFlightState>} s
 * @param {{pitch:number, roll:number, yaw:number, throttle:number, brake?:number, flaps?:number, gearDown?:boolean}} c
 * @param {number} dt
 * @param {{ground:(x:number,z:number)=>{height:number,water:boolean,normalY:number,runway:boolean},
 *   wind?:Vector3, turbulence?:number, invulnerable?:boolean}} env
 */
export function stepFlight(s, c, dt, env) {
  if (s.crashed) return s;
  const T = s.type;
  s.time += dt;

  const pitchIn = clamp(c.pitch || 0, -1, 1);
  const rollIn = clamp(c.roll || 0, -1, 1);
  const yawIn = clamp(c.yaw || 0, -1, 1);
  s.brake = clamp(c.brake || 0, 0, 1);

  // --- Systems --------------------------------------------------------
  const tgtThrottle = clamp(c.throttle ?? s.throttle, 0, 1);
  s.throttle += clamp(tgtThrottle - s.throttle, -T.throttleRate * dt, T.throttleRate * dt);
  if (T.retractableGear) {
    let want = c.gearDown ?? s.gearDown;
    if (s.onGround) want = true;
    s.gearDown = want;
    s.gearPos = clamp(s.gearPos + (want ? 1 : -1) * dt * 0.4, 0, 1);
  } else {
    s.gearPos = 1;
    s.gearDown = true;
  }
  if (T.hasFlaps) s.flaps += clamp((c.flaps ?? s.flaps) - s.flaps, -0.4 * dt, 0.4 * dt);
  else s.flaps = 0;

  // --- Frames and air data ---------------------------------------------
  const q = s.quat;
  _fwd.set(0, 0, -1).applyQuaternion(q);
  _up.set(0, 1, 0).applyQuaternion(q);
  _right.set(1, 0, 0).applyQuaternion(q);
  const rho = RHO0 * Math.exp(-Math.max(0, s.pos.y) / 8500);

  _air.copy(s.vel);
  if (env.wind) _air.sub(env.wind);
  const turb = env.turbulence || 0;
  if (turb > 0) {
    // Deterministic gusts from a sum of incommensurate sines.
    const t = s.time;
    _air.x += turb * 2.2 * (Math.sin(t * 1.31) + 0.5 * Math.sin(t * 3.7 + 1.1));
    _air.y += turb * 1.6 * (Math.sin(t * 1.93 + 0.4) + 0.6 * Math.sin(t * 4.3 + 2.2));
    _air.z += turb * 2.2 * (Math.sin(t * 1.07 + 2.5) + 0.5 * Math.sin(t * 3.1));
  }
  const V = _air.length();
  if (V > 1e-3) _airDir.copy(_air).divideScalar(V);
  else _airDir.copy(_fwd);
  _qInv.copy(q).invert();
  _vb.copy(_air).applyQuaternion(_qInv);
  const u = -_vb.z;
  const alpha = V > 2 ? Math.atan2(-_vb.y, u) : 0;
  const beta = V > 2 ? Math.atan2(_vb.x, Math.max(Math.abs(u), 1)) : 0;
  const qbar = 0.5 * rho * V * V;

  // Ground below (used for ground effect and contact).
  let g = env.ground(s.pos.x, s.pos.z);
  let surface = surfaceOf(g);
  const contactHeight = s.gearPos > 0.95 ? T.gearHeight : BELLY_HEIGHT;
  const agl = s.pos.y - contactHeight - surface;

  // --- Aerodynamic coefficients --------------------------------------------
  const stallA = T.stallAlpha + T.flapStall * s.flaps;
  const cl0 = T.cl0 + T.flapCl * s.flaps;
  const clMax = cl0 + T.clAlpha * stallA;
  const clMin = cl0 - T.clAlpha * stallA * 0.8;
  let cl = cl0 + T.clAlpha * alpha;
  let stallDepth = 0;
  if (alpha > stallA) {
    stallDepth = clamp((alpha - stallA) / (10 * DEG), 0, 1);
    cl = clMax * (1 - T.clMaxDrop * stallDepth) * Math.max(0, Math.cos(alpha - stallA));
  } else if (cl < clMin) {
    const neg = clamp((clMin - cl) / (T.clAlpha * 10 * DEG), 0, 1);
    cl = clMin * (1 - T.clMaxDrop * neg);
  }
  const ge = agl < T.wingSpan && agl > -1 ? 1 - clamp(agl, 0, T.wingSpan) / T.wingSpan : 0;
  cl *= 1 + 0.1 * ge;
  const k = 1 / (Math.PI * T.oswald * T.aspectRatio);
  const sa = Math.sin(alpha);
  const sb = Math.sin(beta);
  const cd =
    T.cd0 +
    k * cl * cl * (1 - 0.45 * ge) +
    T.gearDrag * s.gearPos +
    T.flapCd * s.flaps +
    (Math.abs(alpha) > stallA ? 0.9 * sa * sa : 0.05 * sa * sa) +
    0.6 * sb * sb;

  // --- Forces ------------------------------------------------------------
  _force.set(0, -T.mass * GRAVITY, 0);
  if (V > 0.5) {
    _lift.crossVectors(_right, _airDir);
    const ll = _lift.length();
    if (ll > 1e-6) _force.addScaledVector(_lift, (qbar * T.wingArea * cl) / ll);
    _force.addScaledVector(_airDir, -qbar * T.wingArea * cd);
  }
  const thrust = T.staticThrust * s.throttle * (rho / RHO0) * clamp(1 - Math.max(u, 0) / T.thrustFadeSpeed, 0, 1);
  _force.addScaledVector(_fwd, thrust);
  // Fuselage side force: damps lateral slip (arcade "grip").
  _force.addScaledVector(_right, -_vb.x * T.sideGrip * T.mass);

  // Load factor felt by the pilot (non-gravity force along the up axis).
  _tmp.copy(_force);
  _tmp.y += T.mass * GRAVITY;
  const gRaw = _tmp.dot(_up) / (T.mass * GRAVITY);
  // On the ground the wheels carry the weight, which the force sum omits.
  s.gForce += ((s.onGround ? Math.max(1, gRaw) : gRaw) - s.gForce) * (1 - Math.exp(-dt / 0.15));

  s.vel.addScaledVector(_force, dt / T.mass);

  // --- Rotation ----------------------------------------------------------
  const ctrl = clamp((V / T.controlRefSpeed) ** 2, 0, 1.15);
  const stab = clamp(V / T.controlRefSpeed, 0, 1.2);
  let alphaTrim = 0;
  if (!s.onGround) {
    const clReq = (T.mass * GRAVITY) / (Math.max(qbar, 1) * T.wingArea);
    alphaTrim = clamp((clReq - cl0) / T.clAlpha, -0.05, stallA * 0.8);
  }
  _euler.setFromQuaternion(q, 'YXZ');
  const rollAngle = _euler.z; // + = left wing down

  let qT = pitchIn * T.maxPitchRate * ctrl - T.pitchStability * (alpha - alphaTrim) * stab;
  let rT = -yawIn * T.maxYawRate * ctrl - T.yawStability * beta * stab;
  let pT = -rollIn * T.maxRollRate * ctrl;
  if (Math.abs(rollIn) < 0.1 && Math.abs(rollAngle) < 60 * DEG && !s.onGround) {
    pT -= T.wingLeveling * rollAngle * stab;
  }
  if (stallDepth > 0 && !s.onGround) {
    // Wing drop in the stall: deterministic, stronger for less docile types.
    const drop = (1.4 - T.wingLeveling) * stallDepth;
    pT += drop * Math.sin(s.time * 1.7) * 1.2;
    rT += drop * Math.sin(s.time * 1.1 + 1) * 0.3;
  }
  if (turb > 0 && !s.onGround) {
    const t = s.time;
    pT += turb * 0.25 * Math.sin(t * 2.3 + 0.7);
    qT += turb * 0.08 * Math.sin(t * 1.7 + 2.1);
  }
  const blend = 1 - Math.exp(-dt / T.response);
  s.angVel.x += (qT - s.angVel.x) * blend;
  s.angVel.y += (rT - s.angVel.y) * blend;
  s.angVel.z += (pT - s.angVel.z) * blend;

  if (s.onGround) {
    // Nose-wheel steering, fading out as the rudder takes over.
    const speed = Math.hypot(s.vel.x, s.vel.z);
    const steer = -(yawIn + rollIn * 0.4) * 0.55 * clamp(speed / 4, 0, 1) * (1 - clamp((speed - 25) / 30, 0, 0.8));
    s.angVel.y = steer + rT * 0.3;
    s.angVel.z = 0;
  }

  const w = s.angVel.length();
  if (w > 1e-9) {
    _axis.copy(s.angVel).divideScalar(w);
    _dq.setFromAxisAngle(_axis, w * dt);
    q.multiply(_dq).normalize();
  }

  // --- Position + ground contact -----------------------------------------
  s.pos.addScaledVector(s.vel, dt);
  g = env.ground(s.pos.x, s.pos.z);
  surface = surfaceOf(g);
  const gap = s.pos.y - contactHeight - surface;

  if (gap <= 0 || (s.onGround && gap < 0.4 && s.vel.y <= 0)) {
    if (!s.onGround) {
      const problem = touchdownProblem(s, g, contactHeight);
      if (problem && !env.invulnerable) return crash(s, problem);
      s.onGround = true;
      s.groundTime = 0;
      if (s.airTime > 1) {
        s.events.push({
          type: 'touchdown',
          vs: s.vel.y,
          speed: Math.hypot(s.vel.x, s.vel.z),
          bank: Math.abs(rollAngle),
          pitch: _euler.x,
          runway: !!g.runway,
          x: s.pos.x,
          z: s.pos.z,
          problem,
        });
      }
      s.airTime = 0;
    }
    s.pos.y = surface + contactHeight;
    if (s.vel.y < 0) s.vel.y = 0;
    groundRoll(s, g, dt);
  } else if (s.onGround && gap >= 0.4) {
    s.onGround = false;
    s.events.push({ type: 'liftoff', speed: s.airspeed });
  }
  if (s.onGround) s.groundTime += dt;
  else s.airTime += dt;

  // Airframe strikes: nose and wingtips against terrain while near the ground.
  if (!s.onGround && agl < T.wingSpan * 2) {
    const half = T.wingSpan / 2;
    const pts = [
      [_fwd, T.noseLength],
      [_right, half],
      [_right, -half],
    ];
    for (const [dir, len] of pts) {
      _probe.copy(s.pos).addScaledVector(dir, len);
      const pg = env.ground(_probe.x, _probe.z);
      if (_probe.y < surfaceOf(pg) - 0.15) {
        const reason = dir === _fwd ? 'Flew into terrain' : 'Wingtip struck terrain';
        if (!env.invulnerable) return crash(s, reason);
        s.events.push({ type: 'scrape', reason });
        s.pos.y += surfaceOf(pg) - _probe.y + 0.5;
        if (s.vel.y < 0) s.vel.y = 0;
        break;
      }
    }
  }

  updateDerived(s, g, alpha, beta, V, stallA);
  return s;
}

function touchdownProblem(s, g, contactHeight) {
  const T = s.type;
  _euler.setFromQuaternion(s.quat, 'YXZ');
  const speed = Math.hypot(s.vel.x, s.vel.z);
  if (g.water && g.height < SEA_LEVEL) return 'Ditched in the water';
  if (s.vel.y < -T.maxTouchdownVs * 1.6) return 'Hard impact';
  if (Math.abs(_euler.z) > 25 * DEG) return 'Wingtip strike on touchdown';
  if (_euler.x < -7 * DEG && speed > 8) return 'Nose-first impact';
  if (contactHeight === BELLY_HEIGHT && speed > 15) return 'Belly landing (gear up)';
  if (g.normalY < 0.93 && speed > 10) return 'Too steep to land here';
  return '';
}

function groundRoll(s, g, dt) {
  const T = s.type;
  _fwd.set(0, 0, -1).applyQuaternion(s.quat);
  _hf.set(_fwd.x, 0, _fwd.z);
  if (_hf.lengthSq() < 1e-6) _hf.set(0, 0, -1);
  _hf.normalize();
  const along = s.vel.x * _hf.x + s.vel.z * _hf.z;
  let latX = s.vel.x - _hf.x * along;
  let latZ = s.vel.z - _hf.z * along;
  const latDamp = Math.exp(-dt * 6);
  latX *= latDamp;
  latZ *= latDamp;
  const rolling = g.runway ? 0.25 : 0.9;
  const decel = rolling + s.brake * T.brakeDecel;
  const mag = Math.abs(along);
  const newAlong = mag <= decel * dt ? 0 : along - Math.sign(along) * decel * dt;
  s.vel.x = _hf.x * newAlong + latX;
  s.vel.z = _hf.z * newAlong + latZ;

  // Attitude: wings level, nose wheel stops the nose dropping below level.
  _euler.setFromQuaternion(s.quat, 'YXZ');
  let pitch = _euler.x;
  let roll = _euler.z * Math.exp(-dt * 8);
  if (pitch < 0) {
    pitch = 0;
    if (s.angVel.x < 0) s.angVel.x = 0;
  }
  if (pitch > 16 * DEG) {
    pitch = 16 * DEG;
    if (s.angVel.x > 0) s.angVel.x = 0;
  }
  _euler.set(pitch, _euler.y, roll, 'YXZ');
  s.quat.setFromEuler(_euler);
}

function crash(s, reason) {
  s.crashed = true;
  s.crashReason = reason;
  s.vel.set(0, 0, 0);
  s.angVel.set(0, 0, 0);
  s.events.push({ type: 'crash', reason, x: s.pos.x, z: s.pos.z });
  updateDerived(s, null, 0, 0, 0);
  return s;
}

function updateDerived(s, g, alpha = 0, beta = 0, V = s.vel.length(), stallA = s.type.stallAlpha) {
  _euler.setFromQuaternion(s.quat, 'YXZ');
  s.pitch = _euler.x;
  s.bank = -_euler.z;
  let hdg = -_euler.y;
  hdg = ((hdg % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  s.heading = hdg;
  s.airspeed = V;
  s.groundSpeed = Math.hypot(s.vel.x, s.vel.z);
  s.verticalSpeed = s.vel.y;
  s.aoa = alpha;
  s.sideslip = beta;
  s.stalled = !s.onGround && alpha > stallA;
  s.stallWarning = !s.onGround && V > 3 && alpha > stallA - 3 * DEG;
  if (g) {
    s.groundHeight = surfaceOf(g);
    s.onRunway = !!g.runway;
  }
  s.agl = s.pos.y - s.groundHeight - (s.gearPos > 0.95 ? s.type.gearHeight : BELLY_HEIGHT);
}
