import { describe, expect, it } from 'vitest';
import { shouldDrawMenu } from '../src/rendering/menu-preview.ts';

describe('menu scene-preview ownership', () => {
  it('blocks every frame during a settings transaction, even an uncovered pending preview', () => {
    for (const covered of [false, true])
      for (const preview of [false, true])
        for (const invalidated of [false, true])
          for (const resizePending of [false, true])
            expect(
              shouldDrawMenu({ covered, preview, invalidated, resizePending, settingsBusy: true }),
            ).toBe(false);
  });

  it('keeps settings, HQ and other non-preview editors frozen from their first callback', () => {
    for (const invalidated of [false, true])
      expect(
        shouldDrawMenu({
          covered: true,
          preview: false,
          invalidated,
          resizePending: false,
          settingsBusy: false,
        }),
      ).toBe(false);
  });

  it('renders an explicitly invalidated Academy preview exactly once', () => {
    const state = {
      covered: true,
      preview: true,
      invalidated: true,
      resizePending: false,
      settingsBusy: false,
    };
    const before = { ...state };
    expect(shouldDrawMenu(state)).toBe(true);
    expect(state).toEqual(before); // A busy GPU can defer the draw without losing the request.
    state.invalidated = false; // The caller has completed the preview frame.
    for (let callback = 0; callback < 120; callback++) expect(shouldDrawMenu(state)).toBe(false);
    state.invalidated = true; // A subsequent day/night/guide control change.
    expect(shouldDrawMenu(state)).toBe(true);
  });

  it('does not leak a pending Academy invalidation into a replacement settings editor', () => {
    const state = {
      covered: true,
      preview: true,
      invalidated: true,
      resizePending: false,
      settingsBusy: false,
    };
    state.preview = false;
    expect(shouldDrawMenu(state)).toBe(false);
    state.settingsBusy = true;
    expect(shouldDrawMenu(state)).toBe(false);
    state.settingsBusy = false;
    expect(shouldDrawMenu(state)).toBe(false);
    state.covered = false;
    expect(shouldDrawMenu(state)).toBe(true);
  });

  it('restores a resized covered editor once without authorizing unrelated invalidations', () => {
    const state = {
      covered: true,
      preview: false,
      invalidated: true,
      resizePending: true,
      settingsBusy: false,
    };
    const held = { ...state };
    expect(shouldDrawMenu(state)).toBe(true);
    expect(state).toEqual(held); // Defer safely when a previous GPU submission is still pending.
    state.invalidated = false;
    state.resizePending = false; // The caller completed the one redraw.
    for (let i = 0; i < 120; i++) expect(shouldDrawMenu(state)).toBe(false);
    state.invalidated = true; // A settings/HQ action is not a viewport event.
    expect(shouldDrawMenu(state)).toBe(false);
  });

  it('coalesces resize requests through a settings save and still draws once afterward', () => {
    const state = {
      covered: true,
      preview: false,
      invalidated: true,
      resizePending: false,
      settingsBusy: true,
    };
    for (let event = 0; event < 4; event++) {
      state.resizePending = true;
      expect(shouldDrawMenu(state)).toBe(false);
    }
    state.settingsBusy = false;
    expect(shouldDrawMenu(state)).toBe(true);
    state.invalidated = false;
    state.resizePending = false;
    expect(shouldDrawMenu(state)).toBe(false);
  });

  it('does not draw a stale resize marker without an outstanding invalidation', () => {
    for (const preview of [false, true])
      expect(
        shouldDrawMenu({
          covered: true,
          preview,
          invalidated: false,
          resizePending: true,
          settingsBusy: false,
        }),
      ).toBe(false);
  });

  it('preserves normal uncovered presentation independently of preview invalidation', () => {
    for (const preview of [false, true])
      for (const invalidated of [false, true])
        expect(
          shouldDrawMenu({
            covered: false,
            preview,
            invalidated,
            resizePending: false,
            settingsBusy: false,
          }),
        ).toBe(true);
  });
});
