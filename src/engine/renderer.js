import * as THREE from 'three';

/**
 * Owns the WebGLRenderer: tone mapping, shadows, resize handling and dynamic
 * resolution. Antialiasing is a context-creation flag, so changing it
 * recreates the renderer; Three.js re-uploads GPU resources transparently.
 */
export class Renderer {
  constructor(container, preset) {
    this.container = container;
    this.preset = preset;
    this.renderScale = 1;
    this.adaptive = true;
    this._create();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  _create() {
    const r = new THREE.WebGLRenderer({
      antialias: this.preset.antialias,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      stencil: false,
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.enabled = this.preset.shadows;
    r.domElement.className = 'game-canvas';
    r.domElement.setAttribute('aria-label', 'Flight view');
    this.container.prepend(r.domElement);
    this.gl = r;
    this.resize();
  }

  get canvas() {
    return this.gl.domElement;
  }

  applyQuality(preset) {
    const needsRecreate = preset.antialias !== this.preset.antialias;
    this.preset = preset;
    this.renderScale = 1;
    if (needsRecreate) {
      const old = this.gl;
      old.domElement.remove();
      old.dispose();
      this._create();
    }
    this.gl.shadowMap.enabled = preset.shadows;
    this.gl.shadowMap.needsUpdate = true;
    this.resize();
    return needsRecreate;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatioCap);
    this.gl.setPixelRatio(dpr * this.renderScale);
    this.gl.setSize(w, h, true);
    this.width = w;
    this.height = h;
    this.aspect = w / h;
  }

  /**
   * Nudge render scale toward a frame-time budget. Called a few times per
   * second, never per frame, so it does not oscillate.
   */
  adaptResolution(avgFrameMs, budgetMs = 1000 / 55) {
    if (!this.adaptive) return;
    let s = this.renderScale;
    if (avgFrameMs > budgetMs * 1.15) s -= 0.08;
    else if (avgFrameMs < budgetMs * 0.75) s += 0.05;
    s = Math.min(1, Math.max(this.preset.minRenderScale, s));
    if (Math.abs(s - this.renderScale) > 0.01) {
      this.renderScale = s;
      this.resize();
    }
  }

  render(scene, camera) {
    this.gl.render(scene, camera);
  }

  info() {
    const i = this.gl.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries };
  }
}
