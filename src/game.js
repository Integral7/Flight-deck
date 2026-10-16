import * as THREE from 'three';
import { Renderer } from './engine/renderer.js';
import { Settings, QUALITY_PRESETS } from './engine/settings.js';
import { FixedStepLoop, FrameStats } from './engine/loop.js';
import { createTerrain, SEA_LEVEL } from './terrain/heightfield.js';
import { ChunkManager } from './terrain/chunkManager.js';
import { CHUNK_SIZE } from './terrain/chunk.js';
import { Water } from './world/water.js';
import { Aircraft } from './aircraft/aircraft.js';
import { CameraRig } from './camera/cameras.js';
import { Input } from './input/input.js';

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

    this._setupLights();
    this._createWorld(this.settings.resolveSeed());
    this.aircraft = new Aircraft(this.scene, this.settings.get('aircraft'));
    this.rig.setAircraft(this.aircraft.type.id);

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
    const sky = new THREE.Color(0x9cc4e8);
    this.scene.background = sky;
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4f5a3a, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
    this.sun.castShadow = this.settings.preset.shadows;
    const sz = this.settings.preset.shadowMapSize || 1024;
    this.sun.shadow.mapSize.set(sz, sz);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -60;
    cam.right = cam.top = 60;
    cam.near = 1;
    cam.far = 2000;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sunDir = new THREE.Vector3(0.45, 0.75, 0.3).normalize();
    this.scene.add(this.sun, this.sun.target);
  }

  _createWorld(seed) {
    const preset = this.settings.preset;
    this.seed = seed;
    this.terrain = createTerrain(seed);
    const far = preset.viewRadius * CHUNK_SIZE;
    this.viewDistance = far;
    this.scene.fog = new THREE.Fog(this.scene.background, far * 0.3, far * 0.97);
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
    this.spawnFree();
  }

  _handleActions() {
    for (const a of this.input.consume()) {
      const c = this.input.controls;
      const T = this.aircraft.type;
      switch (a) {
        case 'camera':
          this.rig.toggle();
          break;
        case 'reset':
          this.spawnFree();
          break;
        case 'gear':
          if (T.retractableGear) c.gearDown = !c.gearDown;
          break;
        case 'flaps':
          if (T.hasFlaps) c.flaps = c.flaps >= 1 ? 0 : c.flaps + 0.5;
          break;
        case 'fps':
          this.settings.set('showFps', !this.settings.get('showFps'));
          break;
        default:
          break;
      }
    }
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
    const t1 = performance.now();

    this.aircraft.render(alpha, controls, dt, this.time);
    this.rig.distanceScale = THREE.MathUtils.clamp(this.rig.distanceScale * (1 + this.input.zoom * 0.1), 0.5, 3);
    this.input.zoom = 0;
    this.rig.update(dt, this.aircraft.renderPos, this.aircraft.renderQuat, (x, z) => Math.max(this.terrain.heightAt(x, z), SEA_LEVEL), this.input.look);
    this.aircraft.setCockpitView(this.rig.mode === 'cockpit');

    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.chunks.update(this.camera.position, this.forward);
    this.water.update(dt, this.camera.position);
    this._updateSun();
    const t2 = performance.now();

    this.camera.aspect = this.renderer.aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const t3 = performance.now();
    const k = 0.1;
    this.timing.sim += (t1 - t0 - this.timing.sim) * k;
    this.timing.world += (t2 - t1 - this.timing.world) * k;
    this.timing.render += (t3 - t2 - this.timing.render) * k;
    this.onFrame?.(dt);
  }

  _updateSun() {
    const p = this.aircraft.renderPos;
    this.sun.position.copy(p).addScaledVector(this.sunDir, 800);
    this.sun.target.position.copy(p);
    this.sun.target.updateMatrixWorld();
  }

  onFlightEvent(e) {
    if (e.type === 'touchdown') this.rig.bump(Math.min(1, Math.abs(e.vs) / 4));
    if (e.type === 'crash') this.rig.bump(1.2);
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
