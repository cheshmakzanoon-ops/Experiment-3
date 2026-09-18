import {
  graphicsPreset,
  validateGraphics,
  type GraphicsOptions,
  type Quality,
} from '../rendering/options.ts';
import type { Settings } from '../storage/data.ts';

const choices: [keyof GraphicsOptions, string, (string | number)[], string[]][] = [
  [
    'textureSize',
    'Texture detail limit',
    [128, 256, 512, 1024],
    ['128 px', '256 px', '512 px', '1024 px'],
  ],
  [
    'shadowSize',
    'Shadow resolution',
    [0, 512, 1024, 2048],
    ['Off', '512 px', '1024 px', '2048 px'],
  ],
  [
    'reflections',
    'Reflection method',
    ['environment', 'local'],
    ['Environment lighting', 'Local scene probe'],
  ],
  [
    'mirrorQuality',
    'Rear-view mirror quality',
    ['low', 'medium', 'high'],
    ['128 px / 10 Hz', '256 px / 15 Hz', '512 px / 30 Hz'],
  ],
  ['anisotropy', 'Anisotropic filtering', [1, 2, 4, 8, 16], ['1×', '2×', '4×', '8×', '16×']],
];
const ranges: [keyof GraphicsOptions, string, number, number, number][] = [
  ['resolutionScale', 'Render resolution scale', 0.5, 1.5, 0.05],
  ['motionBlur', 'Motion blur (0 disables; HUD stays sharp)', 0, 0.6, 0.05],
  ['particleDensity', 'Smoke, spray and rain density', 0, 1, 0.1],
  ['vegetationDensity', 'Environment vegetation density', 0, 1, 0.1],
];
const checks: [keyof GraphicsOptions, string][] = [
  ['crowd', 'Grandstand crowd'],
  ['bloom', 'Bloom post-processing'],
  ['antialias', 'FXAA anti-aliasing'],
];
export function presentationControls(settings: Settings) {
  return `<details class="presentation-details"><summary>Individual graphics controls</summary><p class="small-note">Presets reset these controls. Individual changes apply on save. Lower resolutions reduce GPU work; barriers and timing signs are never removed.</p>${choices.map(([key, label, values, labels]) => `<label>${label}<select name="graphics_${key}">${values.map((value, i) => `<option value="${value}">${labels[i]}</option>`).join('')}</select></label>`).join('')}${ranges.map(([key, label, min, max, step]) => `<label class="range-row">${label}<output></output><input name="graphics_${key}" type="range" min="${min}" max="${max}" step="${step}"></label>`).join('')}${checks.map(([key, label]) => `<label class="check"><input type="checkbox" name="graphics_${key}">${label}</label>`).join('')}</details><h3>Accessibility</h3><label class="check"><input name="colorblind" type="checkbox" ${settings.colorblind ? 'checked' : ''}>Patterned flags (colorblind-friendly)</label><label class="check"><input name="highContrast" type="checkbox" ${settings.highContrast ? 'checked' : ''}>High-contrast instruments</label><p class="small-note">Flags always include text. Camera movement and interface scale can be adjusted below.</p>`;
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
  preset.addEventListener('change', () => fill(graphicsPreset(preset.value as Quality)));
  return () => {
    const result: Record<string, unknown> = {};
    for (const [key] of [...choices, ...ranges]) {
      const value = input(key).value;
      result[key] = key === 'reflections' || key === 'mirrorQuality' ? value : Number(value);
    }
    for (const [key] of checks) result[key] = input(key).checked;
    return validateGraphics(result, preset.value as Quality);
  };
}
