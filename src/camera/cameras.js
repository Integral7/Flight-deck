import * as THREE from 'three';

const CHASE_DISTANCE = { trainer: 17, aerobatic: 14, bush: 21 };
export const EYE = {
  trainer: new THREE.Vector3(-0.32, 0.62, -1.15),
  aerobatic: new THREE.Vector3(0, 0.78, -0.75),
  bush: new THREE.Vector3(-0.38, 0.85, -1.45),
};

/**
 * Camera rig with chase and cockpit views. The chase camera is a critically
 * damped follow that ignores most of the aircraft's roll (keeps the horizon
 * readable) and stays above terrain. The cockpit camera rides the aircraft
 * frame with free head-look.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.distanceScale = 1;
    this.headYaw = 0;
    this.headPitch = 0;
    this.orbitYaw = 0; // chase-cam look-around
    this.orbitPitch = 0;
    this.shake = 0;
    this.typeId = 'trainer';
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._camUp = new THREE.Vector3(0, 1, 0);
    this._initialized = false;
    this._shakeT = 0;
  }

  setAircraft(typeId) {
    this.typeId = typeId;
    this._initialized = false;
  }

  toggle() {
    this.setMode(this.mode === 'chase' ? 'cockpit' : 'chase');
  }

  setMode(mode) {
    this.mode = mode;
    this.headYaw = 0;
    this.headPitch = 0;
    this._initialized = false;
  }

  reset() {
    this._initialized = false;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
  }

  /** Add camera shake (0..1), e.g. from touchdown or stall buffet. */
  bump(amount) {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} pos aircraft position (interpolated)
   * @param {THREE.Quaternion} quat aircraft orientation (interpolated)
   * @param {(x:number,z:number)=>number} groundAt terrain height function
   */
  update(dt, pos, quat, groundAt, look = { yaw: 0, pitch: 0 }) {
    const cam = this.camera;
    this._shakeT += dt;
    this.shake = Math.max(0, this.shake - dt * 1.6);

    if (this.mode === 'cockpit') {
      this.headYaw += (look.yaw * 1.9 - this.headYaw) * Math.min(1, dt * 8);
      this.headPitch += (look.pitch * 0.9 - this.headPitch) * Math.min(1, dt * 8);
      const eye = EYE[this.typeId] || EYE.trainer;
      cam.position.copy(eye).applyQuaternion(quat).add(pos);
      // Default eye line looks slightly down so the panel and horizon share the view.
      this._e.set(this.headPitch - 0.07, this.headYaw, 0, 'YXZ');
      this._q.setFromEuler(this._e);
      cam.quaternion.copy(quat).multiply(this._q);
      cam.near = 0.08;
      cam.fov = 72;
    } else {
      const dist = (CHASE_DISTANCE[this.typeId] || 16) * this.distanceScale;
      this._fwd.set(0, 0, -1).applyQuaternion(quat);
      this._up.set(0, 1, 0).applyQuaternion(quat);
      // Look-around orbit (from touch drag / mouse) around the aircraft.
      this.orbitYaw += (look.yaw * Math.PI * 0.95 - this.orbitYaw) * Math.min(1, dt * 6);
      this.orbitPitch += (look.pitch * 0.9 - this.orbitPitch) * Math.min(1, dt * 6);
      const flatLen = Math.hypot(this._fwd.x, this._fwd.z);
      const yaw = Math.atan2(this._fwd.x, -this._fwd.z) + this.orbitYaw;
      const pitch = Math.atan2(this._fwd.y, flatLen) * 0.6 - 0.16 - this.orbitPitch;
      this._desired.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      this._desired.multiplyScalar(dist).add(pos);
      this._desired.y += dist * 0.12;

      if (!this._initialized) {
        this._pos.copy(this._desired);
        this._initialized = true;
      }
      // Frame-rate independent exponential follow.
      const k = 1 - Math.exp(-dt * 5.5);
      this._pos.lerp(this._desired, k);
      // Keep the camera a fixed distance from the aircraft (no rubber-banding).
      this._tmp.subVectors(this._pos, pos);
      const d = this._tmp.length();
      if (d > 1e-3) this._pos.copy(pos).addScaledVector(this._tmp, Math.min(d, dist * 1.08) / d);
      const ground = groundAt(this._pos.x, this._pos.z);
      if (this._pos.y < ground + 2) this._pos.y = ground + 2;

      cam.position.copy(this._pos);
      this._look.copy(pos).addScaledVector(this._fwd, 8);
      // Follow a little of the aircraft's roll for a cinematic feel.
      this._camUp.lerp(this._tmp.set(0, 1, 0).lerp(this._up, 0.22).normalize(), Math.min(1, dt * 3));
      cam.up.copy(this._camUp);
      cam.lookAt(this._look);
      cam.near = 0.5;
      cam.fov = 62;
    }

    if (this.shake > 0.001) {
      const t = this._shakeT * 37;
      const a = this.shake * this.shake * (this.mode === 'cockpit' ? 0.012 : 0.03);
      cam.rotateX(Math.sin(t * 1.3) * a);
      cam.rotateY(Math.sin(t * 1.7 + 1) * a);
      cam.rotateZ(Math.sin(t * 0.9 + 2) * a * 0.5);
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}
