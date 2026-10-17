import { SEA_LEVEL } from '../terrain/heightfield.js';

/**
 * Free flight: airborne a few km from the home airport, pointed at it.
 * The HUD target follows the nearest airport.
 */
export class FreeFlightMode {
  constructor(game) {
    this.game = game;
    this.name = 'free';
    this.title = 'Free flight';
    this.invulnerable = false;
    this.target = null; // nearest airport, supplied by the game
  }

  start() {
    const g = this.game;
    const ap = g.home || { x: 0, z: 0, elevation: 0 };
    const a = g.findApproach(ap, 3500);
    const ground = Math.max(g.terrain.heightAt(a.x, a.z), SEA_LEVEL);
    const y = Math.max(ground + 400, a.maxH + 250);
    g.aircraft.placeInAir({ x: a.x, y, z: a.z, heading: a.heading, speed: g.aircraft.type.cruiseSpeed, throttle: 0.65 });
    g.resetControls(0.65);
  }

  restart() {
    this.start();
  }

  update() {}

  onEvent() {}

  info() {
    return null; // game shows nearest-airport info
  }

  dispose() {}
}
