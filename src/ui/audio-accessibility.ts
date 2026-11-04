import { th } from '../i18n/index.ts';
import { N_ } from '../i18n/mark.ts';
import { validateDrivingAudio, type DrivingAudioSettings } from '../audio/driving-cues.ts';
const switches = [
  ['enabled', N_('Enable live driving tones (off by default)')],
  ['brake', N_('Braking advisory')],
  ['turns', N_('Stereo turn direction')],
  ['gears', N_('Upshift / downshift')],
  ['trackLimits', N_('Track-limit warning')],
  ['wrongWay', N_('Wrong-way warning')],
  ['invertStereo', N_('Invert left / right stereo')],
] as const;
export function audioAccessibility(value: DrivingAudioSettings) {
  const settings = validateDrivingAudio(value);
  return `<fieldset class="audio-accessibility"><legend>${th('AUDIO DRIVING CUES')}</legend>${switches.map(([key, label]) => `<label class="check"><input type="checkbox" name="cue_${key}" ${settings[key] ? 'checked' : ''}>${th(label)}</label>`).join('')}<label class="range-row">${th('Cue volume')}<output>${settings.volume}</output><input type="range" name="cue_volume" min="0" max="1" step="0.01" value="${settings.volume}"></label><label class="range-row">${th('Turn lookahead (metres)')}<output>${settings.lookahead}</output><input type="range" name="cue_lookahead" min="8" max="80" step="1" value="${settings.lookahead}"></label><button type="button" id="previewDrivingAudio">${th('PREVIEW LEFT / BRAKE / RIGHT')}</button><p class="small-note">${th('Preview uses these unsaved volume/stereo values. Apply to retain them. Tones never steer, brake, shift or award laps. Live human driving only: silent in replay, AI demonstration, pit service, pause and hidden tabs. Geometric guidance is advisory, not blind-driving certification.')}</p></fieldset>`;
}
export function readDrivingAudio(form: HTMLFormElement): DrivingAudioSettings {
  const row: Record<string, unknown> = {};
  for (const [key] of switches)
    row[key] = (form.elements.namedItem(`cue_${key}`) as HTMLInputElement).checked;
  for (const key of ['volume', 'lookahead'])
    row[key] = Number((form.elements.namedItem(`cue_${key}`) as HTMLInputElement).value);
  return validateDrivingAudio(row);
}
