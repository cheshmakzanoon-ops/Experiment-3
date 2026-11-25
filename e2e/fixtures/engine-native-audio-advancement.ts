import { EngineVoices } from '../../src/audio/engine-voices.ts';
import { frameCharacter } from '../../src/audio/sound-profiles.ts';
import type { AudioView } from '../../src/audio/spatial.ts';
import { UiSounds } from '../../src/audio/ui-sounds.ts';
import { uiCue } from '../../src/ui/ui-cue.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../src/simulation/protocol.ts';
import { vehicleIndex } from '../../src/simulation/vehicles.ts';

export type OriginalAudio = { EngineVoices: typeof EngineVoices };
const VEHICLES = ['apx01', 'tc1', 'eh3', 'gpr1'] as const;
const SECONDS = 0.64;

function frame(step: number) {
  const data = new Float32Array(HEADER + VEHICLES.length * CAR_STRIDE);
  data[H.CARS] = VEHICLES.length;
  data[H.TIME] = step * 0.16;
  data[H.PHASE] = 2;
  for (let id = 0; id < VEHICLES.length; id++) {
    const o = carBase(id);
    data[o + F.QW] = 1;
    data[o + F.X] = id * 8;
    data[o + F.Z] = 4 + id * 3;
    data[o + F.VX] = step % 2 ? -12 - id : 8 + id;
    data[o + F.VZ] = step % 2 ? 5 : -4;
    data[o + F.SPEED] = step === 0 ? 0 : 15 + step * 12 + id;
    data[o + F.RPM] = [1800, 5500, 11000, 14500][step] + id * 500;
    data[o + F.ENGINE_TORQUE] = step === 1 ? -35 : 100 + step * 90;
    data[o + F.THROTTLE] = step === 1 ? 0 : 0.3 + step * 0.2;
    data[o + F.GEAR] = step + 1;
    data[o + RACE_BASE + R.VEHICLE] = vehicleIndex(VEHICLES[id]);
    for (let wheel = 0; wheel < 4; wheel++)
      data[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD] = 1200;
  }
  return data;
}

function view(step: number): AudioView {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: step % 2 ? 3 : -3,
    vy: 0,
    vz: 0,
    rightX: 1,
    rightY: 0,
    rightZ: 0,
    interior: step === 2,
    followedCar: 0,
  };
}

async function digest(channels: readonly Float32Array[]) {
  const bytes = new Uint8Array(channels.reduce((sum, channel) => sum + channel.byteLength, 0));
  let at = 0;
  for (const channel of channels) {
    bytes.set(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength), at);
    at += channel.byteLength;
  }
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function signal(channels: readonly Float32Array[]) {
  let finite = true,
    peak = 0,
    squareSum = 0,
    stereoDifferences = 0;
  for (const channel of channels)
    for (const value of channel) {
      finite &&= Number.isFinite(value);
      peak = Math.max(peak, Math.abs(value));
      squareSum += value * value;
    }
  for (let i = 0; i < channels[0].length; i++)
    if (!Object.is(channels[0][i], channels[1][i])) stereoDifferences++;
  const samples = channels.reduce((sum, channel) => sum + channel.length, 0);
  return { finite, peak, rms: Math.sqrt(squareSum / samples), samples, stereoDifferences };
}

function compare(a: readonly Float32Array[], b: readonly Float32Array[]) {
  if (a.length !== b.length || a.some((channel, i) => channel.length !== b[i].length))
    throw new Error('Native audio render lengths disagree');
  let differingSamples = 0,
    differingBytes = 0,
    maxDifference = 0;
  for (let channel = 0; channel < a.length; channel++) {
    for (let i = 0; i < a[channel].length; i++) {
      if (!Object.is(a[channel][i], b[channel][i])) differingSamples++;
      maxDifference = Math.max(maxDifference, Math.abs(a[channel][i] - b[channel][i]));
    }
    const left = new Uint8Array(a[channel].buffer, a[channel].byteOffset, a[channel].byteLength);
    const right = new Uint8Array(b[channel].buffer, b[channel].byteOffset, b[channel].byteLength);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) differingBytes++;
  }
  return { differingSamples, differingBytes, maxDifference };
}

async function renderVoices(
  Voice: typeof EngineVoices,
  sampleRate: number,
  seenWaves: Set<PeriodicWave>,
) {
  const context = new OfflineAudioContext(2, Math.round(SECONDS * sampleRate), sampleRate);
  const waves: PeriodicWave[] = [],
    oscillators: OscillatorNode[] = [];
  const stops = new Map<OscillatorNode, number>();
  const createWave = context.createPeriodicWave.bind(context);
  context.createPeriodicWave = (...args) => {
    const wave = createWave(...args);
    waves.push(wave);
    return wave;
  };
  const createOscillator = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = createOscillator(),
      stop = oscillator.stop.bind(oscillator);
    oscillators.push(oscillator);
    oscillator.stop = (when) => {
      stops.set(oscillator, (stops.get(oscillator) ?? 0) + 1);
      stop(when);
    };
    return oscillator;
  };
  const voices = new Voice(context);
  const trace = [];
  let channels: Float32Array[];
  try {
    // Keep each voice on one family: PeriodicWave assignment is immediate,
    // whereas AudioParam automation is scheduled. These future updates do not
    // pretend that an immediate family change happened later in the render.
    for (let step = 0; step < 4; step++) {
      const data = frame(step),
        before = data.slice();
      voices.update(data, view(step), step * 0.16);
      if (data.some((value, i) => !Object.is(value, before[i])))
        throw new Error('Native audio graph changed its input frame');
      trace.push({
        presence: voices.presence,
        spatial: voices.spatial.voices.map((voice) => ({ ...voice })),
      });
    }
    const rendered = await context.startRendering();
    channels = [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()];
  } finally {
    voices.dispose();
  }
  voices.update(frame(0), view(0), 0.7);
  voices.dispose();
  const reusedWaveObjects = waves.filter((wave) => seenWaves.has(wave)).length;
  waves.forEach((wave) => seenWaves.add(wave));
  return {
    channels,
    report: {
      sampleRate: context.sampleRate,
      frames: channels[0].length,
      channels: channels.length,
      state: context.state,
      finalTime: context.currentTime,
      periodicWaves: waves.length,
      oscillators: oscillators.length,
      stopCounts: oscillators.map((oscillator) => stops.get(oscillator) ?? 0),
      retainedVoices: (voices as unknown as { voices: unknown[] }).voices.length,
      reusedWaveObjects,
      signal: signal(channels),
      digest: await digest(channels),
      trace,
    },
  };
}

/** Both constructors execute the actual EngineVoices graph. The reference's
 * only substituted dependency is the byte-exact original loudness module. */
export async function offlineParity(original: OriginalAudio) {
  const cases = [],
    waves = new Set<PeriodicWave>();
  let firstCurrent: Float32Array[] | null = null;
  let firstBaseline: Float32Array[] | null = null;
  for (const [index, sampleRate] of [44100, 44100, 48000, 96000].entries()) {
    const baseline = await renderVoices(original.EngineVoices, sampleRate, waves);
    const current = await renderVoices(EngineVoices, sampleRate, waves);
    cases.push({
      numericCache: index === 0 ? 'cold module' : 'warm module',
      baseline: baseline.report,
      current: current.report,
      ...compare(baseline.channels, current.channels),
      sameRateRepeat:
        index === 1
          ? {
              baseline: compare(firstBaseline!, baseline.channels),
              current: compare(firstCurrent!, current.channels),
            }
          : null,
    });
    if (index === 0) {
      firstBaseline = baseline.channels;
      firstCurrent = current.channels;
    }
  }
  return {
    seconds: SECONDS,
    vehicles: [...VEHICLES],
    families: VEHICLES.map((_, id) => frameCharacter(frame(0), id).profile.family),
    cases,
    samplesPerImplementation: cases.reduce((sum, item) => sum + item.current.signal.samples, 0),
  };
}

function cueCount(sounds: UiSounds) {
  return (sounds as unknown as { cues: Set<unknown> }).cues.size;
}

function watchContext(context: AudioContext) {
  const nodes: AudioNode[] = [],
    sources: AudioScheduledSourceNode[] = [];
  const disconnects = new Map<AudioNode, number>();
  const closes: Promise<void>[] = [],
    resumes: Promise<void>[] = [];
  const resumeOutcomes: string[] = [];
  const observe = <T extends AudioNode>(node: T) => {
    nodes.push(node);
    const disconnect = node.disconnect;
    Object.defineProperty(node, 'disconnect', {
      configurable: true,
      value: (...args: unknown[]) => {
        disconnects.set(node, (disconnects.get(node) ?? 0) + 1);
        return Reflect.apply(disconnect, node, args);
      },
    });
    return node;
  };
  const gain = context.createGain.bind(context);
  context.createGain = () => observe(gain());
  const filter = context.createBiquadFilter.bind(context);
  context.createBiquadFilter = () => observe(filter());
  const shaper = context.createWaveShaper.bind(context);
  context.createWaveShaper = () => observe(shaper());
  const oscillator = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const node = observe(oscillator());
    sources.push(node);
    return node;
  };
  const bufferSource = context.createBufferSource.bind(context);
  context.createBufferSource = () => {
    const node = observe(bufferSource());
    sources.push(node);
    return node;
  };
  const close = context.close.bind(context);
  context.close = () => {
    const pending = close();
    closes.push(pending);
    return pending;
  };
  const resume = context.resume.bind(context);
  context.resume = () => {
    const pending = resume();
    resumes.push(pending);
    pending.then(
      () => resumeOutcomes.push('fulfilled'),
      () => resumeOutcomes.push('rejected'),
    );
    return pending;
  };
  const snapshot = () => ({
    state: context.state,
    nodes: nodes.length,
    sources: sources.length,
    disconnected: nodes.filter((node) => (disconnects.get(node) ?? 0) > 0).length,
    closeRequests: closes.length,
    resumeRequests: resumes.length,
    sourceHandlers: sources.filter((source) => source.onended !== null).length,
    resumeOutcomes: [...resumeOutcomes],
  });
  return { context, nodes, sources, closes, resumes, snapshot };
}

async function nativeDeadline<T>(promise: Promise<T>) {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error('Native audio operation timed out')),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Real live contexts, nodes, resume and close promises. Instrumented methods
 * forward every call. Only explicit delivery of captured old ended callbacks
 * is controlled; it is not claimed as an observed native event ordering. */
export async function cueSuspension() {
  const contexts = Array.from({ length: 3 }, () => new AudioContext({ sampleRate: 48000 }));
  let sounds: UiSounds | null = null;
  try {
    await nativeDeadline(Promise.all(contexts.map((context) => context.resume())));
    const watched = contexts.map(watchContext),
      target = new EventTarget();
    let created = 0;
    sounds = new UiSounds({
      target,
      settings: () => ({ volume: 0.45, muted: false }),
      createContext: () => {
        const context = contexts[created++];
        if (!context) throw new Error('Unexpected extra menu audio owner');
        return context;
      },
    });
    uiCue('confirm', target);
    const firstOwned = cueCount(sounds);
    const oldHandlers = watched[0].sources.map((source) => ({ source, handler: source.onended }));
    sounds.suspend();
    const afterFirstSuspend = { cues: cueCount(sounds), graph: watched[0].snapshot() };
    uiCue('confirm', target);
    const secondOwned = cueCount(sounds);
    oldHandlers.push(...watched[1].sources.map((source) => ({ source, handler: source.onended })));

    await nativeDeadline(contexts[1].suspend());
    const suspendedState = contexts[1].state;
    const pendingCueAccepted = sounds.cue('tick');
    const resumeWasPending =
      watched[1].resumes.length === 1 && watched[1].snapshot().resumeOutcomes.length === 0;
    sounds.suspend();
    uiCue('confirm', target);
    const replacementBefore = { cues: cueCount(sounds), graph: watched[2].snapshot() };
    for (const { source, handler } of oldHandlers) handler?.call(source, new Event('ended'));
    const replacementAfter = { cues: cueCount(sounds), graph: watched[2].snapshot() };
    await nativeDeadline(
      Promise.allSettled(watched.flatMap((item) => [...item.resumes, ...item.closes])),
    );
    const afterSettled = watched.map((item) => item.snapshot());
    const deliberateFreshCue = sounds.cue('deny');
    const playedBeforeDispose = sounds.played;
    sounds.dispose();
    sounds.dispose();
    uiCue('confirm', target);
    await nativeDeadline(Promise.allSettled(watched.flatMap((item) => item.closes)));
    return {
      activation: navigator.userActivation.hasBeenActive,
      sampleRates: contexts.map((context) => context.sampleRate),
      created,
      firstOwned,
      secondOwned,
      afterFirstSuspend,
      suspendedState,
      pendingCueAccepted,
      resumeWasPending,
      controlledOldCallbacks: oldHandlers.filter(({ handler }) => handler !== null).length,
      replacementBefore,
      replacementAfter,
      afterSettled,
      deliberateFreshCue,
      playedBeforeDispose,
      playedAfterDispose: sounds.played,
      finalCues: cueCount(sounds),
      final: watched.map((item) => item.snapshot()),
    };
  } finally {
    sounds?.dispose();
    await Promise.allSettled(
      contexts.filter((context) => context.state !== 'closed').map((context) => context.close()),
    );
  }
}
