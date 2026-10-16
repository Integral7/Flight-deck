/**
 * Dev tool: render a top-down colour map of the terrain to a PNG and print
 * statistics. Usage: node scripts/terrain-map.mjs [seed] [sizeMetres] [px] [out.png]
 */
import { createTerrain, BIOME } from '../src/terrain/heightfield.js';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const seed = Number(process.argv[2] ?? 1337);
const size = Number(process.argv[3] ?? 40000);
const px = Number(process.argv[4] ?? 400);
const outPath = process.argv[5] ?? 'screenshots/terrain-map.png';

const t = createTerrain(seed);
const colors = {
  [BIOME.WATER]: [40, 90, 150],
  [BIOME.SAND]: [210, 195, 140],
  [BIOME.GRASS]: [100, 150, 70],
  [BIOME.FOREST]: [40, 90, 45],
  [BIOME.ROCK]: [120, 110, 100],
  [BIOME.SNOW]: [240, 240, 245],
  [BIOME.RUNWAY]: [255, 60, 60],
};
const img = Buffer.alloc(px * px * 3);
const counts = {};
let minH = Infinity;
let maxH = -Infinity;
const t0 = performance.now();
const n = [0, 1, 0];
for (let j = 0; j < px; j++) {
  for (let i = 0; i < px; i++) {
    const x = (i / px - 0.5) * size;
    const z = (j / px - 0.5) * size;
    t.normalAt(x, z, n, 4);
    const s = t.sample(x, z);
    const b = t.biome(s, 1 - n[1], x, z);
    counts[b] = (counts[b] || 0) + 1;
    minH = Math.min(minH, s.height);
    maxH = Math.max(maxH, s.height);
    const shade = 0.75 + 0.25 * (n[0] * -0.6 + n[1] * 0.6 + n[2] * -0.5);
    const c = colors[b];
    const o = (j * px + i) * 3;
    img[o] = Math.min(255, c[0] * shade);
    img[o + 1] = Math.min(255, c[1] * shade);
    img[o + 2] = Math.min(255, c[2] * shade);
  }
}
const ms = performance.now() - t0;
const airports = t.airportsNear(0, 0, size / 2);
for (const ap of airports) {
  const i = Math.round((ap.x / size + 0.5) * px);
  const j = Math.round((ap.z / size + 0.5) * px);
  for (let a = -3; a <= 3; a++)
    for (let b = -3; b <= 3; b++) {
      const o = ((j + b) * px + (i + a)) * 3;
      if (o >= 0 && o < img.length) img.set([255, 40, 200], o);
    }
}

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const crcTable = Array.from({ length: 256 }, (_, k) => {
    let c = k;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
writeFileSync(outPath, png(px, px, img));
const total = px * px;
const names = Object.fromEntries(Object.entries(BIOME).map(([k, v]) => [v, k]));
console.log({
  seed,
  minH: minH.toFixed(1),
  maxH: maxH.toFixed(1),
  usPerSample: ((ms * 1000) / total / 5).toFixed(2),
  airports: airports.length,
  home: t.airportForCell(0, 0),
  biomes: Object.fromEntries(Object.entries(counts).map(([k, v]) => [names[k], ((v / total) * 100).toFixed(1) + '%'])),
});
