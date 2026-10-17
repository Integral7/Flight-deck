import * as THREE from 'three';
import { AIRCRAFT } from './types.js';
import { createFlightState, stepFlight, placeInAir, placeOnGround } from './flightModel.js';
import { createAircraftModel, animateAircraft } from './model.js';

/**
 * Glue between the pure flight model and the rendered model: owns the
 * state, keeps the previous step for render interpolation and drives the
 * mesh.
 */
export class Aircraft {
  constructor(scene, typeId) {
    this.scene = scene;
    this.prevPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.renderPos = new THREE.Vector3();
    this.renderQuat = new THREE.Quaternion();
    this._wreck = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, 0.3, 0.42, 'YXZ'));
    this.setType(typeId);
  }

  setType(typeId) {
    if (this.model) {
      this.scene.remove(this.model);
      this.model.traverse((o) => {
        o.geometry?.dispose();
      });
    }
    this.type = AIRCRAFT[typeId] || AIRCRAFT.trainer;
    this.state = createFlightState(this.type);
    this.model = createAircraftModel(this.type);
    this.scene.add(this.model);
  }

  placeInAir(opts) {
    placeInAir(this.state, opts);
    this._snap();
  }

  placeOnGround(opts, groundHeight) {
    placeOnGround(this.state, opts, groundHeight);
    this._snap();
  }

  _snap() {
    this.prevPos.copy(this.state.pos);
    this.prevQuat.copy(this.state.quat);
    this.renderPos.copy(this.state.pos);
    this.renderQuat.copy(this.state.quat);
  }

  step(controls, dt, env) {
    this.prevPos.copy(this.state.pos);
    this.prevQuat.copy(this.state.quat);
    stepFlight(this.state, controls, dt, env);
  }

  /** Interpolate between the last two sim steps and update the mesh. */
  render(alpha, controls, dt, time) {
    this.renderPos.lerpVectors(this.prevPos, this.state.pos, alpha);
    this.renderQuat.slerpQuaternions(this.prevQuat, this.state.quat, alpha);
    this.model.position.copy(this.renderPos);
    this.model.quaternion.copy(this.renderQuat);
    if (this.state.crashed) {
      // Wreck pose: nosed over, one wing dug in, settled into the ground.
      this.model.quaternion.multiply(this._wreck);
      this.model.position.y -= this.type.gearHeight * 0.6;
    }
    animateAircraft(this.model, this.state, controls, dt, time);
  }

  /** Hide parts that would block the view from the pilot's seat. */
  setCockpitView(on) {
    for (const o of this.model.userData.exterior) o.visible = !on;
  }

  drainEvents() {
    const ev = this.state.events.slice();
    this.state.events.length = 0;
    return ev;
  }
}
