import { fixed, t, th } from '../i18n/index.ts';
import { N_ } from '../i18n/mark.ts';
import {
  COCKPIT_FOV,
  graphicsPreset,
  validateGraphics,
  type GraphicsOptions,
  type QualityPreset,
} from '../rendering/options.ts';
import type { Settings } from '../storage/data.ts';
import { CLEAR_VISIBILITY_M, KOSCHMIEDER, snowShare } from '../simulation/weather.ts';

const choices: [keyof GraphicsOptions, string, (string | number)[], string[]][] = [
  [
    'textureSize',
    N_('Texture detail limit'),
    [128, 256, 512, 1024],
    ['128 px', '256 px', '512 px', '1024 px'],
  ],
  [
    'shadowSize',
    N_('Shadow resolution'),
    [0, 512, 1024, 2048, 4096],
    ['Off', '512 px', '1024 px', '2048 px', '4096 px (Ultra GPUs)'],
  ],
  ['shadowCascades', N_('Sun shadow cascades'), [2, 3], ['Near + far', 'Near + mid + far (Ultra)']],
  [
    'reflections',
    N_('Reflection method'),
    ['environment', 'local'],
    ['Environment lighting', 'Local scene probe'],
  ],
  [
    'mirrorQuality',
    N_('Rear-view mirror quality'),
    ['low', 'medium', 'high'],
    ['128 px / 10 Hz', '256 px / 15 Hz', '512 px / 30 Hz'],
  ],
  ['anisotropy', N_('Anisotropic filtering'), [1, 2, 4, 8, 16], ['1×', '2×', '4×', '8×', '16×']],
  ['msaa', N_('Multisample anti-aliasing'), [0, 2, 4], ['Off', '2× MSAA', '4× MSAA']],
  [
    'toneMapper',
    'Tone mapping',
    ['aces', 'agx', 'neutral'],
    ['ACES filmic (calibrated)', 'AgX (softer highlights)', 'Khronos neutral'],
  ],
];
/** Choices whose values are strings, not numbers. */
const textChoices = new Set<keyof GraphicsOptions>(['reflections', 'mirrorQuality', 'toneMapper']);
const ranges: [keyof GraphicsOptions, string, number, number, number][] = [
  ['resolutionScale', N_('Render resolution scale'), 0.5, 1.5, 0.05],
  ['motionBlur', N_('Motion blur (0 disables; HUD stays sharp)'), 0, 0.6, 0.05],
  ['particleDensity', N_('Smoke, spray and rain density'), 0, 1, 0.1],
  ['vegetationDensity', N_('Environment vegetation density'), 0, 1, 0.1],
  ['cockpitFov', N_('Cockpit field of view (vertical degrees)'), COCKPIT_FOV.min, COCKPIT_FOV.max, 1],
  ['taaSharpen', N_('Temporal AA sharpening (0 disables)'), 0, 1, 0.05],
];
const checks: [keyof GraphicsOptions, string][] = [
  ['crowd', N_('Grandstand crowd')],
  ['bloom', N_('Bloom post-processing')],
  ['autoExposure', N_('Adaptive exposure (measured scene luminance)')],
  ['localFog', N_('Weather-driven low-lying haze')],
  ['antialias', N_('FXAA anti-aliasing (used when MSAA is off)')],
  ['ambientOcclusion', N_('Ambient occlusion (contact shading)')],
  ['filmGrade', N_('Broadcast colour grade and light vignette')],
  ['temporalAA', N_('Temporal anti-aliasing (steadier fine detail, softer motion)')],
  ['lensEffects', N_('Lens effects (sun flare, lens dirt, rain on lens)')],
  ['ssr', N_('Screen-space reflections (wet asphalt, car paint)')],
  ['aoTemporal', N_('High-quality temporal ambient occlusion')],
  ['physicalBloom', N_('Energy-conserving bloom (no highlight threshold)')],
  ['chromaticAberration', N_('Restrained lens chromatic aberration')],
  ['lightShafts', N_('Sun shafts through trees and structures')],
  ['replayDof', N_('Depth of field on replay broadcast cameras')],
];
/** The operating system's reduced-motion request (prefers-reduced-motion). */
export function systemReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
export function presentationControls(settings: Settings) {
  return `<details class="presentation-details"><summary>${th('Individual graphics controls')}</summary><p class="small-note">${th('Presets reset these controls. Individual changes apply on save. Lower resolutions reduce GPU work; barriers and timing signs are never removed.')}</p>${choices.map(([key, label, values, labels]) => `<label>${th(label)}<select name="graphics_${key}">${values.map((value, i) => `<option value="${value}">${labels[i]}</option>`).join('')}</select></label>`).join('')}${ranges.map(([key, label, min, max, step]) => `<label class="range-row">${th(label)}<output></output><input name="graphics_${key}" type="range" min="${min}" max="${max}" step="${step}"></label>`).join('')}${checks.map(([key, label]) => `<label class="check"><input type="checkbox" name="graphics_${key}">${th(label)}</label>`).join('')}</details><h3>${th('Race entry')}</h3><label class="check"><input name="quickStart" type="checkbox" ${settings.quickStart ? 'checked' : ''}>${th('Quick Start · skip briefing and grid preparation')}</label><h3>${th('Accessibility')}</h3><label class="check"><input name="colorblind" type="checkbox" ${settings.colorblind ? 'checked' : ''}>${th('Colour-blind-safe HUD · patterned flags, and blue, orange, yellow and rose for the timing colours')}</label><label class="check"><input name="highContrast" type="checkbox" ${settings.highContrast ? 'checked' : ''}>${th('High-contrast instruments')}</label><label class="check"><input name="captions" type="checkbox" ${settings.captions ? 'checked' : ''}>${th('Race radio captions (speaker and message)')}</label><label class="check"><input name="engineerRadio" type="checkbox" ${settings.engineerRadio ? 'checked' : ''}>${th('Engineer messages (race control is always shown)')}</label><label class="check"><input name="reducedMotion" type="checkbox" ${settings.reducedMotion ? 'checked' : ''}>${th('Reduced motion · no camera vibration or motion blur')}</label>${systemReducedMotion() ? `<p class="small-note">${th('Your system asks for reduced motion. The menus and the camera follow it whether or not this box is ticked.')}</p>` : ''}<h3>${th('Controller rumble')}</h3><p class="small-note">${th('A cue, not racing-wheel force feedback.')}</p>${(
    [
      ['traction', N_('Traction (wheelspin, lockup)')],
      ['impact', N_('Impacts and kerbs')],
      ['engine', N_('Engine texture')],
    ] as const
  )
    .map(
      ([key, label]) =>
        `<label class="range-row">${th(label)}<output>${settings.rumble[key]}</output><input name="rumble_${key}" type="range" min="0" max="1" step="0.05" value="${settings.rumble[key]}"></label>`,
    )
    .join(
      '',
    )}<p class="small-note">${th('Flags always include text. Camera movement and interface scale can be adjusted below.')}</p>`;
}
export function bindPresentation(form: HTMLFormElement, settings: Settings) {
  const input = (key: keyof GraphicsOptions) =>
    form.elements.namedItem(`graphics_${key}`) as HTMLInputElement;
  const fill = (values: GraphicsOptions) => {
    for (const [key] of [...choices, ...ranges]) {
      const control = input(key);
      control.value = String(values[key]);
      const output = control.parentElement?.querySelector('output');
      if (output) output.value = control.value;
    }
    for (const [key] of checks) input(key).checked = !!values[key];
  };
  fill(settings.graphics);
  const preset = form.elements.namedItem('quality') as HTMLSelectElement;
  preset.addEventListener('change', () => fill(graphicsPreset(preset.value as QualityPreset)));
  return () => {
    const result: Record<string, unknown> = {};
    for (const [key] of [...choices, ...ranges]) {
      const value = input(key).value;
      result[key] = textChoices.has(key) ? value : Number(value);
    }
    for (const [key] of checks) result[key] = input(key).checked;
    return validateGraphics(result, preset.value as QualityPreset);
  };
}

/** What the air is doing, for the HUD: the fog or dust bank's visibility and a
 * strong wind. Empty in clear air and ordinary breezes, so the dry and rain
 * readouts are unchanged. Visibility is the particulate's own (H.EXTINCTION;
 * rain is already reported as rain, so a storm's rain curtain is not called
 * fog: with 10 mm/h or more falling only dust is named). Fog is named from
 * the meteorological threshold, under 1 km. */
export function airReadout(
  extinctionPerKm: number,
  dust: number,
  windMS: number,
  rainMmHr = 0,
  snowing = false,
) {
  const parts: string[] = [];
  if (Number.isFinite(extinctionPerKm) && extinctionPerKm > 0) {
    // Koschmieder: V = 3.912 / sigma, with the clear-air baseline restored.
    const visibilityM =
      (KOSCHMIEDER / (extinctionPerKm + KOSCHMIEDER / (CLEAR_VISIBILITY_M / 1000))) * 1000;
    const dusty = Number.isFinite(dust) && dust >= 0.5,
      raining = Number.isFinite(rainMmHr) && rainMmHr >= 10;
    if (dusty ? visibilityM < 5000 : visibilityM < 1000 && !raining) {
      const view =
        visibilityM >= 1000
          ? `${fixed(visibilityM / 1000, 1)} ${t('KM')}`
          : `${Math.max(10, Math.round(visibilityM / 10) * 10)} ${t('M')}`;
      parts.push(`${dusty ? t('DUST') : snowing ? t('VIS') : t('FOG')} ${view}`);
    }
  }
  if (Number.isFinite(windMS) && windMS >= 8)
    parts.push(t('WIND {speed} M/S', { speed: Math.round(windMS) }));
  return parts.length ? `${parts.join(' · ')} · ` : '';
}

/** Rainfall and water left on the surface are distinct observations. The water
 * label explicitly describes the circuit mean, not a claim about every cell.
 * Optional air terms (fog/dust visibility, strong wind) lead the surface
 * state; clear air adds nothing. */
export function weatherReadout(
  ambientC: number,
  rainMmHr: number,
  meanWaterMm: number,
  extinctionPerKm = 0,
  dust = 0,
  windMS = 0,
) {
  if (![ambientC, rainMmHr, meanWaterMm].every(Number.isFinite) || rainMmHr < 0 || meanWaterMm < 0)
    return t('WEATHER DATA UNAVAILABLE');
  // Below freezing the precipitation channel is snow (weather.ts snowShare).
  const snowing = snowShare(ambientC) >= 0.5;
  const rain =
    rainMmHr > 0.01
      ? `${snowing ? t('SNOW') : t('RAIN')} ${fixed(rainMmHr, 1)} ${t('MM/H')} · `
      : '';
  const surface =
    meanWaterMm >= 0.04
      ? t('TRACK AVG {water} MM WATER', { water: fixed(meanWaterMm, 2) })
      : snowing
        ? t('SNOW AND ICE ON TRACK')
        : meanWaterMm > 0.001
          ? t('DAMP TRACK')
          : rainMmHr > 0.01
            ? t('TRACK WETTING')
            : t('DRY TRACK');
  return `${Math.round(ambientC)}°C / ${airReadout(extinctionPerKm, dust, windMS, rainMmHr, snowing)}${rain}${surface}`;
}
