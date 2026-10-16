import { SEA_LEVEL } from '../terrain/heightfield.js';
import { Autopilot } from '../aircraft/autopilot.js';

const AUTO_REENGAGE = 6; // seconds hands-off before the autopilot takes over again

/**
 * Scenic mode: invulnerable, minimal HUD, a terrain-following autopilot that
 * gives way to the pilot (and takes back over when hands-off), and
 * automatic cinematic camera cuts until the player picks a camera.
 */
export class ScenicMode {
  constructor(game) {
    this.game = game;
    this.name = 'scenic';
    this.title = 'Scenic';
    this.invulnerable = true;
    this.target = null;
    this.minimalHud = true;
    this.autopilot = new Autopilot({ seed: game.seed });
    this.autoCamera = true;
  }

  start() {
    const g = this.game;
    const ap = g.home || { x: 0, z: 0 };
    const a = g.findApproach(ap, 4000);
    const ground = Math.max(g.terrain.heightAt(a.x, a.z), SEA_LEVEL);
    g.aircraft.placeInAir({ x: a.x, y: Math.max(ground + 450, a.maxH + 300), z: a.z, heading: a.heading + Math.PI, speed: g.aircraft.type.cruiseSpeed, throttle: 0.6 });
    g.resetControls(0.6);
    this.autopilot.reset();
    this.engaged = true;
    this.handsOff = AUTO_REENGAGE;
    this.camTimer = 14;
    this.autoCamera = true;
    g.rig.setMode('chase');
    g.overlay.toast('Autopilot on — take the controls any time', 'good', 3200);
  }

  restart() {
    this.start();
  }

  /**
   * Called by the game with the pilot's raw controls; returns the controls
   * to fly with (autopilot output while engaged).
   */
  filterControls(c, dt) {
    const g = this.game;
    const active = Math.abs(c.pitch) + Math.abs(c.roll) + Math.abs(c.yaw) > 0.05 || g.input.key('throttleUp') || g.input.key('throttleDown');
    if (active) {
      if (this.engaged) g.overlay.toast('Autopilot off', 'warn');
      this.engaged = false;
      this.handsOff = 0;
      this.autopilot.reset();
      return c;
    }
    this.handsOff += dt;
    if (!this.engaged && this.handsOff > AUTO_REENGAGE) {
      this.engaged = true;
      g.overlay.toast('Autopilot on', 'good');
    }
    if (!this.engaged) return c;
    const out = this.autopilot.update(g.aircraft.state, g._groundFn, dt);
    c.throttle = out.throttle; // keep the throttle lever in sync for the HUD
    return out;
  }

  update(dt) {
    if (!this.autoCamera) return;
    this.camTimer -= dt;
    if (this.camTimer <= 0) {
      const rig = this.game.rig;
      const next = rig.mode === 'chase' ? 'flyby' : rig.mode === 'flyby' ? (Math.random() < 0.35 ? 'cockpit' : 'chase') : 'chase';
      rig.setMode(next);
      this.camTimer = next === 'flyby' ? 13 : next === 'cockpit' ? 9 : 16;
    }
  }

  /** The player chose a camera: stop cutting automatically. */
  onCameraChosen() {
    this.autoCamera = false;
  }

  onEvent(e) {
    // Invulnerable: if we touch terrain or water, lift clear and carry on.
    if ((e.type === 'touchdown' && e.problem) || e.type === 'scrape') {
      const s = this.game.aircraft.state;
      this.game.aircraft.placeInAir({
        x: s.pos.x,
        y: Math.max(this.game.terrain.heightAt(s.pos.x, s.pos.z), SEA_LEVEL) + 200,
        z: s.pos.z,
        heading: s.heading,
        speed: s.type.cruiseSpeed,
        throttle: 0.6,
      });
      this.autopilot.reset();
      this.engaged = true;
      this.game.overlay.toast('Whoops — back up you go', 'info');
    }
  }

  info() {
    return {
      title: 'Scenic flight',
      body: `<div>${this.engaged ? 'Autopilot <b>on</b>' : 'You have control'}</div>
        <div class="dim">C cameras · P photo · T time · Y weather</div>`,
    };
  }

  dispose() {}
}
