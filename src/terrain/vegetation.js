import * as THREE from 'three';
import { TREE_STRIDE } from './chunk.js';

/**
 * Low-poly instanced trees. Each terrain chunk near the camera owns two
 * InstancedMeshes (conifers and broadleaf) that share geometry and material.
 */
function colorize(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function merge(input) {
  const geos = input.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// Open-ended cylinders/cones: caps and cone bases are never visible, so
// leaving them out saves ~40 % of the triangles per tree.
function coniferGeometry() {
  const trunk = colorize(new THREE.CylinderGeometry(0.35, 0.5, 4, 5, 1, true).translate(0, 2, 0), 0x4a3524);
  const low = colorize(new THREE.ConeGeometry(3.2, 7, 7, 1, true).translate(0, 6.5, 0), 0x2d5a2f);
  const high = colorize(new THREE.ConeGeometry(2.3, 6, 6, 1, true).translate(0, 10, 0), 0x346a36);
  return merge([trunk, low, high]);
}

function broadleafGeometry() {
  const trunk = colorize(new THREE.CylinderGeometry(0.35, 0.55, 4.5, 5, 1, true).translate(0, 2.25, 0), 0x55402b);
  const crown = colorize(new THREE.IcosahedronGeometry(3.7, 0).scale(1, 0.9, 1).translate(0, 7.2, 0), 0x4f7c2d);
  return merge([trunk, crown]);
}

/** Distant tier: a handful of triangles per tree, no trunk. */
function farConifer() {
  return merge([colorize(new THREE.ConeGeometry(3, 12, 5, 1, true).translate(0, 7, 0), 0x2f5d31)]);
}
function farBroadleaf() {
  return merge([colorize(new THREE.OctahedronGeometry(3.8, 0).scale(1, 1.1, 1).translate(0, 7, 0), 0x4f7c2e)]);
}

export class Vegetation {
  constructor() {
    this.geometries = [coniferGeometry(), broadleafGeometry()];
    this.farGeometries = [farConifer(), farBroadleaf()];
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    this.castShadow = false;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** Create the tree group for one chunk from worker data. */
  createGroup(data, originX, originZ, tier = 'near') {
    const geos = tier === 'far' ? this.farGeometries : this.geometries;
    const group = new THREE.Group();
    group.position.set(originX, 0, originZ);
    const count = data.length / TREE_STRIDE;
    const counts = [0, 0];
    const far = tier === 'far';
    // Far tier: every tree uses one mesh (one draw call per chunk).
    const kindOf = (i) => (far ? 0 : data[i * TREE_STRIDE + 5]);
    for (let i = 0; i < count; i++) counts[kindOf(i)]++;
    for (let kind = 0; kind < 2; kind++) {
      if (!counts[kind]) continue;
      const mesh = new THREE.InstancedMesh(geos[kind], this.material, counts[kind]);
      mesh.castShadow = tier === 'near' && this.castShadow;
      mesh.receiveShadow = false;
      let k = 0;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < count; i++) {
        const o = i * TREE_STRIDE;
        if (kindOf(i) !== kind) continue;
        const sc = data[o + 3];
        this._p.set(data[o], data[o + 1], data[o + 2]);
        this._q.setFromAxisAngle(this._up, data[o + 4]);
        this._s.set(sc, sc * (0.85 + 0.3 * ((i * 0.618) % 1)), sc);
        this._m.compose(this._p, this._q, this._s);
        mesh.setMatrixAt(k, this._m);
        const tint = 0.8 + 0.4 * ((i * 0.7548) % 1);
        const broad = far && data[o + 5] === 1;
        this._c.setRGB(tint * (broad ? 1.25 : 1), tint * (broad ? 1.2 : 0.95 + 0.1 * ((i * 0.31) % 1)), tint * 0.9);
        mesh.setColorAt(k, this._c);
        minY = Math.min(minY, data[o + 1]);
        maxY = Math.max(maxY, data[o + 1] + 14 * sc);
        k++;
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Cheap, conservative bounds instead of iterating every instance again.
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(256, (minY + maxY) / 2, 256), 370 + (maxY - minY) / 2);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    group.updateMatrixWorld(true);
    return group;
  }

  disposeGroup(group) {
    for (const m of group.children) m.dispose?.();
  }

  setShadows(on) {
    this.castShadow = on;
  }
}
