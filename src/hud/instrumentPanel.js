import {
  speedBands,
  drawAirspeed,
  drawAttitude,
  drawAltimeter,
  drawHeading,
  drawVSI,
  drawTurnCoordinator,
  drawStatus,
} from './instruments.js';

/**
 * Renders the instrument set onto one canvas in either a single row (chase
 * HUD) or a classic six-pack (cockpit panel texture).
 */
export class InstrumentPanel {
  constructor(layout, scale = 1) {
    this.layout = layout;
    this.canvas = document.createElement('canvas');
    if (layout === 'row') {
      this.canvas.width = Math.round(980 * scale);
      this.canvas.height = Math.round(150 * scale);
    } else {
      this.canvas.width = Math.round(1024 * scale);
      this.canvas.height = Math.round(512 * scale);
    }
    this.ctx = this.canvas.getContext('2d');
    this.scale = scale;
    this.bands = null;
    this.typeId = null;
    this.turnRate = 0;
    this._lastHeading = null;
  }

  draw(s, controls, dt, bug = null) {
    if (this.typeId !== s.type.id) {
      this.bands = speedBands(s.type);
      this.typeId = s.type.id;
    }
    // Turn rate from heading change (wrapped), smoothed like a gyro.
    if (this._lastHeading !== null && dt > 0) {
      let d = s.heading - this._lastHeading;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.turnRate += (d / dt - this.turnRate) * Math.min(1, dt * 4);
    }
    this._lastHeading = s.heading;

    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (this.layout === 'row') {
      const r = H * 0.43;
      const gap = (W - H * 0.95) / 6;
      const cy = H / 2;
      const xs = [0, 1, 2, 3, 4, 5].map((i) => gap * (i + 0.5));
      drawAirspeed(ctx, xs[0], cy, r, s, this.bands);
      drawAttitude(ctx, xs[1], cy, r, s);
      drawAltimeter(ctx, xs[2], cy, r, s);
      drawTurnCoordinator(ctx, xs[3], cy, r, s, this.turnRate);
      drawHeading(ctx, xs[4], cy, r, s, bug);
      drawVSI(ctx, xs[5], cy, r, s);
      drawStatus(ctx, W - H * 0.9, H * 0.04, H * 0.85, H * 0.92, s, controls);
    } else {
      // Panel background with subtle texture.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#2a2d33');
      g.addColorStop(1, '#17191d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (i / 40) * H);
        ctx.lineTo(W, (i / 40) * H + 6);
        ctx.stroke();
      }
      const r = H * 0.205;
      const cols = [W * 0.12, W * 0.34, W * 0.56];
      const rows = [H * 0.27, H * 0.73];
      drawAirspeed(ctx, cols[0], rows[0], r, s, this.bands);
      drawAttitude(ctx, cols[1], rows[0], r, s);
      drawAltimeter(ctx, cols[2], rows[0], r, s);
      drawTurnCoordinator(ctx, cols[0], rows[1], r, s, this.turnRate);
      drawHeading(ctx, cols[1], rows[1], r, s, bug);
      drawVSI(ctx, cols[2], rows[1], r, s);
      drawStatus(ctx, W * 0.72, H * 0.06, W * 0.2, H * 0.88, s, controls);
      // Screws for a bit of tactile realism.
      ctx.fillStyle = '#0d0e10';
      for (const [sx, sy] of [[12, 12], [W - 12, 12], [12, H - 12], [W - 12, H - 12]]) {
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
