import { describe, expect, it, vi } from 'vitest';
import { keyName, DEFAULT_BINDINGS } from '../src/input/bindings.ts';
import {
  LIGHT_CATALOGUE,
  LIGHT_CHOICES,
  LIGHT_PRESET_KEY,
  LIVE_SKY_KEY,
  isLightChoice,
  lightOptionsHtml,
  readLightChoice,
  resolveLighting,
  sessionLight,
  writeLightChoice,
} from '../src/rendering/light-choice.ts';
import { wildcardEntry, wildcardSeries } from '../src/career/wildcard-series.ts';
import { DRS } from '../src/simulation/drs.ts';
import { WEATHER_CATALOGUE, WEATHER_IDS } from '../src/simulation/weather-catalogue.ts';
import {
  CUE_SOUND,
  UI_MASTER,
  UI_SOUNDS,
  UI_SOUND_MAX_SECONDS,
  UiSounds,
} from '../src/audio/ui-sounds.ts';
import { loadingTipsFor, type TipContext, type TipDiscipline } from '../src/ui/loading-tips.ts';
import { LIGHT_GLYPH, WEATHER_GLYPH, glyph } from '../src/ui/glyphs.ts';
import { UI_CUE_EVENT, uiCue, type UiCue } from '../src/ui/ui-cue.ts';

/** A Storage stand-in. */
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('the LIGHT dial: choice, storage and what it resolves to', () => {
  it('offers the three presets, LIVE and the venue default, each with a name and a glyph', () => {
    expect([...LIGHT_CHOICES]).toEqual(['auto', 'day', 'sunset', 'night', 'live']);
    for (const id of LIGHT_CHOICES) {
      expect(isLightChoice(id)).toBe(true);
      expect(LIGHT_CATALOGUE[id].option.length, id).toBeGreaterThan(0);
      expect(LIGHT_CATALOGUE[id].option.length, `${id} fits a narrow dial`).toBeLessThanOrEqual(10);
      expect(glyph(LIGHT_GLYPH[id])).toContain('<svg');
    }
    expect(isLightChoice('dusk')).toBe(false);
    const html = lightOptionsHtml();
    for (const id of LIGHT_CHOICES) expect(html).toContain(`<option value="${id}">`);
  });
  it('resolves a choice to the renderer preset: AUTO is the venue own light', () => {
    expect(resolveLighting('auto', false)).toBe('day');
    expect(resolveLighting('auto', true)).toBe('night');
    for (const preset of ['day', 'sunset', 'night'] as const) {
      expect(resolveLighting(preset, true)).toBe(preset);
      expect(resolveLighting(preset, false)).toBe(preset);
    }
    expect(resolveLighting('live', true, 'sunset')).toBe('sunset');
    expect(resolveLighting('live', true)).toBe('day'); // before the first sky reading
  });
  it('lets an event that names its light win over the standing choice, for that session', () => {
    expect(sessionLight('auto', 'night')).toBe('night');
    expect(sessionLight('live', 'sunset')).toBe('sunset');
    expect(sessionLight('sunset', null)).toBe('sunset');
    // Wildcard events name theirs through the series data (lighting is advisory, same vocabulary).
    const named = wildcardSeries().filter((e) => e.lighting);
    expect(named.length).toBeGreaterThanOrEqual(5);
    for (const e of named) expect(sessionLight('auto', e.lighting), e.id).toBe(e.lighting);
    expect(wildcardEntry('karts-after-dark')!.lighting).toBe('night');
  });
  it('stores LIVE under the key live-sky.ts has always used, and presets beside it', () => {
    const store = memory();
    expect(readLightChoice(store)).toBe('auto');
    writeLightChoice('live', store);
    expect(store.data.get(LIVE_SKY_KEY)).toBe('1');
    expect(readLightChoice(store)).toBe('live');
    writeLightChoice('sunset', store);
    expect(store.data.has(LIVE_SKY_KEY)).toBe(false);
    expect(store.data.get(LIGHT_PRESET_KEY)).toBe('sunset');
    expect(readLightChoice(store)).toBe('sunset');
    writeLightChoice('auto', store);
    expect(store.data.size).toBe(0);
    expect(readLightChoice(store)).toBe('auto');
    // A stored value this build does not know is the default, not a crash.
    expect(readLightChoice(memory({ [LIGHT_PRESET_KEY]: 'dusk' }))).toBe('auto');
    // An earlier build that stored LIVE only (the key is unchanged) still reads as LIVE.
    expect(readLightChoice(memory({ [LIVE_SKY_KEY]: '1' }))).toBe('live');
  });
  it('survives storage that throws (a private window, blocked site data)', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readLightChoice(broken)).toBe('auto');
    expect(() => writeLightChoice('night', broken)).not.toThrow();
    expect(readLightChoice(undefined)).toBe('auto');
  });
  it('draws a glyph for every weather the catalogue has, so no dial falls back to the sun', () => {
    for (const id of WEATHER_IDS) expect(WEATHER_GLYPH[id], id).toBeDefined();
  });
});

/** An AudioContext stand-in that counts what the sounds build. */
function fakeContext(state: 'running' | 'suspended' = 'running') {
  const log = {
    oscillators: 0,
    noises: 0,
    gains: [] as number[],
    filters: 0,
    resumed: 0,
    closed: 0,
  };
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn((n: unknown) => n) });
  const ctx = {
    state,
    currentTime: 1,
    sampleRate: 48000,
    destination: {},
    resume: vi.fn(async () => void log.resumed++),
    close: vi.fn(async () => void log.closed++),
    createGain: () => {
      const gain = param();
      const g = { ...node(), gain };
      // The master gain is the first gain made; record every level set on it.
      gain.setValueAtTime.mockImplementation((v: number) => log.gains.push(v));
      return g;
    },
    createOscillator: () => {
      log.oscillators++;
      return { ...node(), type: 'sine', frequency: param(), start: vi.fn(), stop: vi.fn() };
    },
    createBufferSource: () => {
      log.noises++;
      return { ...node(), buffer: null, start: vi.fn(), stop: vi.fn() };
    },
    createBiquadFilter: () => {
      log.filters++;
      return { ...node(), type: 'lowpass', frequency: param(), Q: { value: 0 } };
    },
    createBuffer: (_c: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
  };
  return { ctx: ctx as unknown as AudioContext, raw: ctx, log };
}

describe('menu sounds (the audio half of motobound:cue)', () => {
  const settings = { volume: 0.5, muted: false };
  function make(
    over: Partial<ConstructorParameters<typeof UiSounds>[0]> = {},
    state?: 'running' | 'suspended',
  ) {
    const target = new EventTarget();
    const fake = fakeContext(state);
    const sounds = new UiSounds({
      settings: () => settings,
      target,
      activated: () => true,
      createContext: () => fake.ctx,
      ...over,
    });
    return { target, fake, sounds };
  }
  it('has six recipes: short, quiet and different, and every cue plays one', () => {
    expect(Object.keys(UI_SOUNDS).sort()).toEqual([
      'close',
      'confirm',
      'deny',
      'open',
      'select',
      'tick',
    ]);
    const cues: UiCue[] = ['tick', 'select', 'confirm', 'open', 'close', 'back', 'deny'];
    for (const cue of cues) expect(UI_SOUNDS[CUE_SOUND[cue]], cue).toBeDefined();
    expect(CUE_SOUND.back).toBe(CUE_SOUND.close);
    const shapes = new Set<string>();
    for (const [id, voices] of Object.entries(UI_SOUNDS)) {
      expect(voices.length, id).toBeGreaterThan(0);
      for (const v of voices) {
        expect(
          v.at + v.attack + v.decay,
          `${id} ends within ${UI_SOUND_MAX_SECONDS} s`,
        ).toBeLessThanOrEqual(UI_SOUND_MAX_SECONDS);
        expect(v.gain, id).toBeGreaterThan(0);
        expect(v.gain, id).toBeLessThanOrEqual(1);
        expect(v.hz, id).toBeGreaterThan(20);
        expect(v.hz, id).toBeLessThan(12000);
      }
      shapes.add(JSON.stringify(voices));
    }
    expect(shapes.size).toBe(6);
    expect(UI_MASTER).toBeLessThanOrEqual(0.4);
  });
  it('plays a cue after the person has interacted, scaled by the master volume', () => {
    const { target, fake, sounds } = make();
    uiCue('confirm', target);
    expect(sounds.played).toBe(1);
    expect(fake.log.oscillators).toBe(UI_SOUNDS.confirm.filter((v) => v.kind === 'tone').length);
    // The master level is the ceiling times the player's volume.
    expect(fake.log.gains[0]).toBeCloseTo(UI_MASTER * 0.5, 6);
  });
  it('plays nothing before any interaction (the autoplay rule) and creates no context', () => {
    const create = vi.fn(() => fakeContext().ctx);
    const { target, sounds } = make({ activated: () => false, createContext: create });
    uiCue('tick', target);
    uiCue('select', target);
    expect(sounds.played).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
  it('falls back to its own gesture check where the browser has no user-activation flag', () => {
    const target = new EventTarget();
    const fake = fakeContext();
    const sounds = new UiSounds({
      settings: () => settings,
      target,
      createContext: () => fake.ctx,
    });
    // Node has no navigator.userActivation: nothing plays until a pointer or key event is seen.
    uiCue('tick', target);
    expect(sounds.played).toBe(0);
    target.dispatchEvent(new Event('pointerdown'));
    uiCue('tick', target);
    expect(sounds.played).toBe(1);
  });
  it('respects mute and a master volume of zero', () => {
    const { target, sounds } = make({ settings: () => ({ volume: 0.5, muted: true }) });
    uiCue('confirm', target);
    expect(sounds.played).toBe(0);
    const zero = make({ settings: () => ({ volume: 0, muted: false }) });
    uiCue('confirm', zero.target);
    expect(zero.sounds.played).toBe(0);
    // The mute key flips it live: the settings are read at every cue.
    const live = { volume: 0.5, muted: true };
    const toggled = make({ settings: () => live });
    uiCue('tick', toggled.target);
    live.muted = false;
    uiCue('select', toggled.target);
    expect(toggled.sounds.played).toBe(1);
  });
  it('leaves a suspended context alone: asks to resume once, queues no sound', () => {
    const { target, fake, sounds } = make({}, 'suspended');
    uiCue('confirm', target);
    uiCue('select', target);
    expect(sounds.played).toBe(0);
    expect(fake.raw.resume).toHaveBeenCalled();
    expect(fake.log.oscillators).toBe(0);
  });
  it('thins a key-repeat train and ignores a cue it does not know', () => {
    const { target, fake, sounds } = make();
    uiCue('tick', target);
    uiCue('tick', target); // same instant: inside the repeat gap
    expect(sounds.played).toBe(1);
    fake.raw.currentTime = 1.2;
    uiCue('tick', target);
    expect(sounds.played).toBe(2);
    target.dispatchEvent(new CustomEvent(UI_CUE_EVENT, { detail: { cue: 'no-such-cue' } }));
    target.dispatchEvent(new CustomEvent(UI_CUE_EVENT, { detail: null }));
    expect(sounds.played).toBe(2);
  });
  it('stops listening and closes its context when disposed', () => {
    const { target, fake, sounds } = make();
    uiCue('tick', target);
    sounds.dispose();
    fake.raw.currentTime = 5;
    uiCue('select', target);
    expect(sounds.played).toBe(1);
    expect(fake.log.closed).toBe(1);
  });
});

describe('loading tips (real, per discipline, in the player own keys)', () => {
  const bindings = { ...DEFAULT_BINDINGS };
  const ctx = (over: Partial<TipContext> = {}): TipContext => ({
    discipline: 'circuit',
    weather: 'clear',
    night: false,
    drs: false,
    hybrid: false,
    race: true,
    solo: false,
    bindings,
    ...over,
  });
  const disciplines: TipDiscipline[] = [
    'circuit',
    'gp',
    'motocross',
    'supercross',
    'rallycross',
    'stage',
    'festival',
  ];
  it('has something true to say for every discipline, none of it filler', () => {
    for (const discipline of disciplines) {
      const tips = loadingTipsFor(ctx({ discipline }));
      expect(tips.length, discipline).toBeGreaterThanOrEqual(1);
      for (const tip of tips) {
        expect(tip, discipline).toMatch(/[.!?]$/);
        expect(tip.length, tip).toBeLessThan(200);
        expect(tip, tip).not.toMatch(/lorem|welcome|experience the|unleash|loading\.\.\./i);
      }
      expect(new Set(tips).size, discipline).toBe(tips.length);
    }
  });
  it('keeps each discipline to its own advice', () => {
    const text = (d: TipDiscipline, extra: Partial<TipContext> = {}) =>
      loadingTipsFor(ctx({ discipline: d, ...extra })).join('\n');
    expect(text('motocross')).toContain('rider weight');
    expect(text('supercross')).toContain('tap a brake');
    expect(text('gp')).toMatch(/lean/);
    expect(text('gp')).toMatch(/front brake/);
    expect(text('circuit')).not.toMatch(/rider weight|lean/);
    expect(text('motocross')).not.toMatch(/pit stop|DRS|hybrid/i);
    expect(text('festival')).toMatch(/event marker/);
    expect(text('rallycross', { race: true })).toMatch(/joker/);
    expect(text('rallycross', { race: false })).not.toMatch(/joker/);
    // Pit stops, DRS and the hybrid mode appear only where the session has them.
    expect(text('circuit', { race: false })).not.toMatch(/pit stop/);
    expect(text('circuit', { drs: false })).not.toMatch(/DRS/);
    expect(text('circuit', { hybrid: false })).not.toMatch(/hybrid/);
    expect(text('circuit', { drs: true })).toContain(
      `within ${DRS.gap.toFixed(1)} s of the car ahead, in the dry, from lap ${DRS.fromLap}`,
    );
    expect(text('circuit', { hybrid: true })).toMatch(/hybrid mode/);
    expect(text('motocross', { solo: true })).toMatch(/solo practice/);
    expect(text('motocross', { solo: false })).not.toMatch(/solo practice/);
  });
  it('uses the key the player bound, not the default', () => {
    const remapped = { ...bindings, riderForward: 'KeyU', riderBack: 'KeyJ', camera: 'KeyV' };
    const moto = loadingTipsFor(ctx({ discipline: 'motocross', bindings: remapped })).join('\n');
    expect(moto).toContain(`${keyName('KeyU')} / ${keyName('KeyJ')}`);
    expect(moto).not.toContain(`${keyName('KeyQ')} / ${keyName('KeyZ')}`);
    expect(loadingTipsFor(ctx({ bindings: remapped })).join('\n')).toContain(
      `Press ${keyName('KeyV')} to change camera`,
    );
  });
  it('states what each weather does, from the weather catalogue numbers', () => {
    for (const id of WEATHER_IDS) {
      const tips = loadingTipsFor(ctx({ weather: id }));
      if (id === 'clear') continue;
      const first = tips[0];
      expect(first, id).toBeTruthy();
      // The first tip of a non-clear weather is about that weather.
      expect(first.toLowerCase(), id).toMatch(/rain|dry|fog|storm|dust/);
    }
    const brief = (id: 'fog' | 'dust') => WEATHER_CATALOGUE[id].brief;
    expect(loadingTipsFor(ctx({ weather: 'fog' }))[0]).toContain('110 m');
    expect(brief('fog')).toContain('110 m');
    expect(loadingTipsFor(ctx({ weather: 'dust' }))[0]).toContain('170 m');
    expect(brief('dust')).toContain('170 m');
    expect(loadingTipsFor(ctx({ weather: 'storm' }))[0]).toContain('20 m/s');
    expect(WEATHER_CATALOGUE.storm.brief).toContain('20 m/s');
    expect(loadingTipsFor(ctx({ night: true })).join('\n')).toMatch(
      /floodlights.*never changes grip/,
    );
    expect(loadingTipsFor(ctx({ night: false })).join('\n')).not.toMatch(/floodlights/);
  });
  it('tells a Wildcard event medal ladder and its rules', () => {
    const karts = loadingTipsFor(ctx({ wildcard: wildcardEntry('karts-after-dark') }));
    expect(karts[0]).toBe(
      'Gold asks P1, silver P3, bronze P5 or better. The machine is loaned: nothing to buy.',
    );
    const attack = loadingTipsFor(ctx({ wildcard: wildcardEntry('hypercar-roof-deck-attack') }));
    expect(attack[0]).toContain('Gold asks 40.96 s, silver 42.61 s, bronze 45.51 s or faster');
    expect(attack.join('\n')).toMatch(/no ABS and no traction control/);
    expect(
      loadingTipsFor(ctx({ wildcard: wildcardEntry('the-long-way-round') })).join('\n'),
    ).toMatch(/One lap decides it/);
  });
});
