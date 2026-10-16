import { InstrumentPanel } from './instrumentPanel.js';
import { Minimap, LargeMap } from './minimap.js';
import { computeWarnings } from './warnings.js';

/**
 * Screen-space HUD: instrument row (chase view), warnings, mode info panel,
 * minimap and the large map.
 */
export class HUD {
  constructor(container, mapRenderer) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    container.append(this.root);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.row = new InstrumentPanel('row', dpr);
    this.row.canvas.className = 'hud-instruments';
    this.root.append(this.row.canvas);

    this.warnEl = document.createElement('div');
    this.warnEl.className = 'hud-warnings';
    this.root.append(this.warnEl);

    this.info = document.createElement('div');
    this.info.className = 'hud-info panel';
    this.info.innerHTML = '<div class="hi-title"></div><div class="hi-body"></div>';
    this.root.append(this.info);
    this.infoTitle = this.info.querySelector('.hi-title');
    this.infoBody = this.info.querySelector('.hi-body');

    this.approachEl = document.createElement('div');
    this.approachEl.className = 'hud-approach panel';
    this.approachEl.hidden = true;
    this.approachEl.innerHTML = `<div class="ha-title">APPROACH</div>
      <div class="ha-gs"><div class="ha-dot"></div></div>
      <div class="ha-loc"><div class="ha-dot"></div></div>
      <div class="ha-read"></div>`;
    this.root.append(this.approachEl);
    this.gsDot = this.approachEl.querySelector('.ha-gs .ha-dot');
    this.locDot = this.approachEl.querySelector('.ha-loc .ha-dot');
    this.approachRead = this.approachEl.querySelector('.ha-read');

    this.minimap = new Minimap(this.root, mapRenderer);
    this.largeMap = new LargeMap(container, mapRenderer);

    this.visible = true;
    this.view = 'chase';
    this._rowAccum = 0;
    this._warnKey = '';
    this._infoKey = '';
    this.showInstruments = true;
  }

  setVisible(v) {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
  }

  setView(view) {
    this.view = view;
    this.root.classList.toggle('cockpit', view === 'cockpit');
  }

  setInfo(title, bodyHTML) {
    const key = title + '|' + bodyHTML;
    if (key === this._infoKey) return;
    this._infoKey = key;
    this.info.hidden = !title;
    this.infoTitle.textContent = title || '';
    this.infoBody.innerHTML = bodyHTML || '';
  }

  /**
   * ILS-style guidance: diamonds show where the glide path / centreline is
   * relative to the aircraft (fly toward the diamond).
   * @param {null|{glideDev:number, locDev:number, toThreshold:number, height:number}} g
   */
  setApproach(g) {
    this.approachEl.hidden = !g || !this.visible;
    if (!g) return;
    // Full scale: +/-0.7 deg glide slope, +/-2.5 deg localizer.
    const gs = Math.max(-1, Math.min(1, g.glideDev / 0.7));
    const loc = Math.max(-1, Math.min(1, g.locDev / 2.5));
    // Above the path -> path is below us -> diamond moves down.
    this.gsDot.style.top = `${50 + gs * 42}%`;
    // Right of centreline -> centreline is to our left -> diamond moves left.
    this.locDot.style.left = `${50 - loc * 42}%`;
    const nm = Math.max(0, g.toThreshold) / 1852;
    this.approachRead.textContent = `${nm.toFixed(1)} nm · ${Math.round(Math.max(0, g.height) * 3.28084)} ft`;
  }

  /**
   * @param {object} p
   * @param {number} p.dt
   * @param {object} p.state flight state
   * @param {object} p.controls
   * @param {number|null} p.bug heading bug (radians)
   * @param {object} p.world { airports, rings, target }
   * @param {(x:number,z:number)=>number} p.groundAt
   */
  update({ dt, state, controls, bug, world, groundAt, warnings: showWarnings = true }) {
    if (!this.visible) {
      if (this.largeMap.open) this.largeMap.update({ x: state.pos.x, z: state.pos.z, heading: state.heading }, world);
      return;
    }
    const plane = { x: state.pos.x, z: state.pos.z, heading: state.heading };
    const showRow = this.view === 'chase' && this.showInstruments;
    this.row.canvas.style.display = showRow ? '' : 'none';
    if (showRow) {
      this._rowAccum += dt;
      if (this._rowAccum >= 1 / 30) {
        this.row.draw(state, controls, this._rowAccum, bug);
        this._rowAccum = 0;
      }
    }
    this.minimap.update(dt, plane, world);
    this.largeMap.update(plane, world);

    const warnings = showWarnings ? computeWarnings(state, groundAt) : [];
    const key = warnings.map((w) => w.id).join(',');
    if (key !== this._warnKey) {
      this._warnKey = key;
      this.warnEl.innerHTML = warnings.map((w) => `<div class="hw ${w.level}">${w.text}</div>`).join('');
    }
    this.warnings = warnings;
  }
}
