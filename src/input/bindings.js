/**
 * Keyboard bindings use `KeyboardEvent.code` so they follow physical key
 * positions on any layout (AZERTY players get the same WASD shape).
 *
 * Note: Ctrl is deliberately NOT used for throttle - Ctrl+W closes the
 * browser tab while you are pitching down. Throttle down is Z (or -).
 */
export const AXIS_KEYS = {
  pitchDown: ['KeyW', 'ArrowUp'],
  pitchUp: ['KeyS', 'ArrowDown'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleUp: ['ShiftLeft', 'ShiftRight', 'Equal', 'NumpadAdd', 'PageUp'],
  throttleDown: ['KeyZ', 'Minus', 'NumpadSubtract', 'PageDown'],
  brake: ['KeyB', 'Space'],
};

export const ACTION_KEYS = {
  gear: ['KeyG'],
  flaps: ['KeyV'],
  camera: ['KeyC'],
  map: ['KeyM'],
  photo: ['KeyP'],
  time: ['KeyT'],
  weather: ['KeyY'],
  reset: ['KeyR', 'Backspace'],
  pause: ['Escape'],
  help: ['KeyH', 'F1'],
  hud: ['KeyU'],
  confirm: ['Enter', 'NumpadEnter'],
  fps: ['F3'],
};

/** Human-readable control list for help screens and the README. */
export const CONTROL_HELP = [
  ['W / S  or  ↑ / ↓', 'Pitch (W = nose down)'],
  ['A / D  or  ← / →', 'Roll'],
  ['Q / E', 'Rudder (yaw)'],
  ['Shift / Z', 'Throttle up / down'],
  ['1 – 9, 0', 'Throttle 10 % – 90 %, 100 %'],
  ['B or Space', 'Wheel brakes (hold)'],
  ['G', 'Landing gear (Vortex A-7)'],
  ['V', 'Flaps: up / half / full'],
  ['C', 'Camera: chase / cockpit / fly-by'],
  ['Mouse drag', 'Look around   ·   Wheel: zoom'],
  ['M', 'Large map'],
  ['T / Y', 'Time of day +1 h / cycle weather'],
  ['P', 'Photo mode'],
  ['U', 'Hide HUD'],
  ['R', 'Reset flight'],
  ['Esc', 'Pause menu'],
  ['H', 'Help'],
];
