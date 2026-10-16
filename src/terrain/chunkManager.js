import * as THREE from 'three';
import { CHUNK_SIZE, LOD_SEGMENTS } from './chunk.js';
import { TerrainWorkerPool } from './workerPool.js';
import { createTerrainMaterial } from './terrainMaterial.js';
import { Vegetation } from './vegetation.js';

/**
 * Streams terrain chunks in rings around the camera.
 *
 * - Every chunk within `viewRadius` gets a mesh; its LOD is picked from the
 *   3D distance to the camera (altitude counts, so high flight is cheap).
 * - Builds happen in workers; finished meshes are attached at most
 *   `chunkBuildsPerFrame` per frame to avoid upload hitches.
 * - A chunk keeps its old mesh until the replacement LOD arrives: no holes.
 * - Skirts on each chunk hide cracks between neighbouring LODs.
 */
export class ChunkManager {
  constructor(scene, terrain, preset) {
    this.scene = scene;
    this.terrain = terrain;
    this.preset = preset;
    this.root = new THREE.Group();
    this.root.name = 'terrain';
    scene.add(this.root);
    this.material = createTerrainMaterial();
    this.vegetation = new Vegetation();
    this.vegetation.setShadows(preset.name === 'high');
    this.chunks = new Map();
    this.ready = [];
    this.center = { cx: Infinity, cz: Infinity };
    this._createPool();
    this.stats = { chunks: 0, treeChunks: 0, pending: 0, triangles: 0 };
  }

  _createPool() {
    const cores = globalThis.navigator?.hardwareConcurrency || 4;
    const size = Math.max(1, Math.min(4, cores - 1, this.preset.name === 'low' ? 2 : 4));
    this.pool = new TerrainWorkerPool(this.terrain.seed, size);
    this.pool.onResult = (msg) => this.ready.push(msg);
  }

  static key(cx, cz) {
    return cx + ',' + cz;
  }

  lodFor(distChunks, current) {
    const t = this.preset.lodDistances;
    let lod = 3;
    for (let i = 0; i < t.length; i++) {
      if (distChunks < t[i]) {
        lod = i;
        break;
      }
    }
    // Hysteresis: only switch if we are clearly past the threshold.
    if (current !== undefined && current !== lod) {
      const edge = lod < current ? t[lod] : t[current];
      if (Math.abs(distChunks - edge) < 0.25) return current;
    }
    return Math.min(lod, LOD_SEGMENTS.length - 1);
  }

  /**
   * @param {THREE.Vector3} cam camera world position
   * @param {THREE.Vector3} forward camera forward (for build priority)
   */
  update(cam, forward) {
    const pr = this.preset;
    const ccx = Math.floor(cam.x / CHUNK_SIZE);
    const ccz = Math.floor(cam.z / CHUNK_SIZE);
    const ground = this.terrain.heightAt(cam.x, cam.z);
    const alt = Math.max(0, cam.y - Math.max(ground, 0));
    const R = pr.viewRadius;
    const seen = new Set();

    for (let dz = -R - 1; dz <= R + 1; dz++) {
      for (let dx = -R - 1; dx <= R + 1; dx++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const midX = (cx + 0.5) * CHUNK_SIZE;
        const midZ = (cz + 0.5) * CHUNK_SIZE;
        const flat = Math.hypot(midX - cam.x, midZ - cam.z) / CHUNK_SIZE;
        if (flat > R + 0.75) continue;
        const key = ChunkManager.key(cx, cz);
        seen.add(key);
        let c = this.chunks.get(key);
        if (!c) {
          c = { cx, cz, key, lod: -1, pendingLod: -1, mesh: null, trees: null, treesPending: false };
          this.chunks.set(key, c);
        }
        const dist = Math.hypot(flat, (alt / CHUNK_SIZE) * 0.7);
        const want = this.lodFor(dist, c.lod >= 0 ? c.lod : undefined);
        // Priority: missing meshes first, then nearer and in-front chunks.
        const dirX = (midX - cam.x) / (flat * CHUNK_SIZE + 1);
        const dirZ = (midZ - cam.z) / (flat * CHUNK_SIZE + 1);
        const facing = dirX * forward.x + dirZ * forward.z;
        c.prio = dist + (facing < -0.2 && flat > 1.5 ? 4 : 0) + (c.mesh ? 50 : 0);
        if (want !== c.lod && want !== c.pendingLod) {
          if (c.pendingLod >= 0) this.pool.cancel((j) => j.id === key && j.type === 'chunk');
          c.pendingLod = want;
          this.pool.request({ type: 'chunk', id: key, cx, cz, lod: want, priority: c.prio, chunk: c });
        }
        const wantTrees = flat <= pr.treeRadius + 0.5 && pr.treeDensity > 0;
        if (wantTrees && !c.trees && !c.treesPending) {
          c.treesPending = true;
          this.pool.request({ type: 'trees', id: key, cx, cz, density: pr.treeDensity, priority: c.prio + 2, chunk: c });
        } else if (!wantTrees && (c.trees || c.treesPending) && flat > pr.treeRadius + 1.2) {
          this._dropTrees(c);
        }
      }
    }

    // Unload chunks that left the ring.
    for (const [key, c] of this.chunks) {
      if (!seen.has(key)) this._unload(c);
    }

    this.pool.pump();
    this._attachReady();
    this.center.cx = ccx;
    this.center.cz = ccz;
    this.stats.chunks = this.chunks.size;
    let tc = 0;
    for (const c of this.chunks.values()) if (c.trees && c.trees.children.length) tc++;
    this.stats.treeChunks = tc;
    this.stats.pending = this.pool.busy;
  }

  _attachReady() {
    // While the game holds for loading, attach much more per frame.
    let budget = this.preset.chunkBuildsPerFrame * (this.boost ? 6 : 1);
    // Attach the most important results first (missing chunks before refinements).
    while (this.ready.length && budget > 0) {
      const msg = this.ready.shift();
      const c = this.chunks.get(msg.id);
      if (!c) continue;
      if (msg.type === 'chunk') {
        if (msg.data.lod !== c.pendingLod) continue;
        this._setMesh(c, msg.data);
        budget--;
      } else if (msg.type === 'trees') {
        if (!c.treesPending) continue;
        c.treesPending = false;
        if (msg.data.length) {
          c.trees = this.vegetation.createGroup(msg.data, c.cx * CHUNK_SIZE, c.cz * CHUNK_SIZE);
          this.root.add(c.trees);
        } else {
          c.trees = new THREE.Group();
        }
        budget -= 0.5;
      }
    }
  }

  _setMesh(c, d) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(d.indices, 1));
    const half = CHUNK_SIZE / 2;
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, d.minY, 0), new THREE.Vector3(CHUNK_SIZE, d.maxY, CHUNK_SIZE));
    const midY = (d.minY + d.maxY) / 2;
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(half, midY, half),
      Math.hypot(half, half, (d.maxY - d.minY) / 2),
    );
    if (c.mesh) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = geo;
    } else {
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.set(c.cx * CHUNK_SIZE, 0, c.cz * CHUNK_SIZE);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.name = 'chunk ' + c.key;
      this.root.add(mesh);
      c.mesh = mesh;
    }
    c.lod = d.lod;
    c.pendingLod = -1;
  }

  _dropTrees(c) {
    if (c.trees) {
      this.root.remove(c.trees);
      this.vegetation.disposeGroup(c.trees);
    }
    c.trees = null;
    if (c.treesPending) this.pool.cancel((j) => j.id === c.key && j.type === 'trees');
    c.treesPending = false;
  }

  _unload(c) {
    this.pool.cancel((j) => j.id === c.key);
    if (c.mesh) {
      this.root.remove(c.mesh);
      c.mesh.geometry.dispose();
    }
    this._dropTrees(c);
    this.chunks.delete(c.key);
  }

  /** True once every chunk near the camera has some mesh (used for loading screens). */
  isReadyAround(cam, radiusChunks = 2) {
    const ccx = Math.floor(cam.x / CHUNK_SIZE);
    const ccz = Math.floor(cam.z / CHUNK_SIZE);
    for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
      for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
        const c = this.chunks.get(ChunkManager.key(ccx + dx, ccz + dz));
        if (!c || !c.mesh) return false;
      }
    }
    return true;
  }

  /** Fraction of the current ring that has meshes. */
  loadProgress() {
    let have = 0;
    for (const c of this.chunks.values()) if (c.mesh) have++;
    return this.chunks.size ? have / this.chunks.size : 0;
  }

  applyQuality(preset) {
    const treesChanged = preset.treeDensity !== this.preset.treeDensity;
    this.preset = preset;
    this.vegetation.setShadows(preset.name === 'high');
    for (const c of this.chunks.values()) {
      if (treesChanged) this._dropTrees(c);
      else if (c.trees) c.trees.traverse((o) => o.isInstancedMesh && (o.castShadow = this.vegetation.castShadow));
    }
  }

  clear() {
    for (const c of [...this.chunks.values()]) this._unload(c);
    this.ready = [];
  }

  /** Switch to a new world seed. */
  setTerrain(terrain) {
    this.clear();
    this.pool.dispose();
    this.terrain = terrain;
    this._createPool();
  }

  dispose() {
    this.clear();
    this.pool.dispose();
    this.scene.remove(this.root);
    this.material.dispose();
  }
}
