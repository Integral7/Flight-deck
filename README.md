# Flight Deck

Fly a small aircraft over an endless, procedurally generated landscape in your browser.
Built with Vite and Three.js.

> Work in progress — see [PROGRESS.md](PROGRESS.md) for the current milestone.

## Run it

Requires **Node.js 20.19 or newer** (Node 22 LTS recommended) and a WebGL 2 browser.

### Windows (PowerShell or Command Prompt)

```powershell
git clone https://github.com/Integral7/Flight-deck.git
cd Flight-deck
git checkout claude/stoic-johnson-0i522r
npm install
npm run dev
```

Then open <http://localhost:5173> in Chrome, Edge or Firefox.

### macOS / Linux

Same commands in a terminal.

### Other scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm test` | Run the Vitest suite (flight model, terrain, chunks, input) |
| `npm run lint` | ESLint |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build on <http://localhost:4173> |

## Controls

| Key | Action |
|---|---|
| W / S or ↑ / ↓ | Pitch (W = nose down, like pushing a stick) |
| A / D or ← / → | Roll |
| Q / E | Rudder |
| Shift / Z | Throttle up / down (1–9, 0 set 10 %–100 %) |
| B or Space | Brakes |
| G | Landing gear (Vortex A-7 only) |
| V | Flaps |
| C | Camera: chase → cockpit → fly-by |
| P | Photo mode |
| Mouse drag, wheel | Look around, zoom |
| M | Large map (wheel zooms) |
| T | Time of day +1 hour |
| Y | Cycle weather (clear → scattered → overcast → rain → fog) |
| U | Hide / show HUD |
| R | Reset flight |
| Enter | Retry after a crash or a landing result |
| Esc | Pause menu (switch mode and aircraft here) |
| H | Help |

Throttle down is **Z**, not Ctrl: Ctrl+W closes the browser tab.

Touch screens get an on-screen stick, throttle slider, rudder and buttons. A gamepad works too.
To try the touch UI with a mouse, add `?touch=1` to the URL.

## Menu and settings

The start menu picks the **mode**, **aircraft** and settings:

- **Graphics quality: Low / Medium / High.** Low is meant for laptops with integrated graphics
  (no shadows, shorter view distance, fewer trees, clouds and raindrops, no antialiasing);
  High is for gaming GPUs. You can also change it from the pause menu at any time.
  "Lower resolution automatically" drops the render resolution a little when the frame rate dips.
- **World:** the classic world (seed 1337), a random world every flight, or a custom seed.
- Time of day, day/night cycle speed, weather, invert pitch, FPS counter.

Settings are remembered in your browser.

## Modes

- **Free flight** – start near your home airport and explore.
- **Landing challenge** – start on a 3° final approach. The approach panel shows glide slope and
  centreline guidance (fly toward the magenta diamonds), the PAPI lights beside the runway show two
  white / two red when you are on the glide path. You are scored out of 100 on touchdown rate,
  centreline, touchdown zone, wings level and stopping on the runway; bounces cost points.
  Best scores are saved per aircraft.

- **Time trial** – twelve rings on a seeded course; the clock starts at the first ring, a missed
  ring costs 5 seconds. Best times are saved per aircraft and course. "Next course" generates another.
- **Scenic** – no crashes, minimal HUD, an autopilot that wanders over the landscape and steers around
  mountains it can't climb over, and automatic cinematic camera cuts. Touch the controls to fly
  yourself; the autopilot takes back over after 6 seconds hands-off.

**Photo mode** (P, any mode) freezes time and gives you an orbit camera (drag / wheel) with sliders
for field of view, exposure and time of day, and saves a PNG.

Switch modes, aircraft and quality from the pause menu (Esc) or go back to the main menu.

## URL options

Adding `?mode=…` (or `?autostart`) skips the menu.

`?mode=free|landing|timetrial|scenic`, `?aircraft=trainer|aerobatic|bush`, `?quality=low|medium|high`, `?seed=1234`,
`?time=17.5` (hour of day), `?weather=clear|cloudy|overcast|rain|fog`, `?touch=1`
