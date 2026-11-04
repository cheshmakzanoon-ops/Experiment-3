import { th } from '../i18n/index.ts';
import { N_ } from '../i18n/mark.ts';
import { BUS_NAMES, validateLevels, type AudioLevels, type BusName } from '../audio/mixer.ts';
import { MUSIC_AVAILABLE } from '../audio/music.ts';

/** The sound-mix section of the settings screen: one slider per bus beside the
 * master Volume above it. The music controls appear only once music assets
 * ship (audio/music.ts `MUSIC_AVAILABLE`): a slider that does nothing is a lie. */
const LABELS: Readonly<Record<BusName, string>> = {
  engine: N_('Engine'),
  effects: N_('Tyres, surfaces and impacts'),
  ambience: N_('Wind and weather'),
  ui: N_('Menu sounds'),
  music: N_('Music'),
};
const percent = (value: number) => `${Math.round(value * 100)}%`;

export interface AudioMixerView {
  levels: AudioLevels;
  musicEnabled: boolean;
}

export function audioMixer(view: AudioMixerView, musicAvailable = MUSIC_AVAILABLE) {
  const levels = validateLevels(view.levels);
  const buses = BUS_NAMES.filter((bus) => bus !== 'music' || musicAvailable);
  return `<fieldset class="audio-mixer"><legend>${th('SOUND MIX')}</legend>${buses
    .map(
      (bus) =>
        `<label class="range-row">${th(LABELS[bus])}<output>${percent(levels[bus])}</output><input type="range" name="level_${bus}" min="0" max="1" step="0.01" value="${levels[bus]}"></label>`,
    )
    .join('')}${
    musicAvailable
      ? `<label class="check"><input type="checkbox" name="musicEnabled" ${view.musicEnabled ? 'checked' : ''}>${th('Play background music')}</label>`
      : ''
  }<p class="small-note">${th('Volume above is the master; these set the balance between the sounds. The driving-cue tones below are never turned down by these sliders.')}</p></fieldset>`;
}

/** Read the section back; a control that was not shown keeps its previous value. */
export function readAudioMixer(form: HTMLFormElement, previous: AudioMixerView): AudioMixerView {
  const row: Partial<AudioLevels> = { ...validateLevels(previous.levels) };
  for (const bus of BUS_NAMES) {
    const input = form.elements.namedItem(`level_${bus}`) as HTMLInputElement | null;
    if (input) row[bus] = Number(input.value);
  }
  const music = form.elements.namedItem('musicEnabled') as HTMLInputElement | null;
  return {
    levels: validateLevels(row),
    musicEnabled: music ? music.checked : previous.musicEnabled,
  };
}
