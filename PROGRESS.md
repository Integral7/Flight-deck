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
| 7 | Sky, day/night, lighting polish | ✅ done |
| 8 | Weather: clouds, fog, rain | ✅ done |
| 9 | Airports + landing challenge — **PAUSE for user** | ✅ done (user said go) |
| 10 | Rings + time trial | ✅ done |
| 11 | Menu (incl. quality), scenic mode, photo mode | ✅ done |
| 12 | Headless run, error + frame-time fixes, screenshots | ✅ done |
| 13 | README incl. "How this was built" | ✅ done |

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

- M7: `src/world/dayNight.js` (pure: sun/moon direction from hours, keyframed palette by
  sun elevation, clock helpers), `sky.js` (gradient dome shader w/ sun disc+glow, moon,
  overcast tint; Points stars), `environment.js` (time cycle 36-min day, T = +1 h smooth,
  sun/moon key light with shadow following aircraft + shadow.intensity fade instead of
  toggling castShadow, hemisphere ambient, fog from palette+weather, exposure, PMREM
  env map from sky scene refreshed on change, nose landing light at night). Fixed the
  washed-out look: terrain palette is sRGB and is now converted to linear vertex colours.
  CSS vignette. `?time=HH` URL param. `tests/dayNight.test.js` (8). 100 tests green.

- M8: `src/world/weather.js` (presets clear/cloudy/overcast/rain/fog, 20 s smoothstep
  transitions, veering gusty wind, turbulence = weather + low-level + in-cloud, in-cloud
  visibility collapse), `clouds.js` (instanced camera-facing puffs from a canvas texture,
  deterministic clusters per 1.4 km cell gated by cover, wind drift, back-to-front sort
  4x/s, lit tops/dark bellies, fog), `rain.js` (LineSegments animated in the vertex shader,
  wrapped box around camera, streaks slant with apparent wind). Weather drives env
  overcast/visibility/light and the flight model's wind + turbulence. Y cycles weather,
  `?weather=` URL param, HUD shows time/weather/wind. `tests/weather.test.js` (8).
  108 tests green. Profiled (high, rain, SwiftShader): chunks 1.25 ms, hud 1.7 ms,
  env 0.25 ms, clouds 0.24 ms avg per frame.

- M9: `src/modes/runway.js` (pure: local/world frames, runway numbers, thresholds,
  into-wind end selection, ILS-style guidance, PAPI, `scoreLanding` 0–100 + grade),
  `src/world/airports.js` (streamed scenery: canvas-textured runway with numbers, piano
  keys, aiming/TDZ marks; overruns, apron, taxiways, hangars, tower, wind-driven windsock,
  fixed-pixel-size edge/threshold/end/approach lights brighter at night, working PAPI
  for both ends), `src/modes/{freeFlight,landing}.js` (mode interface: start/restart/
  update/onEvent/info/approach/target/invulnerable), landing mode picks into-wind end
  with terrain clearance, spawns 3.6 km out on the 3° path, tracks touchdown/bounces/
  rollout, scores and saves best per aircraft. HUD approach widget (GS + LOC diamonds).
  Pause menu switches mode + aircraft. `?mode=landing`. Cockpit dash lowered (~15°
  over-nose view). Fixed: arcade side-grip acted on the ground (parked aircraft drifted
  in crosswind) — now air-only + static friction when parked. `tests/landing.test.js`
  (14, incl. an autopilot flying the glide path to a scored landing). 123 tests green.

- M10: `src/modes/course.js` (pure: seeded 12-ring course with S-curves, terrain
  clearance, two-way gradient limiting ≤16 %, ring normals; `ringCrossing` plane-crossing
  hit/miss with interpolation; time formatting/penalties), `src/world/rings.js` (torus
  gates, pulsing next ring, finish ring white), `src/hud/targetMarker.js` (screen-space
  reticle/edge arrow with distance), `src/modes/timeTrial.js` (clock starts at ring 1,
  +5 s per miss, best per aircraft+course in localStorage, Next course). Minimap shows
  rings. Pause menu has Time trial. `tests/course.test.js` (11, incl. an autopilot
  threading a full course in the trainer). 134 tests green.

- M11: `src/hud/menu.js` (start menu over a scenic backdrop: mode + aircraft cards with
  stat bars, Low/Medium/High quality, auto-resolution, seed classic/random/custom, time,
  day-cycle speed, weather, invert pitch, FPS), `src/aircraft/autopilot.js` (terrain-
  following with look-ahead, heading search to route around terrain it can't out-climb),
  `src/modes/scenic.js` (invulnerable, autopilot hands back/forth, auto camera cuts,
  minimal HUD), `src/modes/photo.js` (frozen sim, orbit cam, FOV/EV/time sliders,
  vignette toggle, PNG capture), camera rig fly-by + photo modes, `game.js` rewritten:
  runtime `applyQuality` (renderer recreate on AA change + PMREM rebuild, shadows,
  view distance, clouds, rain, trees), `setSeed` world regeneration, loading gate
  (holds sim until nearby chunks exist), FPS readout, adaptive resolution, pause menu
  with quality + main menu. Worker pool now queues up to 3 jobs per worker (was 1 per
  frame — loading was frame-rate bound). Fixed `setAircraft` calling a removed method.
  Tests: autopilot (5), settings (8), menu (2). 149 tests green.

- M12: `scripts/verify.mjs` (16-case matrix in headless Chromium + streaming leak test:
  all pass, no console errors/warnings, geometry/chunk counts flat over 10 teleports),
  far tree tier (sparse low-poly, 1 draw/chunk) removes the forest cut-off line, crash
  wreck pose + smoke/fire (`src/world/effects.js`), chunk results attached by priority
  under a per-frame time budget, ring scan throttled, trees ~40 % fewer triangles, rain
  near-camera fade, `?adaptive=0`, debug stats triangle key clash fixed.
  Measured (medium, software GL): ~115k tris / 120 draws on Low, ~300k / 250 on Medium.
- M13: README rewritten (features, Windows run steps, controls, modes, settings, layout,
  "How this was built"), screenshots in `docs/images/` from `scripts/readme-shots.mjs`.

## Next
- All 13 milestones are complete. Possible follow-ups: audio (engine, wind, rain),
  tree collision, more airport variety, multiplayer ghosts for the time trial.

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
