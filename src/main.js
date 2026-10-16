import * as THREE from 'three';
import { Renderer } from './engine/renderer.js';
import { Settings, QUALITY_PRESETS } from './engine/settings.js';
import { FixedStepLoop, FrameStats } from './engine/loop.js';
import { createTerrain } from './terrain/heightfield.js';
import { ChunkManager } from './terrain/chunkManager.js';
import { CHUNK_SIZE } from './terrain/chunk.js';
import { Water } from './world/water.js';

/** Milestone-3 shell: streamed terrain with an auto-flying camera. */
function boot() {
  const params = new URLSearchParams(location.search);
  const app = document.getElementById('app');
  const settings = new Settings();
  if (params.get('quality') && QUALITY_PRESETS[params.get('quality')]) settings.set('quality', params.get('quality'));
  const preset = settings.preset;
  const renderer = new Renderer(app, preset);
  const scene = new THREE.Scene();
  const skyColor = new THREE.Color(0x9cc4e8);
  scene.background = skyColor;
  const far = preset.viewRadius * CHUNK_SIZE;
  scene.fog = new THREE.Fog(skyColor, far * 0.35, far * 0.98);
  const camera = new THREE.PerspectiveCamera(65, renderer.aspect, 1, far * 1.2);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x5a5a3a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
  sun.position.set(0.5, 0.8, 0.3).multiplyScalar(1000);
  scene.add(sun);

  const terrain = createTerrain(settings.resolveSeed());
  const chunks = new ChunkManager(scene, terrain, preset);
  const water = new Water(scene, far * 2.4);

  const fps = document.createElement('div');
  fps.className = 'fps';
  app.append(fps);

  const loop = new FixedStepLoop();
  const stats = new FrameStats();
  const home = terrain.nearestAirport(0, 0);
  const pos = new THREE.Vector3(home.x - 2500, 0, home.z - 2500);
  let heading = Math.PI / 4;
  const forward = new THREE.Vector3();
  let last = performance.now();
  let t = 0;
  const timing = { update: 0, render: 0 };

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    stats.push(dt * 1000);
    loop.advance(dt, (step) => {
      t += step;
      heading += step * 0.05 * Math.sin(t * 0.1);
      pos.x += Math.sin(heading) * 70 * step;
      pos.z += Math.cos(heading) * 70 * step;
    });
    const ground = Math.max(terrain.heightAt(pos.x, pos.z), 0);
    pos.y += (ground + 180 - pos.y) * Math.min(1, dt * 0.8);
    forward.set(Math.sin(heading), 0, Math.cos(heading));
    camera.position.copy(pos);
    camera.lookAt(pos.x + forward.x * 100, pos.y - 25, pos.z + forward.z * 100);
    const t0 = performance.now();
    chunks.update(camera.position, forward);
    const t1 = performance.now();
    water.update(dt, camera.position);
    camera.aspect = renderer.aspect;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const t2 = performance.now();
    timing.update = timing.update * 0.9 + (t1 - t0) * 0.1;
    timing.render = timing.render * 0.9 + (t2 - t1) * 0.1;
    const info = renderer.info();
    fps.textContent = `${stats.fps.toFixed(0)} fps · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris · ${chunks.stats.chunks} chunks · ${chunks.stats.pending} pending`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__flightdeck = {
    debugStats: () => ({ fps: stats.fps, ...timing, ...renderer.info(), ...chunks.stats, progress: chunks.loadProgress() }),
  };
}

boot();
