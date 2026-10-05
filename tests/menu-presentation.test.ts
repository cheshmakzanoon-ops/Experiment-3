import { describe, expect, it } from 'vitest';
import { shouldDrawMenu } from '../src/rendering/menu-preview.ts';

describe('menu scene-preview ownership', () => {
  it('blocks every frame during a settings transaction, even an uncovered pending preview', () => {
    for (const covered of [false, true])
      for (const preview of [false, true])
        for (const invalidated of [false, true])
          expect(shouldDrawMenu({ covered, preview, invalidated, settingsBusy: true })).toBe(false);
  });

  it('keeps settings, HQ and other non-preview editors frozen from their first callback', () => {
    for (const invalidated of [false, true])
      expect(
        shouldDrawMenu({ covered: true, preview: false, invalidated, settingsBusy: false }),
      ).toBe(false);
  });

  it('renders an explicitly invalidated Academy preview exactly once', () => {
    const state = { covered: true, preview: true, invalidated: true, settingsBusy: false };
    const before = { ...state };
    expect(shouldDrawMenu(state)).toBe(true);
    expect(state).toEqual(before); // A busy GPU can defer the draw without losing the request.
    state.invalidated = false; // The caller has completed the preview frame.
    for (let callback = 0; callback < 120; callback++) expect(shouldDrawMenu(state)).toBe(false);
    state.invalidated = true; // A subsequent day/night/guide control change.
    expect(shouldDrawMenu(state)).toBe(true);
  });

  it('does not leak a pending Academy invalidation into a replacement settings editor', () => {
    const state = { covered: true, preview: true, invalidated: true, settingsBusy: false };
    state.preview = false;
    expect(shouldDrawMenu(state)).toBe(false);
    state.settingsBusy = true;
    expect(shouldDrawMenu(state)).toBe(false);
    state.settingsBusy = false;
    expect(shouldDrawMenu(state)).toBe(false);
    state.covered = false;
    expect(shouldDrawMenu(state)).toBe(true);
  });

  it('preserves normal uncovered presentation independently of preview invalidation', () => {
    for (const preview of [false, true])
      for (const invalidated of [false, true])
        expect(shouldDrawMenu({ covered: false, preview, invalidated, settingsBusy: false })).toBe(
          true,
        );
  });
});
