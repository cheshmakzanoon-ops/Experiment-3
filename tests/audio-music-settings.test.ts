import { describe, expect, it, vi } from 'vitest';
import {
  MUSIC_AVAILABLE,
  MUSIC_CUES,
  MUSIC_DUCK_DB,
  MUSIC_REFERENCE_LUFS,
  MusicBus,
  cueNormalisation,
  musicCueFor,
  musicGain,
  type MusicCueId,
  type MusicCueSpec,
} from '../src/audio/music.ts';
import { DEFAULT_LEVELS, dbToGain, gainToDb } from '../src/audio/mixer.ts';
import { audioMixer, readAudioMixer } from '../src/ui/audio-mixer.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { CUE_SOUND, UI_MASTER, UI_TRIM_DB, UiSounds } from '../src/audio/ui-sounds.ts';
import { uiCue } from '../src/ui/ui-cue.ts';
import { FakeContext, asContext, asNode } from './fake-audio.ts';

describe('music: a socket for the soundtrack, off by default and silent without assets', () => {
  it('names the eight cues of the brief and ships no asset', () => {
    expect(Object.keys(MUSIC_CUES).sort()).toEqual(
      [
        'menu',
        'race-ambient',
        'race-tension',
        'results',
        'wildcard-sting',
        'festival-day',
        'festival-night',
        'snow',
      ].sort(),
    );
    for (const cue of Object.values(MUSIC_CUES)) {
      expect(cue.src, cue.id).toBeNull();
      expect(cue.lufs, cue.id).toBeLessThanOrEqual(-18);
      expect(cue.lufs, cue.id).toBeGreaterThanOrEqual(-30);
      if (cue.kind === 'stinger') expect(cue.loop).toBeNull();
    }
    expect(MUSIC_AVAILABLE).toBe(false);
    expect(MUSIC_CUES['wildcard-sting'].kind).toBe('stinger');
  });
  it('chooses a cue from the scene, purely', () => {
    expect(musicCueFor({ scene: 'menu' })).toBe('menu');
    expect(musicCueFor({ scene: 'results' })).toBe('results');
    expect(musicCueFor({ scene: 'wildcard-start' })).toBe('wildcard-sting');
    expect(musicCueFor({ scene: 'race' })).toBe('race-ambient');
    expect(musicCueFor({ scene: 'race', tense: true })).toBe('race-tension');
    expect(musicCueFor({ scene: 'race', snow: true })).toBe('snow');
    expect(musicCueFor({ scene: 'festival' })).toBe('festival-day');
    expect(musicCueFor({ scene: 'festival', night: true })).toBe('festival-night');
    expect(musicCueFor({ scene: 'festival', night: true, snow: true })).toBe('snow');
  });
  it('ducks under the engines and follows the slider', () => {
    const quiet = musicGain(DEFAULT_LEVELS, 0),
      loud = musicGain(DEFAULT_LEVELS, 1);
    expect(gainToDb(loud) - gainToDb(quiet)).toBeCloseTo(-MUSIC_DUCK_DB, 6);
    expect(musicGain({ ...DEFAULT_LEVELS, music: 0 }, 0)).toBe(0);
    expect(musicGain({ ...DEFAULT_LEVELS, music: 1 }, 0)).toBeGreaterThan(quiet);
    expect(cueNormalisation({ lufs: MUSIC_REFERENCE_LUFS })).toBe(1);
    expect(cueNormalisation({ lufs: -30 })).toBeCloseTo(dbToGain(6), 9);
  });

  function withAssets(loader = vi.fn(async () => ({}) as AudioBuffer)) {
    const ctx = new FakeContext();
    const cues = {
      ...MUSIC_CUES,
      menu: { ...MUSIC_CUES.menu, src: 'audio/music/menu.ogg', loop: [1.5, 61.5] as const },
      'wildcard-sting': { ...MUSIC_CUES['wildcard-sting'], src: 'audio/music/sting.ogg' },
    } as Record<MusicCueId, MusicCueSpec>;
    const bus = new MusicBus(asContext(ctx), asNode(ctx.destination), loader, cues);
    return { ctx, bus, loader };
  }
  it('stays disabled until switched on: no load, no source', async () => {
    const { ctx, bus, loader } = withAssets();
    expect(bus.enabled).toBe(false);
    expect(await bus.play('menu')).toBe(false);
    expect(loader).not.toHaveBeenCalled();
    expect(ctx.of('source')).toHaveLength(0);
    // Enabled, but a cue with no asset is unavailable: still no request, no sound.
    bus.enabled = true;
    expect(await bus.play('snow')).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });
  it('loops a cue between its loop points with a fade in, and crossfades to the next', async () => {
    const { ctx, bus, loader } = withAssets();
    bus.enabled = true;
    expect(await bus.play('menu')).toBe(true);
    const [source] = ctx.of('source');
    expect(source.loop).toBe(true);
    expect([source.loopStart, source.loopEnd]).toEqual([1.5, 61.5]);
    expect(source.started).toEqual([0]);
    expect(bus.playing).toBe('menu');
    const fade = ctx.of('gain').at(-1)!;
    expect(fade.gain.events[0]).toMatchObject({ kind: 'set', value: 0 });
    expect(fade.gain.events[1]).toMatchObject({ kind: 'linear', time: MUSIC_CUES.menu.fade });
    // Asking again for the cue that plays changes nothing; the file is loaded once.
    expect(await bus.play('menu')).toBe(true);
    expect(ctx.of('source')).toHaveLength(1);
    expect(loader).toHaveBeenCalledTimes(1);
    // A stinger plays once, over a fade-out of the bed.
    expect(await bus.play('wildcard-sting')).toBe(true);
    const sting = ctx.of('source')[1];
    expect(sting.loop).toBe(false);
    expect(source.stopped.length).toBe(1);
  });
  it('gives up quietly when the asset fails to load, and when switched off while loading', async () => {
    const failing = vi.fn(async () => {
      throw new Error('404');
    });
    const a = withAssets(failing);
    a.bus.enabled = true;
    expect(await a.bus.play('menu')).toBe(false);
    expect(a.ctx.of('source')).toHaveLength(0);
    let release: (b: AudioBuffer) => void = () => undefined;
    const slow = vi.fn(() => new Promise<AudioBuffer>((r) => (release = r)));
    const b = withAssets(slow);
    b.bus.enabled = true;
    const pending = b.bus.play('menu');
    b.bus.enabled = false;
    release({} as AudioBuffer);
    expect(await pending).toBe(false);
    expect(b.ctx.of('source')).toHaveLength(0);
  });
  it('drives its output from the slider, the switch and the engine presence', () => {
    const { ctx, bus } = withAssets();
    const out = bus.output as unknown as ReturnType<FakeContext['createGain']>;
    bus.update(DEFAULT_LEVELS, 0.5, 1);
    expect(out.gain.events.at(-1)).toMatchObject({ kind: 'target', value: 0 }); // disabled
    bus.enabled = true;
    bus.update(DEFAULT_LEVELS, 0, 2);
    const open = out.gain.events.at(-1)!.value;
    bus.update(DEFAULT_LEVELS, 1, 3);
    expect(out.gain.events.at(-1)!.value).toBeLessThan(open);
    bus.update({ ...DEFAULT_LEVELS, music: 0 }, 0, 4);
    expect(out.gain.events.at(-1)!.value).toBe(0);
    bus.dispose();
    expect(ctx.nodes.length).toBeGreaterThan(0);
  });
});

describe('sound settings: per-class sliders beside the master volume', () => {
  it('default to the designed mix, with music off', () => {
    expect(DEFAULT_SETTINGS.audioLevels).toEqual(DEFAULT_LEVELS);
    expect(DEFAULT_SETTINGS.musicEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.volume).toBe(0.45);
  });
  it('migrate older saves (no levels), clamp wild values and keep what is valid', () => {
    const old = validateSettings({ version: 6, volume: 0.7 });
    expect(old.audioLevels).toEqual(DEFAULT_LEVELS);
    expect(old.volume).toBe(0.7);
    const wild = validateSettings({
      version: 6,
      audioLevels: { engine: 0.3, effects: 9, ambience: 'x', ui: -2 },
      musicEnabled: 'yes',
    });
    expect(wild.audioLevels).toEqual({ ...DEFAULT_LEVELS, engine: 0.3, effects: 1, ui: 0 });
    expect(wild.musicEnabled).toBe(false);
    expect(validateSettings({ version: 6, musicEnabled: true }).musicEnabled).toBe(true);
  });
  it('shows a slider per bus; the music controls appear only when music exists', () => {
    const view = { levels: { ...DEFAULT_LEVELS, engine: 0.4 }, musicEnabled: false };
    const without = audioMixer(view, false);
    for (const bus of ['engine', 'effects', 'ambience', 'ui'])
      expect(without).toContain(`name="level_${bus}"`);
    expect(without).toContain('value="0.4"');
    expect(without).not.toContain('level_music');
    expect(without).not.toContain('musicEnabled');
    const withMusic = audioMixer({ ...view, musicEnabled: true }, true);
    expect(withMusic).toContain('name="level_music"');
    expect(withMusic).toMatch(/name="musicEnabled"\s+checked/);
  });
  it('reads the section back, keeping the value of any control that was not shown', () => {
    const inputs: Record<string, { value?: string; checked?: boolean }> = {
      level_engine: { value: '0.25' },
      level_effects: { value: '0.5' },
      level_ambience: { value: '1' },
      level_ui: { value: '0' },
    };
    const form = { elements: { namedItem: (name: string) => inputs[name] ?? null } };
    const read = readAudioMixer(form as unknown as HTMLFormElement, {
      levels: { ...DEFAULT_LEVELS, music: 0.3 },
      musicEnabled: true,
    });
    expect(read.levels).toEqual({ engine: 0.25, effects: 0.5, ambience: 1, ui: 0, music: 0.3 });
    expect(read.musicEnabled).toBe(true); // checkbox not in the form: previous value stands
    inputs.musicEnabled = { checked: false };
    inputs.level_music = { value: '0.9' };
    const shown = readAudioMixer(form as unknown as HTMLFormElement, {
      levels: DEFAULT_LEVELS,
      musicEnabled: true,
    });
    expect(shown.musicEnabled).toBe(false);
    expect(shown.levels.music).toBe(0.9);
  });
});

describe('menu sounds obey the menu slider and keep their measured trims', () => {
  function make(level: number | undefined) {
    const ctx = new FakeContext(),
      target = new EventTarget();
    const sounds = new UiSounds({
      settings: () => ({ volume: 0.5, muted: false, level }),
      target,
      activated: () => true,
      createContext: () => ctx as never,
    });
    return { ctx, target, sounds };
  }
  it('scales the master by the square-law slider; no slider means full', () => {
    for (const [level, factor] of [
      [undefined, 1],
      [1, 1],
      [0.5, 0.25],
    ] as const) {
      const { ctx, target } = make(level);
      uiCue('confirm', target);
      const master = ctx.of('gain')[0];
      expect(master.gain.events.find((e) => e.kind === 'set')!.value).toBeCloseTo(
        UI_MASTER * 0.5 * factor,
        9,
      );
    }
    const silent = make(0);
    uiCue('confirm', silent.target);
    expect(silent.ctx.of('gain')[0].gain.events.find((e) => e.kind === 'set')!.value).toBe(0);
  });
  it('trims every cue sound so the six sit at the same loudness, ceiling after the make-up', () => {
    expect(Object.keys(UI_TRIM_DB).sort()).toEqual([
      'close',
      'confirm',
      'deny',
      'open',
      'select',
      'tick',
    ]);
    for (const sound of new Set(Object.values(CUE_SOUND))) expect(UI_TRIM_DB[sound]).toBeDefined();
    const { ctx, target } = make(undefined);
    uiCue('tick', target);
    const [shaper] = ctx.of('shaper');
    expect(shaper.outputs).toContain(ctx.destination);
    expect(shaper.curve).not.toBeNull();
    expect(Math.max(...shaper.curve!)).toBeLessThan(0.9); // under -1 dBFS
  });
});
