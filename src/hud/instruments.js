/**
 * Canvas 2D flight instruments. The same drawing code feeds the chase-view
 * HUD (a DOM canvas) and the 3D cockpit panel (a CanvasTexture).
 *
 * Needle mappings are exported as pure functions so they can be tested.
 */
export const KT = 1.94384;
export const FT = 3.28084;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Speed ranges (knots) derived from the aircraft's aerodynamics at sea level. */
export function speedBands(type) {
  const clMax = type.cl0 + type.clAlpha * type.stallAlpha;
  const clMaxFlaps = clMax + type.flapCl + type.clAlpha * type.flapStall;
  const vs = (cl) => Math.sqrt((2 * type.mass * 9.81) / (1.225 * type.wingArea * cl)) * KT;
  const vne = type.neverExceed * KT;
  return {
    vs0: type.hasFlaps ? vs(clMaxFlaps) : vs(clMax),
    vs1: vs(clMax),
    vfe: type.hasFlaps ? type.cruiseSpeed * 0.8 * KT : 0,
    vno: vne * 0.82,
    vne,
    max: Math.ceil((vne * 1.12) / 20) * 20,
  };
}

/** Airspeed needle angle: 0 kt at 12 o'clock-ish, full scale ~330 degrees. */
export function asiAngle(kt, max) {
  return -Math.PI / 2 + (clamp(kt, 0, max) / max) * (330 * DEG);
}

/** Altimeter needles: hundreds (long) and thousands (short), radians from 12 o'clock. */
export function altimeterAngles(ft) {
  const f = Math.max(0, ft);
  return {
    hundreds: ((f % 1000) / 1000) * TAU,
    thousands: ((f % 10000) / 10000) * TAU,
    tenThousands: ((f % 100000) / 100000) * TAU,
  };
}

/** VSI needle: 0 at 9 o'clock, +/-2000 fpm sweep +/-170 degrees. */
export function vsiAngle(fpm) {
  const v = clamp(fpm, -2000, 2000);
  // Non-linear scale: finer resolution near zero like real VSIs.
  const s = Math.sign(v) * Math.sqrt(Math.abs(v) / 2000);
  return Math.PI + s * (170 * DEG);
}

function bezel(ctx, x, y, r, label) {
  ctx.save();
  const g = ctx.createRadialGradient(x, y - r * 0.3, r * 0.2, x, y, r * 1.08);
  g.addColorStop(0, '#2b2f36');
  g.addColorStop(1, '#0c0e11');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.08, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0a0b0d';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  if (label) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `600 ${r * 0.11}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y - r * 0.3);
  }
  ctx.restore();
}

function glass(ctx, x, y, r) {
  ctx.save();
  const g = ctx.createLinearGradient(x - r, y - r, x + r * 0.2, y + r * 0.4);
  g.addColorStop(0, 'rgba(255,255,255,0.13)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function needle(ctx, x, y, angle, len, width, color = '#f4f4f0', tail = 0.18) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = width * 1.5;
  ctx.shadowOffsetY = width * 0.6;
  ctx.beginPath();
  ctx.moveTo(-width, len * tail);
  ctx.lineTo(-width * 0.6, -len * 0.85);
  ctx.lineTo(0, -len);
  ctx.lineTo(width * 0.6, -len * 0.85);
  ctx.lineTo(width, len * tail);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#1a1c20';
  ctx.beginPath();
  ctx.arc(x, y, width * 1.6, 0, TAU);
  ctx.fill();
}

function ticks(ctx, x, y, r, from, to, count, len, width, color = '#ddd') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (let i = 0; i <= count; i++) {
    const a = from + ((to - from) * i) / count;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(x + ca * r, y + sa * r);
    ctx.lineTo(x + ca * (r - len), y + sa * (r - len));
    ctx.stroke();
  }
  ctx.restore();
}

function arcBand(ctx, x, y, r, a0, a1, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.stroke();
  ctx.restore();
}

export function drawAirspeed(ctx, x, y, r, s, bands) {
  bezel(ctx, x, y, r, 'KNOTS');
  const max = bands.max;
  const ang = (kt) => asiAngle(kt, max);
  const bw = r * 0.07;
  if (bands.vfe) arcBand(ctx, x, y, r * 0.86, ang(bands.vs0), ang(bands.vfe), '#e8e8e8', bw * 0.6);
  arcBand(ctx, x, y, r * 0.93, ang(bands.vs1), ang(bands.vno), '#2fbf5a', bw);
  arcBand(ctx, x, y, r * 0.93, ang(bands.vno), ang(bands.vne), '#e3c02a', bw);
  arcBand(ctx, x, y, r * 0.93, ang(bands.vne) - 0.012, ang(bands.vne) + 0.012, '#e33', bw * 1.6);
  const step = max > 200 ? 20 : 10;
  ctx.save();
  ctx.fillStyle = '#eee';
  ctx.font = `600 ${r * 0.14}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let kt = 0; kt <= max; kt += step) {
    const a = ang(kt);
    const major = kt % (step * 2) === 0;
    ticks(ctx, x, y, r * 0.98, a, a, 0, major ? r * 0.14 : r * 0.08, major ? 2.2 : 1.4);
    if (major && kt > 0) ctx.fillText(String(kt), x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66);
  }
  ctx.restore();
  const kt = s.airspeed * KT;
  needle(ctx, x, y, ang(kt) + Math.PI / 2, r * 0.82, r * 0.035);
  digital(ctx, x, y + r * 0.32, r * 0.85, Math.round(kt), '');
  glass(ctx, x, y, r);
}

function digital(ctx, x, y, r, value, unit) {
  ctx.save();
  const w = r * 0.62;
  const h = r * 0.2;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h * 0.25);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#9ff0c0';
  ctx.font = `600 ${h * 0.72}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${value}${unit}`, x, y + 1);
  ctx.restore();
}

export function drawAttitude(ctx, x, y, r, s) {
  bezel(ctx, x, y, r, '');
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.96, 0, TAU);
  ctx.clip();
  ctx.translate(x, y);
  ctx.rotate(-s.bank);
  const pxPerDeg = r / 32;
  const pitchDeg = clamp(s.pitch / DEG, -90, 90);
  const off = pitchDeg * pxPerDeg;
  // Sky and ground.
  const sky = ctx.createLinearGradient(0, -r * 2 + off, 0, off);
  sky.addColorStop(0, '#1d5fa8');
  sky.addColorStop(1, '#4fa3e6');
  ctx.fillStyle = sky;
  ctx.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3);
  const gnd = ctx.createLinearGradient(0, off, 0, off + r * 2);
  gnd.addColorStop(0, '#9b6a35');
  gnd.addColorStop(1, '#5a3a1a');
  ctx.fillStyle = gnd;
  ctx.fillRect(-r * 2, off, r * 4, r * 3);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 2, off);
  ctx.lineTo(r * 2, off);
  ctx.stroke();
  // Pitch ladder.
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${r * 0.1}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1.6;
  for (let d = -30; d <= 30; d += 5) {
    if (d === 0) continue;
    const yy = off - d * pxPerDeg;
    const w = d % 10 === 0 ? r * 0.36 : r * 0.16;
    ctx.beginPath();
    ctx.moveTo(-w / 2, yy);
    ctx.lineTo(w / 2, yy);
    ctx.stroke();
    if (d % 10 === 0) {
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.abs(d)), -w / 2 - 4, yy);
      ctx.textAlign = 'left';
      ctx.fillText(String(Math.abs(d)), w / 2 + 4, yy);
    }
  }
  ctx.restore();
  // Bank scale (fixed) and pointer (rotates with bank).
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.82, -Math.PI / 2 - 60 * DEG, -Math.PI / 2 + 60 * DEG);
  ctx.stroke();
  for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = -Math.PI / 2 + b * DEG;
    const len = b % 30 === 0 ? r * 0.12 : r * 0.07;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
    ctx.lineTo(Math.cos(a) * (r * 0.82 + len), Math.sin(a) * (r * 0.82 + len));
    ctx.stroke();
  }
  ctx.rotate(-s.bank);
  ctx.fillStyle = '#f6c453';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.8);
  ctx.lineTo(-r * 0.06, -r * 0.68);
  ctx.lineTo(r * 0.06, -r * 0.68);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Fixed aircraft symbol.
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#f6c453';
  ctx.fillStyle = '#f6c453';
  ctx.lineWidth = r * 0.045;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.5, 0);
  ctx.lineTo(-r * 0.18, 0);
  ctx.lineTo(-r * 0.09, r * 0.08);
  ctx.moveTo(r * 0.5, 0);
  ctx.lineTo(r * 0.18, 0);
  ctx.lineTo(r * 0.09, r * 0.08);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.03, 0, TAU);
  ctx.fill();
  ctx.restore();
  glass(ctx, x, y, r);
}

export function drawAltimeter(ctx, x, y, r, s) {
  bezel(ctx, x, y, r, '');
  ctx.save();
  ctx.fillStyle = '#eee';
  ctx.font = `600 ${r * 0.17}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * TAU;
    ctx.fillText(String(i), x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7);
  }
  ctx.restore();
  ticks(ctx, x, y, r * 0.98, -Math.PI / 2, -Math.PI / 2 + TAU, 50, r * 0.07, 1.2);
  ticks(ctx, x, y, r * 0.98, -Math.PI / 2, -Math.PI / 2 + TAU, 10, r * 0.13, 2.2);
  const ft = s.pos.y * FT;
  const a = altimeterAngles(ft);
  digital(ctx, x, y + r * 0.36, r, Math.round(ft), '');
  needle(ctx, x, y, a.tenThousands, r * 0.9, r * 0.012, '#ddd', 0);
  needle(ctx, x, y, a.thousands, r * 0.5, r * 0.055);
  needle(ctx, x, y, a.hundreds, r * 0.84, r * 0.035);
  glass(ctx, x, y, r);
}

export function drawHeading(ctx, x, y, r, s, bug = null) {
  bezel(ctx, x, y, r, '');
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-s.heading);
  ctx.strokeStyle = '#eee';
  ctx.fillStyle = '#eee';
  for (let d = 0; d < 360; d += 5) {
    const a = d * DEG - Math.PI / 2;
    const len = d % 30 === 0 ? r * 0.15 : d % 10 === 0 ? r * 0.1 : r * 0.06;
    ctx.lineWidth = d % 10 === 0 ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    ctx.lineTo(Math.cos(a) * (r * 0.95 - len), Math.sin(a) * (r * 0.95 - len));
    ctx.stroke();
  }
  ctx.font = `700 ${r * 0.17}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labels = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let d = 0; d < 360; d += 30) {
    ctx.save();
    ctx.rotate(d * DEG);
    ctx.fillStyle = labels[d] ? (d === 0 ? '#f6c453' : '#fff') : '#ccc';
    ctx.font = labels[d] ? `800 ${r * 0.2}px system-ui, sans-serif` : `600 ${r * 0.13}px system-ui, sans-serif`;
    ctx.fillText(labels[d] || String(d / 10), 0, -r * 0.62);
    ctx.restore();
  }
  if (bug !== null) {
    ctx.save();
    ctx.rotate(bug);
    ctx.fillStyle = '#5fd3ff';
    ctx.beginPath();
    ctx.moveTo(-r * 0.08, -r * 0.97);
    ctx.lineTo(r * 0.08, -r * 0.97);
    ctx.lineTo(r * 0.08, -r * 0.86);
    ctx.lineTo(0, -r * 0.8);
    ctx.lineTo(-r * 0.08, -r * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // Fixed aircraft and lubber line.
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#f6c453';
  ctx.lineWidth = r * 0.04;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.3);
  ctx.lineTo(0, r * 0.28);
  ctx.moveTo(-r * 0.26, -r * 0.02);
  ctx.lineTo(r * 0.26, -r * 0.02);
  ctx.moveTo(-r * 0.1, r * 0.24);
  ctx.lineTo(r * 0.1, r * 0.24);
  ctx.stroke();
  ctx.fillStyle = '#f6c453';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.98);
  ctx.lineTo(-r * 0.05, -r * 1.08);
  ctx.lineTo(r * 0.05, -r * 1.08);
  ctx.fill();
  ctx.restore();
  digital(ctx, x, y + r * 0.44, r * 0.7, String(Math.round(s.heading / DEG) % 360).padStart(3, '0'), '°');
  glass(ctx, x, y, r);
}

export function drawVSI(ctx, x, y, r, s) {
  bezel(ctx, x, y, r, '');
  ctx.save();
  ctx.fillStyle = '#eee';
  ctx.font = `600 ${r * 0.15}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const v of [0, 500, 1000, 1500, 2000]) {
    for (const sign of v === 0 ? [1] : [1, -1]) {
      const a = vsiAngle(v * sign);
      ticks(ctx, x, y, r * 0.98, a, a, 0, r * 0.14, 2.2);
      ctx.fillText(String(v / 100), x + Math.cos(a) * r * 0.68, y + Math.sin(a) * r * 0.68);
    }
  }
  for (let v = -2000; v <= 2000; v += 100) {
    const a = vsiAngle(v);
    ticks(ctx, x, y, r * 0.98, a, a, 0, r * 0.06, 1.2);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `600 ${r * 0.1}px system-ui, sans-serif`;
  ctx.fillText('UP', x - r * 0.38, y - r * 0.2);
  ctx.fillText('DN', x - r * 0.38, y + r * 0.2);
  ctx.fillText('FPM ×100', x + r * 0.2, y + r * 0.42);
  ctx.restore();
  const fpm = s.verticalSpeed * FT * 60;
  needle(ctx, x, y, vsiAngle(fpm) + Math.PI / 2, r * 0.84, r * 0.035);
  glass(ctx, x, y, r);
}

export function drawTurnCoordinator(ctx, x, y, r, s, turnRate) {
  bezel(ctx, x, y, r, 'TURN COORD');
  ctx.save();
  ctx.translate(x, y);
  // Standard-rate marks (3 deg/s) at +/-20 degrees of symbol bank.
  ctx.strokeStyle = '#eee';
  ctx.lineWidth = 2.5;
  ctx.fillStyle = '#eee';
  ctx.font = `700 ${r * 0.13}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('L', -r * 0.68, r * 0.38);
  ctx.fillText('R', r * 0.68, r * 0.38);
  for (const side of [-1, 1]) {
    const a = side * 20 * DEG;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.86 * side, Math.sin(a) * r * 0.86 * side);
    ctx.lineTo(Math.cos(a) * r * 0.72 * side, Math.sin(a) * r * 0.72 * side);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-r * 0.86, 0);
  ctx.lineTo(-r * 0.72, 0);
  ctx.moveTo(r * 0.86, 0);
  ctx.lineTo(r * 0.72, 0);
  ctx.stroke();
  // Aircraft symbol banked by turn rate (standard rate = 20 degrees).
  const sym = clamp(turnRate / (3 * DEG), -2, 2) * 20 * DEG;
  ctx.save();
  ctx.rotate(sym);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = r * 0.05;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, 0);
  ctx.lineTo(r * 0.6, 0);
  ctx.moveTo(0, -r * 0.16);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.08, 0, TAU);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
  // Inclinometer (slip ball).
  const tubeY = r * 0.48;
  ctx.fillStyle = '#1d1f22';
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-r * 0.42, tubeY - r * 0.09, r * 0.84, r * 0.18, r * 0.09);
  ctx.fill();
  ctx.stroke();
  const ball = clamp(-s.sideslip / (12 * DEG), -1, 1) * r * 0.32;
  ctx.fillStyle = '#eee';
  ctx.beginPath();
  ctx.arc(ball, tubeY, r * 0.075, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(-r * 0.1, tubeY - r * 0.09);
  ctx.lineTo(-r * 0.1, tubeY + r * 0.09);
  ctx.moveTo(r * 0.1, tubeY - r * 0.09);
  ctx.lineTo(r * 0.1, tubeY + r * 0.09);
  ctx.stroke();
  ctx.restore();
  glass(ctx, x, y, r);
}

/** Small status column: throttle, flaps, gear lights, warnings. */
export function drawStatus(ctx, x, y, w, h, s, controls) {
  ctx.save();
  ctx.fillStyle = '#0b0c0e';
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();
  const pad = w * 0.12;
  const font = (px, weight = 600) => `${weight} ${px}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Throttle bar.
  const barH = h * 0.4;
  const barW = w * 0.22;
  const bx = x + pad;
  const by = y + h * 0.1;
  ctx.fillStyle = '#1b1d21';
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = '#f6c453';
  ctx.fillRect(bx, by + barH * (1 - s.throttle), barW, barH * s.throttle);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  const ty = by + barH * (1 - controls.throttle);
  ctx.beginPath();
  ctx.moveTo(bx - 3, ty);
  ctx.lineTo(bx + barW + 3, ty);
  ctx.stroke();
  ctx.fillStyle = '#aaa';
  ctx.font = font(h * 0.055);
  ctx.fillText('THR', bx + barW / 2, by + barH + h * 0.045);
  ctx.fillStyle = '#eee';
  ctx.font = font(h * 0.065, 700);
  ctx.fillText(`${Math.round(s.throttle * 100)}%`, bx + barW / 2, by + barH + h * 0.1);
  // Flaps.
  const fx = x + w * 0.62;
  ctx.fillStyle = '#aaa';
  ctx.font = font(h * 0.055);
  ctx.fillText('FLAPS', fx, by + h * 0.02);
  ctx.fillStyle = s.type.hasFlaps ? '#eee' : '#555';
  ctx.font = font(h * 0.075, 700);
  ctx.fillText(s.type.hasFlaps ? ['UP', '1/2', 'FULL'][Math.round(s.flaps * 2)] : '—', fx, by + h * 0.1);
  // Gear lights.
  ctx.fillStyle = '#aaa';
  ctx.font = font(h * 0.055);
  ctx.fillText('GEAR', fx, by + h * 0.22);
  const down = s.gearPos > 0.99;
  const transit = s.gearPos > 0.01 && !down;
  for (let i = 0; i < 3; i++) {
    const gx = fx + (i - 1) * w * 0.17;
    const gy = by + h * 0.31 + (i === 1 ? -h * 0.03 : 0);
    ctx.fillStyle = down ? '#3ee07a' : transit ? '#e33' : '#222';
    ctx.beginPath();
    ctx.arc(gx, gy, h * 0.03, 0, TAU);
    ctx.fill();
  }
  // Annunciators.
  const ann = [
    ['STALL', s.stallWarning, '#ff4d4d'],
    ['BRAKE', s.brake > 0, '#ffb74d'],
    ['G ' + s.gForce.toFixed(1), Math.abs(s.gForce) > 3, '#ffb74d'],
  ];
  ann.forEach(([label, on, color], i) => {
    const ay = y + h * (0.73 + i * 0.09);
    ctx.fillStyle = on ? color : '#1b1d21';
    ctx.beginPath();
    ctx.roundRect(x + pad * 0.6, ay - h * 0.035, w - pad * 1.2, h * 0.07, 4);
    ctx.fill();
    ctx.fillStyle = on ? '#111' : '#555';
    ctx.font = font(h * 0.05, 700);
    ctx.fillText(label, x + w / 2, ay + 1);
  });
  ctx.restore();
}
