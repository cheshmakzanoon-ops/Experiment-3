import { ta, th } from '../i18n/index.ts';
import { N_ } from '../i18n/mark.ts';
import { FULL_GAME, clockText, demoPolicy } from '../release/demo.ts';
import { fullGameCounts } from '../release/demo-gates.ts';
import { wishlistAvailable } from '../release/wishlist.ts';
import { escapeHtml } from './team-hub.ts';

/** The Steam demo's "FULL GAME" plates (docs/studio/store/LAUNCH_PLAN.md). Everything here
 * renders to an empty string in the full game, so the call sites can include it
 * unconditionally. Plates are stencilled paper labels like the rest of the Paddock Board; the
 * wishlist button is the one amber thing on them, and exists only where the desktop shell can
 * open the store page. */

/** `data-action` prefix the game routes to the wishlist (main.ts). */
export const WISHLIST_ACTION = 'demo:wishlist';

/** The small plate that replaces a locked row's medal or status. */
export function fullGameTag(extraClass = '') {
  return demoPolicy()
    ? `<span class="dm-tag${extraClass ? ` ${extraClass}` : ''}" data-fullgame>${th(FULL_GAME)}</span>`
    : '';
}

/** The call to action. Without a desktop shell there is nothing to open, so it is a label. */
export function wishlistButtonHtml(where: string, className = '') {
  if (!demoPolicy()) return '';
  return wishlistAvailable()
    ? `<button type="button" class="dm-wishlist${className ? ` ${className}` : ''}" data-action="${WISHLIST_ACTION}:${where}">${th('WISHLIST ON STEAM')}</button>`
    : `<span class="dm-store-note">${th('FULL GAME ON STEAM')}</span>`;
}

/** What the full game adds, as "44 MORE CIRCUITS" chips from the catalogues. */
function countChips() {
  const counts = fullGameCounts();
  if (!counts) return '';
  const chips: [number, string][] = [
    [counts.circuits, N_('MORE CIRCUITS')],
    [counts.machines, N_('MORE MACHINES')],
    [counts.wildcard, N_('MORE WILDCARD EVENTS')],
    [counts.licences, N_('MORE LICENCES')],
  ];
  return chips
    .filter(([n]) => n > 0)
    .map(([n, text]) => `<li><b>${n}</b> ${th(text)}</li>`)
    .join('');
}

/** The plate on the paddock board: what the demo is, what the full game holds, and the way to
 * wishlist it. */
export function demoBoardPlateHtml() {
  const policy = demoPolicy();
  if (!policy) return '';
  const minutes = Math.round(policy.festivalSeconds / 60);
  return `<aside id="demoPlate" class="dm-board" aria-label="${ta('Demo edition')}"><div class="dm-head"><span class="dm-kicker">${th('STEAM DEMO')}</span><b>${th('THE FULL GAME IS WIDER')}</b></div>${wishlistButtonHtml('paddock')}<ul class="dm-counts">${countChips()}<li>${th('THE WHOLE COAST BEYOND {minutes} MINUTES', { minutes: `<b>${minutes}</b>` })}</li></ul></aside>`;
}

/** A locked Wildcard event, venue or licence page: the plate and the way out. */
export function lockedPanelHtml(what: string, where: string) {
  if (!demoPolicy()) return '';
  return `<div class="dm-locked" role="note"><span class="dm-lock-tag">${th(FULL_GAME)}</span><p>${escapeHtml(what)}</p>${wishlistButtonHtml(where)}</div>`;
}

/** The screen that ends the coast visit. */
export function demoEndHtml(minutes: number) {
  return `<div class="dm-end" role="alertdialog" aria-labelledby="dmEndTitle"><span class="dm-kicker">${th('STEAM DEMO')}</span><h2 id="dmEndTitle">${th('That was {minutes} minutes of the coast.', { minutes })}</h2><p>${th('The full game keeps the whole region, every road and every event open, with the rest of the circuits, machines, weather fronts and the full career behind it. Your demo times and medals stay on this machine.')}</p><ul class="dm-counts">${countChips()}</ul><div class="dm-end-actions">${wishlistButtonHtml('festival-end', 'dm-primary')}<button type="button" data-action="modalClose">${th('BACK TO THE PADDOCK')}</button></div></div>`;
}

/** The festival visit clock chip: fixed, small, readable, out of the HUD's way. */
export function demoClockHtml(seconds: number) {
  return `<div id="demoClock" class="dm-clock" role="timer" aria-label="${ta('Demo time left on the coast')}"><small>${th('DEMO COAST')}</small><b>${clockText(seconds)}</b></div>`;
}
