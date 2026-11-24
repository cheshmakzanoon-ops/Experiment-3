import { describe, expect, it } from 'vitest';
import { ReplayClock } from '../src/session/replay-clock.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';

/** In-memory page store: the replay service with no IndexedDB or renderer. */
class MemoryStore implements ReplayPageStore {
  pages = new Map<number, ReplayPage>();
  async put(page: ReplayPage) {
    this.pages.set(page.id, structuredClone(page));
  }
  async get(id: number) {
    const page = this.pages.get(id);
    if (!page) throw new Error('missing');
    return structuredClone(page);
  }
  async dispose() {}
}
async function recording(seconds: number) {
  const replay = new SessionReplay(1, new MemoryStore(), () => undefined, 30);
  for (let i = 0, t = 0; t <= seconds + 1e-9; i++, t = i / 15) {
    // The live recorder yields between batches; sealed pages finish writing.
    if (i % 30 === 0) await replay.settle();
    const f = new Float32Array(HEADER + CAR_STRIDE);
    f[H.CARS] = 1;
    f[H.TIME] = 10 + t;
    f[carBase(0) + F.QW] = 1;
    f[carBase(0) + F.S] = t * 50;
    replay.append(f);
  }
  expect(replay.error).toBeNull();
  return replay;
}
/** One presentation callback: advance, sample, commit when presented. */
async function callback(clock: ReplayClock, replay: SessionReplay, wall: number) {
  const a = replay.makeFrame(),
    b = replay.makeFrame();
  const target = clock.target(wall, replay.duration, true);
  let fraction = replay.sample(target, a, b);
  for (let i = 0; i < 20 && fraction === null; i++) {
    await replay.settle();
    fraction = replay.sample(target, a, b);
  }
  if (fraction === null) throw new Error(`could not present ${target}`);
  clock.presented(target, replay.duration);
  return a[H.TIME] + (b[H.TIME] - a[H.TIME]) * fraction;
}
describe('§24.2 replay clock over a deterministic recording', () => {
  it('advances, pauses, seeks across sealed pages and stops exactly at the end', async () => {
    const replay = await recording(12),
      clock = new ReplayClock();
    await replay.settle();
    expect(replay.duration).toBeCloseTo(12, 4);
    let presented = await callback(clock, replay, 0.25);
    expect(presented).toBeCloseTo(10.25, 4);
    clock.playing = false;
    expect(await callback(clock, replay, 0.25)).toBeCloseTo(presented, 6);
    // Seek before and after earlier pages (2 s pages: several are sealed).
    clock.seek(3.5, 0, replay.duration);
    expect(clock.seekPending).toBe(true);
    clock.playing = true;
    // The seek is presented once before playback advances again.
    expect(await callback(clock, replay, 0.25)).toBeCloseTo(13.5, 4);
    expect(clock.seekPending).toBe(false);
    presented = await callback(clock, replay, 0.25);
    expect(presented).toBeCloseTo(13.75, 4);
    // Continuous play over page boundaries reaches the last frame and stops.
    for (let i = 0; i < 100 && clock.playing; i++) presented = await callback(clock, replay, 0.2);
    expect(clock.playing).toBe(false);
    expect(presented).toBeCloseTo(22, 4);
    // Resume at the end restarts from the floor instead of sticking.
    expect(clock.toggle(0, replay.duration)).toBe(true);
    expect(await callback(clock, replay, 0.1)).toBeCloseTo(10, 4);
  });
  it('caps each callback step and honours rate and rapid repeated controls', async () => {
    const replay = await recording(6),
      clock = new ReplayClock();
    clock.setRate(0.25);
    expect(await callback(clock, replay, 5)).toBeCloseTo(10 + 0.5 * 0.25, 4);
    for (let i = 0; i < 9; i++) clock.toggle(0, replay.duration);
    expect(clock.playing).toBe(false);
    clock.seek(-5, 1, replay.duration);
    expect(clock.position).toBe(1);
    clock.seek(99, 0, replay.duration);
    expect(clock.position).toBeCloseTo(replay.duration, 6);
  });
});

describe('replay clock input boundaries', () => {
  it.each([NaN, Infinity, -Infinity, -1])(
    'holds the last valid position for an invalid callback interval (%s)',
    (wallDelta) => {
      const clock = new ReplayClock();
      clock.presented(2, 10);
      const held = clock.target(wallDelta, 10, true);
      expect(held).toBe(2);
      clock.presented(held, 10);
      expect(clock.playing).toBe(true);
      expect(clock.target(0.25, 10, true)).toBe(2.25);
    },
  );

  it.each([
    { floor: NaN, duration: 10 },
    { floor: Infinity, duration: 10 },
    { floor: -Infinity, duration: 10 },
    { floor: -1, duration: 10 },
    { floor: 11, duration: 10 },
    { floor: 0, duration: NaN },
    { floor: 0, duration: Infinity },
    { floor: 0, duration: -Infinity },
    { floor: 0, duration: -1 },
  ])('ignores an invalid control range ($floor, $duration)', ({ floor, duration }) => {
    const clock = new ReplayClock();
    clock.presented(2, 10);
    clock.seek(5, floor, duration);
    expect(clock.position).toBe(2);
    expect(clock.seekPending).toBe(false);
    clock.playing = false;
    expect(clock.toggle(floor, duration)).toBe(false);
    expect(clock.position).toBe(2);
    expect(clock.seekPending).toBe(false);
    expect(clock.toggle(0, 10)).toBe(true);
    expect(clock.target(0.25, 10, true)).toBe(2.25);
  });

  it.each([NaN, Infinity, -Infinity, -1])(
    'does not advance or acknowledge a seek with an invalid duration (%s)',
    (duration) => {
      const clock = new ReplayClock();
      clock.seek(3, 0, 10);
      clock.presented(3, duration);
      expect(clock.position).toBe(3);
      expect(clock.seekPending).toBe(true);
      expect(clock.playing).toBe(true);
      clock.presented(3, 10);
      expect(clock.target(0.25, duration, true)).toBe(3);
      expect(clock.target(0.25, 10, true)).toBe(3.25);
    },
  );

  it.each([NaN, Infinity, -Infinity, -1, 11])(
    'retains a pending seek after an invalid presentation acknowledgement (%s)',
    (target) => {
      const clock = new ReplayClock();
      clock.seek(3, 0, 10);
      clock.presented(target, 10);
      expect(clock.position).toBe(3);
      expect(clock.seekPending).toBe(true);
      expect(clock.playing).toBe(true);
      expect(clock.target(0.25, 10, true)).toBe(3);
      clock.presented(3, 10);
      expect(clock.seekPending).toBe(false);
      expect(clock.target(0.25, 10, true)).toBe(3.25);
    },
  );

  it('keeps a zero-duration recording at its only frame', () => {
    const clock = new ReplayClock();
    clock.seek(5, 0, 0);
    expect(clock.position).toBe(0);
    expect(clock.seekPending).toBe(true);
    clock.presented(clock.target(5, 0, true), 0);
    expect(clock.seekPending).toBe(false);
    expect(clock.playing).toBe(false);
    expect(clock.toggle(0, 0)).toBe(true);
    expect(clock.target(0.25, 0, true)).toBe(0);
  });
});
