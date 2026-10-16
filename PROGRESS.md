# Flight Deck — build progress

This file is updated after every milestone so work can be resumed in a fresh session.
Branch: `claude/stoic-johnson-0i522r`

## Agreed scope (summary)
Vite + Three.js flight game. Infinite streamed procedural world with a fixed default
seed (1337) and a random-seed option. Cockpit with working instruments, chase cam,
keyboard + touch, terrain (mountains, rivers, forests), day/night, weather (clouds,
fog, rain), airports with landing challenge, ring time trial, minimap, photo mode,
three aircraft, scenic mode, Low/Medium/High quality setting in the menu.
Tests (Vitest) for flight model and terrain. README with "How this was built".

**Process rules from the user**
- Pause for go-ahead after milestone 5 and after milestone 9 (give summary + exact
  Windows commands to run the app).
- Update this file, commit and push after every milestone; also push large WIP chunks.

## Milestones
| # | Milestone | Status |
|---|-----------|--------|
| 1 | Scaffold: Vite, Three.js, Vitest, ESLint, loop, empty scene | ✅ done |
| 2 | Noise + heightfield, terrain tests | ✅ done |
| 3 | Chunked terrain + LOD + worker, water, forests | ✅ done |
| 4 | Flight model + tests, aircraft meshes, chase camera | ✅ done |
| 5 | Input: keyboard + touch — **PAUSE for user** | ✅ done (user said go) |
| 6 | Cockpit + instruments, HUD, minimap | ✅ done |
| 7 | Sky, day/night, lighting polish | ⏳ next |
| 8 | Weather: clouds, fog, rain | |
| 9 | Airports + landing challenge — **PAUSE for user** | |
| 10 | Rings + time trial | |
| 11 | Menu (incl. quality), scenic mode, photo mode | |
| 12 | Headless run, error + frame-time fixes, screenshots | |
| 13 | README incl. "How this was built" | |

## Done so far
- M1: `package.json` (three 0.186, vite 8, vitest 5, eslint 10), `vite.config.js`
  (also holds Vitest config), `eslint.config.js`, `src/engine/{settings,loop,renderer}.js`,
  placeholder scene in `src/main.js`, `tests/loop.test.js`.
- `scripts/smoke.mjs`: starts Vite, opens headless Chromium (SwiftShader), prints
  console errors + `window.__flightdeck.debugStats()`, writes `screenshots/<name>.png`.
- Quality presets (low/medium/high) defined in `src/engine/settings.js`.

- M2: `src/engine/random.js` (mulberry32, hash2, simplex, fbm, soft-crest ridged),
  `src/terrain/heightfield.js` — `createTerrain(seed)` with `sample/heightAt/normalAt/
  biome/forestDensity/airportForCell/airportsNear/nearestAirport`. Rivers are carved
  inside the heightfield (zero-contour of a noise field, distance = |n|/|grad n|), airports
  are flattened pads (one per 7 km cell, flatness-checked). `tests/noise.test.js`,
  `tests/terrain.test.js` (29 tests total, all green).
- `scripts/terrain-map.mjs [seed] [size] [px] [out]` renders a biome map PNG + stats.

- M3: `src/terrain/chunk.js` (pure: `buildChunk` grid+skirts+normals+blended vertex
  colours, `buildTrees` jittered-grid scatter), `terrainWorker.js` + `workerPool.js`
  (priority queue, re-prioritised each frame, main-thread fallback), `chunkManager.js`
  (512 m chunks, 4 LODs [64,32,16,8 segs], 3D-distance LOD with hysteresis, keeps old
  mesh until new LOD arrives, per-frame attach budget), `terrainMaterial.js` (shader
  detail noise), `vegetation.js` (instanced conifer/broadleaf), `src/world/water.js`
  (camera-following plane, two-layer scrolling normal map). Renderer uses reversed depth
  when EXT_clip_control exists. `tests/chunk.test.js` (seams, LOD cracks vs skirts,
  winding, trees). 39 tests green.
- M4: `src/aircraft/types.js` (Skylark T-1 trainer, Vortex A-7 aerobatic w/ retractable
  gear, Kodiak STOL bush plane), `flightModel.js` (pure: lift/drag/thrust/gravity/side-grip
  forces, rate-commanded rotation with weathervane stability + 1 g auto-trim, stall with
  wing drop, ground effect, flaps, gear, ground roll/brakes/steering, touchdown + crash
  classification, airframe strike probes, wind/turbulence, invulnerable flag for scenic),
  `model.js` (procedural meshes, animated surfaces/prop/gear/strobe), `aircraft.js`
  (render interpolation), `src/camera/cameras.js` (chase + cockpit), `src/input/{bindings,
  input}.js` (keyboard, mouse look, gamepad), `src/game.js` (Game class, spawn picks the
  approach with lowest terrain). `scripts/tune-flight.mjs` prints the flight envelope.
  `tests/flightModel.test.js` (29 tests). 68 tests total, green.
- Controls: W/S pitch (W = nose down), A/D roll, Q/E yaw, Shift/Z throttle (no Ctrl:
  Ctrl+W closes the tab), digits set throttle, B/Space brakes, G gear, V flaps, C camera,
  R reset.

- M5: `src/input/touch.js` (pointer-event stick with dead zone + expo, throttle slider,
  rudder/brake hold buttons, action buttons, drag-to-look; auto-enables on coarse pointer
  or first touch; `?touch=1` forces it), `src/hud/overlay.js` (toasts, banner, modal),
  `src/hud/flightStrip.js` (temporary text HUD), pause/help/crash/restart flow in
  `game.js`. `tests/input.test.js` (12 tests). 80 tests total, green. Production build +
  worker verified with `PREVIEW=1 node scripts/smoke.mjs`. README has run instructions.

- M6: `src/hud/instruments.js` (canvas ASI w/ colour arcs from aero data, attitude,
  altimeter, turn coordinator + slip ball, heading w/ bug, VSI, status column; pure needle
  mappings), `instrumentPanel.js` (row layout for chase HUD, six-pack for cockpit),
  `src/cockpit/cockpit.js` (3D interior parented to the model: CanvasTexture panel,
  glareshield, frame, yoke/stick + throttle animated), `src/hud/warnings.js` (STALL,
  PULL UP via 2–8 s path probe, SINK RATE, GEAR UP, OVERSPEED, BANK ANGLE),
  `src/terrain/mapTile.js` + worker 'maptile' jobs, `src/hud/minimap.js` (tile cache,
  heading-up circular minimap, large north-up map on M with labels + zoom),
  `src/hud/hud.js`. `tests/hud.test.js` (12). 92 tests total, green.
- `scripts/smoke.mjs` also supports `EVAL=` (run JS mid-way), `PRINT=` (dump expression),
  `PREVIEW=1`, `TOUCH=1`, `KEYS=KeyW:500,...`.

## Next
- M7: `src/world/sky.js` (sky dome shader, sun/moon, stars), `dayNight.js` (sun path,
  light colours, fog colour, exposure, env map for water), lighting polish (colour
  grading, shadows following aircraft), night lights (runway later).

## Known issues
- Headless Chromium uses software WebGL, so FPS there (~5) is not representative.
  CPU per frame measured: chunk update ~0.9 ms, render submit ~3 ms (medium).
- Visible line where instanced trees stop (tree radius). Polish idea: far tree tier
  with low-poly/billboard trees at reduced density (M12).
- Colours look washed out; lighting/tone tuning planned for M7.
- Crashed aircraft has no wreck visual yet (idea: smoke particles + tilted model, M12).
- In cockpit view the exterior glass/fuselage is hidden; a proper interior comes in M6.

## Commands
- `npm install`, `npm run dev`, `npm test`, `npm run lint`, `npm run build`
- `node scripts/smoke.mjs "autostart" 6 name` → headless check
