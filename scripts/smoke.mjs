/**
 * Headless smoke test: starts the Vite dev server, opens the game in
 * Chromium, collects console errors and frame statistics and saves
 * screenshots. Usage:
 *
 *   node scripts/smoke.mjs [query=...] [seconds] [name]
 *   node scripts/smoke.mjs "autostart&mode=free" 8 free
 *
 * Set CHROMIUM_PATH to use a specific browser binary. Software WebGL makes
 * absolute FPS meaningless here; use draw calls / triangles / sim timings.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const query = process.argv[2] ?? 'autostart';
const seconds = Number(process.argv[3] ?? 6);
const name = process.argv[4] ?? 'smoke';
const width = Number(process.env.W ?? 1280);
const height = Number(process.env.H ?? 720);

const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));

const server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:5199/?${query}`;

const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const touch = process.env.TOUCH === '1';
const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  if (process.env.VERBOSE) console.log(`console.${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.stack || e.message}`));

await page.goto(url, { waitUntil: 'load' });
const keys = process.env.KEYS ? process.env.KEYS.split(',') : [];
const start = Date.now();
for (const k of keys) {
  const [key, ms] = k.split(':');
  await page.keyboard.down(key);
  await page.waitForTimeout(Number(ms ?? 500));
  await page.keyboard.up(key);
}
const remaining = seconds * 1000 - (Date.now() - start);
if (process.env.EVAL) {
  // Optional script run halfway through, e.g. to switch camera for a screenshot.
  await page.waitForTimeout(Math.max(0, remaining / 2));
  await page.evaluate(process.env.EVAL);
  await page.waitForTimeout(Math.max(0, remaining / 2));
} else if (remaining > 0) await page.waitForTimeout(remaining);

mkdirSync('screenshots', { recursive: true });
await page.screenshot({ path: `screenshots/${name}.png` });
const stats = await page.evaluate(() => (window.__flightdeck?.debugStats ? window.__flightdeck.debugStats() : null));
console.log(JSON.stringify({ url, stats, errors }, null, 2));
await browser.close();
await server.close();
process.exit(errors.some((e) => e.startsWith('[pageerror]') || e.startsWith('[error]')) ? 1 : 0);
