import { formatClock } from '../world/dayNight.js';

/**
 * Photo mode: freezes the simulation, hands the camera to an orbit around
 * the aircraft and shows a small toolbar (field of view, exposure, time of
 * day, vignette) plus a capture button that saves a PNG of the 3D view.
 */
export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.root = document.createElement('div');
    this.root.className = 'photo-bar panel ui-layer';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="pb-title">PHOTO MODE <span class="muted">drag to orbit · wheel to zoom</span></div>
      <label>Field of view <input type="range" min="15" max="100" step="1" data-k="fov"><output></output></label>
      <label>Exposure <input type="range" min="-1.5" max="1.5" step="0.05" data-k="ev"><output></output></label>
      <label>Time of day <input type="range" min="0" max="24" step="0.05" data-k="time"><output></output></label>
      <label class="check"><input type="checkbox" data-k="vignette" checked> Vignette</label>
      <div class="pb-actions">
        <button class="btn primary" data-capture>Capture PNG</button>
        <button class="btn" data-exit>Exit <kbd>P</kbd></button>
      </div>`;
    game.container.append(this.root);
    this.inputs = Object.fromEntries([...this.root.querySelectorAll('[data-k]')].map((el) => [el.dataset.k, el]));
    for (const [k, el] of Object.entries(this.inputs)) el.oninput = () => this._apply(k);
    this.root.querySelector('[data-capture]').onclick = () => this.capture();
    this.root.querySelector('[data-exit]').onclick = () => this.exit();
    this._bindOrbit();
  }

  _bindOrbit() {
    const el = this.game.container;
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (!this.active || e.target.closest('.ui-layer')) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const p = this.game.rig.photo;
      p.yaw -= ((e.clientX - drag.x) / window.innerWidth) * 4;
      p.pitch = Math.max(-0.4, Math.min(1.45, p.pitch + ((e.clientY - drag.y) / window.innerHeight) * 2.5));
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const end = (e) => {
      if (drag && e.pointerId === drag.id) drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        const p = this.game.rig.photo;
        p.dist = Math.max(6, Math.min(400, p.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
      },
      { passive: true },
    );
  }

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  enter() {
    const g = this.game;
    if (this.active || g.overlay.modalOpen || g.menu?.open) return;
    this.active = true;
    this.prevCamera = g.rig.mode;
    this.prevTimeScale = g.env3d.timeScale;
    g.env3d.timeScale = 0;
    g.paused = true;
    g.input.reset();
    // Start the orbit from where the camera currently is.
    const c = g.camera.position;
    const p = g.aircraft.renderPos;
    const rig = g.rig;
    rig.photo.dist = Math.max(8, Math.min(60, c.distanceTo(p)));
    rig.photo.yaw = Math.atan2(c.x - p.x, c.z - p.z);
    rig.photo.pitch = Math.asin(Math.max(-0.9, Math.min(0.9, (c.y - p.y) / Math.max(rig.photo.dist, 1))));
    rig.photo.fov = 55;
    rig.setMode('photo');
    this.ev = 0;
    this._sync();
    g.hud.setVisible(false);
    g.touch.setVisible(false);
    g.marker.hide();
    this.root.hidden = false;
  }

  exit() {
    const g = this.game;
    if (!this.active) return;
    this.active = false;
    g.env3d.timeScale = this.prevTimeScale;
    g.env3d.exposureBias = 0;
    g.rig.setMode(this.prevCamera || 'chase');
    g.paused = false;
    g.loop.reset();
    g.hud.setVisible(true);
    g.touch.setVisible(true);
    document.querySelector('.vignette')?.removeAttribute('hidden');
    this.root.hidden = true;
  }

  _sync() {
    const g = this.game;
    this.inputs.fov.value = g.rig.photo.fov;
    this.inputs.ev.value = this.ev;
    this.inputs.time.value = g.env3d.hours;
    this._outputs();
  }

  _outputs() {
    const g = this.game;
    this.inputs.fov.nextElementSibling.textContent = `${Math.round(g.rig.photo.fov)}°`;
    this.inputs.ev.nextElementSibling.textContent = `${this.ev >= 0 ? '+' : ''}${Number(this.ev).toFixed(1)} EV`;
    this.inputs.time.nextElementSibling.textContent = formatClock(g.env3d.hours);
  }

  _apply(k) {
    const g = this.game;
    const v = this.inputs[k].type === 'checkbox' ? this.inputs[k].checked : Number(this.inputs[k].value);
    if (k === 'fov') g.rig.photo.fov = v;
    if (k === 'ev') {
      this.ev = v;
      g.env3d.exposureBias = v;
    }
    if (k === 'time') g.env3d.setTime(v);
    if (k === 'vignette') document.querySelector('.vignette')?.toggleAttribute('hidden', !v);
    this._outputs();
  }

  /** Render one frame and save the canvas as a PNG download. */
  capture() {
    const g = this.game;
    g.renderer.render(g.scene, g.camera);
    const canvas = g.renderer.canvas;
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `flight-deck-${stamp}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      g.overlay.toast('Photo saved', 'good');
    }, 'image/png');
  }
}
