import * as THREE from 'three';
import { Sky } from './sky.js';
import { sunDirection, moonDirection, skyState, wrapHours } from './dayNight.js';

/**
 * Owns time of day and everything lit by it: sky dome, stars, sun/moon
 * directional light (with shadows following the aircraft), hemisphere
 * ambient, fog, exposure and an environment map rendered from the sky for
 * reflections. Weather feeds in overcast/visibility/light dimming.
 */
export class Environment {
  constructor(scene, renderer, preset) {
    this.scene = scene;
    this.renderer = renderer;
    this.preset = preset;
    this.hours = 15.5;
    this.timeScale = 1 / 90; // game hours per real second (36-minute day)
    this._targetHours = null;

    this.sky = new Sky(scene, preset.starCount);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    scene.add(this.hemi);

    this.light = new THREE.DirectionalLight(0xffffff, 2.5);
    this.light.castShadow = preset.shadows;
    this._configureShadow(preset);
    scene.add(this.light, this.light.target);

    this.fog = new THREE.Fog(0x9cc4e8, 1000, 5000);
    scene.fog = this.fog;
    scene.background = new THREE.Color(0x9cc4e8);
    this.viewDistance = 5000;

    // Environment map from a sky-only scene, refreshed when the light changes.
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(this.sky.mesh.geometry, this.sky.material);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer.gl);
    this.envTarget = null;
    this._envKey = null;
    this._envTimer = 0;
    scene.environmentIntensity = 0.65;

    this.weather = { overcast: 0, visibility: 1, light: 1, haze: 0 };
    this.state = null;
    this.sunDir = [0, 1, 0];
    this.moonDir = [0, 1, 0];
    this._tmp = new THREE.Color();
    this._tmp2 = new THREE.Color();
  }

  _configureShadow(preset) {
    const sz = preset.shadowMapSize || 1024;
    this.light.shadow.mapSize.set(sz, sz);
    this.light.shadow.map?.dispose();
    this.light.shadow.map = null;
    const cam = this.light.shadow.camera;
    cam.left = cam.bottom = -70;
    cam.right = cam.top = 70;
    cam.near = 10;
    cam.far = 2500;
    cam.updateProjectionMatrix();
    this.light.shadow.bias = -0.0005;
    this.light.shadow.normalBias = 0.5;
  }

  applyQuality(preset) {
    this.preset = preset;
    this.light.castShadow = preset.shadows;
    if (preset.shadows) this._configureShadow(preset);
  }

  setViewDistance(d) {
    this.viewDistance = d;
  }

  /** Jump the clock smoothly forward by `h` hours. */
  advance(h) {
    this._targetHours = (this._targetHours ?? this.hours) + h;
  }

  setTime(h) {
    this.hours = wrapHours(h);
    this._targetHours = null;
    this._envKey = null;
  }

  get isNight() {
    return (this.state?.night ?? 0) > 0.5;
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} focus point the shadow camera should centre on
   */
  update(dt, camera, focus) {
    if (this._targetHours !== null) {
      const step = Math.min(this._targetHours - this.hours, dt * 1.2);
      this.hours += step;
      if (this._targetHours - this.hours < 1e-3) {
        this.hours = wrapHours(this._targetHours);
        this._targetHours = null;
      }
    } else {
      this.hours = wrapHours(this.hours + dt * this.timeScale);
    }
    const w = this.weather;
    sunDirection(this.hours, this.sunDir);
    moonDirection(this.hours, this.moonDir);
    const st = skyState(Math.asin(this.sunDir[1]));
    this.state = st;

    this.sky.apply(st, this.sunDir, this.moonDir, w.overcast, this.hours);
    this.sky.follow(camera);

    // Key light: sun by day, moon by night.
    const moonPart = st.night;
    const dir = moonPart > 0.5 ? this.moonDir : this.sunDir;
    const lightScale = w.light * (1 - w.overcast * 0.75);
    this._tmp.setRGB(...st.sunColor, THREE.SRGBColorSpace);
    this._tmp2.setRGB(0.55, 0.65, 0.95, THREE.SRGBColorSpace);
    this.light.color.copy(this._tmp).lerp(this._tmp2, moonPart);
    this.light.intensity = (st.sunIntensity + moonPart * 0.7) * lightScale;
    this.light.position.set(focus.x + dir[0] * 900, focus.y + dir[1] * 900, focus.z + dir[2] * 900);
    this.light.target.position.copy(focus);
    this.light.target.updateMatrixWorld();
    // Fade shadows near the horizon and under cloud instead of toggling
    // castShadow (which would force shader recompiles).
    this.light.shadow.intensity = Math.min(1, Math.max(0, dir[1] * 6)) * (1 - w.overcast * 0.8);

    // Ambient: hemisphere + sky environment map. Overcast flattens light
    // (less key light, relatively more ambient).
    this.hemi.color.setRGB(...st.hemiSky, THREE.SRGBColorSpace);
    this.hemi.groundColor.setRGB(...st.hemiGround, THREE.SRGBColorSpace);
    this.hemi.intensity = st.hemiIntensity * 0.55 * w.light * (1 + w.overcast * 0.35);
    this.scene.environmentIntensity = 0.55 * w.light * (0.4 + 0.6 * (1 - st.night));

    // Fog: colour from the horizon palette, distance from view range and weather.
    this._tmp.setRGB(...st.fog, THREE.SRGBColorSpace);
    if (w.overcast > 0) this._tmp.lerp(this.sky.uniforms.uOvercastColor.value, w.overcast * 0.8);
    this.fog.color.copy(this._tmp);
    this.scene.background.copy(this._tmp);
    const vis = Math.max(0.03, w.visibility);
    this.fog.far = this.viewDistance * 0.97 * vis;
    this.fog.near = this.fog.far * (0.12 + 0.25 * vis) * (1 - w.haze * 0.5);

    this.renderer.gl.toneMappingExposure = st.exposure * (0.85 + 0.15 * w.light);

    this._updateLandingLight();
    this._updateEnvMap(dt, st);
  }

  /** Colours for lit cloud tops and shaded bellies under the current light. */
  cloudColors(lit, shadow) {
    const l = this.light;
    const h = this.hemi;
    const t = this._tmp;
    lit.copy(l.color).multiplyScalar(l.intensity * 0.32).add(t.copy(h.color).multiplyScalar(h.intensity * 1.1));
    shadow.copy(h.color).multiplyScalar(h.intensity * 0.75).add(t.copy(h.groundColor).multiplyScalar(h.intensity * 0.35));
    // Overcast/rain clouds are greyer and darker underneath.
    shadow.multiplyScalar(1 - this.weather.overcast * 0.35);
    return { lit, shadow };
  }

  /**
   * Nose-mounted landing light for night flying. It is always present and
   * fades by intensity so the light count (and shaders) never change.
   */
  attachLandingLight(model, type) {
    if (!this.landingLight) {
      this.landingLight = new THREE.SpotLight(0xfff2dc, 0, 900, 0.32, 0.5, 1.2);
      this.landingLight.castShadow = false;
      this.landingTarget = new THREE.Object3D();
    }
    this.landingLight.parent?.remove(this.landingLight);
    this.landingTarget.parent?.remove(this.landingTarget);
    this.landingLight.position.set(0, -0.2, -type.noseLength + 0.4);
    this.landingTarget.position.set(0, -12, -80);
    model.add(this.landingLight, this.landingTarget);
    this.landingLight.target = this.landingTarget;
  }

  _updateLandingLight() {
    if (!this.landingLight) return;
    const dark = Math.max(this.state.night, this.weather.overcast * 0.5 * (1 - this.state.sunIntensity / 3));
    this.landingLight.intensity = dark > 0.15 ? 9000 * Math.min(1, dark * 1.4) : 0;
  }

  _updateEnvMap(dt, st) {
    this._envTimer -= dt;
    const key = `${Math.round(st.elevation * 60)}|${Math.round(this.weather.overcast * 20)}`;
    if (key === this._envKey || this._envTimer > 0) return;
    this._envKey = key;
    this._envTimer = 1.5;
    const target = this.pmrem.fromScene(this.envScene, 0, 0.1, 3000);
    this.envTarget?.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture;
  }
}
