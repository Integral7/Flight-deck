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
   * @param {object} p
   * @param {number} p.dt
   * @param {object} p.state flight state
   * @param {object} p.controls
   * @param {number|null} p.bug heading bug (radians)
   * @param {object} p.world { airports, rings, target }
   * @param {(x:number,z:number)=>number} p.groundAt
   */
  update({ dt, state, controls, bug, world, groundAt }) {
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

    const warnings = computeWarnings(state, groundAt);
    const key = warnings.map((w) => w.id).join(',');
    if (key !== this._warnKey) {
      this._warnKey = key;
      this.warnEl.innerHTML = warnings.map((w) => `<div class="hw ${w.level}">${w.text}</div>`).join('');
    }
    this.warnings = warnings;
  }
}
