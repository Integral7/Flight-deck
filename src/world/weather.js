/**
 * Weather state machine. Presets describe a full weather picture; the live
 * state blends smoothly toward a target preset. Everything here is plain
 * data so it can be unit-tested; clouds, rain, fog, lighting and the flight
 * model all read from `Weather.current`.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const WEATHER_PRESETS = {
  clear: { label: 'Clear', cover: 0.12, puffScale: 0.8, cloudBase: 1300, overcast: 0, visibility: 1, rain: 0, haze: 0, wind: 3, turbulence: 0.05, light: 1 },
  cloudy: { label: 'Scattered clouds', cover: 0.5, puffScale: 1, cloudBase: 750, overcast: 0.12, visibility: 0.92, rain: 0, haze: 0.1, wind: 6, turbulence: 0.2, light: 0.97 },
  overcast: { label: 'Overcast', cover: 0.85, puffScale: 1.35, cloudBase: 850, overcast: 0.72, visibility: 0.72, rain: 0, haze: 0.2, wind: 8, turbulence: 0.3, light: 0.78 },
  rain: { label: 'Rain', cover: 0.95, puffScale: 1.5, cloudBase: 700, overcast: 0.9, visibility: 0.42, rain: 1, haze: 0.4, wind: 11, turbulence: 0.55, light: 0.62 },
  fog: { label: 'Fog', cover: 0.25, puffScale: 1.1, cloudBase: 600, overcast: 0.45, visibility: 0.11, rain: 0, haze: 1, wind: 1.5, turbulence: 0, light: 0.88 },
};

export const WEATHER_ORDER = ['clear', 'cloudy', 'overcast', 'rain', 'fog'];

const NUMERIC = ['cover', 'puffScale', 'cloudBase', 'overcast', 'visibility', 'rain', 'haze', 'wind', 'turbulence', 'light'];

/** Linear blend of two weather pictures. */
export function lerpWeather(a, b, t, out = {}) {
  const k = clamp(t, 0, 1);
  for (const key of NUMERIC) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}

export class Weather {
  constructor(preset = 'clear', seed = 1) {
    this.name = WEATHER_PRESETS[preset] ? preset : 'clear';
    this.from = { ...WEATHER_PRESETS[this.name] };
    this.to = WEATHER_PRESETS[this.name];
    this.current = { ...this.from };
    this.t = 1;
    this.duration = 20;
    this.windDir = ((seed * 137) % 360) * (Math.PI / 180); // direction the wind blows FROM
    this.time = 0;
    this.gust = 0;
    this.inCloud = 0;
    this.wind = { x: 0, y: 0, z: 0 };
  }

  get label() {
    return WEATHER_PRESETS[this.name].label;
  }

  /** Change weather; `instant` skips the transition (used at spawn). */
  set(name, instant = false) {
    if (!WEATHER_PRESETS[name]) return;
    this.from = { ...this.current };
    this.name = name;
    this.to = WEATHER_PRESETS[name];
    this.t = instant ? 1 : 0;
    if (instant) Object.assign(this.current, this.to);
  }

  cycle() {
    const i = WEATHER_ORDER.indexOf(this.name);
    this.set(WEATHER_ORDER[(i + 1) % WEATHER_ORDER.length]);
    return this.name;
  }

  /**
   * @param {number} dt
   * @param {number} altitude aircraft altitude (m) for cloud-layer effects
   */
  update(dt, altitude = 0) {
    this.time += dt;
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration);
      const s = this.t * this.t * (3 - 2 * this.t);
      lerpWeather(this.from, this.to, s, this.current);
    }
    const c = this.current;
    // Slowly veering wind with gusts.
    this.windDir += Math.sin(this.time * 0.013) * dt * 0.002;
    this.gust = 0.5 + 0.5 * Math.sin(this.time * 0.37) * Math.sin(this.time * 0.11 + 1.3);
    const speed = c.wind * (0.85 + 0.3 * this.gust);
    // Wind blows FROM windDir: velocity points the opposite way.
    // Heading convention: north = -Z, east = +X.
    this.wind.x = -Math.sin(this.windDir) * speed;
    this.wind.z = Math.cos(this.windDir) * speed;
    this.wind.y = 0;

    // Inside the cloud layer: thick when cover is high.
    const base = c.cloudBase;
    const top = base + 250 + 450 * c.cover;
    const inLayer = altitude > base - 40 && altitude < top + 40 ? 1 : 0;
    const target = inLayer * clamp((c.cover - 0.35) / 0.5, 0, 1);
    this.inCloud += (target - this.inCloud) * Math.min(1, dt * 1.5);
    return c;
  }

  /** Turbulence felt by the aircraft: weather, low-level mechanical, in-cloud. */
  turbulenceAt(agl) {
    const c = this.current;
    const lowLevel = agl < 300 ? (1 - agl / 300) * c.wind * 0.03 : 0;
    return clamp(c.turbulence * (0.6 + 0.4 * this.gust) + lowLevel + this.inCloud * 0.35, 0, 1.2);
  }

  /** Visibility factor for fog distance (0..1), including flying in cloud. */
  visibility() {
    return this.current.visibility * (1 - this.inCloud * 0.93);
  }

  /** Wind as compass direction (from) in degrees and speed in knots. */
  windReport() {
    const deg = ((((this.windDir * 180) / Math.PI) % 360) + 360) % 360;
    return { from: Math.round(deg), knots: Math.round(Math.hypot(this.wind.x, this.wind.z) * 1.94384) };
  }
}
