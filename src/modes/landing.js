import { SEA_LEVEL } from '../terrain/heightfield.js';
import {
  bestLandingDirection,
  landingHeading,
  runwayNumber,
  threshold,
  approachGuidance,
  scoreLanding,
  GLIDE_SLOPE,
  PAPI_DISTANCE,
} from './runway.js';

const START_DISTANCE = 3600; // metres before the threshold
const BEST_KEY = 'flightdeck.landing.best.v1';

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveBest(best) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    /* ignore */
  }
}

/**
 * Landing challenge: start on a 3-degree final approach and land on the
 * centreline in the touchdown zone, gently, then stop on the runway.
 */
export class LandingMode {
  constructor(game) {
    this.game = game;
    this.name = 'landing';
    this.title = 'Landing challenge';
    this.invulnerable = false;
    this.target = null;
    this.result = null;
  }

  /** Is the approach path clear of terrain for this landing direction? */
  _clearance(ap, dir) {
    const t = threshold(ap, dir);
    const ux = Math.sin(ap.heading) * dir;
    const uz = Math.cos(ap.heading) * dir;
    let worst = Infinity;
    for (let d = 200; d <= START_DISTANCE + 1500; d += 100) {
      const x = t.x - ux * d;
      const z = t.z - uz * d;
      const pathY = ap.elevation + Math.tan(GLIDE_SLOPE) * (d + PAPI_DISTANCE);
      worst = Math.min(worst, pathY - this.game.terrain.heightAt(x, z));
    }
    return worst;
  }

  start(airport = null) {
    const g = this.game;
    const p = g.aircraft.state.pos;
    const ap = airport || g.terrain.nearestAirport(p.x, p.z) || g.home;
    this.airport = ap;
    let dir = bestLandingDirection(ap, g.weather.wind);
    // Prefer the direction with terrain clearance on final.
    const c1 = this._clearance(ap, dir);
    const c2 = this._clearance(ap, -dir);
    if (c1 < 60 && c2 > c1) dir = -dir;
    this.dir = dir;
    const clearance = Math.max(c1, c2);
    const t = threshold(ap, dir);
    const ux = Math.sin(ap.heading) * dir;
    const uz = Math.cos(ap.heading) * dir;
    const x = t.x - ux * START_DISTANCE;
    const z = t.z - uz * START_DISTANCE;
    let y = ap.elevation + Math.tan(GLIDE_SLOPE) * (START_DISTANCE + PAPI_DISTANCE);
    if (clearance < 60) y += 60 - clearance; // steeper approach over high ground
    y = Math.max(y, g.terrain.heightAt(x, z) + 80, SEA_LEVEL + 80);
    const T = g.aircraft.type;
    g.aircraft.placeInAir({ x, y, z, heading: landingHeading(ap, dir), speed: T.approachSpeed * 1.12, throttle: 0.35 });
    const s = g.aircraft.state;
    s.gearPos = 1;
    s.gearDown = true;
    s.flaps = T.hasFlaps ? 0.5 : 0;
    g.resetControls(0.35, { flaps: s.flaps, gearDown: true });
    this.phase = 'approach';
    this.touch = null;
    this.bounces = 0;
    this.result = null;
    this.runway = runwayNumber(ap, dir);
    this.target = { x: t.x, z: t.z, label: `RWY ${this.runway}` };
    g.overlay.hideBanner();
    g.overlay.toast(`Cleared to land runway ${this.runway}`, 'good', 2600);
  }

  restart() {
    this.start(this.airport);
  }

  guidance() {
    const s = this.game.aircraft.state;
    return approachGuidance(this.airport, this.dir, s.pos.x, s.pos.y - s.type.gearHeight, s.pos.z);
  }

  update() {
    if (this.phase === 'done') return;
    const s = this.game.aircraft.state;
    const gd = this.guidance();
    this.lastGuidance = gd;
    if (this.phase === 'approach' && gd.toThreshold < -this.airport.length - 50 && !s.onGround) {
      this._finish({ failed: true, reason: 'Missed approach: flew past the runway', score: 0, grade: 'F', parts: {} });
    }
    if (this.phase === 'rollout') {
      const ap = this.airport;
      const off = Math.abs(gd.lateral) > ap.width / 2 + 3 || gd.toThreshold < -ap.length - 40;
      if (off) this.touch.stoppedOnRunway = false;
      if (s.onGround && s.groundSpeed < 0.6) this._finish();
      else if (off && s.onGround && s.groundSpeed < 8) this._finish();
      else if (!s.onGround && s.airTime > 6) {
        // Go-around after touching down: treat as a fresh approach.
        this.phase = 'approach';
        this.touch = null;
        this.bounces = 0;
        this.game.overlay.toast('Go around', 'warn');
      }
    }
  }

  onEvent(e) {
    if (this.phase === 'done') return;
    if (e.type === 'crash') {
      this._finish({ failed: true, reason: e.reason, score: 0, grade: 'F', parts: {} }, true);
      return;
    }
    if (e.type !== 'touchdown') return;
    const gd = approachGuidance(this.airport, this.dir, e.x, this.airport.elevation, e.z);
    if (this.phase === 'approach') {
      this.touch = {
        vs: e.vs,
        bank: e.bank,
        lateral: gd.lateral,
        distanceFromThreshold: -gd.toThreshold,
        runway: e.runway,
        stoppedOnRunway: true,
      };
      this.phase = 'rollout';
      const fpm = Math.round(Math.abs(e.vs) * 196.85);
      this.game.overlay.toast(`Touchdown ${fpm} fpm`, fpm < 300 ? 'good' : 'warn');
    } else if (this.phase === 'rollout') {
      this.bounces++;
    }
  }

  _finish(forced = null, crashed = false) {
    this.phase = 'done';
    const g = this.game;
    const T = g.aircraft.type;
    const t = this.touch;
    const r =
      forced ||
      scoreLanding({
        ...t,
        bounces: this.bounces,
        maxVs: T.maxTouchdownVs,
        width: this.airport.width,
        runwayLength: this.airport.length,
      });
    this.result = r;
    let bestNote = '';
    if (!r.failed) {
      const best = loadBest();
      const prev = best[T.id] || 0;
      if (r.score > prev) {
        best[T.id] = r.score;
        saveBest(best);
        bestNote = prev ? `New personal best (was ${prev})` : 'First recorded landing!';
      } else bestNote = `Personal best: ${prev}`;
    }
    const rows = r.failed
      ? `<p>${r.reason}</p>`
      : `<div class="score-grid">
          <span>Touchdown (${Math.round(Math.abs(t.vs) * 196.85)} fpm)</span><b>${r.parts.touchdown}/40</b>
          <span>Centreline (${Math.abs(t.lateral).toFixed(1)} m)</span><b>${r.parts.centreline}/20</b>
          <span>Touchdown zone (${Math.round(t.distanceFromThreshold)} m)</span><b>${r.parts.zone}/20</b>
          <span>Wings level (${((Math.abs(t.bank) * 180) / Math.PI).toFixed(1)}°)</span><b>${r.parts.attitude}/10</b>
          <span>Stopped on runway</span><b>${r.parts.rollout}/10</b>
          ${this.bounces ? `<span>Bounces (${this.bounces})</span><b>${r.parts.bounces}</b>` : ''}
        </div><p class="muted">${bestNote}</p>`;
    const show = () =>
      g.overlay.showBanner({
        kind: r.failed ? 'bad' : 'good',
        kicker: r.failed ? 'Landing failed' : `Grade ${r.grade}`,
        title: r.failed ? (crashed ? 'Crashed on landing' : 'No landing') : `${r.score} points`,
        body: rows,
        actions: [
          { label: 'Try again', key: 'Enter', primary: true, onClick: () => g.restart() },
          { label: 'Free flight', onClick: () => g.setMode('free') },
        ],
      });
    // Let the crash banner show first, then replace it with the result.
    if (crashed) setTimeout(show, 1200);
    else show();
  }

  /** Confirm key (Enter) after a result restarts the challenge. */
  onConfirm() {
    if (this.phase === 'done') {
      this.game.restart();
      return true;
    }
    return false;
  }

  info() {
    const ap = this.airport;
    const gd = this.lastGuidance;
    if (!ap || !gd) return null;
    const best = loadBest()[this.game.aircraft.type.id];
    const dist = Math.max(0, gd.toThreshold);
    return {
      title: `Landing · RWY ${this.runway}`,
      body: `<div>${ap.name.full} <span class="dim">${ap.name.code}</span></div>
        <div class="dim">${dist > 0 ? (dist / 1852).toFixed(1) + ' nm to threshold' : 'Over the runway'} · ${Math.round(gd.height * 3.28084)} ft AGL</div>
        <div class="dim">Target ${Math.round(this.game.aircraft.type.approachSpeed * 1.944)} kt · land past the aiming marks${best ? ` · best ${best}` : ''}</div>`,
    };
  }

  /** Data for the HUD's approach guidance widget. */
  approach() {
    if (this.phase === 'done' || !this.lastGuidance) return null;
    return this.lastGuidance;
  }

  dispose() {}
}
