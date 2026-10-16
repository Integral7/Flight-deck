import { CONTROL_HELP } from '../input/bindings.js';

/**
 * DOM overlays that sit above the 3D view: toasts, the centre banner
 * (crash / landing results / mode messages), the pause menu and help.
 */
export class Overlay {
  constructor(container) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.innerHTML = `
      <div class="toasts" aria-live="polite"></div>
      <div class="banner panel" hidden>
        <div class="banner-kicker"></div>
        <h2 class="banner-title"></h2>
        <div class="banner-body"></div>
        <div class="banner-actions"></div>
      </div>
      <div class="modal-backdrop" hidden>
        <div class="modal panel" role="dialog" aria-modal="true"></div>
      </div>`;
    container.append(this.root);
    this.toasts = this.root.querySelector('.toasts');
    this.banner = this.root.querySelector('.banner');
    this.backdrop = this.root.querySelector('.modal-backdrop');
    this.modal = this.root.querySelector('.modal');
    this.modalOpen = null;
  }

  toast(text, kind = 'info', ms = 1600) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.append(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  /**
   * @param {{kicker?:string,title:string,body?:string,kind?:string,actions?:Array<{label:string,key?:string,onClick:Function,primary?:boolean}>}} opts
   */
  showBanner(opts) {
    const b = this.banner;
    b.className = `banner panel ${opts.kind || ''}`;
    b.querySelector('.banner-kicker').textContent = opts.kicker || '';
    b.querySelector('.banner-title').textContent = opts.title;
    b.querySelector('.banner-body').innerHTML = opts.body || '';
    const actions = b.querySelector('.banner-actions');
    actions.innerHTML = '';
    for (const a of opts.actions || []) {
      const btn = document.createElement('button');
      btn.className = `btn ${a.primary ? 'primary' : ''}`;
      btn.innerHTML = a.key ? `${a.label} <kbd>${a.key}</kbd>` : a.label;
      btn.addEventListener('click', () => a.onClick());
      actions.append(btn);
    }
    b.hidden = false;
  }

  hideBanner() {
    this.banner.hidden = true;
  }

  openModal(name, html, onClose) {
    this.modal.innerHTML = html;
    this.backdrop.hidden = false;
    this.modalOpen = name;
    this._onClose = onClose;
    this.modal.querySelector('button, select, input')?.focus({ preventScroll: true });
  }

  closeModal() {
    if (!this.modalOpen) return;
    this.backdrop.hidden = true;
    this.modal.innerHTML = '';
    const cb = this._onClose;
    this.modalOpen = null;
    this._onClose = null;
    cb?.();
  }

  helpHTML() {
    const rows = CONTROL_HELP.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('');
    return `
      <h2>Controls</h2>
      <table class="help-table">${rows}</table>
      <p class="muted">Touch: left stick pitches and rolls (drag down to climb), right slider is throttle,
      ◀ ▶ under the stick are the rudder. Drag on the scenery to look around. Gamepads work too.</p>`;
  }
}
