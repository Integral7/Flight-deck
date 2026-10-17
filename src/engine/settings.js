/**
 * Graphics quality presets and persisted user settings.
 *
 * Each preset trades visual fidelity for speed. `low` is aimed at integrated
 * laptop GPUs, `high` at discrete GPUs. Everything that scales with quality
 * reads from the active preset, so switching tiers at runtime is a matter of
 * calling `applyQuality` on each subsystem.
 */

export const QUALITY_PRESETS = {
  low: {
    name: 'low',
    label: 'Low',
    antialias: false,
    pixelRatioCap: 1.0,
    minRenderScale: 0.6,
    shadows: false,
    shadowMapSize: 0,
    viewRadius: 6, // chunks (512 m each)
    lodDistances: [1.5, 3, 4.5], // chunk-distance thresholds between LOD levels
    treeRadius: 2,
    farTreeRadius: 4,
    treeDensity: 0.45,
    cloudCount: 50,
    rainCount: 2500,
    chunkBuildsPerFrame: 1,
    starCount: 800,
  },
  medium: {
    name: 'medium',
    label: 'Medium',
    antialias: true,
    pixelRatioCap: 1.5,
    minRenderScale: 0.7,
    shadows: true,
    shadowMapSize: 1024,
    viewRadius: 9,
    lodDistances: [2, 4, 6.5],
    treeRadius: 3,
    farTreeRadius: 6,
    treeDensity: 0.75,
    cloudCount: 110,
    rainCount: 6000,
    chunkBuildsPerFrame: 2,
    starCount: 1600,
  },
  high: {
    name: 'high',
    label: 'High',
    antialias: true,
    pixelRatioCap: 2.0,
    minRenderScale: 0.75,
    shadows: true,
    shadowMapSize: 2048,
    viewRadius: 12,
    lodDistances: [2.5, 5, 8.5],
    treeRadius: 4,
    farTreeRadius: 8,
    treeDensity: 1.0,
    cloudCount: 180,
    rainCount: 10000,
    chunkBuildsPerFrame: 3,
    starCount: 2500,
  },
};

export const DEFAULT_SEED = 1337;

const STORAGE_KEY = 'flightdeck.settings.v1';

const DEFAULTS = {
  quality: 'medium',
  adaptiveResolution: true,
  seed: DEFAULT_SEED,
  randomSeed: false,
  aircraft: 'trainer',
  mode: 'free',
  invertPitch: false,
  showFps: false,
  timeOfDay: 15.5,
  dayCycle: 'normal',
  weather: 'cloudy',
};

/** Game hours per real second for each day-cycle setting. */
export const DAY_CYCLES = {
  off: { label: 'Frozen', rate: 0 },
  slow: { label: 'Slow (2.4 h day)', rate: 1 / 360 },
  normal: { label: 'Normal (36 min day)', rate: 1 / 90 },
  fast: { label: 'Fast (6 min day)', rate: 1 / 15 },
};

export const TIMES_OF_DAY = [
  { label: 'Dawn', hours: 6.4 },
  { label: 'Morning', hours: 9 },
  { label: 'Noon', hours: 12.5 },
  { label: 'Afternoon', hours: 15.5 },
  { label: 'Golden hour', hours: 17.2 },
  { label: 'Dusk', hours: 18.4 },
  { label: 'Night', hours: 22.5 },
];

/** Pick a sensible starting tier from coarse hardware hints. */
export function guessQuality(nav = globalThis.navigator) {
  if (!nav) return 'medium';
  const touch = (nav.maxTouchPoints || 0) > 0;
  const cores = nav.hardwareConcurrency || 4;
  if (touch || cores <= 4) return 'low';
  if (cores >= 12) return 'high';
  return 'medium';
}

export class Settings {
  constructor(storage = safeStorage()) {
    this.storage = storage;
    const saved = this._load();
    this.values = { ...DEFAULTS, quality: guessQuality(), ...saved };
    if (!QUALITY_PRESETS[this.values.quality]) this.values.quality = 'medium';
    this.listeners = new Set();
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this._save();
    for (const fn of this.listeners) fn(key, value);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get preset() {
    return QUALITY_PRESETS[this.values.quality];
  }

  /** Seed used for a new flight: fixed by default, random if requested. */
  resolveSeed(rng = Math.random) {
    if (this.values.randomSeed) return Math.floor(rng() * 2 ** 31);
    return this.values.seed;
  }

  _load() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      /* storage unavailable (private mode) - settings stay in memory */
    }
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
