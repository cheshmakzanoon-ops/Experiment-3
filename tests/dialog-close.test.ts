import { describe, expect, it } from 'vitest';
import { dialogCloseOutcome } from '../src/core/dialog-close.ts';

describe('closing the topmost dialog (Escape / a dialog close button)', () => {
  it('resumes the session when the open dialog is the pause menu itself', () => {
    // Journey evidence: Escape on the pause menu used to close and re-open it,
    // so the car could only be reached through the RESUME button.
    expect(dialogCloseOutcome({ state: 'paused', pauseMenuOpen: true, briefingOpen: false })).toBe(
      'resume',
    );
  });

  it('returns to the pause menu from a dialog opened out of it', () => {
    // settings, controls, credits, academy...
    expect(dialogCloseOutcome({ state: 'paused', pauseMenuOpen: false, briefingOpen: false })).toBe(
      'pause-menu',
    );
  });

  it('returns to the pause menu from the pre-race briefing, even if it reports the menu', () => {
    expect(dialogCloseOutcome({ state: 'paused', pauseMenuOpen: false, briefingOpen: true })).toBe(
      'pause-menu',
    );
    expect(dialogCloseOutcome({ state: 'paused', pauseMenuOpen: true, briefingOpen: true })).toBe(
      'pause-menu',
    );
  });

  it('returns to the results card on the results state, whatever dialog was open', () => {
    for (const pauseMenuOpen of [true, false])
      expect(dialogCloseOutcome({ state: 'results', pauseMenuOpen, briefingOpen: false })).toBe(
        'results',
      );
  });

  it('does nothing in the menu, while loading, driving or in a replay', () => {
    for (const state of ['menu', 'loading', 'driving', 'replay', 'photo', 'pregame'])
      expect(dialogCloseOutcome({ state, pauseMenuOpen: false, briefingOpen: false })).toBe('none');
  });
});
