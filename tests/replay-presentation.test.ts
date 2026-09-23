import { describe, expect, it } from 'vitest';
import { shouldDrawReplay } from '../src/rendering/replay-presentation.ts';

describe('replay presentation ownership', () => {
  it('never redraws behind a modal, including its first callback and pending seeks', () => {
    for (const playing of [false, true])
      for (const seekPending of [false, true])
        for (const invalidated of [false, true]) {
          const state = { playing, seekPending, covered: true, invalidated };
          const before = { ...state };
          expect(shouldDrawReplay(state)).toBe(false);
          expect(state).toEqual(before);
        }
  });

  it('keeps playing frames active outside a modal', () => {
    for (const seekPending of [false, true])
      for (const invalidated of [false, true])
        expect(shouldDrawReplay({ playing: true, seekPending, covered: false, invalidated })).toBe(true);
  });

  it('holds a paused frame until a seek or explicit invalidation', () => {
    const state = { playing: false, seekPending: false, covered: false, invalidated: false };
    for (let frame = 0; frame < 120; frame++) expect(shouldDrawReplay(state)).toBe(false);
    expect(shouldDrawReplay({ ...state, seekPending: true })).toBe(true);
    expect(shouldDrawReplay({ ...state, invalidated: true })).toBe(true);
    expect(shouldDrawReplay({ ...state, seekPending: true, invalidated: true })).toBe(true);
  });

  it('retains a pending seek through a modal and presents it after close', () => {
    const state = { playing: false, seekPending: true, covered: true, invalidated: true };
    expect(shouldDrawReplay(state)).toBe(false);
    state.covered = false;
    expect(shouldDrawReplay(state)).toBe(true);
    state.seekPending = state.invalidated = false;
    expect(shouldDrawReplay(state)).toBe(false);
    state.invalidated = true; // A camera change or viewport resize gets one frame.
    expect(shouldDrawReplay(state)).toBe(true);
    state.invalidated = false;
    expect(shouldDrawReplay(state)).toBe(false);
    state.playing = true; // Explicit resume restarts frame presentation.
    expect(shouldDrawReplay(state)).toBe(true);
  });
});
