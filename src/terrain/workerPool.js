import { createTerrain } from './heightfield.js';
import { buildChunk, buildTrees } from './chunk.js';
import { buildMapTile } from './mapTile.js';

/**
 * A small pool of terrain workers with a priority queue. Falls back to
 * building on the main thread (time-sliced by the caller) if workers are
 * unavailable, e.g. in some locked-down browsers.
 */
export class TerrainWorkerPool {
  constructor(seed, size = 2) {
    this.seed = seed;
    this.queue = [];
    this.inFlight = new Map();
    this.nextJob = 1;
    this.workers = [];
    this.idle = [];
    this.onResult = null;
    /** Optional per-message-type handlers (e.g. map tiles) checked before onResult. */
    this.handlers = {};
    this.depth = 3; // max jobs queued per worker
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this._handle(w, e.data);
        w.onerror = (err) => {
          console.error('Terrain worker error', err.message || err);
        };
        w.postMessage({ type: 'init', seed });
        this.workers.push(w);
        this.idle.push(w);
      }
    } catch (err) {
      console.warn('Workers unavailable, building terrain on main thread', err);
      this.workers = [];
      this.idle = [];
      this.fallback = createTerrain(seed);
    }
  }

  get busy() {
    return this.inFlight.size + this.queue.length;
  }

  /** Queue a job; lower priority value runs first. */
  request(job) {
    job.job = this.nextJob++;
    this.queue.push(job);
    return job.job;
  }

  /** Drop queued (not yet started) jobs matching a predicate. */
  cancel(pred) {
    this.queue = this.queue.filter((j) => !pred(j));
  }

  /** Dispatch queued jobs to idle workers. Call once per frame. */
  pump() {
    if (!this.queue.length) return;
    for (const j of this.queue) if (j.chunk) j.priority = j.chunk.prio + (j.type === 'trees' ? 2 : 0);
    this.queue.sort((a, b) => a.priority - b.priority);
    if (this.fallback) {
      // Main-thread fallback: one job per frame keeps hitches bounded.
      const job = this.queue.shift();
      const data =
        job.type === 'chunk'
          ? buildChunk(this.fallback, job.cx, job.cz, job.lod)
          : job.type === 'maptile'
            ? buildMapTile(this.fallback, job.cx, job.cz, job.lod)
            : buildTrees(this.fallback, job.cx, job.cz, job.density);
      this._dispatch({ type: job.type, id: job.id, job: job.job, data });
      return;
    }
    // Keep a few jobs queued inside each worker so throughput does not depend
    // on the frame rate (workers process their messages back to back).
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      const job = this.queue.shift();
      w.__load = (w.__load || 0) + 1;
      if (w.__load < this.depth) this.idle.push(w);
      this.inFlight.set(job.job, job);
      // Post only cloneable fields (jobs may carry a chunk reference).
      w.postMessage({ type: job.type, id: job.id, job: job.job, cx: job.cx, cz: job.cz, lod: job.lod, density: job.density });
    }
  }

  _handle(worker, msg) {
    this.inFlight.delete(msg.job);
    worker.__load = Math.max(0, (worker.__load || 1) - 1);
    if (!this.idle.includes(worker)) this.idle.push(worker);
    this._dispatch(msg);
  }

  _dispatch(msg) {
    const h = this.handlers[msg.type];
    if (h) h(msg);
    else this.onResult?.(msg);
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.inFlight.clear();
  }
}
