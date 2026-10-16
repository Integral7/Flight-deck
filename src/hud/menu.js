import { AIRCRAFT, AIRCRAFT_IDS } from '../aircraft/types.js';
import { QUALITY_PRESETS, DAY_CYCLES, TIMES_OF_DAY, DEFAULT_SEED } from '../engine/settings.js';
import { WEATHER_PRESETS, WEATHER_ORDER } from '../world/weather.js';
import { speedBands } from './instruments.js';

export const MODE_INFO = [
  { id: 'free', name: 'Free flight', text: 'Explore an endless procedural world. Airports every few miles.' },
  { id: 'landing', name: 'Landing challenge', text: 'Fly a 3° final and grease it on the centreline. Scored.' },
  { id: 'timetrial', name: 'Time trial', text: 'Twelve rings against the clock. Missed rings cost 5 s.' },
  { id: 'scenic', name: 'Scenic', text: 'Autopilot, golden light, cinematic cameras. No crashes.' },
];

/** Normalised 0..1 stats for the aircraft cards. */
export function aircraftStats() {
  const raw = AIRCRAFT_IDS.map((id) => {
    const T = AIRCRAFT[id];
    const b = speedBands(T);
    return {
      id,
      speed: T.neverExceed,
      agility: T.maxRollRate,
      stability: T.wingLeveling + T.response * 2 + T.pitchStability * 0.1,
      shortField: 1 / b.vs0,
    };
  });
  const keys = ['speed', 'agility', 'stability', 'shortField'];
  const out = {};
  for (const r of raw) out[r.id] = {};
  for (const k of keys) {
    const vals = raw.map((r) => r[k]);
    const max = Math.max(...vals);
    for (const r of raw) out[r.id][k] = 0.25 + 0.75 * (r[k] / max);
  }
  return out;
}

/**
 * Start / main menu. Calls `onFly(settings)` when the player takes off.
 */
export class Menu {
  constructor(container, settings, { onFly, onHelp }) {
    this.settings = settings;
    this.onFly = onFly;
    this.onHelp = onHelp;
    this.root = document.createElement('div');
    this.root.className = 'menu ui-layer';
    this.root.hidden = true;
    container.append(this.root);
    this._render();
  }

  get open() {
    return !this.root.hidden;
  }

  show() {
    this._render();
    this.root.hidden = false;
    this.root.querySelector('[data-fly]')?.focus({ preventScroll: true });
  }

  hide() {
    this.root.hidden = true;
  }

  _render() {
    const st = this.settings;
    const stats = aircraftStats();
    const bar = (label, v) => `<div class="stat"><small>${label}</small><i style="--v:${(v * 100).toFixed(0)}%"></i></div>`;
    const seedMode = st.get('randomSeed') ? 'random' : st.get('seed') === DEFAULT_SEED ? 'fixed' : 'custom';
    this.root.innerHTML = `
      <div class="menu-panel panel">
        <header class="menu-head">
          <div class="logo">FLIGHT<span>DECK</span></div>
          <p class="muted">An endless procedural world to fly over. Pick a mode, pick a plane, take off.</p>
        </header>
        <section>
          <h3 class="sub">Mode</h3>
          <div class="cards modes">
            ${MODE_INFO.map((m) => `<button class="card ${st.get('mode') === m.id ? 'sel' : ''}" data-mode="${m.id}"><b>${m.name}</b><span>${m.text}</span></button>`).join('')}
          </div>
        </section>
        <section>
          <h3 class="sub">Aircraft</h3>
          <div class="cards planes">
            ${AIRCRAFT_IDS.map((id) => {
              const T = AIRCRAFT[id];
              const s = stats[id];
              return `<button class="card plane ${st.get('aircraft') === id ? 'sel' : ''}" data-aircraft="${id}">
                <b>${T.name}</b><em>${T.role}</em><span class="blurb">${T.blurb}</span>
                ${bar('Speed', s.speed)}${bar('Agility', s.agility)}${bar('Stability', s.stability)}${bar('Short field', s.shortField)}
              </button>`;
            }).join('')}
          </div>
        </section>
        <section class="settings">
          <h3 class="sub">Settings</h3>
          <label>Graphics quality
            <div class="seg" role="radiogroup" aria-label="Graphics quality">
              ${Object.values(QUALITY_PRESETS).map((p) => `<button data-quality="${p.name}" class="${st.get('quality') === p.name ? 'sel' : ''}" role="radio" aria-checked="${st.get('quality') === p.name}">${p.label}</button>`).join('')}
            </div>
            <small class="muted">${qualityHint(st.get('quality'))}</small>
          </label>
          <label class="check"><input type="checkbox" data-setting="adaptiveResolution" ${st.get('adaptiveResolution') ? 'checked' : ''}> Lower resolution automatically if the frame rate drops</label>
          <label>World
            <div class="seg">
              <button data-seed="fixed" class="${seedMode === 'fixed' ? 'sel' : ''}">Classic (${DEFAULT_SEED})</button>
              <button data-seed="random" class="${seedMode === 'random' ? 'sel' : ''}">Random each flight</button>
              <button data-seed="custom" class="${seedMode === 'custom' ? 'sel' : ''}">Custom</button>
            </div>
            <input type="number" class="seed-input" data-seed-input value="${st.get('seed')}" ${seedMode === 'custom' ? '' : 'hidden'} min="1" max="2147483647" aria-label="Custom world seed">
          </label>
          <div class="grid2">
            <label>Time of day
              <select data-setting="timeOfDay">${TIMES_OF_DAY.map((t) => `<option value="${t.hours}" ${Math.abs(st.get('timeOfDay') - t.hours) < 0.01 ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
            </label>
            <label>Day / night cycle
              <select data-setting="dayCycle">${Object.entries(DAY_CYCLES).map(([k, v]) => `<option value="${k}" ${st.get('dayCycle') === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
            </label>
            <label>Weather
              <select data-setting="weather">${WEATHER_ORDER.map((k) => `<option value="${k}" ${st.get('weather') === k ? 'selected' : ''}>${WEATHER_PRESETS[k].label}</option>`).join('')}</select>
            </label>
            <div class="checks">
              <label class="check"><input type="checkbox" data-setting="invertPitch" ${st.get('invertPitch') ? 'checked' : ''}> Invert pitch (W = nose up)</label>
              <label class="check"><input type="checkbox" data-setting="showFps" ${st.get('showFps') ? 'checked' : ''}> Show FPS</label>
            </div>
          </div>
        </section>
        <footer class="menu-foot">
          <button class="btn primary big" data-fly>Take off <kbd>Enter</kbd></button>
          <button class="btn" data-help>Controls</button>
        </footer>
      </div>`;
    this._bind();
  }

  _bind() {
    const st = this.settings;
    const q = (sel) => this.root.querySelectorAll(sel);
    for (const b of q('[data-mode]')) b.onclick = () => this._set('mode', b.dataset.mode);
    for (const b of q('[data-aircraft]')) b.onclick = () => this._set('aircraft', b.dataset.aircraft);
    for (const b of q('[data-quality]')) b.onclick = () => this._set('quality', b.dataset.quality);
    for (const b of q('[data-seed]')) {
      b.onclick = () => {
        const m = b.dataset.seed;
        st.set('randomSeed', m === 'random');
        if (m === 'fixed') st.set('seed', DEFAULT_SEED);
        if (m === 'custom' && st.get('seed') === DEFAULT_SEED) st.set('seed', 1000 + Math.floor(Math.random() * 9e6));
        this._render();
      };
    }
    const seedInput = this.root.querySelector('[data-seed-input]');
    seedInput.onchange = () => {
      const v = Math.max(1, Math.min(2147483647, Math.floor(Number(seedInput.value) || DEFAULT_SEED)));
      st.set('seed', v);
    };
    for (const el of q('[data-setting]')) {
      el.onchange = () => {
        const key = el.dataset.setting;
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (key === 'timeOfDay') v = Number(v);
        st.set(key, v);
      };
    }
    this.root.querySelector('[data-fly]').onclick = () => this.fly();
    this.root.querySelector('[data-help]').onclick = () => this.onHelp?.();
  }

  _set(key, value) {
    this.settings.set(key, value);
    this._render();
  }

  fly() {
    this.hide();
    this.onFly?.(this.settings);
  }
}

function qualityHint(q) {
  return {
    low: 'For integrated graphics and older laptops: shorter view distance, no shadows, fewer trees and clouds.',
    medium: 'Balanced: shadows, medium view distance and forests.',
    high: 'For gaming GPUs: long view distance, sharp shadows, dense forests and more clouds.',
  }[q];
}
