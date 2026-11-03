/** Sound-cue hook for the front end (art direction section 13). The UI never
 * plays audio itself: it announces what just happened on `window`, and the
 * audio engine can subscribe in one place when the sounds exist:
 *
 *   window.addEventListener('motobound:cue', (e) => play((e as CustomEvent).detail.cue));
 */
export type UiCue = 'tick' | 'select' | 'confirm' | 'open' | 'close' | 'back' | 'deny';
export const UI_CUE_EVENT = 'motobound:cue';
export function uiCue(cue: UiCue, target: EventTarget | undefined = globalThis.window) {
  // No window (unit tests, workers): nothing to announce to.
  target?.dispatchEvent(new CustomEvent(UI_CUE_EVENT, { detail: { cue } }));
}
