import * as THREE from 'three';

/**
 * Renders a time-trial course: glowing torus gates oriented along the
 * course. The next gate pulses gold, the one after is dimmer, later gates
 * are faint and passed gates disappear. The finish gate is chequered white.
 */
export class RingRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'rings';
    scene.add(this.group);
    this.geometry = new THREE.TorusGeometry(1, 0.1, 10, 48);
    this.discGeometry = new THREE.CircleGeometry(0.93, 40);
    this.meshes = [];
    this.time = 0;
    this._z = new THREE.Vector3(0, 0, 1);
    this._n = new THREE.Vector3();
  }

  setCourse(course) {
    this.clear();
    course.forEach((r, i) => {
      const last = i === course.length - 1;
      const mat = new THREE.MeshStandardMaterial({
        color: last ? 0xffffff : 0xf6c453,
        emissive: last ? 0xffffff : 0xf6a623,
        emissiveIntensity: 0.4,
        roughness: 0.35,
        metalness: 0.2,
        transparent: true,
      });
      const ring = new THREE.Mesh(this.geometry, mat);
      ring.position.set(r.x, r.y, r.z);
      ring.quaternion.setFromUnitVectors(this._z, this._n.set(r.nx, r.ny, r.nz));
      ring.scale.setScalar(r.radius);
      ring.castShadow = true;
      const disc = new THREE.Mesh(
        this.discGeometry,
        new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      );
      ring.add(disc);
      this.group.add(ring);
      this.meshes.push({ ring, disc, mat });
    });
  }

  clear() {
    for (const m of this.meshes) {
      m.mat.dispose();
      m.disc.material.dispose();
      this.group.remove(m.ring);
    }
    this.meshes = [];
  }

  /** @param {number} next index of the next gate (meshes before it are hidden) */
  update(dt, next) {
    this.time += dt;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
    this.meshes.forEach((m, i) => {
      m.ring.visible = i >= next;
      if (i < next) return;
      const k = i - next;
      m.mat.opacity = k === 0 ? 1 : k === 1 ? 0.85 : 0.45;
      m.mat.emissiveIntensity = k === 0 ? 1.2 + pulse * 1.5 : k === 1 ? 0.6 : 0.25;
      m.disc.material.opacity = k === 0 ? 0.06 + pulse * 0.05 : 0;
    });
  }
}
