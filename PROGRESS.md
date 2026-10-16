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
| 3 | Chunked terrain + LOD + worker, water, forests | ⏳ next |
| 4 | Flight model + tests, aircraft meshes, chase camera | |
| 5 | Input: keyboard + touch — **PAUSE for user** | |
| 6 | Cockpit + instruments, HUD, minimap | |
| 7 | Sky, day/night, lighting polish | |
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

## Next
- M3: `src/terrain/chunk.js` (mesh arrays from heightfield, skirts, vertex colours),
  `chunkManager.js` (rings, LOD, worker pool, per-frame upload budget),
  `terrainWorker.js`, `water.js`, `vegetation.js` (instanced trees). Tests for chunk seams.

## Known issues
- Headless Chromium uses software WebGL, so FPS there (~20) is not representative.

## Commands
- `npm install`, `npm run dev`, `npm test`, `npm run lint`, `npm run build`
- `node scripts/smoke.mjs "autostart" 6 name` → headless check
