/** A covered replay keeps its last completed frame. Pending seeks and explicit
 * camera/viewport changes are serviced after the modal releases ownership.
 * This only gates presentation; it neither advances nor rewrites recorded data. */
export function shouldDrawReplay(state: {
  playing: boolean;
  seekPending: boolean;
  covered: boolean;
  invalidated: boolean;
}): boolean {
  return !state.covered && (state.playing || state.seekPending || state.invalidated);
}
