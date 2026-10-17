import { MAP_LEVELS } from '../terrain/mapTile.js';

const TAU = Math.PI * 2;

/**
 * Tile-cached terrain map. Tiles are rasterised in the terrain workers and
 * cached as canvases; drawing a view is just a handful of drawImage calls,
 * so both the rotating minimap and the large map are cheap every frame.
 */
export class MapRenderer {
  constructor(pool, terrain) {
    this.tiles = new Map();
    this.inFlight = 0;
    this.setSource(pool, terrain);
  }

  setSource(pool, terrain) {
    this.pool = pool;
    this.terrain = terrain;
    this.tiles.clear();
    this.inFlight = 0;
    pool.handlers.maptile = (msg) => this._onTile(msg);
  }

  _onTile(msg) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const t = this.tiles.get(msg.id);
    if (!t) return;
    const { px } = MAP_LEVELS[t.level];
    const c = document.createElement('canvas');
    c.width = c.height = px;
    c.getContext('2d').putImageData(new ImageData(msg.data, px, px), 0, 0);
    t.canvas = c;
    t.pending = false;
  }

  _tile(level, tx, tz, allowRequest) {
    const key = `${level}:${tx},${tz}`;
    let t = this.tiles.get(key);
    if (!t) {
      if (!allowRequest || this.inFlight >= 3) return null;
      t = { level, tx, tz, canvas: null, pending: true, used: 0 };
      this.tiles.set(key, t);
      this.inFlight++;
      // Map tiles are small (~10 ms); the large map is user-requested so it jumps the queue.
      this.pool.request({ type: 'maptile', id: key, cx: tx, cz: tz, lod: level, priority: level === 1 ? -5 : 0.5 });
    }
    t.used = performance.now();
    return t;
  }

  /**
   * Draw terrain centred on (cx, cz). `rotation` rotates the map so the
   * aircraft heading points up (0 = north up). `scale` is pixels per metre.
   */
  drawTerrain(ctx, level, cx, cz, rotation, scale, w, h) {
    const { tile } = MAP_LEVELS[level];
    const radius = Math.hypot(w, h) / 2 / scale;
    const i0 = Math.floor((cx - radius) / tile);
    const i1 = Math.floor((cx + radius) / tile);
    const j0 = Math.floor((cz - radius) / tile);
    const j1 = Math.floor((cz + radius) / tile);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rotation);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cz);
    ctx.imageSmoothingEnabled = true;
    // Request nearest tiles first.
    const list = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) list.push([i, j, Math.hypot((i + 0.5) * tile - cx, (j + 0.5) * tile - cz)]);
    list.sort((a, b) => a[2] - b[2]);
    for (const [i, j] of list) {
      const t = this._tile(level, i, j, true);
      if (t?.canvas) ctx.drawImage(t.canvas, i * tile, j * tile, tile + 1 / scale, tile + 1 / scale);
      else if (level === 0) {
        // Fall back to the coarser level while the fine tile streams in.
        const { tile: T1 } = MAP_LEVELS[1];
        const p = this._tile(1, Math.floor((i * tile) / T1), Math.floor((j * tile) / T1), false);
        if (p?.canvas) {
          const sx = (((i * tile) % T1) + T1) % T1;
          const sz = (((j * tile) % T1) + T1) % T1;
          const k = p.canvas.width / T1;
          ctx.drawImage(p.canvas, sx * k, sz * k, tile * k, tile * k, i * tile, j * tile, tile, tile);
        }
      }
    }
    ctx.restore();
    this._evict();
  }

  _evict() {
    if (this.tiles.size < 600) return;
    const now = performance.now();
    for (const [k, t] of this.tiles) if (!t.pending && now - t.used > 20000) this.tiles.delete(k);
  }
}

/** Draw an airport runway symbol in world space (call inside a transformed ctx). */
function worldToScreen(x, z, cx, cz, rotation, scale, w, h) {
  const dx = (x - cx) * scale;
  const dz = (z - cz) * scale;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return [w / 2 + dx * c - dz * s, h / 2 + dx * s + dz * c];
}

/**
 * The always-on circular minimap (heading-up) in the HUD corner.
 */
export class Minimap {
  constructor(container, mapRenderer) {
    this.map = mapRenderer;
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.canvas = document.createElement('canvas');
    this.el.append(this.canvas);
    this.label = document.createElement('div');
    this.label.className = 'minimap-label';
    this.el.append(this.label);
    container.append(this.el);
    this.ctx = this.canvas.getContext('2d');
    this.range = 3500; // metres from centre to edge
    this._t = 0;
  }

  setVisible(v) {
    this.el.style.display = v ? '' : 'none';
  }

  /**
   * @param {{x:number,z:number,heading:number}} plane
   * @param {{airports:Array, target?:{x:number,z:number,label?:string}, rings?:Array}} world
   */
  update(dt, plane, world) {
    this._t += dt;
    if (this._t < 1 / 20) return; // 20 Hz is plenty
    this._t = 0;
    const size = this.el.clientWidth || 180;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(size * dpr)) {
      this.canvas.width = this.canvas.height = Math.round(size * dpr);
    }
    const ctx = this.ctx;
    const W = this.canvas.width;
    const scale = W / 2 / this.range;
    const rot = -plane.heading;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 1, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#20384a';
    ctx.fillRect(0, 0, W, W);
    this.map.drawTerrain(ctx, 0, plane.x, plane.z, rot, scale, W, W);
    drawOverlays(ctx, world, plane.x, plane.z, rot, scale, W, W, dpr, false);
    // Range ring.
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 4, 0, TAU);
    ctx.stroke();
    ctx.restore();
    drawPlaneIcon(ctx, W / 2, W / 2, 0, 9 * dpr);
    // North marker on the rim.
    const nx = W / 2 + Math.sin(rot) * (W / 2 - 11 * dpr);
    const ny = W / 2 - Math.cos(rot) * (W / 2 - 11 * dpr);
    ctx.fillStyle = '#0b1220';
    ctx.beginPath();
    ctx.arc(nx, ny, 8 * dpr, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f6c453';
    ctx.font = `800 ${10 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);
    if (world.target) {
      const d = Math.hypot(world.target.x - plane.x, world.target.z - plane.z);
      this.label.textContent = `${world.target.label || 'Target'} · ${(d / 1852).toFixed(1)} nm`;
    } else this.label.textContent = '';
  }
}

export function drawPlaneIcon(ctx, x, y, rot, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = '#f6c453';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = size * 0.15;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.18, -size * 0.3);
  ctx.lineTo(size, size * 0.05);
  ctx.lineTo(size, size * 0.28);
  ctx.lineTo(size * 0.18, size * 0.1);
  ctx.lineTo(size * 0.12, size * 0.65);
  ctx.lineTo(size * 0.42, size * 0.85);
  ctx.lineTo(size * 0.42, size);
  ctx.lineTo(0, size * 0.9);
  ctx.lineTo(-size * 0.42, size);
  ctx.lineTo(-size * 0.42, size * 0.85);
  ctx.lineTo(-size * 0.12, size * 0.65);
  ctx.lineTo(-size * 0.18, size * 0.1);
  ctx.lineTo(-size, size * 0.28);
  ctx.lineTo(-size, size * 0.05);
  ctx.lineTo(-size * 0.18, -size * 0.3);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

/** Airports, rings and target marker, shared by minimap and large map. */
export function drawOverlays(ctx, world, cx, cz, rot, scale, w, h, dpr, labels) {
  for (const ap of world.airports || []) {
    const half = ap.length / 2;
    const dx = Math.sin(ap.heading) * half;
    const dz = Math.cos(ap.heading) * half;
    const [x0, y0] = worldToScreen(ap.x - dx, ap.z - dz, cx, cz, rot, scale, w, h);
    const [x1, y1] = worldToScreen(ap.x + dx, ap.z + dz, cx, cz, rot, scale, w, h);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = Math.max(4 * dpr, ap.width * scale * 1.6);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = ap.active ? '#5fd3ff' : '#f2f2f2';
    ctx.lineWidth = Math.max(2 * dpr, ap.width * scale);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    if (labels) {
      const [lx, ly] = worldToScreen(ap.x, ap.z, cx, cz, rot, scale, w, h);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3 * dpr;
      ctx.font = `700 ${11 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const text = `${ap.name.code} ${ap.name.full}`;
      ctx.strokeText(text, lx + 10 * dpr, ly);
      ctx.fillText(text, lx + 10 * dpr, ly);
    }
  }
  const rings = world.rings || [];
  rings.forEach((r, i) => {
    const [x, y] = worldToScreen(r.x, r.z, cx, cz, rot, scale, w, h);
    ctx.strokeStyle = r.done ? 'rgba(255,255,255,0.25)' : r.next ? '#f6c453' : 'rgba(246,196,83,0.6)';
    ctx.lineWidth = (r.next ? 3 : 2) * dpr;
    ctx.beginPath();
    ctx.arc(x, y, (r.next ? 6 : 4) * dpr, 0, TAU);
    ctx.stroke();
    if (labels && !r.done) {
      ctx.fillStyle = '#f6c453';
      ctx.font = `700 ${10 * dpr}px system-ui, sans-serif`;
      ctx.fillText(String(i + 1), x + 8 * dpr, y);
    }
  });
  if (world.target) {
    const [x, y] = worldToScreen(world.target.x, world.target.z, cx, cz, rot, scale, w, h);
    const m = 8 * dpr;
    const cxs = Math.max(m, Math.min(w - m, x));
    const cys = Math.max(m, Math.min(h - m, y));
    ctx.fillStyle = '#5fd3ff';
    ctx.beginPath();
    ctx.arc(cxs, cys, 4 * dpr, 0, TAU);
    ctx.fill();
  }
}

/**
 * Full-screen map (M key): north up, larger range, airport names.
 */
export class LargeMap {
  constructor(container, mapRenderer) {
    this.map = mapRenderer;
    this.el = document.createElement('div');
    this.el.className = 'large-map panel ui-layer';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="lm-head"><b>Map</b><span class="muted">M to close · wheel to zoom</span></div>`;
    this.canvas = document.createElement('canvas');
    this.el.append(this.canvas);
    this.scaleEl = document.createElement('div');
    this.scaleEl.className = 'lm-scale';
    this.el.append(this.scaleEl);
    container.append(this.el);
    this.ctx = this.canvas.getContext('2d');
    this.range = 12000;
    this.el.addEventListener('wheel', (e) => {
      this.range = Math.max(3000, Math.min(40000, this.range * (e.deltaY > 0 ? 1.15 : 0.87)));
      e.preventDefault();
    });
  }

  get open() {
    return !this.el.hidden;
  }

  toggle() {
    this.el.hidden = !this.el.hidden;
  }

  update(plane, world) {
    if (this.el.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const W = Math.max(64, Math.round(rect.width * dpr));
    const H = Math.max(64, Math.round(rect.height * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const ctx = this.ctx;
    const scale = Math.min(W, H) / 2 / this.range;
    ctx.fillStyle = '#1c3344';
    ctx.fillRect(0, 0, W, H);
    const level = this.range > 7000 ? 1 : 0;
    this.map.drawTerrain(ctx, level, plane.x, plane.z, 0, scale, W, H);
    drawOverlays(ctx, world, plane.x, plane.z, 0, scale, W, H, dpr, true);
    drawPlaneIcon(ctx, W / 2, H / 2, plane.heading, 11 * dpr);
    // Scale bar.
    const km = this.range > 20000 ? 10 : this.range > 8000 ? 5 : 2;
    this.scaleEl.innerHTML = `<i style="width:${(km * 1000 * scale) / dpr}px"></i>${km} km`;
  }
}
