/**
 * Cockpit warnings as a pure function of flight state, so they are testable.
 * `groundAt(x, z)` returns terrain/water surface height.
 */
export function computeWarnings(s, groundAt) {
  const out = [];
  if (s.crashed || s.onGround) return out;
  if (s.stallWarning) out.push({ id: 'stall', text: 'STALL', level: 'bad' });
  if (s.airspeed > s.type.neverExceed) out.push({ id: 'overspeed', text: 'OVERSPEED', level: 'bad' });

  // Terrain: check the projected flight path 2-8 s ahead.
  let pullUp = false;
  if (s.agl < 600) {
    for (const t of [2, 4, 6, 8]) {
      const x = s.pos.x + s.vel.x * t;
      const z = s.pos.z + s.vel.z * t;
      const y = s.pos.y + s.vel.y * t;
      const g = groundAt(x, z);
      if (y < g + 15 && !(s.gearPos > 0.95 && s.verticalSpeed > -4 && s.airspeed < s.type.approachSpeed * 1.5)) {
        pullUp = true;
        break;
      }
    }
  }
  if (pullUp) out.push({ id: 'pullup', text: 'PULL UP', level: 'bad' });
  else if (s.agl < 150 && s.verticalSpeed < -10) out.push({ id: 'sinkrate', text: 'SINK RATE', level: 'warn' });

  if (s.type.retractableGear && s.gearPos < 0.99 && s.agl < 120 && s.verticalSpeed < -0.5 && s.airspeed < s.type.approachSpeed * 1.4) {
    out.push({ id: 'gear', text: 'GEAR UP', level: 'warn' });
  }
  if (s.bank > 1.05 || s.bank < -1.05) out.push({ id: 'bank', text: 'BANK ANGLE', level: 'warn' });
  return out;
}
