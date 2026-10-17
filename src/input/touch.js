/**
 * On-screen touch controls:
 *   - left: virtual stick (pitch + roll; drag down = pull = nose up)
 *   - right: vertical throttle slider
 *   - rudder: two hold buttons under the stick
 *   - buttons: brake (hold), gear, flaps, camera, map, photo, pause
 *   - dragging on empty screen space looks around
 *
 * Uses Pointer Events so mouse can test it on desktop with ?touch=1.
 * Each control tracks its own pointerId, so multi-touch just works.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Map a stick drag (pixels) to normalised axes with a small dead zone and expo curve. */
export function stickAxes(dx, dy, radius, deadZone = 0.08, expo = 0.35) {
  let x = dx / radius;
  let y = dy / radius;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  const shape = (v) => {
    const a = Math.abs(v);
    if (a < deadZone) return 0;
    const t = (a - deadZone) / (1 - deadZone);
    return Math.sign(v) * (t * (1 - expo) + t * t * t * expo);
  };
  return { roll: shape(x), pitch: shape(y) };
}

export class TouchControls {
  constructor(container, input, { force = false } = {}) {
    this.input = input;
    this.state = { pitch: 0, roll: 0, yaw: 0, throttle: null, brake: 0, lookYaw: null, lookPitch: null };
    this.active = false;
    this.lookActive = false;
    this._yawL = 0;
    this._yawR = 0;
    this.root = document.createElement('div');
    this.root.className = 'touch-ui ui-layer';
    this.root.innerHTML = `
      <div class="tc-stick" data-role="stick"><div class="tc-knob"></div><span class="tc-label">PITCH · ROLL</span></div>
      <div class="tc-rudder">
        <button class="tc-btn" data-hold="yawL" aria-label="Rudder left">◀</button>
        <span class="tc-label">RUDDER</span>
        <button class="tc-btn" data-hold="yawR" aria-label="Rudder right">▶</button>
      </div>
      <div class="tc-throttle" data-role="throttle"><div class="tc-fill"></div><div class="tc-handle"></div><span class="tc-label">THR</span></div>
      <div class="tc-buttons">
        <button class="tc-btn" data-hold="brake">BRK</button>
        <button class="tc-btn" data-action="flaps">FLAP</button>
        <button class="tc-btn" data-action="gear">GEAR</button>
        <button class="tc-btn" data-action="camera">CAM</button>
      </div>
      <div class="tc-top">
        <button class="tc-btn small" data-action="map">MAP</button>
        <button class="tc-btn small" data-action="photo">📷</button>
        <button class="tc-btn small" data-action="pause">❚❚</button>
      </div>`;
    container.append(this.root);
    this.stick = this.root.querySelector('[data-role=stick]');
    this.knob = this.root.querySelector('.tc-knob');
    this.throttle = this.root.querySelector('[data-role=throttle]');
    this.fill = this.root.querySelector('.tc-fill');
    this.handle = this.root.querySelector('.tc-handle');
    this._bind(container);
    const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches;
    if (force || coarse) this.enable();
    // Show touch controls the moment someone touches the screen.
    window.addEventListener(
      'touchstart',
      () => {
        if (!this.active) this.enable();
      },
      { passive: true },
    );
  }

  enable() {
    this.active = true;
    this.input.touch = this;
    document.body.classList.add('touch-mode');
  }

  disable() {
    this.active = false;
    document.body.classList.remove('touch-mode');
  }

  setVisible(v) {
    this.root.style.display = v ? '' : 'none';
  }

  _bind(container) {
    // Stick.
    let stickId = null;
    let cx = 0;
    let cy = 0;
    const radius = () => this.stick.clientWidth * 0.38;
    this.stick.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
      const r = this.stick.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      moveStick(e);
      e.preventDefault();
    });
    const moveStick = (e) => {
      if (e.pointerId !== stickId) return;
      const R = radius();
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const a = stickAxes(dx, dy, R);
      this.state.roll = a.roll;
      this.state.pitch = a.pitch;
    };
    const endStick = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      this.knob.style.transform = '';
      this.state.roll = 0;
      this.state.pitch = 0;
    };
    this.stick.addEventListener('pointermove', moveStick);
    this.stick.addEventListener('pointerup', endStick);
    this.stick.addEventListener('pointercancel', endStick);

    // Throttle slider.
    let thrId = null;
    const setThrottle = (e) => {
      const r = this.throttle.getBoundingClientRect();
      const t = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      this.input.controls.throttle = t;
    };
    this.throttle.addEventListener('pointerdown', (e) => {
      thrId = e.pointerId;
      this.throttle.setPointerCapture(e.pointerId);
      setThrottle(e);
      e.preventDefault();
    });
    this.throttle.addEventListener('pointermove', (e) => e.pointerId === thrId && setThrottle(e));
    const endThr = (e) => {
      if (e.pointerId === thrId) thrId = null;
    };
    this.throttle.addEventListener('pointerup', endThr);
    this.throttle.addEventListener('pointercancel', endThr);

    // Hold buttons and action buttons.
    for (const btn of this.root.querySelectorAll('[data-hold]')) {
      const key = btn.dataset.hold;
      const set = (v) => {
        if (key === 'brake') this.state.brake = v;
        if (key === 'yawL') this._yawL = v;
        if (key === 'yawR') this._yawR = v;
        this.state.yaw = this._yawR - this._yawL;
        btn.classList.toggle('on', !!v);
      };
      btn.addEventListener('pointerdown', (e) => {
        btn.setPointerCapture(e.pointerId);
        set(1);
        e.preventDefault();
      });
      btn.addEventListener('pointerup', () => set(0));
      btn.addEventListener('pointercancel', () => set(0));
    }
    for (const btn of this.root.querySelectorAll('[data-action]')) {
      btn.addEventListener('pointerdown', (e) => {
        this.input.pressed.push(btn.dataset.action);
        e.preventDefault();
      });
    }

    // Look-around: drag on the scene itself (not on controls).
    let lookId = null;
    let lx = 0;
    let ly = 0;
    container.addEventListener('pointerdown', (e) => {
      if (!this.active || e.pointerType === 'mouse' || lookId !== null) return;
      if (e.target.closest('.ui-layer, .panel, button')) return;
      lookId = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      this.lookActive = true;
    });
    container.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      this.state.lookYaw = clamp(-(e.clientX - lx) / (window.innerWidth * 0.35), -1, 1);
      this.state.lookPitch = clamp(-(e.clientY - ly) / (window.innerHeight * 0.45), -1, 1);
    });
    const endLook = (e) => {
      if (e.pointerId !== lookId) return;
      lookId = null;
      this.lookActive = false;
      this.state.lookYaw = null;
      this.state.lookPitch = null;
    };
    container.addEventListener('pointerup', endLook);
    container.addEventListener('pointercancel', endLook);
  }

  /** Reflect the current throttle on the slider. */
  update(controls) {
    if (!this.active) return;
    const t = controls.throttle;
    this.fill.style.height = `${t * 100}%`;
    this.handle.style.bottom = `calc(${t * 100}% - 14px)`;
  }
}
