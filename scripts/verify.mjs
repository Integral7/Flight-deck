/**
 * Verification pass: runs a matrix of modes / qualities / aircraft / views in
 * headless Chromium, collects console errors + frame statistics, saves a
 * screenshot per case and runs a streaming leak test. Exits non-zero on any
 * page error. Usage: node scripts/verify.mjs [--preview] [caseName ...]
 */
import { createServer, preview } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const usePreview = process.argv.includes('--preview');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const executablePath = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean).find((p) => existsSync(p));

const CASES = [
  { name: 'menu', q: '' , wait: 10 },
  { name: 'free-low', q: 'mode=free&quality=low&time=10', wait: 14 },
  { name: 'free-medium', q: 'mode=free&quality=medium&time=15.5', wait: 14 },
  { name: 'free-high', q: 'mode=free&quality=high&time=16.5&weather=cloudy', wait: 16 },
  { name: 'cockpit', q: 'mode=free&quality=medium&time=12', wait: 12, eval: "__flightdeck.rig.setMode('cockpit')" },
  { name: 'landing-aerobatic', q: 'mode=landing&aircraft=aerobatic&quality=medium', wait: 12 },
  { name: 'timetrial-bush', q: 'mode=timetrial&aircraft=bush&quality=medium', wait: 12 },
  { name: 'scenic-golden', q: 'mode=scenic&quality=medium&time=17.3', wait: 14, eval: "__flightdeck.rig.setMode('flyby')" },
  { name: 'rain-night-high', q: 'mode=free&quality=high&time=21.5&weather=rain', wait: 14 },
  { name: 'fog-low', q: 'mode=free&quality=low&weather=fog&time=8', wait: 12 },
  { name: 'photo', q: 'mode=scenic&quality=medium&time=17.6', wait: 12, eval: "__flightdeck.input.pressed.push('photo')" },
  { name: 'pause', q: 'mode=free&quality=low', wait: 8, eval: "__flightdeck.input.pressed.push('pause')" },
  { name: 'map', q: 'mode=free&quality=low', wait: 14, eval: "__flightdeck.input.pressed.push('map')" },
  { name: 'touch-phone', q: 'mode=free&quality=low&touch=1', wait: 10, w: 844, h: 390, touch: true },
  { name: 'quality-switch', q: 'mode=free&quality=low', wait: 14, eval: "__flightdeck.applyQuality('high'); setTimeout(() => __flightdeck.applyQuality('medium'), 1500)" },
  { name: 'seed-switch', q: 'mode=free&quality=low', wait: 14, eval: "__flightdeck.setSeed(98765); __flightdeck.restart()" },
];

const server = usePreview
  ? await preview({ preview: { port: 5198, host: '127.0.0.1' }, logLevel: 'error' })
  : await createServer({ server: { port: 5198, host: '127.0.0.1' }, logLevel: 'error' });
if (!usePreview) await server.listen();
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
mkdirSync('screenshots/verify', { recursive: true });
const report = [];
let failed = false;

async function runCase(c) {
  const ctx = await browser.newContext({ viewport: { width: c.w || 960, height: c.h || 540 }, hasTouch: !!c.touch, isMobile: !!c.touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:5198/?adaptive=0&${c.q}`, { waitUntil: 'load' });
  await page.waitForTimeout((c.wait * 1000) / 2);
  if (c.eval) await page.evaluate(c.eval);
  await page.waitForTimeout((c.wait * 1000) / 2);
  await page.screenshot({ path: `screenshots/verify/${c.name}.png` });
  const stats = await page.evaluate(() => window.__flightdeck?.debugStats());
  await ctx.close();
  return { stats, errors };
}

for (const c of CASES) {
  if (only.length && !only.includes(c.name)) continue;
  const t0 = Date.now();
  const { stats, errors } = await runCase(c);
  const bad = errors.filter((e) => e.startsWith('[pageerror]') || e.startsWith('[error]'));
  if (bad.length) failed = true;
  const row = {
    case: c.name,
    ok: bad.length === 0,
    errors,
    mode: stats?.mode,
    quality: stats?.quality,
    calls: stats?.calls,
    ktris: Math.round((stats?.triangles ?? 0) / 1000),
    cpuMs: stats ? +(stats.sim + stats.world + stats.render).toFixed(2) : null,
    simMs: stats ? +stats.sim.toFixed(2) : null,
    worldMs: stats ? +stats.world.toFixed(2) : null,
    renderMs: stats ? +stats.render.toFixed(2) : null,
    chunks: stats?.chunks,
    crashed: stats?.crashed,
    secs: Math.round((Date.now() - t0) / 1000),
  };
  report.push(row);
  console.log(JSON.stringify(row));
}

// Streaming leak test: teleport repeatedly and make sure GPU geometry counts
// return to a steady level instead of growing.
if (!only.length || only.includes('leak')) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5198/?adaptive=0&mode=free&quality=low', { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await page.evaluate((k) => {
      const g = window.__flightdeck;
      const s = g.aircraft.state;
      g.aircraft.placeInAir({ x: s.pos.x + 6000 * (k % 2 ? 1 : -1) + 3000, y: 1500, z: s.pos.z + 5000, heading: s.heading, speed: 50 });
    }, i);
    await page.waitForTimeout(5000);
    samples.push(await page.evaluate(() => ({ geometries: window.__flightdeck.renderer.info().geometries, chunks: window.__flightdeck.chunks.chunks.size, airports: window.__flightdeck.airports.groups.size, tiles: window.__flightdeck.mapRenderer.tiles.size })));
  }
  await ctx.close();
  const geo = samples.map((s) => s.geometries);
  const growth = geo[geo.length - 1] - geo[2];
  const row = { case: 'leak', ok: errors.length === 0 && growth < 200, geometries: geo, chunks: samples.map((s) => s.chunks), airports: samples.map((s) => s.airports), tiles: samples.map((s) => s.tiles), errors };
  if (!row.ok) failed = true;
  report.push(row);
  console.log(JSON.stringify(row));
}

writeFileSync('screenshots/verify/report.json', JSON.stringify(report, null, 2));
await browser.close();
await (server.close ? server.close() : server.httpServer.close());
process.exit(failed ? 1 : 0);
