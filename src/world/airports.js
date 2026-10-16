import * as THREE from 'three';
import { localToWorld, runwayNumber, PAPI_DISTANCE, papiLights } from '../modes/runway.js';

/**
 * Builds and streams airport scenery near the camera: textured runway with
 * markings and numbers, apron + taxiway, hangars, tower, windsock, edge /
 * threshold / approach lights (bright at night) and a working PAPI for both
 * runway ends.
 */

function runwayTexture(ap) {
  const W = 64;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  // Asphalt with subtle noise and tyre marks.
  ctx.fillStyle = '#2b2c2e';
  ctx.fillRect(0, 0, W, H);
  let s = Math.floor(ap.x * 7 + ap.z * 13) | 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2500; i++) {
    const g = 30 + rnd() * 25;
    ctx.fillStyle = `rgba(${g},${g},${g + 2},0.5)`;
    ctx.fillRect(rnd() * W, rnd() * H, 1, 1 + rnd() * 3);
  }
  ctx.fillStyle = 'rgba(10,10,10,0.35)';
  for (const end of [0, 1]) {
    const y0 = end ? H * 0.62 : H * 0.18;
    ctx.fillRect(W * 0.38, y0, W * 0.07, H * 0.2);
    ctx.fillRect(W * 0.55, y0, W * 0.07, H * 0.2);
  }
  const mPerPx = ap.length / H;
  const px = (m) => m / mPerPx;
  ctx.fillStyle = '#e9e9e4';
  // Edge lines.
  ctx.fillRect(1, 0, 2, H);
  ctx.fillRect(W - 3, 0, 2, H);
  // Centreline dashes (30 m on, 20 m off), skipping the threshold areas.
  for (let m = 110; m < ap.length - 110; m += 50) ctx.fillRect(W / 2 - 1, H - px(m + 30), 2, px(30));
  const drawEnd = (atTop, label) => {
    ctx.save();
    if (atTop) {
      ctx.translate(W, H);
      ctx.rotate(Math.PI);
    }
    // Threshold piano keys.
    ctx.fillStyle = '#e9e9e4';
    for (let k = 0; k < 8; k++) {
      const x = 5 + k * 6.6 + (k >= 4 ? 3 : 0);
      ctx.fillRect(x, H - px(36), 3.2, px(30));
    }
    // Runway number.
    ctx.font = `bold ${px(26)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(W / 2, H - px(62));
    ctx.scale(0.55, 1);
    ctx.fillText(label, 0, 0);
    ctx.restore();
    // Aiming point blocks at 300 m.
    ctx.fillRect(9, H - px(PAPI_DISTANCE + 25), 8, px(45));
    ctx.fillRect(W - 17, H - px(PAPI_DISTANCE + 25), 8, px(45));
    // Touchdown zone bars.
    for (const m of [150, 450]) {
      ctx.fillRect(10, H - px(m + 20), 3, px(20));
      ctx.fillRect(15, H - px(m + 20), 3, px(20));
      ctx.fillRect(W - 13, H - px(m + 20), 3, px(20));
      ctx.fillRect(W - 18, H - px(m + 20), 3, px(20));
    }
    ctx.restore();
  };
  drawEnd(false, runwayNumber(ap, 1));
  drawEnd(true, runwayNumber(ap, -1));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Quad in airport-local coordinates, `uv` along/across as given. */
function localQuad(ap, u0, u1, v0, v1, y, flipAcross = true) {
  const corners = [
    [u0, v0],
    [u0, v1],
    [u1, v0],
    [u1, v1],
  ];
  const pos = new Float32Array(12);
  const uv = new Float32Array(8);
  corners.forEach(([u, v], i) => {
    const w = localToWorld(ap, u, v);
    pos[i * 3] = w.x - ap.x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = w.z - ap.z;
    // Texture across is flipped so numbers read correctly to the pilot.
    uv[i * 2] = flipAcross ? (v1 - v) / (v1 - v0) : (v - v0) / (v1 - v0);
    uv[i * 2 + 1] = (u - u0) / (u1 - u0);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex([0, 2, 1, 2, 3, 1]);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) g.setIndex([0, 1, 2, 2, 1, 3]);
  g.computeVertexNormals();
  return g;
}

const shared = {};
function sharedAssets() {
  if (shared.ready) return shared;
  shared.ready = true;
  shared.concrete = new THREE.MeshStandardMaterial({ color: 0x8d8d88, roughness: 0.9 });
  shared.taxi = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.92 });
  shared.wall = new THREE.MeshStandardMaterial({ color: 0xc9c4b8, roughness: 0.8 });
  shared.roof = new THREE.MeshStandardMaterial({ color: 0x6b7c8c, roughness: 0.55, metalness: 0.4 });
  shared.door = new THREE.MeshStandardMaterial({ color: 0x4b5560, roughness: 0.6, metalness: 0.3 });
  shared.glass = new THREE.MeshStandardMaterial({ color: 0x1d3442, roughness: 0.1, metalness: 0.6, emissive: 0x000000 });
  shared.pole = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
  shared.sock = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.7, side: THREE.DoubleSide });
  shared.papiBox = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
  shared.hangar = new THREE.BoxGeometry(1, 1, 1);
  shared.roofGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
  shared.sockGeo = new THREE.ConeGeometry(0.45, 3.2, 10, 1, true).rotateZ(-Math.PI / 2).translate(1.6, 0, 0);
  // Lights are point sources: constant pixel size reads correctly at any range.
  shared.lightMat = new THREE.PointsMaterial({
    size: 3,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  shared.papiOn = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  shared.papiRed = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
  shared.papiGeo = new THREE.BoxGeometry(1.2, 0.9, 0.4);
  return shared;
}

function buildAirport(ap) {
  const A = sharedAssets();
  const g = new THREE.Group();
  g.name = 'airport ' + ap.name.code;
  g.position.set(ap.x, ap.elevation, ap.z);
  const L = ap.length;
  const Wd = ap.width;
  const hdg = ap.heading;

  const runwayMat = new THREE.MeshStandardMaterial({ map: runwayTexture(ap), roughness: 0.85 });
  const runway = new THREE.Mesh(localQuad(ap, -L / 2, L / 2, -Wd / 2, Wd / 2, 0.12), runwayMat);
  runway.receiveShadow = true;
  g.add(runway);
  // Paved overrun / blast pads in a lighter grey.
  for (const sgn of [-1, 1]) {
    const pad = new THREE.Mesh(localQuad(ap, sgn * L / 2, sgn * (L / 2 + 40), -Wd / 2, Wd / 2, 0.1, false), A.taxi);
    pad.receiveShadow = true;
    g.add(pad);
  }

  // Apron and taxiway on the +v side.
  const apron = new THREE.Mesh(localQuad(ap, -120, 120, Wd / 2 + 55, Wd / 2 + 130, 0.1, false), A.concrete);
  apron.receiveShadow = true;
  g.add(apron);
  for (const u of [-90, 90]) {
    const tw = new THREE.Mesh(localQuad(ap, u - 9, u + 9, Wd / 2 - 1, Wd / 2 + 56, 0.11, false), A.taxi);
    tw.receiveShadow = true;
    g.add(tw);
  }

  // Buildings: hangars with curved roofs, and a control tower.
  const place = (obj, u, v, y = 0) => {
    const w = localToWorld(ap, u, v);
    obj.position.set(w.x - ap.x, y, w.z - ap.z);
    obj.rotation.y = hdg;
    g.add(obj);
    return obj;
  };
  for (const [u, w, d] of [[-75, 34, 28], [-30, 30, 26], [40, 42, 32]]) {
    const hg = new THREE.Group();
    const body = new THREE.Mesh(A.hangar, A.wall);
    body.scale.set(d, 8, w);
    body.position.y = 4;
    const roof = new THREE.Mesh(A.roofGeo, A.roof);
    roof.scale.set(d, 9, w);
    roof.position.y = 8;
    const door = new THREE.Mesh(A.hangar, A.door);
    door.scale.set(d * 0.8, 7, 0.3);
    door.position.set(0, 3.5, -w / 2 - 0.1);
    for (const m of [body, roof, door]) {
      m.castShadow = true;
      m.receiveShadow = true;
      hg.add(m);
    }
    hg.rotation.y = Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(hg);
    place(holder, u, Wd / 2 + 130 + d / 2 + 4);
  }
  const tower = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 18, 10), A.wall);
  shaft.position.y = 9;
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 3.6, 4, 8), A.glass);
  cab.position.y = 20;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.6, 8), A.roof);
  cap.position.y = 22.3;
  for (const m of [shaft, cab, cap]) {
    m.castShadow = true;
    tower.add(m);
  }
  place(tower, 110, Wd / 2 + 150);

  // Windsock.
  const sock = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6), A.pole);
  pole.position.y = 3.5;
  const cone = new THREE.Mesh(A.sockGeo, A.sock);
  cone.position.y = 6.8;
  sock.add(pole, cone);
  place(sock, -L / 2 + 220, -Wd / 2 - 35);
  sock.rotation.y = 0;

  // Lights: edges (white), thresholds (green), ends (red), approach bars.
  const pts = [];
  const cols = [];
  const add = (u, v, y, c) => {
    const w = localToWorld(ap, u, v);
    pts.push(w.x - ap.x, y, w.z - ap.z);
    cols.push(...c);
  };
  const WHITE = [1, 0.95, 0.8];
  const GREEN = [0.2, 1, 0.4];
  const RED = [1, 0.15, 0.1];
  for (let u = -L / 2; u <= L / 2 + 0.1; u += 55) {
    add(u, -Wd / 2 - 1.5, 0.5, WHITE);
    add(u, Wd / 2 + 1.5, 0.5, WHITE);
  }
  for (let v = -Wd / 2; v <= Wd / 2 + 0.1; v += 4) {
    add(-L / 2, v, 0.5, GREEN);
    add(L / 2, v, 0.5, GREEN);
    add(-L / 2 - 2, v, 0.5, RED);
    add(L / 2 + 2, v, 0.5, RED);
  }
  for (const sgn of [-1, 1]) {
    for (let k = 1; k <= 8; k++) {
      const u = sgn * (L / 2 + 40 + k * 30);
      for (let v = -6; v <= 6; v += 3) add(u, v, 1.2, WHITE);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const lights = new THREE.Points(lg, A.lightMat);
  lights.renderOrder = 4;
  g.add(lights);

  // PAPI on the left of each landing direction, PAPI_DISTANCE past the threshold.
  const papis = [];
  for (const dir of [1, -1]) {
    const units = [];
    for (let i = 0; i < 4; i++) {
      // Outer unit furthest from the runway; left side = +v when dir = +1.
      const vSide = dir * (Wd / 2 + 15 + (3 - i) * 9);
      const u = dir * (-L / 2 + PAPI_DISTANCE);
      const box = new THREE.Mesh(A.papiGeo, A.papiRed);
      const w = localToWorld(ap, u, vSide);
      box.position.set(w.x - ap.x, 0.8, w.z - ap.z);
      box.rotation.y = hdg;
      g.add(box);
      units.push(box);
    }
    papis.push({ dir, units, pos: localToWorld(ap, dir * (-L / 2 + PAPI_DISTANCE), dir * (Wd / 2 + 30)) });
  }

  g.userData = { ap, sock, papis, runwayMat };
  return g;
}

export class AirportRenderer {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.groups = new Map();
    this._timer = 0;
  }

  setTerrain(terrain) {
    for (const g of this.groups.values()) this._dispose(g);
    this.groups.clear();
    this.terrain = terrain;
    this._timer = 0;
  }

  _dispose(g) {
    this.scene.remove(g);
    g.userData.runwayMat.map.dispose();
    g.userData.runwayMat.dispose();
    g.traverse((o) => {
      if (o.geometry && !Object.values(shared).includes(o.geometry)) o.geometry.dispose();
    });
  }

  /**
   * @param {THREE.Vector3} cam camera position
   * @param {number} range metres
   * @param {{night:number}} lighting
   * @param {{x:number,z:number}} wind
   */
  update(dt, cam, range, night, wind) {
    this._timer -= dt;
    if (this._timer <= 0) {
      this._timer = 1;
      const want = new Set();
      for (const ap of this.terrain.airportsNear(cam.x, cam.z, range)) {
        if (Math.hypot(ap.x - cam.x, ap.z - cam.z) > range) continue;
        want.add(ap.id);
        if (!this.groups.has(ap.id)) {
          const g = buildAirport(ap);
          this.scene.add(g);
          this.groups.set(ap.id, g);
        }
      }
      for (const [id, g] of this.groups) {
        if (!want.has(id)) {
          this._dispose(g);
          this.groups.delete(id);
        }
      }
    }
    const A = sharedAssets();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    A.lightMat.opacity = 0.12 + 0.88 * night;
    A.lightMat.size = (2 + 2.5 * night) * dpr;
    A.glass.emissive.setRGB(0.25 * night, 0.22 * night, 0.15 * night);
    const windAngle = Math.atan2(wind.x, wind.z);
    const windSpeed = Math.hypot(wind.x, wind.z);
    for (const g of this.groups.values()) {
      const { sock, papis, ap } = g.userData;
      // Windsock points downwind and droops in light wind.
      sock.children[1].rotation.set(0, windAngle - Math.PI / 2, -Math.max(0, 0.9 - windSpeed / 8));
      // PAPI colours from the viewer's angle above each unit.
      for (const p of papis) {
        const dist = Math.hypot(cam.x - p.pos.x, cam.z - p.pos.z);
        const angle = Math.atan2(cam.y - ap.elevation - 1, Math.max(dist, 1));
        const lights = papiLights(angle);
        p.units.forEach((u, i) => (u.material = lights[i] ? A.papiOn : A.papiRed));
      }
    }
  }
}
