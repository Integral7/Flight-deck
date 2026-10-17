import * as THREE from 'three';
import { InstrumentPanel } from '../hud/instrumentPanel.js';
import { EYE } from '../camera/cameras.js';

/**
 * 3D cockpit interior attached to the aircraft model: textured instrument
 * panel (live canvas), glareshield, window frame, yoke/stick and throttle
 * that move with the controls. Only visible in cockpit view.
 */
export class Cockpit {
  constructor(quality = 'medium') {
    this.panel = new InstrumentPanel('six', quality === 'low' ? 0.75 : 1);
    this.texture = new THREE.CanvasTexture(this.panel.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.group = null;
    this._accum = 0;
    this.refreshRate = quality === 'low' ? 15 : 30;
  }

  /** Build the interior for an aircraft type and parent it to the model. */
  attach(model, type) {
    if (this.group) {
      this.group.parent?.remove(this.group);
      this.group.traverse((o) => o.geometry?.dispose());
    }
    const eye = EYE[type.id] || EYE.trainer;
    const g = new THREE.Group();
    g.name = 'cockpit';
    // Slight emissive keeps the interior readable when the sun is behind it.
    const dark = new THREE.MeshStandardMaterial({ color: 0x3d4148, roughness: 0.85, metalness: 0.1, emissive: 0x1a1b1e });
    const trim = new THREE.MeshStandardMaterial({
      color: type.id === 'aerobatic' ? 0x2c3140 : 0x5a5248,
      roughness: 0.8,
      emissive: 0x1c1a17,
    });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: type.accent, roughness: 0.5 });
    const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

    const centreX = type.id === 'aerobatic' ? 0 : eye.x * 0.35;
    const panelW = type.id === 'aerobatic' ? 0.7 : 0.86;
    const panelH = panelW / 2;
    // Over-the-nose view of ~15 degrees: enough to keep the runway in sight
    // on a nose-up final approach.
    const panelZ = eye.z - 0.62;
    const panelTopY = eye.y - 0.24;

    // Instrument panel face (self-lit so it stays readable at night).
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(panelW, panelH),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }),
    );
    // Tilted slightly toward the pilot (top leans away), as in real aircraft.
    face.position.set(eye.x + (type.id === 'aerobatic' ? 0 : 0.06), panelTopY - panelH / 2, panelZ);
    face.rotation.x = -0.12;
    g.add(face);
    // Dash body behind the panel (front face clear of the tilted panel).
    const dash = box(1.7, 0.7, 0.24, dark);
    dash.position.set(centreX, panelTopY - 0.36, panelZ - 0.2);
    g.add(dash);
    const glare = box(1.75, 0.04, 0.2, trim);
    glare.position.set(centreX, panelTopY + 0.01, panelZ - 0.07);
    g.add(glare);
    // Nose cowling top seen beyond the glareshield, sloping away and down.
    const cowl = box(0.7, 0.04, 1.1, new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.7 })); // anti-glare paint
    cowl.position.set(0, panelTopY - 0.12, panelZ - 0.85);
    cowl.rotation.x = -0.12;
    g.add(cowl);
    const lip = box(1.75, 0.02, 0.03, accent);
    lip.position.set(centreX, panelTopY + 0.035, panelZ + 0.04);
    g.add(lip);

    // Window frame.
    if (type.id === 'aerobatic') {
      // Canopy bow and rail.
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.025, 6, 24, Math.PI), trim);
      bow.position.set(0, eye.y - 0.25, panelZ - 0.15);
      g.add(bow);
      for (const side of [-1, 1]) {
        const rail = box(0.06, 0.06, 2.2, trim);
        rail.position.set(side * 0.5, eye.y - 0.3, eye.z + 0.4);
        g.add(rail);
      }
    } else {
      const roofY = eye.y + 0.3;
      for (const side of [-1, 1]) {
        const x = centreX + side * 0.82;
        const pillar = box(0.06, 0.62, 0.06, trim);
        pillar.position.set(x, (panelTopY + roofY) / 2, panelZ - 0.08);
        pillar.rotation.x = -0.45;
        g.add(pillar);
        const doorPost = box(0.06, 0.62, 0.06, trim);
        doorPost.position.set(x, (panelTopY + roofY) / 2, eye.z + 0.45);
        g.add(doorPost);
        const sill = box(0.08, 0.06, 1.6, trim);
        sill.position.set(x, panelTopY - 0.02, eye.z - 0.2);
        g.add(sill);
      }
      const roof = box(1.8, 0.05, 1.3, dark);
      roof.position.set(centreX, roofY, eye.z - 0.15);
      g.add(roof);
      const header = box(1.75, 0.08, 0.08, trim);
      header.position.set(centreX, roofY - 0.02, panelZ - 0.22);
      g.add(header);
    }

    // Yoke (trainer / bush) or stick (aerobatic) and throttle.
    const controls = new THREE.Group();
    g.add(controls);
    if (type.id === 'aerobatic') {
      const stick = new THREE.Group();
      stick.position.set(0, eye.y - 0.95, eye.z - 0.3);
      const shaft = box(0.03, 0.42, 0.03, metal);
      shaft.position.y = 0.21;
      const grip = box(0.05, 0.12, 0.05, dark);
      grip.position.y = 0.46;
      stick.add(shaft, grip);
      g.add(stick);
      this.stick = stick;
      this.yoke = null;
    } else {
      const yoke = new THREE.Group();
      yoke.position.set(eye.x, panelTopY - panelH - 0.02, panelZ + 0.2);
      const shaft = box(0.035, 0.035, 0.3, metal);
      shaft.position.z = -0.15;
      const bar = box(0.34, 0.035, 0.035, dark);
      bar.position.y = 0.02;
      const hornL = box(0.04, 0.13, 0.04, dark);
      hornL.position.set(-0.17, 0.07, 0);
      const hornR = hornL.clone();
      hornR.position.x = 0.17;
      yoke.add(shaft, bar, hornL, hornR);
      g.add(yoke);
      this.yoke = yoke;
      this.stick = null;
    }
    const thr = new THREE.Group();
    thr.position.set(type.id === 'aerobatic' ? -0.38 : centreX + 0.08, panelTopY - panelH - 0.02, panelZ + 0.12);
    const rod = box(0.015, 0.015, 0.16, metal);
    rod.position.z = 0.08;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    knob.position.z = 0.16;
    thr.add(rod, knob);
    g.add(thr);
    this.throttle = thr;
    this.yokeBase = this.yoke ? this.yoke.position.z : 0;
    this.thrBase = thr.position.z;

    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });
    model.add(g);
    this.group = g;
    this.group.visible = false;
  }

  setVisible(v) {
    if (this.group) this.group.visible = v;
  }

  update(dt, state, controls, bug) {
    if (!this.group?.visible) return;
    if (this.yoke) {
      this.yoke.position.z = this.yokeBase + controls.pitch * 0.08;
      this.yoke.rotation.z = -controls.roll * 0.6;
    }
    if (this.stick) {
      this.stick.rotation.x = -controls.pitch * 0.3;
      this.stick.rotation.z = -controls.roll * 0.3;
    }
    this.throttle.position.z = this.thrBase - state.throttle * 0.1;
    this._accum += dt;
    if (this._accum >= 1 / this.refreshRate) {
      this.panel.draw(state, controls, this._accum, bug);
      this.texture.needsUpdate = true;
      this._accum = 0;
    }
  }
}
