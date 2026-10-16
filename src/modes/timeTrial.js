import { generateCourse, ringCrossing, formatTime, totalTime, MISS_PENALTY } from './course.js';
import { SEA_LEVEL } from '../terrain/heightfield.js';
import { hash2 } from '../engine/random.js';

const BEST_KEY = 'flightdeck.timetrial.best.v1';
const COUNT = 12;

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
  } catch {
    return {};
  }
}

/**
 * Time trial: fly through a seeded course of rings as fast as possible.
 * The clock starts at the first ring; missing a ring costs 5 seconds.
 */
export class TimeTrialMode {
  constructor(game) {
    this.game = game;
    this.name = 'timetrial';
    this.title = 'Time trial';
    this.invulnerable = false;
    this.target = null;
    this.courseIndex = 0;
  }

  /** Course seed is derived from the world seed so a world always has the same courses. */
  _courseKey() {
    return `${this.game.seed}:${this.courseIndex}`;
  }

  start() {
    const g = this.game;
    const ap = g.home || { x: 0, z: 0 };
    // Start downwind of the home airport, heading out over open ground.
    const a = g.findApproach(ap, 2500);
    const heading = (a.heading + Math.PI) % (Math.PI * 2);
    const startPos = { x: ap.x, z: ap.z, heading };
    const seed = Math.floor(hash2(this.courseIndex, 7, g.seed) * 2 ** 31);
    const course = generateCourse({ heightAt: (x, z) => Math.max(g.terrain.heightAt(x, z), SEA_LEVEL) }, startPos, seed, COUNT);
    this.course = course;
    g.rings.setCourse(course);
    // Spawn ~800 m before the first ring, lined up with it.
    const r0 = course[0];
    const dx = r0.x - startPos.x;
    const dz = r0.z - startPos.z;
    const d = Math.hypot(dx, dz);
    const sx = r0.x - (dx / d) * 800;
    const sz = r0.z - (dz / d) * 800;
    const ground = Math.max(g.terrain.heightAt(sx, sz), SEA_LEVEL);
    const y = Math.max(r0.y, ground + 120);
    const T = g.aircraft.type;
    g.aircraft.placeInAir({ x: sx, y, z: sz, heading: Math.atan2(dx, -dz), speed: T.cruiseSpeed, throttle: 0.85 });
    g.resetControls(0.85);
    this.next = 0;
    this.missed = 0;
    this.elapsed = 0;
    this.running = false;
    this.done = false;
    this.splits = [];
    this._prev = { x: sx, y, z: sz };
    this._updateTarget();
    g.overlay.hideBanner();
    g.overlay.toast(`Course ${this.courseIndex + 1}: ${COUNT} rings — clock starts at the first ring`, 'info', 2800);
  }

  restart() {
    this.start();
  }

  nextCourse() {
    this.courseIndex++;
    this.start();
  }

  _updateTarget() {
    const r = this.course[this.next];
    this.target = r ? { x: r.x, z: r.z, label: `Ring ${this.next + 1}` } : null;
    this.game._worldTimer = 0;
  }

  update(dt) {
    if (this.done) return;
    const s = this.game.aircraft.state;
    if (this.running && !s.crashed) this.elapsed += dt;
    const cur = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    const ring = this.course[this.next];
    if (ring) {
      const c = ringCrossing(this._prev, cur, ring);
      if (c && c.distance < ring.radius * 12) this._pass(c.hit);
    }
    this._prev = cur;
  }

  _pass(hit) {
    const g = this.game;
    if (this.next === 0) this.running = true;
    if (!hit) {
      this.missed++;
      g.overlay.toast(`Missed ring ${this.next + 1}  +${MISS_PENALTY}s`, 'bad');
    } else {
      g.overlay.toast(`Ring ${this.next + 1}/${COUNT}  ${formatTime(this.elapsed)}`, 'good', 1000);
    }
    this.splits.push(this.elapsed);
    this.next++;
    if (this.next >= this.course.length) this._finish();
    else this._updateTarget();
  }

  _finish() {
    this.done = true;
    this.target = null;
    const g = this.game;
    const total = totalTime(this.elapsed, this.missed);
    const key = `${g.aircraft.type.id}|${this._courseKey()}`;
    const best = loadBest();
    const prev = best[key];
    let note;
    if (!prev || total < prev) {
      best[key] = total;
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(best));
      } catch {
        /* ignore */
      }
      note = prev ? `New best! Previous ${formatTime(prev)}` : 'First time on this course';
    } else note = `Best ${formatTime(prev)} (+${(total - prev).toFixed(2)} s)`;
    g.overlay.showBanner({
      kind: 'good',
      kicker: `Course ${this.courseIndex + 1} complete`,
      title: formatTime(total),
      body: `<div class="score-grid">
          <span>Flight time</span><b>${formatTime(this.elapsed)}</b>
          <span>Missed rings (${this.missed} × ${MISS_PENALTY}s)</span><b>+${this.missed * MISS_PENALTY}s</b>
        </div><p class="muted">${note}</p>`,
      actions: [
        { label: 'Fly again', key: 'Enter', primary: true, onClick: () => g.restart() },
        { label: 'Next course', onClick: () => this.nextCourse() },
        { label: 'Free flight', onClick: () => g.setMode('free') },
      ],
    });
  }

  onEvent(e) {
    if (e.type === 'crash') this.running = false;
  }

  onConfirm() {
    if (this.done) {
      this.game.restart();
      return true;
    }
    return false;
  }

  info() {
    const best = loadBest()[`${this.game.aircraft.type.id}|${this._courseKey()}`];
    const pen = this.missed * MISS_PENALTY;
    return {
      title: `Time trial · course ${this.courseIndex + 1}`,
      body: `<div class="timer ${pen ? 'pen' : ''}">${formatTime(this.elapsed + pen)}</div>
        <div class="dim">Ring ${Math.min(this.next + 1, COUNT)} of ${COUNT}${this.missed ? ` · ${this.missed} missed` : ''}${best ? ` · best ${formatTime(best)}` : ''}</div>`,
    };
  }

  /** Next ring in 3D, for the screen-space marker. */
  marker() {
    if (this.done) return null;
    const r = this.course[this.next];
    if (!r) return null;
    const p = this.game.aircraft.state.pos;
    return { target: r, text: `${Math.round(Math.hypot(r.x - p.x, r.y - p.y, r.z - p.z))} m` };
  }

  /** Ring list for the minimap. */
  mapRings() {
    return this.course.map((r, i) => ({ x: r.x, z: r.z, done: i < this.next, next: i === this.next }));
  }

  dispose() {
    this.game.rings.clear();
  }
}
