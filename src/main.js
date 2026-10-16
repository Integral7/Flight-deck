import * as THREE from 'three';
import { Renderer } from './engine/renderer.js';
import { Settings } from './engine/settings.js';
import { FixedStepLoop, FrameStats } from './engine/loop.js';

/** Milestone-1 shell: renderer, loop and a placeholder scene. */
function boot() {
  const app = document.getElementById('app');
  const settings = new Settings();
  const renderer = new Renderer(app, settings.preset);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb7e0);
  const camera = new THREE.PerspectiveCamera(65, renderer.aspect, 0.5, 20000);
  camera.position.set(0, 20, 60);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x4a5a3a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(100, 200, 50);
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x4f7a3a }),
  );
  scene.add(ground);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial({ color: 0xf6c453 }));
  cube.position.y = 15;
  scene.add(cube);

  const fps = document.createElement('div');
  fps.className = 'fps';
  app.append(fps);

  const loop = new FixedStepLoop();
  const stats = new FrameStats();
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    stats.push(dt * 1000);
    loop.advance(dt, (step) => {
      cube.rotation.y += step;
    });
    camera.aspect = renderer.aspect;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    fps.textContent = `${stats.fps.toFixed(0)} fps`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
