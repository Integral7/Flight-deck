import * as THREE from 'three';
import { Renderer } from './engine/renderer.js';
import { Settings, QUALITY_PRESETS } from './engine/settings.js';
import { FixedStepLoop, FrameStats } from './engine/loop.js';
import { createTerrain, SEA_LEVEL } from './terrain/heightfield.js';
import { ChunkManager } from './terrain/chunkManager.js';
import { CHUNK_SIZE } from './terrain/chunk.js';
import { Water } from './world/water.js';
import { Environment } from './world/environment.js';
import { formatClock } from './world/dayNight.js';
import { Aircraft } from './aircraft/aircraft.js';
import { CameraRig } from './camera/cameras.js';
import { Input } from './input/input.js';
import { TouchControls } from './input/touch.js';
import { Overlay } from './hud/overlay.js';
import { FlightStrip } from './hud/flightStrip.js';
import { HUD } from './hud/hud.js';
import { MapRenderer } from './hud/minimap.js';
import { Cockpit } from './cockpit/cockpit.js';

const SIM_STEP = 1 / 120;

/**
 * Top-level game object: owns the renderer, world, aircraft, cameras and
 * input, and runs the main loop (fixed-step simulation, interpolated render).
 */
export class Game {
  constructor(container, params = new URLSearchParams()) {
    this.container = container;
    this.params = params;
    this.settings = new Settings();
    const q = params.get('quality');
    if (q && QUALITY_PRESETS[q]) this.settings.set('quality', q);
    if (params.get('aircraft')) this.settings.set('aircraft', params.get('aircraft'));
    if (params.has('seed')) this.settings.set('seed', Number(params.get('seed')) || 1337);

    this.renderer = new Renderer(container, this.settings.preset);
    this.renderer.adaptive = this.settings.get('adaptiveResolution');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, this.renderer.aspect, 0.5, 20000);
    this.input = new Input(window);
    this.input.invertPitch = this.settings.get('invertPitch');
    this.rig = new CameraRig(this.camera);
    this.loop = new FixedStepLoop({ step: SIM_STEP, maxSubSteps: 12 });
    this.frameStats = new FrameStats();
    this.timing = { sim: 0, world: 0, render: 0 };
    this.time = 0;
    this.paused = false;
    this.forward = new THREE.Vector3();

    const vignette = document.createElement('div');
    vignette.className = 'vignette';
    container.append(vignette);
    this.overlay = new Overlay(container);
    this.strip = new FlightStrip(container);
    this.touch = new TouchControls(container, this.input, { force: params.get('touch') === '1' });
    this.crashTimer = 0;

    this._setupLights();
    this._createWorld(this.settings.resolveSeed());
    this.aircraft = new Aircraft(this.scene, this.settings.get('aircraft'));
    this.rig.setAircraft(this.aircraft.type.id);
    this.cockpit = new Cockpit(this.settings.get('quality'));
    this.cockpit.attach(this.aircraft.model, this.aircraft.type);
    this.env3d.attachLandingLight(this.aircraft.model, this.aircraft.type);

    this.mapRenderer = new MapRenderer(this.chunks.pool, this.terrain);
    this.hud = new HUD(container, this.mapRenderer);
    this.strip.setVisible(false);
    this.world = { airports: [], rings: [], target: null };
    this._worldTimer = 0;
    this._groundFn = (x, z) => Math.max(this.terrain.heightAt(x, z), SEA_LEVEL);

    this._groundSample = { height: 0, water: false, normalY: 1, runway: false };
    this._normal = [0, 1, 0];
    this.env = {
      ground: (x, z) => this.groundAt(x, z),
      wind: new THREE.Vector3(),
      turbulence: 0,
      invulnerable: false,
    };

    this.spawnFree();
    this._last = performance.now();
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  _setupLights() {
    this.env3d = new Environment(this.scene, this.renderer, this.settings.preset);
    const t = Number(this.params.get('time'));
    if (this.params.has('time') && Number.isFinite(t)) this.env3d.setTime(t);
  }

  _createWorld(seed) {
    const preset = this.settings.preset;
    this.seed = seed;
    this.terrain = createTerrain(seed);
    const far = preset.viewRadius * CHUNK_SIZE;
    this.viewDistance = far;
    this.env3d.setViewDistance(far);
    this.camera.far = far * 1.3;
    if (this.chunks) this.chunks.setTerrain(this.terrain);
    else this.chunks = new ChunkManager(this.scene, this.terrain, preset);
    if (!this.water) this.water = new Water(this.scene, far * 2.6);
    this.home = this.terrain.nearestAirport(0, 0);
  }

  /** Ground query used by the flight model and camera (allocation-free). */
  groundAt(x, z) {
    const s = this.terrain.sample(x, z);
    const g = this._groundSample;
    g.height = s.height;
    g.water = s.height < SEA_LEVEL;
    g.runway = s.runway;
    this.terrain.normalAt(x, z, this._normal, 2);
    g.normalY = s.runway ? 1 : this._normal[1];
    return g;
  }

  /**
   * Pick the approach direction to an airport with the lowest terrain on the
   * way in, so spawns never face a mountain wall.
   */
  findApproach(ap, distance) {
    let best = null;
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      let maxH = SEA_LEVEL;
      for (let k = 0; k <= 24; k++) {
        const d = (k / 24) * distance;
        maxH = Math.max(maxH, this.terrain.heightAt(ap.x + Math.sin(angle) * d, ap.z - Math.cos(angle) * d));
      }
      if (!best || maxH < best.maxH) best = { angle, maxH };
    }
    const x = ap.x + Math.sin(best.angle) * distance;
    const z = ap.z - Math.cos(best.angle) * distance;
    // Heading from the spawn point toward the airport.
    const heading = Math.atan2(ap.x - x, -(ap.z - z));
    return { x, z, heading, maxH: best.maxH };
  }

  /** Free flight: airborne a few km from the home airport, pointed at it. */
  spawnFree() {
    const ap = this.home || { x: 0, z: 0, elevation: 0 };
    const a = this.findApproach(ap, 3500);
    const ground = Math.max(this.terrain.heightAt(a.x, a.z), SEA_LEVEL);
    const y = Math.max(ground + 400, a.maxH + 250);
    this.aircraft.placeInAir({ x: a.x, y, z: a.z, heading: a.heading, speed: this.aircraft.type.cruiseSpeed, throttle: 0.65 });
    this.input.controls.throttle = 0.65;
    this.input.controls.flaps = 0;
    this.input.controls.gearDown = !this.aircraft.type.retractableGear;
    this.rig.reset();
    this.loop.reset();
  }

  setAircraft(id) {
    this.settings.set('aircraft', id);
    this.aircraft.setType(id);
    this.rig.setAircraft(id);
    this.cockpit.attach(this.aircraft.model, this.aircraft.type);
    this.spawnFree();
  }

  _handleActions() {
    for (const a of this.input.consume()) {
      const c = this.input.controls;
      const T = this.aircraft.type;
      // While a modal is open only pause/help/confirm do anything.
      if (this.overlay.modalOpen) {
        if (a === 'pause' || (a === 'help' && this.overlay.modalOpen === 'help')) this.resume();
        continue;
      }
      switch (a) {
        case 'pause':
          this.pause();
          break;
        case 'help':
          this.showHelp();
          break;
        case 'camera':
          this.rig.toggle();
          this.overlay.toast(this.rig.mode === 'cockpit' ? 'Cockpit view' : 'Chase view');
          break;
        case 'reset':
          this.restart();
          break;
        case 'confirm':
          if (this.aircraft.state.crashed && this.crashTimer > 0.6) this.restart();
          break;
        case 'gear':
          if (!T.retractableGear) this.overlay.toast(`${T.name}: fixed landing gear`);
          else if (this.aircraft.state.onGround) this.overlay.toast('Gear locked on the ground', 'warn');
          else {
            c.gearDown = !c.gearDown;
            this.overlay.toast(c.gearDown ? 'Gear down' : 'Gear up');
          }
          break;
        case 'flaps':
          if (!T.hasFlaps) this.overlay.toast(`${T.name}: no flaps`);
          else {
            c.flaps = c.flaps >= 1 ? 0 : c.flaps + 0.5;
            this.overlay.toast(`Flaps ${['up', 'half', 'full'][c.flaps * 2]}`);
          }
          break;
        case 'time':
          this.env3d.advance(1);
          this.overlay.toast(`Time ${formatClock(this.env3d.hours + 1)}`);
          break;
        case 'map':
          this.hud.largeMap.toggle();
          break;
        case 'hud':
          this.hud.setVisible(!this.hud.visible);
          break;
        case 'fps':
          this.settings.set('showFps', !this.settings.get('showFps'));
          break;
        default:
          break;
      }
    }
  }

  pause() {
    if (this.overlay.modalOpen) return;
    this.paused = true;
    this.input.reset();
    this.overlay.openModal(
      'pause',
      `<h2>Paused</h2>
       <p class="muted">${this.aircraft.type.name} · seed ${this.seed}</p>
       <div class="row">
         <button class="btn primary" data-act="resume">Resume <kbd>Esc</kbd></button>
         <button class="btn" data-act="restart">Restart flight <kbd>R</kbd></button>
         <button class="btn" data-act="help">Controls <kbd>H</kbd></button>
       </div>`,
      () => this._afterModal(),
    );
    this.overlay.modal.querySelector('[data-act=resume]').onclick = () => this.resume();
    this.overlay.modal.querySelector('[data-act=restart]').onclick = () => {
      this.resume();
      this.restart();
    };
    this.overlay.modal.querySelector('[data-act=help]').onclick = () => {
      this.overlay.closeModal();
      this.showHelp();
    };
  }

  showHelp() {
    this.paused = true;
    this.input.reset();
    this.overlay.openModal(
      'help',
      this.overlay.helpHTML() + '<div class="row"><button class="btn primary" data-act="close">Back to flying <kbd>Esc</kbd></button></div>',
      () => this._afterModal(),
    );
    this.overlay.modal.querySelector('[data-act=close]').onclick = () => this.resume();
  }

  resume() {
    this.overlay.closeModal();
  }

  _afterModal() {
    this.paused = false;
    this.input.reset();
    this.loop.reset();
  }

  restart() {
    this.overlay.hideBanner();
    this.crashTimer = 0;
    this.spawnFree();
  }

  _frame(now) {
    requestAnimationFrame(this._frame);
    const dt = Math.min((now - this._last) / 1000, 0.1);
    this._last = now;
    this.frameStats.push(dt * 1000);
    this.time += dt;

    const t0 = performance.now();
    this._handleActions();
    const controls = this.input.update(dt);
    let alpha = 1;
    if (!this.paused) {
      const r = this.loop.advance(dt, (step) => this.aircraft.step(controls, step, this.env));
      alpha = r.alpha;
    }
    for (const e of this.aircraft.drainEvents()) this.onFlightEvent(e);
    if (this.aircraft.state.crashed) this.crashTimer += dt;
    const t1 = performance.now();

    this.aircraft.render(alpha, controls, dt, this.time);
    this.rig.distanceScale = THREE.MathUtils.clamp(this.rig.distanceScale * (1 + this.input.zoom * 0.1), 0.5, 3);
    this.input.zoom = 0;
    this.rig.update(dt, this.aircraft.renderPos, this.aircraft.renderQuat, (x, z) => Math.max(this.terrain.heightAt(x, z), SEA_LEVEL), this.input.look);
    this.aircraft.setCockpitView(this.rig.mode === 'cockpit');

    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.chunks.update(this.camera.position, this.forward);
    this.water.update(dt, this.camera.position);
    this.env3d.update(dt, this.camera, this.aircraft.renderPos);
    const t2 = performance.now();

    this.camera.aspect = this.renderer.aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const t3 = performance.now();
    const k = 0.1;
    this.timing.sim += (t1 - t0 - this.timing.sim) * k;
    this.timing.world += (t2 - t1 - this.timing.world) * k;
    this.timing.render += (t3 - t2 - this.timing.render) * k;
    this._updateHud(dt, controls);
    this.touch.update(controls);
    this.onFrame?.(dt);
  }

  /** Refresh map overlays (airports, target) about once a second. */
  _updateWorldInfo(dt) {
    this._worldTimer -= dt;
    if (this._worldTimer > 0) return;
    this._worldTimer = 1;
    const p = this.aircraft.state.pos;
    const list = this.terrain.airportsNear(p.x, p.z, 26000);
    const nearest = this.terrain.nearestAirport(p.x, p.z);
    for (const ap of list) ap.active = ap === nearest;
    this.world.airports = list;
    if (!this.modeTarget && nearest) {
      this.world.target = { x: nearest.x, z: nearest.z, label: nearest.name.code };
      this.nearestAirport = nearest;
    }
  }

  _updateHud(dt, controls) {
    this._updateWorldInfo(dt);
    const s = this.aircraft.state;
    const t = this.world.target;
    const bug = t ? Math.atan2(t.x - s.pos.x, -(t.z - s.pos.z)) : null;
    const cockpit = this.rig.mode === 'cockpit';
    this.hud.setView(this.rig.mode);
    this.cockpit.setVisible(cockpit);
    this.cockpit.update(dt, s, controls, bug);
    this.hud.update({ dt, state: s, controls, bug, world: this.world, groundAt: this._groundFn });
    if (!this.modeInfo) {
      const ap = this.nearestAirport;
      const d = ap ? Math.hypot(ap.x - s.pos.x, ap.z - s.pos.z) : 0;
      this.hud.setInfo(
        'Free flight',
        ap
          ? `<div>${ap.name.full} <span class="dim">${ap.name.code}</span></div><div class="dim">${(d / 1852).toFixed(1)} nm · field elev ${Math.round(ap.elevation * 3.28084)} ft</div>`
          : '',
      );
    }
  }

  onFlightEvent(e) {
    if (e.type === 'touchdown') this.rig.bump(Math.min(1, Math.abs(e.vs) / 4));
    if (e.type === 'crash') {
      this.rig.bump(1.2);
      this.overlay.showBanner({
        kind: 'bad',
        kicker: 'Crash',
        title: e.reason,
        body: 'The aircraft is a write-off. Shake it off and go again.',
        actions: [{ label: 'Restart', key: 'R', primary: true, onClick: () => this.restart() }],
      });
    }
    this.onEvent?.(e);
  }

  debugStats() {
    const s = this.aircraft.state;
    return {
      fps: this.frameStats.fps,
      ...this.timing,
      ...this.renderer.info(),
      ...this.chunks.stats,
      aircraft: this.aircraft.type.id,
      alt: s.pos.y,
      agl: s.agl,
      airspeed: s.airspeed,
      crashed: s.crashed,
      onGround: s.onGround,
      camera: this.rig.mode,
    };
  }
}
