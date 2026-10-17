import * as THREE from 'three';

/**
 * Screen-space marker for a 3D target: a reticle with the distance while
 * the target is on screen, an arrow clamped to the screen edge otherwise.
 */
export class TargetMarker {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'target-marker';
    this.el.innerHTML = '<div class="tm-ring"></div><div class="tm-arrow"></div><div class="tm-label"></div>';
    this.el.hidden = true;
    container.append(this.el);
    this.label = this.el.querySelector('.tm-label');
    this.arrow = this.el.querySelector('.tm-arrow');
    this._v = new THREE.Vector3();
  }

  hide() {
    this.el.hidden = true;
  }

  /**
   * @param {THREE.Camera} camera
   * @param {{x:number,y:number,z:number}} target
   * @param {string} text
   */
  update(camera, target, text) {
    if (!target) return this.hide();
    const v = this._v.set(target.x, target.y, target.z).project(camera);
    // Behind the camera: mirror so the arrow points the right way.
    const behind = v.z > 1;
    let x = behind ? -v.x : v.x;
    let y = behind ? -v.y : v.y;
    const onScreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!onScreen) {
      // Push the arrow to the screen edge along the direction to the target.
      if (behind && Math.hypot(x, y) < 1e-3) y = -1;
      const m = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.85);
      x /= m;
      y /= m;
    }
    const px = (x * 0.5 + 0.5) * w;
    const py = (-y * 0.5 + 0.5) * h;
    this.el.hidden = false;
    this.el.classList.toggle('off', !onScreen);
    this.el.style.transform = `translate(${px}px, ${py}px)`;
    this.arrow.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(x, y)}rad)`;
    this.label.textContent = text;
  }
}
