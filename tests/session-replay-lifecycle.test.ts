import { describe, expect, it, vi } from 'vitest';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';

class Pages implements ReplayPageStore {
  readonly pages = new Map<number, ReplayPage>();
  readonly events: string[] = [];
  readonly heldWrites: {
    page: ReplayPage;
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];
  holdWrites = false;

  async put(page: ReplayPage) {
    const copy = structuredClone(page);
    this.events.push(`write:${page.id}`);
    if (this.holdWrites)
      await new Promise<void>((resolve, reject) => {
        this.heldWrites.push({ page: copy, resolve, reject });
      });
    this.pages.set(page.id, copy);
  }

  async get(id: number) {
    const page = this.pages.get(id);
    if (!page) throw new Error(`Missing page ${id}`);
    return structuredClone(page);
  }

  releaseWrites() {
    this.holdWrites = false;
    for (const write of this.heldWrites) write.resolve();
  }

  async dispose() {
    this.events.push('dispose');
    this.pages.clear();
  }
}

function frame(index: number, resumed = false) {
  const result = new Float32Array(HEADER + CAR_STRIDE);
  result[H.CARS] = 1;
  result[H.TIME] = 10 + index;
  result[H.TICK] = index * 120;
  result[carBase(0) + F.QW] = 1;
  result[carBase(0) + F.X] = resumed ? -index : index;
  return result;
}

async function recording(count = 20, withSurface = true) {
  const store = new Pages();
  const notify = vi.fn<(message: string) => void>();
  const replay = new SessionReplay(1, store, notify, 2);
  if (withSurface)
    replay.recordSurface(
      new Float32Array([0.25]),
      new Float32Array([0.5]),
      10,
      new Float32Array([0.125]),
      new Float32Array([2]),
    );
  for (let index = 0; index < count; index++) {
    replay.append(frame(index));
    await replay.settle();
  }
  return { store, replay, notify };
}

async function reusedPageWithPendingWrite() {
  const result = await recording(18);
  const { store, replay } = result;
  store.holdWrites = true;
  replay.append(frame(18)); // The old page 8 has started writing.
  await vi.waitFor(() => expect(store.heldWrites).toHaveLength(1));
  expect(replay.truncate(frame(15)[H.TIME])).toBe(true);
  for (let index = 16; index < 19; index++) replay.append(frame(index, true));
  // New pages 7 and 8 are queued behind the old page 8.
  return result;
}

describe('session replay asynchronous page ownership', () => {
  it('reseals a disk-loaded flashback page with its original surface bytes intact', async () => {
    const { store, replay, notify } = await recording();
    try {
      const original = structuredClone(store.pages.get(0)!);
      const a = replay.makeFrame();
      const b = replay.makeFrame();
      expect(replay.sample(0, a, b)).toBeNull();
      await replay.settle();
      expect(replay.sample(0, a, b)).toBe(0);
      const surface = structuredClone(replay.surfaceState);
      expect(replay.truncate(frame(1)[H.TIME])).toBe(true);
      for (let index = 2; index < 20; index++) {
        replay.append(frame(index, true));
        await replay.settle();
      }
      expect(store.pages.get(0)).toEqual(original);
      expect(replay.sample(0, a, b)).toBeNull();
      await replay.settle();
      expect(replay.error).toBeNull();
      expect(replay.sample(0, a, b)).toBe(0);
      expect(a).toEqual(frame(0));
      expect(b).toEqual(frame(1));
      expect(replay.surfaceState).toEqual(surface);
      replay.prepareSeek(2.5);
      await replay.settle();
      expect(replay.sample(2.5, a, b)).toBe(0.5);
      expect(a).toEqual(frame(2, true));
      expect(b).toEqual(frame(3, true));
      expect(replay.surfaceState).toEqual(surface);
      expect(notify).not.toHaveBeenCalled();
    } finally {
      await replay.dispose();
    }
  });

  it('removes a first surface belonging entirely to the discarded future', async () => {
    const { replay } = await recording(2, false);
    try {
      replay.recordSurface(new Float32Array([2]), new Float32Array([0.8]), 10.8);
      const a = replay.makeFrame();
      const b = replay.makeFrame();
      expect(replay.sample(1, a, b)).toBe(0);
      expect(replay.surfaceState.time).toBe(10.8);
      expect(replay.truncate(10)).toBe(true);
      replay.recordSurface(new Float32Array([0.3]), new Float32Array([0.4]), 10.5);
      replay.append(frame(1, true));
      replay.append(frame(2, true));
      await replay.settle();
      expect(replay.sample(0, a, b)).toBe(0);
      expect(replay.surfaceState.time).toBe(-1);
      expect(replay.sample(1.5, a, b)).toBe(0.5);
      expect(replay.surfaceState.time).toBe(10.5);
      expect(replay.surfaceState.water[0]).toBeCloseTo(0.3, 5);
      expect(replay.error).toBeNull();
    } finally {
      await replay.dispose();
    }
  });

  it('does not unlock a replacement page when an old write with the same id finishes', async () => {
    const { store, replay, notify } = await reusedPageWithPendingWrite();
    try {
      store.heldWrites[0].resolve();
      await vi.waitFor(() => expect(store.heldWrites).toHaveLength(2));
      expect(replay.canTruncate(frame(17)[H.TIME])).toBe(false);
      expect(replay.truncate(frame(16)[H.TIME])).toBe(false);
      store.releaseWrites();
      await replay.settle();
      expect(replay.canTruncate(frame(17)[H.TIME])).toBe(true);
      const a = replay.makeFrame();
      const b = replay.makeFrame();
      expect(replay.sample(16.5, a, b)).toBe(0.5);
      expect(a).toEqual(frame(16, true));
      expect(b).toEqual(frame(17, true));
      expect(store.pages.get(8)!.frames.subarray(0, replay.stride)).toEqual(frame(16, true));
      expect(notify).not.toHaveBeenCalled();
    } finally {
      store.releaseWrites();
      await replay.dispose();
    }
  });

  it('counts both generations of a reused id against the three queued-page limit', async () => {
    const { store, replay, notify } = await reusedPageWithPendingWrite();
    try {
      replay.append(frame(19, true));
      const captured = replay.count;
      replay.append(frame(20, true));
      expect(replay.error).toContain('cannot keep up');
      expect(replay.count).toBe(captured);
      expect(replay.diagnostics().writing).toHaveLength(3);
      expect(replay.diagnostics().cached.length).toBeLessThanOrEqual(4);
      expect(notify).toHaveBeenCalledTimes(1);
      store.releaseWrites();
      await replay.settle();
      expect(store.events.slice(-3)).toEqual(['write:8', 'write:7', 'write:8']);
      expect(replay.diagnostics().writing).toEqual([]);
      // A backpressure stop preserves both the earlier lap and every accepted
      // frame on the resumed timeline.
      const a = replay.makeFrame();
      const b = replay.makeFrame();
      expect(replay.sample(0, a, b)).toBeNull();
      await replay.settle();
      expect(replay.sample(0, a, b)).toBe(0);
      expect(a).toEqual(frame(0));
      expect(replay.sample(replay.duration, a, b)).toBe(0);
      expect(a).toEqual(frame(19, true));
    } finally {
      store.releaseWrites();
      await replay.dispose();
    }
  });

  it('drains queued pages before cleanup when writes reject during disposal', async () => {
    const { store, replay, notify } = await recording(2);
    store.events.length = 0;
    store.holdWrites = true;
    for (let index = 2; index < 7; index++) replay.append(frame(index));
    await vi.waitFor(() => expect(store.heldWrites).toHaveLength(1));
    const disposing = replay.dispose();
    try {
      const count = replay.count;
      replay.append(frame(7));
      replay.prepareSeek(0);
      expect(replay.count).toBe(count);
      expect(replay.canTruncate(10)).toBe(false);
      expect(replay.sample(0, replay.makeFrame(), replay.makeFrame())).toBeNull();
      expect(store.events).toEqual(['write:0']);
      store.heldWrites[0].reject(new Error('Quota exhausted'));
      await vi.waitFor(() => expect(store.heldWrites).toHaveLength(2));
      store.heldWrites[1].reject(new Error('Quota still exhausted'));
      await vi.waitFor(() => expect(store.heldWrites).toHaveLength(3));
      expect(store.events).toEqual(['write:0', 'write:1', 'write:2']);
      store.releaseWrites();
      await disposing;
      expect(store.events).toEqual(['write:0', 'write:1', 'write:2', 'dispose']);
      expect(replay.diagnostics().cached).toEqual([]);
      expect(replay.diagnostics().writing).toEqual([]);
      expect(replay.diagnostics().pending).toEqual([]);
      expect(replay.diagnostics().preparedSeekTime).toBeNull();
      // Preserve the first storage failure for diagnostics; the application's
      // session-generation guard decides whether its notification is still live.
      expect(replay.error).toContain('Quota exhausted');
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      store.releaseWrites();
      await disposing;
    }
  });

  it.each(['dispose', 'replace timeline'] as const)(
    'cancels a partially validated disk read on %s without admitting its old bytes',
    async (action) => {
      const { store, replay, notify } = await recording();
      let disposing: Promise<void> | undefined;
      let clock = 0;
      // Keep page 6 available for flashback while evicting the old page 8.
      for (const seconds of [0, 2, 4, 6, 12]) {
        replay.prepareSeek(seconds);
        await replay.settle();
      }
      const a = replay.makeFrame().fill(-3);
      const b = replay.makeFrame().fill(-4);
      const get = vi.spyOn(store, 'get');
      const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 5));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        replay.prepareSeek(16.5);
        await Promise.resolve();
        // The first frame was validated, but the page is not resident until
        // every recorded byte and surface passes the remaining checks.
        expect(vi.getTimerCount()).toBe(1);
        expect(replay.diagnostics().pending).toEqual([8]);
        expect(replay.diagnostics().cached).not.toContain(8);
        if (action === 'dispose') disposing = replay.dispose();
        else {
          expect(replay.truncate(frame(13)[H.TIME])).toBe(true);
          for (let index = 14; index < 20; index++) replay.append(frame(index, true));
          expect(replay.diagnostics().currentPage).toBe(9);
        }
        await vi.runAllTimersAsync();
        await (disposing ?? replay.settle());
        expect(get).toHaveBeenCalledTimes(1);
        expect(replay.error).toBeNull();
        expect(notify).not.toHaveBeenCalled();
        expect(replay.diagnostics().pending).toEqual([]);
        expect(replay.diagnostics().failed).toEqual([]);
        expect(a.every((value) => value === -3)).toBe(true);
        expect(b.every((value) => value === -4)).toBe(true);
        if (action === 'dispose') {
          expect(replay.diagnostics().cached).toEqual([]);
          expect(replay.sample(16.5, a, b)).toBeNull();
        } else {
          expect(replay.sample(16.5, a, b)).toBe(0.5);
          expect(a).toEqual(frame(16, true));
          expect(b).toEqual(frame(17, true));
          expect(replay.diagnostics().cached.length).toBeLessThanOrEqual(4);
        }
      } finally {
        now.mockRestore();
        await vi.runAllTimersAsync();
        vi.useRealTimers();
        await (disposing ?? replay.dispose());
      }
    },
  );
});
