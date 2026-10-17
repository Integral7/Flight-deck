import './style.css';
import { Game } from './game.js';

function boot() {
  const app = document.getElementById('app');
  try {
    const game = new Game(app, new URLSearchParams(location.search));
    window.__flightdeck = game;
  } catch (err) {
    console.error(err);
    const div = document.createElement('div');
    div.className = 'fatal';
    div.innerHTML = `<div><h1>Flight Deck could not start</h1><p>${String(err.message || err)}</p><p>WebGL 2 is required. Try updating your browser or graphics drivers.</p></div>`;
    app.append(div);
  }
}

boot();
