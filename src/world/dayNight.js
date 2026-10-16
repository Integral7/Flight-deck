/**
 * Pure day/night model: sun position from time of day and a palette of
 * sky/light/fog colours keyed by sun elevation. No three.js, so it is
 * unit-tested and reused by the sky shader, lights and the HUD.
 *
 * World axes: +X east, +Y up, -Z north (so south is +Z).
 */

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const SUNRISE = 6;
export const SUNSET = 18;
const MAX_ELEVATION = 62 * DEG;

/** Normalise any hour value into [0, 24). */
export function wrapHours(h) {
  return ((h % 24) + 24) % 24;
}

/**
 * Sun direction (unit vector toward the sun) for a time of day in hours.
 * The sun rises in the east at 06:00, peaks due south at 12:00 and sets in
 * the west at 18:00; at night it continues below the horizon.
 */
export function sunDirection(hours, out = [0, 0, 0]) {
  const h = wrapHours(hours);
  // Hour angle: 0 at noon, -pi at midnight.
  const ha = ((h - 12) / 12) * Math.PI;
  const elevation = Math.asin(Math.cos(ha) * Math.sin(MAX_ELEVATION));
  // Azimuth sweeps east (90 deg) -> south (180) -> west (270) during the day.
  const az = Math.PI + ha; // radians clockwise from north
  const ce = Math.cos(elevation);
  out[0] = Math.sin(az) * ce;
  out[1] = Math.sin(elevation);
  out[2] = -Math.cos(az) * ce;
  return out;
}

export function sunElevation(hours) {
  return Math.asin(sunDirection(hours)[1]);
}

/** Moon roughly opposite the sun, a bit higher so nights are moonlit. */
export function moonDirection(hours, out = [0, 0, 0]) {
  sunDirection(hours + 12, out);
  out[1] = Math.max(out[1], 0.25) * 0.9 + 0.1;
  const len = Math.hypot(out[0], out[1], out[2]);
  out[0] /= len;
  out[1] /= len;
  out[2] /= len;
  return out;
}

// Keyframes by sun elevation in degrees. Colours are sRGB hex.
const KEYS = [
  { e: -18, zenith: 0x02040b, horizon: 0x0a1222, sun: 0x000000, sunI: 0, hemiSky: 0x6a82b8, hemiGround: 0x1a1d26, hemiI: 0.5, fog: 0x0e1628, exposure: 1.7, stars: 1 },
  { e: -7, zenith: 0x0b1733, horizon: 0x33395a, sun: 0x000000, sunI: 0, hemiSky: 0x6f80b4, hemiGround: 0x23252e, hemiI: 0.5, fog: 0x272c47, exposure: 1.4, stars: 0.7 },
  { e: -1.5, zenith: 0x203e78, horizon: 0xd9744a, sun: 0xff6a2a, sunI: 0.25, hemiSky: 0x8a8fc0, hemiGround: 0x3a3030, hemiI: 0.45, fog: 0xa86d62, exposure: 1.05, stars: 0.2 },
  { e: 4, zenith: 0x33609f, horizon: 0xf2a066, sun: 0xffa060, sunI: 1.5, hemiSky: 0xa7b9e0, hemiGround: 0x5a4a3a, hemiI: 0.6, fog: 0xd8a582, exposure: 1.0, stars: 0 },
  { e: 12, zenith: 0x3a6fbc, horizon: 0xd9cfc0, sun: 0xffd2a0, sunI: 2.3, hemiSky: 0xb6cdf0, hemiGround: 0x5d5a45, hemiI: 0.75, fog: 0xc9cdd0, exposure: 1.0, stars: 0 },
  { e: 30, zenith: 0x3b78c8, horizon: 0xb6d2ee, sun: 0xfff1de, sunI: 2.8, hemiSky: 0xc4dcff, hemiGround: 0x5b6046, hemiI: 0.85, fog: 0xb3cde8, exposure: 1.0, stars: 0 },
  { e: 70, zenith: 0x2f6ec4, horizon: 0xa9cbee, sun: 0xfffaf2, sunI: 3.0, hemiSky: 0xc8e0ff, hemiGround: 0x5e6449, hemiI: 0.9, fog: 0xadcbea, exposure: 1.0, stars: 0 },
];

function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Interpolated lighting state for a sun elevation (radians).
 * Colours are returned as sRGB [r, g, b] in 0..1.
 */
export function skyState(elevationRad) {
  const e = clamp(elevationRad / DEG, KEYS[0].e, KEYS[KEYS.length - 1].e);
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = clamp((e - a.e) / (b.e - a.e), 0, 1);
  const s = t * t * (3 - 2 * t);
  const col = (k) => mixRgb(hexToRgb(a[k]), hexToRgb(b[k]), s);
  const num = (k) => a[k] + (b[k] - a[k]) * s;
  return {
    elevation: elevationRad,
    zenith: col('zenith'),
    horizon: col('horizon'),
    sunColor: col('sun'),
    sunIntensity: num('sunI'),
    hemiSky: col('hemiSky'),
    hemiGround: col('hemiGround'),
    hemiIntensity: num('hemiI'),
    fog: col('fog'),
    exposure: num('exposure'),
    stars: num('stars'),
    night: clamp((-elevationRad / DEG - 2) / 8, 0, 1),
  };
}

/** "07:30" style clock string. */
export function formatClock(hours) {
  const h = wrapHours(hours);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
