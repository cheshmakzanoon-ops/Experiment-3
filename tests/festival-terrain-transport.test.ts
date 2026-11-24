import { getEventListeners } from 'node:events';
import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TERRAIN_BUDGETS,
  TerrainStreamer,
  type TerrainBudget,
} from '../src/rendering/open-world/terrain.ts';
import type {
  FromTileWorker,
  TileMeshData,
  TileRequest,
  ToTileWorker,
} from '../src/workers/open-world-protocol.ts';

function tileData(request: TileRequest): TileMeshData {
  const vertices = (request.res + 1) ** 2;
  const normals = new Float32Array(vertices * 3);
  for (let i = 0; i < vertices; i++) normals[i * 3 + 1] = 1;
  return {
    type: 'tile',
    id: request.id,
    heights: new Float32Array(vertices),
    normals,
    splat: new Float32Array(vertices * 4),
    shade: new Float32Array(vertices * 4),
    trees: new Float32Array(),
    minY: 0,
    maxY: 0,
    ms: 1,
  };
}

class TileWorkerStub extends EventTarget {
  readonly attempts: ToTileWorker[] = [];
  readonly pending = new Map<number, TileRequest>();
  failTilePosts = 0;
  failCancelPosts = 0;

  postMessage(message: ToTileWorker) {
    this.attempts.push(message);
    if (message.type === 'tile') {
      if (this.failTilePosts > 0) {
        this.failTilePosts--;
        throw new Error('Tile request transport unavailable');
      }
      this.pending.set(message.id, message);
    } else {
      if (this.failCancelPosts > 0) {
        this.failCancelPosts--;
        throw new Error('Tile cancellation transport unavailable');
      }
      this.pending.delete(message.id);
    }
  }

  get requests() {
    return this.attempts.filter((message) => message.type === 'tile');
  }

  get cancellations() {
    return this.attempts.filter((message) => message.type === 'cancel');
  }

  reply(request: TileRequest, message: FromTileWorker = tileData(request)) {
    this.pending.delete(request.id);
    this.dispatchEvent(new MessageEvent('message', { data: message }));
  }
}

const streamers: TerrainStreamer[] = [];
afterEach(() => {
  for (const terrain of streamers.splice(0)) terrain.dispose();
  vi.restoreAllMocks();
});

function fixture(budget: TerrainBudget = { ...TERRAIN_BUDGETS.low, maxTiles: 21 }) {
  const worker = new TileWorkerStub();
  const terrain = new TerrainStreamer(worker as unknown as Worker, budget);
  streamers.push(terrain);
  const camera = new T.PerspectiveCamera();
  const move = (x: number) => {
    camera.position.set(x, 150, 900);
    camera.updateMatrixWorld();
  };
  move(1200);
  const receive = getEventListeners(worker, 'message')[0] as (
    event: MessageEvent<FromTileWorker>,
  ) => void;
  const update = () => terrain.update(camera);
  const loadRoot = () => {
    update();
    worker.reply([...worker.pending.values()][0]);
    update();
  };
  return { worker, terrain, move, receive, update, loadRoot };
}

function expectDetached(worker: TileWorkerStub) {
  for (const type of ['message', 'error', 'messageerror'])
    expect(getEventListeners(worker, type)).toHaveLength(0);
}

describe('terrain worker request ownership', () => {
  it('rolls back rejected root and child sends and retries with fresh request IDs', () => {
    const f = fixture();
    f.worker.failTilePosts = 1;
    expect(f.update).not.toThrow();
    const rejectedRoot = f.worker.requests[0];
    expect(f.worker.pending.size).toBe(0);
    expect(f.terrain.stats.requested).toBe(0);

    f.update();
    const root = [...f.worker.pending.values()][0];
    expect(root.id).not.toBe(rejectedRoot.id);
    f.worker.reply(rejectedRoot);
    expect(f.terrain.stats.built).toBe(0);
    f.worker.reply(root);
    expect(f.terrain.stats.built).toBe(1);

    f.worker.failTilePosts = 1;
    expect(f.update).not.toThrow();
    const rejectedChild = f.worker.requests.at(-1)!;
    expect(f.worker.pending.size).toBe(0);
    expect(f.terrain.stats.requested).toBe(1);
    f.update();
    expect(f.worker.pending.size).toBe(TERRAIN_BUDGETS.low.inFlight);
    expect(f.terrain.stats.requested).toBe(1 + TERRAIN_BUDGETS.low.inFlight);
    expect([...f.worker.pending.values()][0]).toEqual({
      ...rejectedChild,
      id: rejectedChild.id + 1,
    });
    f.worker.reply(rejectedChild);
    f.update();
    expect(f.worker.pending.size).toBe(TERRAIN_BUDGETS.low.inFlight);
    expect(f.terrain.stats.built).toBe(1);
  });

  it('retries per-tile errors and ignores duplicate errors and late replies without releasing another slot', () => {
    const f = fixture();
    f.loadRoot();
    const failed = [...f.worker.pending.values()][0];
    const error: FromTileWorker = { type: 'error', id: failed.id, message: 'Tile build failed' };
    f.worker.reply(failed, error);
    f.update();
    const retried = [...f.worker.pending.values()].find(
      (request) => request.x0 === failed.x0 && request.z0 === failed.z0,
    )!;
    expect(retried.id).not.toBe(failed.id);
    expect(f.worker.pending.size).toBe(TERRAIN_BUDGETS.low.inFlight);
    f.worker.reply(failed, error);
    f.worker.reply(failed);
    f.update();
    expect(f.worker.pending.size).toBe(TERRAIN_BUDGETS.low.inFlight);
    expect(f.terrain.stats.built).toBe(1);

    f.worker.reply(retried);
    f.worker.reply(retried);
    f.update();
    expect(f.terrain.stats.built).toBe(2);
    expect(f.terrain.root.children).toHaveLength(2);
    expect(f.worker.pending.size).toBe(TERRAIN_BUDGETS.low.inFlight);
  });

  it('retires every stale request when cancellation throws and ignores their late replies', () => {
    const f = fixture();
    f.loadRoot();
    const stale = [...f.worker.pending.values()];
    f.worker.failCancelPosts = Infinity;
    f.move(80000);
    expect(f.update).not.toThrow();
    expect(f.worker.cancellations.map((message) => message.id).sort((a, b) => a - b)).toEqual(
      stale.map((request) => request.id).sort((a, b) => a - b),
    );

    const attemptsBeforeReturn = f.worker.requests.length;
    f.move(1200);
    f.update();
    expect(f.worker.requests.length - attemptsBeforeReturn).toBe(TERRAIN_BUDGETS.low.inFlight);
    for (const request of stale) f.worker.reply(request);
    f.update();
    expect(f.worker.pending.size).toBe(TERRAIN_BUDGETS.low.inFlight);
    expect(f.worker.requests.length - attemptsBeforeReturn).toBe(TERRAIN_BUDGETS.low.inFlight);
    expect(f.terrain.stats.built).toBe(1);
  });

  it.each(['low', 'medium', 'high'] as const)(
    'preserves the %s preset in-flight limit while replies arrive',
    (quality) => {
      const budget = TERRAIN_BUDGETS[quality];
      const f = fixture(budget);
      let peak = 0;
      for (let turn = 0; turn < 8; turn++) {
        f.update();
        peak = Math.max(peak, f.worker.pending.size);
        expect(f.worker.pending.size).toBeLessThanOrEqual(budget.inFlight);
        for (const request of [...f.worker.pending.values()]) f.worker.reply(request);
      }
      expect(peak).toBe(budget.inFlight);
      expect(f.terrain.stats.built).toBe(f.terrain.stats.requested);
      expect(f.terrain.stats.resident).toBe(f.terrain.root.children.length);
    },
  );
});

describe('terrain worker terminal cleanup', () => {
  it.each(['error', 'messageerror'])(
    'retires outstanding work on %s and rejects late callbacks',
    (type) => {
      const f = fixture();
      f.loadRoot();
      const pending = [...f.worker.pending.values()];
      const geometry = (f.terrain.root.children[0] as T.Mesh).geometry;
      const disposeGeometry = vi.spyOn(geometry, 'dispose');
      const disposeMaterial = vi.spyOn(f.terrain.material, 'dispose');
      const attempts = f.worker.attempts.length;

      f.worker.dispatchEvent(new Event(type));
      expectDetached(f.worker);
      f.worker.dispatchEvent(new Event(type));
      for (const request of pending) {
        f.worker.reply(request);
        f.receive(new MessageEvent('message', { data: tileData(request) }));
      }
      f.update();
      expect(f.worker.attempts).toHaveLength(attempts);
      expect(f.terrain.stats.built).toBe(1);
      expect(f.terrain.root.children).toHaveLength(1);
      expect(disposeGeometry).not.toHaveBeenCalled();

      f.terrain.dispose();
      f.terrain.dispose();
      expect(f.worker.cancellations).toHaveLength(0);
      expect(disposeGeometry).toHaveBeenCalledTimes(1);
      expect(disposeMaterial).toHaveBeenCalledTimes(1);
      expect(f.terrain.root.children).toHaveLength(0);
    },
  );

  it('finishes teardown exactly once when every cancellation send throws', () => {
    const f = fixture(TERRAIN_BUDGETS.medium);
    f.loadRoot();
    const pending = [...f.worker.pending.values()];
    const geometry = (f.terrain.root.children[0] as T.Mesh).geometry;
    const disposeGeometry = vi.spyOn(geometry, 'dispose');
    const disposeMaterial = vi.spyOn(f.terrain.material, 'dispose');
    f.worker.failCancelPosts = Infinity;
    expect(() => f.terrain.dispose()).not.toThrow();
    expectDetached(f.worker);
    const attempts = f.worker.attempts.length;
    f.terrain.dispose();
    for (const request of pending) {
      f.worker.reply(request);
      f.receive(new MessageEvent('message', { data: tileData(request) }));
    }
    f.worker.dispatchEvent(new Event('error'));
    f.worker.dispatchEvent(new Event('messageerror'));
    f.update();

    expect(f.worker.attempts).toHaveLength(attempts);
    expect(f.worker.cancellations.map((message) => message.id)).toEqual(
      pending.map((request) => request.id),
    );
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(f.terrain.root.children).toHaveLength(0);
    expect(f.terrain.treeTiles.size).toBe(0);
    expect(f.terrain.stats).toMatchObject({
      built: 1,
      resident: 0,
      drawn: 0,
      reserved: 0,
      transitioning: 0,
      morphBytes: 0,
    });
  });
});
