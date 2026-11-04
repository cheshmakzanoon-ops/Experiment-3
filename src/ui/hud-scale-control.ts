import { th } from '../i18n/index.ts';
import {
  AUTO_HUD_SCALE_BELOW,
  HUD_SCALES,
  validateHudScale,
  type HudScaleSetting,
} from '../core/hud-scale.ts';

/** The HUD section of the settings screen: one dial, HUD SCALE, beside SOUND MIX and the other
 * fieldsets. Automatic is the default (115% under 900 px tall, so a handheld reads the HUD without
 * touching anything); a step is applied as the dial moves (interface.ts), the way the text size is. */
export function hudScaleSection(setting: HudScaleSetting) {
  const option = (value: HudScaleSetting, label: string) =>
    `<option value="${value}"${value === setting ? ' selected' : ''}>${label}</option>`;
  return `<fieldset class="hud-scale"><legend>${th('HUD')}</legend><label>${th('HUD SCALE')}<select name="hudScale">${option(
    'auto',
    th('Automatic · 115% on screens under {px} px tall', { px: AUTO_HUD_SCALE_BELOW }),
  )}${HUD_SCALES.map((step) => option(step, `${Math.round(step * 100)}%`)).join(
    '',
  )}</select></label><p class="small-note">${th(
    'Sizes the race HUD: speed, gear, timing, tyres and maps. Larger reads better on a handheld or from the sofa. On a small window the largest sizes stop where the panels would meet.',
  )}</p></fieldset>`;
}

/** The dial's value back as a setting (a missing control keeps the previous value). */
export function readHudScale(form: HTMLFormElement, previous: HudScaleSetting): HudScaleSetting {
  const select = form.elements.namedItem('hudScale') as HTMLSelectElement | null;
  return select ? validateHudScale(select.value) : previous;
}
