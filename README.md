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
| C | Chase / cockpit camera |
| Mouse drag, wheel | Look around, zoom |
| R | Reset flight |
| Esc | Pause |
| H | Help |

Throttle down is **Z**, not Ctrl: Ctrl+W closes the browser tab.

Touch screens get an on-screen stick, throttle slider, rudder and buttons. A gamepad works too.
To try the touch UI with a mouse, add `?touch=1` to the URL.

## URL options

`?quality=low|medium|high`, `?aircraft=trainer|aerobatic|bush`, `?seed=1234`, `?touch=1`
