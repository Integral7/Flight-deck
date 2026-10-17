import { AXIS_KEYS, ACTION_KEYS } from './bindings.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Merges keyboard, mouse, touch and gamepad into one control state:
 *   axes:   pitch, roll, yaw in [-1, 1]; throttle in [0, 1]; brake in [0, 1]
 *   look:   yaw/pitch head-look in [-1, 1]
 *   actions: discrete presses drained once per frame with `consume()`
 *
 * Keyboard axes ramp smoothly (keys are digital, aircraft feel analogue).
 */
export class Input {
  constructor(target = window) {
    this.target = target;
    this.down = new Set();
    this.pressed = [];
    this.controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0.6, brake: 0, flaps: 0, gearDown: true };
    this.look = { yaw: 0, pitch: 0 };
    this.zoom = 0;
    this.invertPitch = false;
    this.enabled = true;
    this.touch = null; // set by TouchControls
    this._mouse = { dragging: false, x: 0, y: 0 };
    this._kb = { pitch: 0, roll: 0, yaw: 0 };
    this._gamepadIndex = null;
    this._lastGamepadButtons = [];
    this.lastSource = 'keyboard';
    this._bind();
  }

  _bind() {
    const t = this.target;
    this._onKeyDown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const code = e.code;
      if (isGameKey(code)) e.preventDefault();
      if (!this.down.has(code)) {
        for (const [action, codes] of Object.entries(ACTION_KEYS)) {
          if (codes.includes(code)) this.pressed.push(action);
        }
        // Number keys set throttle directly: 1 = 10 % ... 9 = 90 %, 0 = 100 %, ` = idle.
        if (/^Digit[0-9]$/.test(code) || /^Numpad[0-9]$/.test(code)) {
          const n = Number(code.slice(-1));
          this.controls.throttle = n === 0 ? 1 : n / 10;
          this.pressed.push('throttleSet');
        }
        if (code === 'Backquote') this.controls.throttle = 0;
      }
      this.down.add(code);
      this.lastSource = 'keyboard';
    };
    this._onKeyUp = (e) => this.down.delete(e.code);
    this._onBlur = () => this.down.clear();
    this._onMouseDown = (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      if (e.target.closest && e.target.closest('.ui-layer')) return;
      this._mouse.dragging = true;
      this._mouse.x = e.clientX;
      this._mouse.y = e.clientY;
    };
    this._onMouseMove = (e) => {
      if (!this._mouse.dragging) return;
      const dx = (e.clientX - this._mouse.x) / window.innerWidth;
      const dy = (e.clientY - this._mouse.y) / window.innerHeight;
      this.look.yaw = clamp(-dx * 2.2, -1, 1);
      this.look.pitch = clamp(-dy * 2.2, -1, 1);
    };
    this._onMouseUp = () => {
      this._mouse.dragging = false;
    };
    this._onWheel = (e) => {
      if (e.target.closest && e.target.closest('.ui-layer')) return;
      this.zoom += Math.sign(e.deltaY);
    };
    this._onContext = (e) => e.preventDefault();
    t.addEventListener('keydown', this._onKeyDown);
    t.addEventListener('keyup', this._onKeyUp);
    t.addEventListener('blur', this._onBlur);
    t.addEventListener('mousedown', this._onMouseDown);
    t.addEventListener('mousemove', this._onMouseMove);
    t.addEventListener('mouseup', this._onMouseUp);
    t.addEventListener('wheel', this._onWheel, { passive: true });
    t.addEventListener('contextmenu', this._onContext);
    t.addEventListener('gamepadconnected', (e) => {
      this._gamepadIndex = e.gamepad.index;
    });
  }

  key(name) {
    return AXIS_KEYS[name].some((c) => this.down.has(c));
  }

  /** Discrete actions since the last call. */
  consume() {
    const out = this.pressed;
    this.pressed = [];
    return out;
  }

  /** Update smoothed axes. Call once per rendered frame. */
  update(dt) {
    const c = this.controls;
    if (!this.enabled) {
      c.pitch = c.roll = c.yaw = 0;
      return c;
    }
    const kb = this._kb;
    const ramp = (cur, target, rate) => {
      const r = target === 0 || Math.sign(target) !== Math.sign(cur) ? rate * 1.8 : rate;
      const d = target - cur;
      return cur + clamp(d, -r * dt, r * dt);
    };
    const tp = (this.key('pitchUp') ? 1 : 0) - (this.key('pitchDown') ? 1 : 0);
    const tr = (this.key('rollRight') ? 1 : 0) - (this.key('rollLeft') ? 1 : 0);
    const ty = (this.key('yawRight') ? 1 : 0) - (this.key('yawLeft') ? 1 : 0);
    kb.pitch = ramp(kb.pitch, tp, 3.2);
    kb.roll = ramp(kb.roll, tr, 4.5);
    kb.yaw = ramp(kb.yaw, ty, 3);

    let pitch = kb.pitch;
    let roll = kb.roll;
    let yaw = kb.yaw;
    let brake = this.key('brake') ? 1 : 0;

    if (this.key('throttleUp')) c.throttle = clamp(c.throttle + dt * 0.45, 0, 1);
    if (this.key('throttleDown')) c.throttle = clamp(c.throttle - dt * 0.45, 0, 1);

    // Touch: virtual stick + throttle slider.
    if (this.touch?.active) {
      const tc = this.touch.state;
      pitch += tc.pitch;
      roll += tc.roll;
      yaw += tc.yaw;
      if (tc.throttle !== null) c.throttle = tc.throttle;
      brake = Math.max(brake, tc.brake);
      this.look.yaw = tc.lookYaw ?? this.look.yaw;
      this.look.pitch = tc.lookPitch ?? this.look.pitch;
    }

    // Gamepad: left stick pitch/roll, triggers rudder, right stick look.
    const gp = this._readGamepad(dt);
    if (gp) {
      pitch += gp.pitch;
      roll += gp.roll;
      yaw += gp.yaw;
      brake = Math.max(brake, gp.brake);
    }

    if (!this._mouse.dragging && !this.touch?.lookActive && !gp?.looking) {
      // Spring the view back to centre when nothing is holding it.
      const k = Math.min(1, dt * 3);
      this.look.yaw -= this.look.yaw * k;
      this.look.pitch -= this.look.pitch * k;
    }

    c.pitch = clamp(this.invertPitch ? -pitch : pitch, -1, 1);
    c.roll = clamp(roll, -1, 1);
    c.yaw = clamp(yaw, -1, 1);
    c.brake = brake;
    return c;
  }

  _readGamepad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = this._gamepadIndex !== null ? pads[this._gamepadIndex] : [...pads].find(Boolean);
    if (!gp) return null;
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const ax = gp.axes;
    const b = (i) => gp.buttons[i]?.value ?? 0;
    const out = {
      roll: dz(ax[0] ?? 0),
      pitch: dz(ax[1] ?? 0), // stick back (down) = nose up, as in real aircraft
      yaw: b(7) - b(6),
      brake: b(0) > 0.5 ? 1 : 0,
      looking: false,
    };
    const lx = dz(ax[2] ?? 0);
    const ly = dz(ax[3] ?? 0);
    if (lx || ly) {
      this.look.yaw = -lx;
      this.look.pitch = -ly;
      out.looking = true;
    }
    const thr = b(5) - b(4); // bumpers
    if (thr) this.controls.throttle = clamp(this.controls.throttle + thr * dt * 0.5, 0, 1);
    const edges = { 3: 'camera', 2: 'gear', 1: 'flaps', 9: 'pause', 8: 'map', 12: 'time', 13: 'weather' };
    for (const [i, action] of Object.entries(edges)) {
      const now = (gp.buttons[i]?.value ?? 0) > 0.5;
      if (now && !this._lastGamepadButtons[i]) this.pressed.push(action);
      this._lastGamepadButtons[i] = now;
    }
    if (Math.abs(out.pitch) + Math.abs(out.roll) + Math.abs(out.yaw) > 0) this.lastSource = 'gamepad';
    return out;
  }

  /** Clear held keys and axes (used when pausing / resetting). */
  reset() {
    this.down.clear();
    this.pressed = [];
    this._kb.pitch = this._kb.roll = this._kb.yaw = 0;
    this.controls.pitch = this.controls.roll = this.controls.yaw = 0;
  }

  dispose() {
    const t = this.target;
    t.removeEventListener('keydown', this._onKeyDown);
    t.removeEventListener('keyup', this._onKeyUp);
    t.removeEventListener('blur', this._onBlur);
    t.removeEventListener('mousedown', this._onMouseDown);
    t.removeEventListener('mousemove', this._onMouseMove);
    t.removeEventListener('mouseup', this._onMouseUp);
    t.removeEventListener('wheel', this._onWheel);
    t.removeEventListener('contextmenu', this._onContext);
  }
}

function isGameKey(code) {
  if (code === 'F5' || code === 'F12') return false;
  for (const codes of Object.values(AXIS_KEYS)) if (codes.includes(code)) return true;
  for (const codes of Object.values(ACTION_KEYS)) if (codes.includes(code)) return true;
  return code === 'Space' || /^Digit/.test(code);
}
