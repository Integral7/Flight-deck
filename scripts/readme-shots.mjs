/**
 * Capture the README screenshots (slow: waits for terrain to stream in under
 * software rendering). Writes JPEGs to docs/images via screenshots/*.png.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const executablePath = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean).find((p) => existsSync(p));
const SHOTS = [
  { name: 'golden-hour', q: 'mode=scenic&time=17.25&weather=cloudy&quality=medium', eval: "__flightdeck.rig.setMode('chase'); __flightdeck.mode.onCameraChosen()", hideHud: false },
  { name: 'cockpit-final', q: 'mode=landing&time=11&weather=clear&quality=medium', eval: 'FINAL;' + "__flightdeck.rig.setMode('cockpit')" },
  { name: 'night-approach', q: 'mode=landing&time=21.8&weather=clear&quality=medium', eval: 'FINAL;' },
  { name: 'time-trial', q: 'mode=timetrial&time=14&weather=cloudy&quality=medium&aircraft=aerobatic' },
  { name: 'rain', q: 'mode=free&time=16&weather=rain&quality=medium&aircraft=bush' },
  { name: 'menu', q: 'time=17&quality=medium' },
];
const FINAL = `{const g=__flightdeck,m=g.mode,ap=m.airport,dir=m.dir;const ux=Math.sin(ap.heading)*dir,uz=Math.cos(ap.heading)*dir;const tx=ap.x-ux*ap.length/2,tz=ap.z-uz*ap.length/2;const d=650;const s=g.aircraft.state;g.aircraft.placeInAir({x:tx-ux*d,y:ap.elevation+Math.tan(3*Math.PI/180)*(d+300)+s.type.gearHeight,z:tz-uz*d,heading:Math.atan2(ux,-uz),speed:s.type.approachSpeed,throttle:0.3});s.gearPos=1;s.flaps=0.5;g.input.controls.throttle=0.3;g.input.controls.flaps=0.5;g.rig.reset();g.env3d.timeScale=0;}`;

const server = await createServer({ server: { port: 5197, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync('screenshots/readme', { recursive: true });
for (const s of SHOTS.filter((x) => !process.env.ONLY || process.env.ONLY.split(',').includes(x.name))) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:5197/?adaptive=0&${s.q}`, { waitUntil: 'load' });
  // Wait for loading to finish, then a little longer for trees and map tiles.
  await page.waitForFunction(() => window.__flightdeck && !window.__flightdeck.loading, null, { timeout: 240000 }).catch(() => {});
  if (s.eval) await page.evaluate(s.eval.replace('FINAL;', FINAL));
  await page.waitForTimeout(25000);
  await page.screenshot({ path: `screenshots/readme/${s.name}.png` });
  console.log('shot', s.name);
  await ctx.close();
}
await browser.close();
await server.close();
