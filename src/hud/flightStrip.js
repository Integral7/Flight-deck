const KT = 1.94384;
const FT = 3.28084;

/**
 * Compact text readout used before the full instrument HUD exists and as
 * the minimal HUD in scenic mode.
 */
export class FlightStrip {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'flight-strip';
    container.append(this.el);
    this._last = '';
  }

  update(s, controls) {
    const deg = 180 / Math.PI;
    const parts = [
      `<b>${Math.round(s.airspeed * KT)}</b> kt`,
      `<b>${Math.round(s.pos.y * FT)}</b> ft`,
      `<b>${String(Math.round(s.heading * deg) % 360).padStart(3, '0')}</b>°`,
      `VS <b>${Math.round(s.verticalSpeed * FT * 60)}</b>`,
      `THR <b>${Math.round(controls.throttle * 100)}</b>%`,
    ];
    if (s.type.hasFlaps) parts.push(`FLAPS <b>${Math.round(s.flaps * 100)}</b>%`);
    if (s.type.retractableGear) parts.push(`GEAR <b>${s.gearPos > 0.99 ? 'DOWN' : s.gearPos < 0.01 ? 'UP' : 'TRANSIT'}</b>`);
    if (s.stallWarning) parts.push('<b class="warn">STALL</b>');
    const html = parts.join('<span class="sep">·</span>');
    if (html !== this._last) {
      this.el.innerHTML = html;
      this._last = html;
    }
  }

  setVisible(v) {
    this.el.style.display = v ? '' : 'none';
  }
}
