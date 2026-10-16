/**
 * Terrain build worker. Receives build jobs and returns typed arrays as
 * transferables so nothing is copied back to the main thread.
 */
import { createTerrain } from './heightfield.js';
import { buildChunk, buildTrees } from './chunk.js';

let terrain = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    terrain = createTerrain(msg.seed);
    return;
  }
  if (!terrain) return;
  if (msg.type === 'chunk') {
    const c = buildChunk(terrain, msg.cx, msg.cz, msg.lod);
    self.postMessage({ type: 'chunk', id: msg.id, job: msg.job, data: c }, [
      c.positions.buffer,
      c.normals.buffer,
      c.colors.buffer,
      c.indices.buffer,
    ]);
  } else if (msg.type === 'trees') {
    const trees = buildTrees(terrain, msg.cx, msg.cz, msg.density);
    self.postMessage({ type: 'trees', id: msg.id, job: msg.job, data: trees }, [trees.buffer]);
  }
};
