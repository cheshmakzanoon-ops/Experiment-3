import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineVoices } from '../src/audio/engine-voices.ts';
import type { AudioView } from '../src/audio/spatial.ts';
import { UiSounds } from '../src/audio/ui-sounds.ts';
import { validateDrivingAudio } from '../src/audio/driving-cues.ts';
import { uiCue } from '../src/ui/ui-cue.ts';
import { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { FakeContext, FakeParam, asContext, type FakeNode } from './fake-audio.ts';

interface Wave {
  owner: WaveContext;
  index: number;
  real: number[];
  imag: number[];
}

/** Records scheduling and context affinity; it does not render audio. */
export class WaveContext extends FakeContext {
  waves: Wave[] = [];
  assignments = new Map<FakeNode, Wave[]>();
  closes = 0;
  resumes = 0;
  resume = async () => {
    this.resumes++;
    this.state = 'running';
  };
  close = async () => {
    this.closes++;
    this.state = 'closed';
  };
  override createPeriodicWave(...args: unknown[]) {
    const [real, imag] = args as [Float32Array, Float32Array];
    const wave = { owner: this, index: this.waves.length, real: [...real], imag: [...imag] };
    this.waves.push(wave);
    return wave;
  }
  override createOscillator() {
    const node = super.createOscillator();
    const assigned: Wave[] = [];
    this.assignments.set(node, assigned);
    node.setPeriodicWave = (...args: unknown[]) => {
      const wave = args[0] as Wave;
      if (wave.owner !== this) throw new Error('PeriodicWave crossed AudioContext ownership');
      assigned.push(wave);
    };
    return node;
  }
}

export function audioFrame(step: number) {
  const ids = ['apx01', 'tc1', 'dx8', 'eh3', 'gpr1', 'mx450'];
  const count = step === 11 ? 2 : ids.length;
  const frame = new Float32Array(HEADER + CAR_STRIDE * count);
  frame[H.CARS] = count;
  frame[H.TIME] = step * 0.1;
  frame[H.PHASE] = 2;
  frame[H.RAIN] = 0;
  for (let id = 0; id < count; id++) {
    const o = carBase(id);
    frame[o + F.QW] = 1;
    frame[o + F.X] = 4 + ((id + step) % ids.length) * 22;
    frame[o + F.Z] = id % 2 ? 7 : -7;
    frame[o + F.VX] = step % 2 ? 18 : -18;
    frame[o + F.SPEED] = step === 0 ? 0 : 20 + id * 3;
    frame[o + F.RPM] = 1800 + ((step + id) % 8) * 1500;
    frame[o + F.ENGINE_TORQUE] = step % 3 ? 300 : -40;
    frame[o + F.GEAR] = 3;
    frame[o + F.THROTTLE] = step % 3 ? 0.7 : 0;
    frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(ids[(id + Math.floor(step / 4)) % ids.length]);
  }
  return frame;
}

export function audioView(step: number): AudioView {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: step % 2 ? -4 : 4,
    vy: 0,
    vz: 0,
    rightX: 1,
    rightY: 0,
    rightZ: 0,
    interior: step >= 4 && step < 8,
    followedCar: step % 2,
  };
}

export function nodeRecord(context: WaveContext) {
  return context.nodes.map((node) => ({
    kind: node.kind,
    type: node.type,
    started: [...node.started],
    stopped: [...node.stopped],
    outputs: node.outputs.map((output) => context.nodes.indexOf(output)),
    params: Object.fromEntries(
      Object.entries(node)
        .filter((entry): entry is [string, FakeParam] => entry[1] instanceof FakeParam)
        .map(([key, param]) => [
          key,
          { value: param.value, events: param.events.map((e) => ({ ...e })) },
        ]),
    ),
    waves: context.assignments.get(node)?.map((wave) => wave.index) ?? [],
  }));
}

/** Exported so the identical scenario can run against the real pinned baseline. */
export function recordVoiceRun(Voice: typeof EngineVoices, sampleRate: number) {
  const context = new WaveContext();
  context.sampleRate = sampleRate;
  const voices = new Voice(asContext(context));
  const trace = [];
  for (let step = 0; step < 12; step++) {
    const frame = audioFrame(step),
      before = frame.slice();
    voices.update(frame, audioView(step), step * 0.1);
    if (frame.some((value, i) => !Object.is(value, before[i])))
      throw new Error('Audio mutated its source frame');
    trace.push({
      presence: voices.presence,
      spatial: voices.spatial.voices.map((voice) => ({ ...voice })),
    });
  }
  const active = nodeRecord(context);
  voices.dispose();
  const disposed = nodeRecord(context);
  voices.update(audioFrame(0), audioView(0), 5);
  voices.dispose();
  return {
    context,
    observations: {
      active,
      disposed,
      afterStaleUpdate: nodeRecord(context),
      trace,
      waves: context.waves.map(({ index, real, imag }) => ({ index, real, imag })),
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const release of cleanup.splice(0)) await release();
  vi.restoreAllMocks();
});

describe('audio math caches remain separate from audio-context ownership', () => {
  it('retains exact voice automation across a cold graph and warm replacement graphs at three context rates', async () => {
    vi.resetModules();
    const { EngineVoices: Voice } = await import('../src/audio/engine-voices.ts');
    const cold = recordVoiceRun(Voice, 44100);
    for (const rate of [48000, 96000]) {
      const warm = recordVoiceRun(Voice, rate);
      expect(warm.observations).toEqual(cold.observations);
      expect(warm.context.waves.every((wave) => !cold.context.waves.includes(wave))).toBe(true);
      expect(warm.context.waves.every((wave) => wave.owner === warm.context)).toBe(true);
    }
    expect(cold.context.of('oscillator')).toHaveLength(13);
    expect(cold.observations.waves.length).toBeGreaterThan(4);
    expect(
      cold.observations.trace.some((item) => item.spatial.some((voice) => voice.doppler !== 1)),
    ).toBe(true);
    expect(cold.observations.trace.at(-1)!.spatial.filter((voice) => voice.id >= 0)).toHaveLength(
      2,
    );
    expect(cold.observations.afterStaleUpdate).toEqual(cold.observations.disposed);
    for (const node of cold.context.nodes) {
      expect(node.outputs).toHaveLength(0);
      if (node.kind === 'oscillator') expect(node.stopped).toEqual([undefined]);
    }
  });

  it('keeps new menu cues and warmed race voices independent of old resume, close and ended callbacks', async () => {
    const { RacingAudio } = await import('../src/audio/engine.ts');
    const audio = new RacingAudio(),
      oldRace = new WaveContext(),
      nextRace = new WaveContext();
    oldRace.sampleRate = 44100;
    nextRace.sampleRate = 96000;
    oldRace.currentTime = 60;
    await audio.start(asContext(oldRace));
    cleanup.push(() => audio.dispose());
    audio.update(audioFrame(0), false, true, audioView(0));

    const oldMenu = new WaveContext(),
      nextMenu = new WaveContext(),
      target = new EventTarget();
    oldMenu.sampleRate = 44100;
    nextMenu.sampleRate = 96000;
    oldMenu.currentTime = 60;
    let away = false,
      created = 0;
    const sounds = new UiSounds({
      target,
      settings: () => ({ volume: 0.45, muted: away }),
      activated: () => true,
      createContext: () => (++created === 1 ? oldMenu : nextMenu) as unknown as AudioContext,
    });
    cleanup.push(() => sounds.dispose());
    uiCue('confirm', target);
    expect(sounds.played).toBe(1);
    const oldEnds = oldMenu.nodes.map((node) => node.onended).filter(Boolean);
    const menuResume = deferred(),
      raceResume = deferred(),
      raceClose = deferred(),
      menuClose = deferred();
    oldMenu.state = oldRace.state = 'suspended';
    oldMenu.resume = () => menuResume.promise;
    oldRace.resume = () => raceResume.promise;
    oldMenu.close = async () => {
      oldMenu.closes++;
      await menuClose.promise;
      oldMenu.state = 'closed';
    };
    oldRace.close = async () => {
      oldRace.closes++;
      await raceClose.promise;
      oldRace.state = 'closed';
    };
    expect(sounds.cue('tick')).toBe(false);
    const settings = validateDrivingAudio(null),
      pendingPreview = audio.previewDriving(settings);
    away = true;
    audio.stop();
    sounds.suspend();
    expect(sounds.cue('confirm')).toBe(false);
    const retired = audio.dispose();
    await audio.start(asContext(nextRace));
    audio.update(audioFrame(0), false, true, audioView(0));
    away = false;
    uiCue('confirm', target);
    expect(sounds.played).toBe(2);
    expect(created).toBe(2);
    const freshRace = nodeRecord(nextRace),
      freshMenu = nodeRecord(nextMenu);
    oldEnds.forEach((ended) => ended?.());
    raceResume.resolve();
    menuResume.resolve();
    raceClose.resolve();
    menuClose.resolve();
    await pendingPreview;
    await retired;
    await Promise.resolve();
    expect(nodeRecord(nextRace)).toEqual(freshRace);
    expect(nodeRecord(nextMenu)).toEqual(freshMenu);
    expect(oldRace.closes).toBe(1);
    expect(oldMenu.closes).toBe(1);
    expect(oldMenu.nodes.every((node) => !node.outputs.length)).toBe(true);
    expect(oldRace.nodes.every((node) => !node.outputs.length)).toBe(true);
    expect(nextRace.waves.every((wave) => wave.owner === nextRace)).toBe(true);
    expect(audio.diagnostics().playing).toBe(true);
    await audio.previewDriving(settings);
    expect(
      nextRace
        .of('oscillator')
        .some((node) =>
          node.frequency.events.some((event) => event.kind === 'set' && event.value === 800),
        ),
    ).toBe(true);
    expect(
      oldRace
        .of('oscillator')
        .some((node) =>
          node.frequency.events.some((event) => event.kind === 'set' && event.value === 800),
        ),
    ).toBe(false);
  });
});
