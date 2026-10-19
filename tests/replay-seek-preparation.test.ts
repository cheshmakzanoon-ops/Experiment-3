import { describe, expect, it, vi } from 'vitest';
import { ReplayClock } from '../src/session/replay-clock.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';

class Pages implements ReplayPageStore {
  readonly pages = new Map<number, ReplayPage>();
  async put(page: ReplayPage) {
    this.pages.set(page.id, structuredClone(page));
  }
  async get(id: number): Promise<ReplayPage> {
    const page = this.pages.get(id);
    if (!page) throw new Error(`Missing page ${id}`);
    return structuredClone(page);
  }
  async dispose() {
    this.pages.clear();
  }
}

async function recording() {
  const store = new Pages(),
    replay = new SessionReplay(1, store, undefined, 4);
  for (let i = 0; i < 48; i++) {
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[H.CARS] = 1;
    frame[H.TIME] = 5 + i / 15;
    frame[H.TICK] = i * 8;
    frame[carBase(0) + F.QW] = 1;
    frame[carBase(0) + F.X] = i;
    if (i % 8 === 0)
      replay.recordSurface(new Float32Array([i / 100]), new Float32Array([0.2]), frame[H.TIME]);
    replay.append(frame);
    if (i % 4 === 3) await replay.settle();
  }
  await replay.settle();
  return { store, replay };
}

function deferred(store: Pages) {
  const requests: number[] = [],
    releases = new Map<number, (page: ReplayPage) => void>(),
    rejections = new Map<number, (error: Error) => void>();
  store.get = (id) => {
    requests.push(id);
    return new Promise((resolve, reject) => {
      releases.set(id, resolve);
      rejections.set(id, reject);
    });
  };
  const release = (id: number, page = store.pages.get(id)!) =>
    releases.get(id)!(structuredClone(page));
  const reject = (id: number) => rejections.get(id)!(new Error('Old timeline read failed'));
  return { requests, release, reject };
}

describe('replay seek preparation before rendering', () => {
  it('loads an evicted position without changing the held pose, surface or seek acknowledgement', async () => {
    const { store, replay } = await recording(),
      a = replay.makeFrame(),
      b = replay.makeFrame(),
      clock = new ReplayClock();
    replay.sample(44.5 / 15, a, b);
    const heldA = a.slice(),
      heldB = b.slice(),
      heldSurface = replay.surfaceState,
      get = vi.spyOn(store, 'get');
    clock.playing = false;
    clock.seek(1.5 / 15, 0, replay.duration);
    replay.prepareSeek(clock.position);
    expect(get.mock.calls.map(([id]) => id)).toEqual([0]);
    // No renderer callback or sample is needed for disk reads to finish.
    await replay.settle();
    expect(a).toEqual(heldA);
    expect(b).toEqual(heldB);
    expect(replay.surfaceState).toEqual(heldSurface);
    expect(clock.seekPending).toBe(true);
    expect(clock.position).toBe(1.5 / 15);
    const fraction = replay.sample(clock.position, a, b);
    expect(fraction).toBeCloseTo(0.5, 3);
    expect(a[carBase(0) + F.X]).toBe(1);
    expect(b[carBase(0) + F.X]).toBe(2);
    expect(replay.surfaceState.water[0]).toBe(0);
    clock.presented(clock.position, replay.duration);
    expect(clock.seekPending).toBe(false);
    await replay.dispose();
  });

  it('prepares both sides of a page seam concurrently and retains the bounded cache', async () => {
    const { store, replay } = await recording(),
      get = vi.spyOn(store, 'get');
    replay.prepareSeek(3.5 / 15);
    expect(get.mock.calls.map(([id]) => id)).toEqual([0, 1]);
    await replay.settle();
    const a = replay.makeFrame(),
      b = replay.makeFrame();
    expect(replay.sample(3.5 / 15, a, b)).toBeCloseTo(0.5, 3);
    expect(a[carBase(0) + F.X]).toBe(3);
    expect(b[carBase(0) + F.X]).toBe(4);
    for (let i = 0; i < 20; i++) {
      replay.prepareSeek(((i * 7) % 47) / 15);
      await replay.settle();
      expect(replay.diagnostics().cached.length).toBeLessThanOrEqual(4);
      expect(replay.diagnostics().pending).toEqual([]);
      expect(replay.bytes).toBeLessThan(5 * 4 * replay.stride * 4 + 1024);
    }
    await replay.dispose();
  });

  it('services the latest scrub when an earlier read finishes, with no render polling', async () => {
    const { store, replay } = await recording(),
      { requests, release } = deferred(store),
      a = replay.makeFrame().fill(-3),
      b = replay.makeFrame().fill(-4);
    replay.prepareSeek(0.5 / 15);
    replay.prepareSeek(8.5 / 15);
    replay.prepareSeek(16.5 / 15);
    expect(requests).toEqual([0, 2]);
    expect(replay.diagnostics().pending).toHaveLength(2);
    release(2);
    await vi.waitFor(() => expect(requests).toEqual([0, 2, 4]));
    release(4);
    await vi.waitFor(() => expect(replay.diagnostics().preparedSeekTime).toBeNull());
    expect(a.every((value) => value === -3)).toBe(true);
    expect(b.every((value) => value === -4)).toBe(true);
    expect(replay.sample(16.5 / 15, a, b)).toBeCloseTo(0.5, 3);
    const shownA = a.slice(),
      shownB = b.slice();
    release(0);
    await replay.settle();
    expect(a).toEqual(shownA);
    expect(b).toEqual(shownB);
    expect(a[carBase(0) + F.X]).toBe(16);
    expect(replay.diagnostics().pending).toEqual([]);
    await replay.dispose();
  });

  it('rejects a corrupt prepared page before a pose or weather can be presented', async () => {
    const { store, replay } = await recording(),
      a = replay.makeFrame().fill(-3),
      b = replay.makeFrame().fill(-4),
      get = vi.spyOn(store, 'get');
    store.pages.get(0)!.frames[carBase(0) + F.X] = 100;
    replay.prepareSeek(0);
    await replay.settle();
    expect(replay.error).toContain('recorded bytes changed');
    expect(replay.sample(0, a, b)).toBeNull();
    replay.prepareSeek(8 / 15);
    expect(get).toHaveBeenCalledTimes(1);
    expect(a.every((value) => value === -3)).toBe(true);
    expect(b.every((value) => value === -4)).toBe(true);
    expect(replay.surfaceState.time).toBe(-1);
    await replay.dispose();
  });

  it('disposes during rapid scrubbing without starting another read or reviving a cache', async () => {
    const { store, replay } = await recording(),
      { requests, release } = deferred(store);
    replay.prepareSeek(0.5 / 15);
    replay.prepareSeek(8.5 / 15);
    replay.prepareSeek(16.5 / 15);
    const disposing = replay.dispose();
    release(0);
    release(2);
    await disposing;
    expect(requests).toEqual([0, 2]);
    expect(replay.diagnostics().cached).toEqual([]);
    expect(replay.diagnostics().pending).toEqual([]);
    expect(replay.diagnostics().preparedSeekTime).toBeNull();
    expect(replay.error).toBeNull();
  });

  for (const completion of ['resolve', 'reject'] as const)
    it(`ignores a late ${completion} from the old future after flashback while retaining earlier reads`, async () => {
      const { store, replay } = await recording();
      for (const index of [0.5, 8.5, 16.5, 24.5]) {
        replay.prepareSeek(index / 15);
        await replay.settle();
      }
      const { requests, release, reject } = deferred(store);
      replay.prepareSeek(4.5 / 15); // sealed page 1 survives the flashback
      replay.prepareSeek(36.5 / 15); // sealed page 9 belongs to its old future
      expect(requests).toEqual([1, 9]);
      expect(replay.truncate(5 + 26 / 15)).toBe(true);
      expect(replay.count).toBe(27);
      expect(replay.diagnostics().preparedSeekTime).toBeNull();
      expect(replay.diagnostics().pending).toHaveLength(2);
      if (completion === 'resolve') release(9);
      else reject(9);
      release(1);
      await replay.settle();
      expect(replay.error).toBeNull();
      expect(replay.diagnostics().failed).toEqual([]);
      expect(replay.diagnostics().pending).toEqual([]);
      expect(replay.diagnostics().cached).toContain(1);
      expect(replay.diagnostics().cached).not.toContain(9);
      const a = replay.makeFrame(),
        b = replay.makeFrame();
      expect(replay.sample(4.5 / 15, a, b)).toBeCloseTo(0.5, 3);
      expect(a[carBase(0) + F.X]).toBe(4);
      expect(replay.sample(replay.duration, a, b)).toBe(0);
      expect(a[carBase(0) + F.X]).toBe(26);
      a[H.TIME] = 5 + 27 / 15;
      a[carBase(0) + F.X] = -27;
      replay.append(a);
      expect(replay.count).toBe(28);
      await replay.dispose();
    });

  it('rejects an old page witness when its numeric id has been sealed on the resumed timeline', async () => {
    const { store, replay } = await recording();
    for (const index of [0.5, 8.5, 16.5, 24.5]) {
      replay.prepareSeek(index / 15);
      await replay.settle();
    }
    const { release } = deferred(store),
      oldFuture = structuredClone(store.pages.get(9)!);
    replay.prepareSeek(36.5 / 15);
    expect(replay.truncate(5 + 26 / 15)).toBe(true);
    const frame = replay.makeFrame();
    frame[H.CARS] = 1;
    frame[carBase(0) + F.QW] = 1;
    for (let index = 27; index < 44; index++) {
      frame[H.TIME] = 5 + index / 15;
      frame[carBase(0) + F.X] = -index;
      replay.append(frame);
      // Let actual writes finish without waiting for the deliberately held
      // old read. This seals page 9 again with the resumed session's bytes.
      await vi.waitFor(() => expect(replay.diagnostics().writing).toEqual([]));
    }
    expect(replay.diagnostics().currentPage).toBe(10);
    release(9, oldFuture);
    await replay.settle();
    expect(replay.error).toBeNull();
    expect(replay.diagnostics().failed).toEqual([]);
    const a = replay.makeFrame(),
      b = replay.makeFrame();
    expect(replay.sample(36.5 / 15, a, b)).toBeCloseTo(0.5, 3);
    expect(a[carBase(0) + F.X]).toBe(-36);
    expect(b[carBase(0) + F.X]).toBe(-37);
    await replay.dispose();
  });

  it('ignores non-finite requests and prepares the clamped endpoint without a disk read', async () => {
    const { store, replay } = await recording(),
      get = vi.spyOn(store, 'get');
    replay.prepareSeek(NaN);
    replay.prepareSeek(Infinity);
    replay.prepareSeek(999);
    expect(get).not.toHaveBeenCalled();
    const a = replay.makeFrame(),
      b = replay.makeFrame();
    expect(replay.sample(999, a, b)).toBe(0);
    expect(a[carBase(0) + F.X]).toBe(47);
    await replay.dispose();
  });
});
