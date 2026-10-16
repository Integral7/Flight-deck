/**
 * Pure ring-course generation and gate detection for the time trial.
 * Coordinates are world metres; headings are compass radians
 * (clockwise from north = -Z).
 */
import { mulberry32 } from '../engine/random.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const RING_RADIUS = 28;
export const MISS_PENALTY = 5; // seconds per missed ring

/**
 * @param {{heightAt:(x:number,z:number)=>number}} terrain
 * @param {{x:number,z:number,heading:number}} start
 * @param {number} seed
 * @param {number} count
 * @returns {Array<{x:number,y:number,z:number,nx:number,ny:number,nz:number,radius:number}>}
 */
export function generateCourse(terrain, start, seed, count = 12) {
  const rnd = mulberry32(seed >>> 0);
  const pts = [];
  let heading = start.heading;
  let x = start.x;
  let z = start.z;
  let turnBias = rnd() < 0.5 ? -1 : 1;
  for (let i = 0; i < count; i++) {
    const spacing = 650 + rnd() * 450;
    // Gentle S-curves: alternate turn direction every few rings.
    if (i % 4 === 3) turnBias = -turnBias;
    heading += turnBias * (0.1 + rnd() * 0.32) * (i === 0 ? 0 : 1);
    x += Math.sin(heading) * spacing;
    z -= Math.cos(heading) * spacing;
    // Highest ground on the leg and around the ring.
    let ground = 0;
    const px = pts.length ? pts[pts.length - 1].x : start.x;
    const pz = pts.length ? pts[pts.length - 1].z : start.z;
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      ground = Math.max(ground, terrain.heightAt(px + (x - px) * t, pz + (z - pz) * t));
    }
    for (const [ox, oz] of [[60, 0], [-60, 0], [0, 60], [0, -60]]) ground = Math.max(ground, terrain.heightAt(x + ox, z + oz));
    const clearance = 70 + rnd() * 110;
    pts.push({ x, z, y: ground + clearance + RING_RADIUS });
  }
  // Limit climb/descent gradients so every ring is reachable: raise rings
  // (never lower them below their clearance) in a forward and backward pass.
  const maxGrad = 0.16;
  for (let pass = 0; pass < 6; pass++) {
    // Limit descents (forward) and climbs (backward); only ever raise rings.
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      pts[i].y = Math.max(pts[i].y, pts[i - 1].y - d * maxGrad);
    }
    for (let i = pts.length - 1; i > 0; i--) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      pts[i - 1].y = Math.max(pts[i - 1].y, pts[i].y - d * maxGrad);
    }
  }
  // Ring normals: average of incoming and outgoing directions.
  return pts.map((p, i) => {
    const prev = i === 0 ? { x: start.x, y: p.y, z: start.z } : pts[i - 1];
    const next = pts[i + 1] || { x: p.x + (p.x - prev.x), y: p.y, z: p.z + (p.z - prev.z) };
    const a = norm(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    const b = norm(next.x - p.x, next.y - p.y, next.z - p.z);
    const n = norm(a[0] + b[0], (a[1] + b[1]) * 0.5, a[2] + b[2]);
    return { x: p.x, y: p.y, z: p.z, nx: n[0], ny: n[1], nz: n[2], radius: RING_RADIUS };
  });
}

function norm(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * Did the segment a -> b cross the ring's plane, and where?
 * Returns null (no crossing), or { hit: boolean, distance } where distance
 * is from the ring centre to the crossing point.
 */
export function ringCrossing(a, b, ring) {
  const da = (a.x - ring.x) * ring.nx + (a.y - ring.y) * ring.ny + (a.z - ring.z) * ring.nz;
  const db = (b.x - ring.x) * ring.nx + (b.y - ring.y) * ring.ny + (b.z - ring.z) * ring.nz;
  // Only count crossings in the direction of travel (front -> back).
  if (!(da < 0 && db >= 0)) return null;
  const t = da / (da - db);
  const px = a.x + (b.x - a.x) * t;
  const py = a.y + (b.y - a.y) * t;
  const pz = a.z + (b.z - a.z) * t;
  const distance = Math.hypot(px - ring.x, py - ring.y, pz - ring.z);
  return { hit: distance <= ring.radius, distance };
}

/** "1:05.32" */
export function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`;
}

/** Total time with penalties, clamped to sensible values. */
export function totalTime(elapsed, missed) {
  return clamp(elapsed, 0, 1e6) + missed * MISS_PENALTY;
}
