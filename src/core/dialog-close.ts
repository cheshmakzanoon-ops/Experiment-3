/** What closing the topmost dialog means, for the Escape key (the native dialog
 * `cancel`) and for a dialog's own close button.
 *
 * Escape starts the pause menu from driving; a second Escape on that same menu
 * must leave it, i.e. resume, like every racing game. A sub-dialog opened from
 * the pause menu (settings, controls, the race briefing) closes back to the
 * pause menu instead, and results dialogs return to the results card. Found by
 * the full-flow journey: Escape on the open pause menu closed and immediately
 * re-opened it, so the only way back to the car was the RESUME button. */
export type DialogCloseOutcome = 'resume' | 'pause-menu' | 'results' | 'none';

export interface DialogCloseContext {
  /** The application state machine's current state. */
  state: string;
  /** The dialog that is open right now is the pause menu itself. */
  pauseMenuOpen: boolean;
  /** The pre-race briefing (a pause-state dialog that is not the pause menu) is open. */
  briefingOpen: boolean;
}

export function dialogCloseOutcome(context: DialogCloseContext): DialogCloseOutcome {
  if (context.state === 'paused') {
    if (context.briefingOpen) return 'pause-menu';
    return context.pauseMenuOpen ? 'resume' : 'pause-menu';
  }
  if (context.state === 'results') return 'results';
  return 'none';
}
