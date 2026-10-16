/**
 * Pure runway geometry, approach guidance and landing scoring. Shared by the
 * airport renderer, the landing challenge and the tests.
 *
 * Airport frame (from the heightfield): u runs along the runway in direction
 * (sin h, cos h) in world (x, z); v runs across it. A runway "end" is one of
 * the two landing directions: dir = +1 lands toward +u, dir = -1 toward -u.
 */
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const GLIDE_SLOPE = 3 * DEG;
export const PAPI_ANGLES = [2.5, 2.83, 3.17, 3.5].map((d) => d * DEG); // outer -> inner
export const PAPI_DISTANCE = 300; // from threshold, metres

/** World position of airport-local (u, v). */
export function localToWorld(ap, u, v) {
  const dx = Math.sin(ap.heading);
  const dz = Math.cos(ap.heading);
  return { x: ap.x + dx * u + dz * v, z: ap.z + dz * u - dx * v };
}

/** Airport-local (u, v) of a world point. */
export function worldToLocal(ap, x, z) {
  const dx = Math.sin(ap.heading);
  const dz = Math.cos(ap.heading);
  const rx = x - ap.x;
  const rz = z - ap.z;
  return { u: rx * dx + rz * dz, v: rx * dz - rz * dx };
}

/** Compass heading (radians, clockwise from north = -Z) when landing in `dir`. */
export function landingHeading(ap, dir) {
  const ux = Math.sin(ap.heading) * dir;
  const uz = Math.cos(ap.heading) * dir;
  const h = Math.atan2(ux, -uz);
  return (h + Math.PI * 2) % (Math.PI * 2);
}

/** Runway designator ("09", "27") for a landing direction. */
export function runwayNumber(ap, dir) {
  let n = Math.round(landingHeading(ap, dir) / DEG / 10);
  if (n <= 0) n += 36;
  if (n > 36) n -= 36;
  return String(n).padStart(2, '0');
}

/** Threshold position (world) for a landing direction. */
export function threshold(ap, dir) {
  return localToWorld(ap, (-dir * ap.length) / 2, 0);
}

/**
 * Pick the landing direction with the most headwind.
 * @param {{x:number,z:number}} wind velocity the air moves with (m/s)
 */
export function bestLandingDirection(ap, wind) {
  const ux = Math.sin(ap.heading);
  const uz = Math.cos(ap.heading);
  // Landing toward +u wants the wind blowing toward -u (headwind).
  const along = wind.x * ux + wind.z * uz;
  return along > 0 ? -1 : 1;
}

/**
 * Approach guidance relative to the touchdown aim point (on the glide path,
 * PAPI_DISTANCE beyond the threshold).
 * Returns distance along the approach (positive before the threshold),
 * lateral offset (m, + = right of centreline) and glide slope deviation in
 * degrees (+ = above the path).
 */
export function approachGuidance(ap, dir, x, y, z) {
  const { u, v } = worldToLocal(ap, x, z);
  const along = dir * u; // distance past the runway centre in landing direction
  const toThreshold = -ap.length / 2 - along; // > 0 while still before the threshold
  const toAim = toThreshold + PAPI_DISTANCE;
  const height = y - ap.elevation;
  const angle = Math.atan2(height, Math.max(toAim, 1));
  // +v is to the pilot's left when landing toward +u; flip so + = right.
  const lateral = -v * dir;
  return {
    toThreshold,
    toAim,
    height,
    lateral,
    glideDev: (angle - GLIDE_SLOPE) / DEG,
    locDev: Math.atan2(lateral, Math.max(toThreshold + ap.length, 1)) / DEG,
  };
}

/** PAPI lights (outer -> inner) as booleans: true = white, false = red. */
export function papiLights(angleRad) {
  return PAPI_ANGLES.map((a) => angleRad > a);
}

/**
 * Score a landing. Inputs:
 *   vs (m/s, negative down), bank (rad), lateral offset (m), distance from
 *   threshold at touchdown (m), bounces, stoppedOnRunway, maxVs (aircraft
 *   limit, m/s positive), width (m)
 * Returns { score 0-100, grade, failed, reason, parts }.
 */
export function scoreLanding(t) {
  const parts = {};
  if (t.distanceFromThreshold < 0) return fail('Touched down short of the runway');
  if (t.distanceFromThreshold > t.runwayLength) return fail('Touched down past the runway');
  if (Math.abs(t.lateral) > t.width / 2) return fail('Touched down off the runway');

  const vs = Math.abs(t.vs);
  parts.touchdown = vs <= 0.6 ? 40 : vs >= t.maxVs ? 0 : Math.round(40 - ((vs - 0.6) / (t.maxVs - 0.6)) * 32);
  if (vs >= t.maxVs) parts.touchdown = 0;
  const half = t.width / 2;
  const off = Math.abs(t.lateral);
  parts.centreline = off <= 2 ? 20 : Math.round(20 - ((off - 2) / (half - 2)) * 16);
  const d = t.distanceFromThreshold;
  parts.zone = d >= 60 && d <= 450 ? 20 : d < 60 ? Math.round(10 + (d / 60) * 10) : Math.round(clamp(20 - ((d - 450) / 450) * 20, 0, 20));
  const bankDeg = Math.abs(t.bank) / DEG;
  parts.attitude = bankDeg <= 2 ? 10 : Math.round(clamp(10 - (bankDeg - 2) * 1.25, 0, 10));
  parts.rollout = t.stoppedOnRunway ? 10 : 0;
  parts.bounces = -10 * Math.max(0, t.bounces);
  const score = clamp(Object.values(parts).reduce((a, b) => a + b, 0), 0, 100);
  const grade = score >= 92 ? 'S' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';
  return { score, grade, failed: false, reason: '', parts, hard: vs >= t.maxVs };

  function fail(reason) {
    return { score: 0, grade: 'F', failed: true, reason, parts: {} };
  }
}
