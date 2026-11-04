/** HUD SCALE (Settings > HUD): how large the race HUD is drawn.
 *
 * The HUD is laid out in one unit, `--u` (f1-hud.css), a share of the viewport. Its size is
 * `--u = --hud-k x (the viewport's own unit, never under 8 px)`, and `--hud-k` is the player's interface
 * size (`--ui-scale`) times this setting. So a larger HUD scale grows every panel, label and gap in the
 * same proportion (type is never scaled by a transform), and the layout contracts keep holding because
 * the panels only ever grow together (the largest sizes are capped by the window: see f1-hud.css).
 *
 * `auto` is the default and follows the window: 100% on a tall screen, 115% under 900 px tall (a 7 inch
 * 1280x800 handheld, a 720p or 768 px laptop) in the desktop layout. The CSS decides it with a media query so a resized or
 * rotated window follows without a reload; `AUTO_HUD_SCALE_BELOW` here must match that query
 * (tests/hud-scale.test.ts reads the style sheet and compares). A choice from the four steps is always
 * honoured, whatever the window. */
export const HUD_SCALES = [1, 1.15, 1.3, 1.5] as const;
export type HudScale = (typeof HUD_SCALES)[number];
export type HudScaleSetting = 'auto' | HudScale;
export const DEFAULT_HUD_SCALE: HudScaleSetting = 'auto';
/** `auto` draws the HUD at `AUTO_HUD_SCALE_SHORT` in a viewport shorter than this many CSS px, in the desktop
 * layout only (at least `AUTO_HUD_SCALE_MIN_WIDTH` x `AUTO_HUD_SCALE_MIN_HEIGHT`: below it the compact layout keeps
 * the size its contracts were measured at, and only a step the player chose applies). */
export const AUTO_HUD_SCALE_BELOW = 900;
export const AUTO_HUD_SCALE_MIN_WIDTH = 1280;
export const AUTO_HUD_SCALE_MIN_HEIGHT = 680;
export const AUTO_HUD_SCALE_SHORT: HudScale = 1.15;

/** A saved or typed value as a setting: `auto`, a step, or the nearest step to a number; anything else reads as `auto`. */
export function validateHudScale(value: unknown): HudScaleSetting {
  if (value === 'auto') return 'auto';
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'auto';
  return HUD_SCALES.reduce((best, step) => (Math.abs(step - n) < Math.abs(best - n) ? step : best));
}

/** The scale in force for a window (what the style sheet computes for the same window). */
export function resolveHudScale(setting: HudScaleSetting, viewportHeight: number, viewportWidth = Infinity): HudScale {
  if (setting !== 'auto') return setting;
  const desktop = viewportWidth >= AUTO_HUD_SCALE_MIN_WIDTH && viewportHeight >= AUTO_HUD_SCALE_MIN_HEIGHT;
  return desktop && viewportHeight < AUTO_HUD_SCALE_BELOW ? AUTO_HUD_SCALE_SHORT : 1;
}

/** Apply the setting live: a step is an inline custom property on the root (the HUD reads it as
 * `--hud-scale`); `auto` removes it so the style sheet's media query decides. */
export function applyHudScale(root: HTMLElement, setting: HudScaleSetting) {
  if (setting === 'auto') root.style.removeProperty('--hud-scale');
  else root.style.setProperty('--hud-scale', String(setting));
  root.dataset.hudScale = String(setting);
}
