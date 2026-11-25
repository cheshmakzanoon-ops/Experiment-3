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
// Four three-band junctions and one four-voice junction: 4 * 2 + 3 additions.
// Paired Float32 accumulation budget, scoped to this finite native fixture.
const UNIT_ROUNDOFF = 2 ** -24;
const MIX_ADDITIONS = 4 * (3 - 1) + (4 - 1);
const RELATIVE_BUDGET = (2 * MIX_ADDITIONS * UNIT_ROUNDOFF) / (1 - MIX_ADDITIONS * UNIT_ROUNDOFF);

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
  return digestBytes(bytes);
}

async function digestBytes(bytes: Uint8Array<ArrayBuffer>) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function channelSignal(channel: Float32Array) {
  let finite = true,
    peak = 0,
    squareSum = 0;
  for (const value of channel) {
    finite &&= Number.isFinite(value);
    peak = Math.max(peak, Math.abs(value));
    squareSum += value * value;
  }
  return {
    finite,
    peak,
    meanSquare: squareSum / channel.length,
    rms: Math.sqrt(squareSum / channel.length),
  };
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
  return {
    finite,
    peak,
    rms: Math.sqrt(squareSum / samples),
    samples,
    stereoDifferences,
    perChannel: channels.map(channelSignal),
  };
}

function compare(a: readonly Float32Array[], b: readonly Float32Array[]) {
  if (a.length !== b.length || a.some((channel, i) => channel.length !== b[i].length))
    throw new Error('Native audio render lengths disagree');
  let differingSamples = 0,
    differingBytes = 0,
    maxDifference = 0;
  const perChannel = [];
  for (let channel = 0; channel < a.length; channel++) {
    let squareDifference = 0,
      channelMaxDifference = 0;
    for (let i = 0; i < a[channel].length; i++) {
      if (!Object.is(a[channel][i], b[channel][i])) differingSamples++;
      const difference = Math.abs(a[channel][i] - b[channel][i]);
      channelMaxDifference = Math.max(channelMaxDifference, difference);
      squareDifference += difference * difference;
    }
    const left = new Uint8Array(a[channel].buffer, a[channel].byteOffset, a[channel].byteLength);
    const right = new Uint8Array(b[channel].buffer, b[channel].byteOffset, b[channel].byteLength);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) differingBytes++;
    const baseline = channelSignal(a[channel]),
      current = channelSignal(b[channel]);
    const absoluteLimit = RELATIVE_BUDGET * Math.max(baseline.peak, current.peak);
    const rmsLimit = RELATIVE_BUDGET * Math.max(baseline.rms, current.rms);
    const rmsDifference = Math.sqrt(squareDifference / a[channel].length);
    // Cauchy-Schwarz: |mean((a+d)^2)-mean(a^2)| <= 2*rms(a)*rms(d)+rms(d)^2.
    const energyLimit = 2 * baseline.rms * rmsLimit + rmsLimit * rmsLimit;
    const energyDifference = Math.abs(baseline.meanSquare - current.meanSquare);
    maxDifference = Math.max(maxDifference, channelMaxDifference);
    perChannel.push({
      baseline,
      current,
      maxDifference: channelMaxDifference,
      rmsDifference,
      relativeRmsDifference: rmsDifference / Math.max(baseline.rms, current.rms),
      absoluteLimit,
      rmsLimit,
      energyDifference,
      energyLimit,
      withinContract:
        baseline.finite &&
        current.finite &&
        baseline.rms > 0.001 &&
        current.rms > 0.001 &&
        channelMaxDifference <= absoluteLimit &&
        rmsDifference <= rmsLimit &&
        energyDifference <= energyLimit,
    });
  }
  return {
    differingSamples,
    differingBytes,
    maxDifference,
    perChannel,
    withinContract: perChannel.every((channel) => channel.withinContract),
  };
}

function numberBits(value: number) {
  if (!Number.isFinite(value)) throw new Error('Non-finite native audio input');
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  return bytes.getBigUint64(0).toString(16).padStart(16, '0');
}

function exactInputs(a: readonly string[], b: readonly string[]) {
  let differences = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) differences++;
  return { events: a.length, differences, exact: differences === 0 };
}

async function renderVoices(
  Voice: typeof EngineVoices,
  sampleRate: number,
  seenWaves: Set<PeriodicWave>,
  outputGain = 1,
) {
  const context = new OfflineAudioContext(2, Math.round(SECONDS * sampleRate), sampleRate);
  // A native unity output gain is identical in every ordinary render. The
  // sensitivity render alone changes it by exactly 2^-10; no PCM is edited.
  const output = context.createGain();
  output.gain.value = outputGain;
  output.connect(context.destination);
  const inputs: string[] = [];
  const names = new Map<AudioNode | AudioParam, string>([[output, 'fixture-output']]);
  const observedNodes: AudioNode[] = [];
  let parameterValues = 0,
    automationEvents = 0,
    waveSelections = 0;
  function observeParameter(parameter: AudioParam, name: string) {
    names.set(parameter, name);
    const value = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(parameter), 'value');
    if (!value?.get || !value.set) throw new Error('Missing native AudioParam value accessor');
    inputs.push(`parameter:${name}:${numberBits(parameter.value)}`);
    Object.defineProperty(parameter, 'value', {
      configurable: true,
      get: () => Reflect.apply(value.get!, parameter, []) as number,
      set: (next: number) => {
        parameterValues++;
        inputs.push(`value:${name}:${numberBits(next)}`);
        Reflect.apply(value.set!, parameter, [next]);
      },
    });
    for (const method of ['setValueAtTime', 'setTargetAtTime', 'cancelScheduledValues'] as const) {
      const native = parameter[method];
      Object.defineProperty(parameter, method, {
        configurable: true,
        value: (...args: number[]) => {
          automationEvents++;
          inputs.push(`${method}:${name}:${args.map(numberBits).join(',')}`);
          return Reflect.apply(native, parameter, args);
        },
      });
    }
  }
  function observeNode<T extends AudioNode>(
    node: T,
    kind: string,
    parameters: Record<string, AudioParam>,
  ) {
    const name = `${kind}:${observedNodes.length}`;
    names.set(node, name);
    observedNodes.push(node);
    inputs.push(`node:${name}`);
    for (const [key, parameter] of Object.entries(parameters))
      observeParameter(parameter, `${name}.${key}`);
    const connect = node.connect;
    Object.defineProperty(node, 'connect', {
      configurable: true,
      value: (destination: AudioNode | AudioParam, ...ports: number[]) => {
        const target = names.get(destination);
        if (!target) throw new Error('Unobserved native engine audio connection');
        inputs.push(`connect:${name}:${target}:${ports.map(numberBits).join(',')}`);
        return Reflect.apply(connect, node, [destination, ...ports]);
      },
    });
    return node;
  }
  const createGain = context.createGain.bind(context);
  context.createGain = () => {
    const node = createGain();
    return observeNode(node, 'gain', { gain: node.gain });
  };
  const createFilter = context.createBiquadFilter.bind(context);
  context.createBiquadFilter = () => {
    const node = createFilter();
    return observeNode(node, 'filter', {
      frequency: node.frequency,
      detune: node.detune,
      Q: node.Q,
      gain: node.gain,
    });
  };
  const createPan = context.createStereoPanner.bind(context);
  context.createStereoPanner = () => {
    const node = createPan();
    return observeNode(node, 'pan', { pan: node.pan });
  };
  const waves: PeriodicWave[] = [],
    oscillators: OscillatorNode[] = [];
  const stops = new Map<OscillatorNode, number>();
  const createWave = context.createPeriodicWave.bind(context);
  context.createPeriodicWave = (...args) => {
    inputs.push(
      `wave:${waves.length}:${Array.from(args[0], numberBits).join(',')}:${Array.from(args[1], numberBits).join(',')}:${JSON.stringify(args[2] ?? null)}`,
    );
    const wave = createWave(...args);
    waves.push(wave);
    return wave;
  };
  const createOscillator = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = createOscillator(),
      stop = oscillator.stop.bind(oscillator);
    observeNode(oscillator, 'oscillator', {
      frequency: oscillator.frequency,
      detune: oscillator.detune,
    });
    const setWave = oscillator.setPeriodicWave.bind(oscillator);
    oscillator.setPeriodicWave = (wave) => {
      waveSelections++;
      inputs.push(`setWave:${names.get(oscillator)}:${waves.indexOf(wave)}`);
      setWave(wave);
    };
    const start = oscillator.start.bind(oscillator);
    oscillator.start = (...args) => {
      inputs.push(
        `start:${names.get(oscillator)}:${args.map((value) => (value === undefined ? 'undefined' : numberBits(value))).join(',')}`,
      );
      start(...args);
    };
    oscillators.push(oscillator);
    oscillator.stop = (when) => {
      stops.set(oscillator, (stops.get(oscillator) ?? 0) + 1);
      stop(when);
    };
    return oscillator;
  };
  const voices = new Voice(context, output);
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
    for (const node of observedNodes) {
      inputs.push(
        `configuration:${names.get(node)}:${node.channelCount}:${node.channelCountMode}:${node.channelInterpretation}:${'type' in node ? node.type : ''}`,
      );
    }
    const rendered = await context.startRendering();
    channels = [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()];
  } finally {
    voices.dispose();
    output.disconnect();
  }
  voices.update(frame(0), view(0), 0.7);
  voices.dispose();
  const reusedWaveObjects = waves.filter((wave) => seenWaves.has(wave)).length;
  waves.forEach((wave) => seenWaves.add(wave));
  return {
    channels,
    inputs,
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
      suppliedInputs: {
        events: inputs.length,
        parameterValues,
        automationEvents,
        waveSelections,
        digest: await digestBytes(new TextEncoder().encode(inputs.join('\n'))),
      },
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
  type Render = Awaited<ReturnType<typeof renderVoices>>;
  let firstCurrent: Render | null = null;
  let firstBaseline: Render | null = null;
  let renders = 0,
    renderedSamples = 0;
  const render = async (Voice: typeof EngineVoices, sampleRate: number, outputGain = 1) => {
    const result = await renderVoices(Voice, sampleRate, waves, outputGain);
    renders++;
    renderedSamples += result.report.signal.samples;
    return result;
  };
  const compareRenders = (a: Render, b: Render) => ({
    ...compare(a.channels, b.channels),
    suppliedInputs: exactInputs(a.inputs, b.inputs),
    digests: [a.report.digest, b.report.digest],
  });
  for (const [index, sampleRate] of [44100, 44100, 48000, 96000].entries()) {
    const baseline = await render(original.EngineVoices, sampleRate);
    const current = await render(EngineVoices, sampleRate);
    const sameRateRepeat =
      index === 0
        ? null
        : {
            baseline: compareRenders(
              index === 1 ? firstBaseline! : await render(original.EngineVoices, sampleRate),
              baseline,
            ),
            current: compareRenders(
              index === 1 ? firstCurrent! : await render(EngineVoices, sampleRate),
              current,
            ),
          };
    cases.push({
      numericCache: index === 0 ? 'cold module' : 'warm module',
      baseline: baseline.report,
      current: current.report,
      ...compareRenders(baseline, current),
      sameRateRepeat,
    });
    if (index === 0) {
      firstBaseline = baseline;
      firstCurrent = current;
    }
  }
  const factor = 1 + 2 ** -10;
  const perturbed = await render(EngineVoices, 44100, factor);
  return {
    seconds: SECONDS,
    vehicles: [...VEHICLES],
    families: VEHICLES.map((_, id) => frameCharacter(frame(0), id).profile.family),
    cases,
    contract: {
      unitRoundoff: UNIT_ROUNDOFF,
      mixAdditions: MIX_ADDITIONS,
      relativeBudget: RELATIVE_BUDGET,
    },
    sensitivity: {
      factor,
      sampleRate: 44100,
      ...compareRenders(firstBaseline!, perturbed),
      render: perturbed.report,
    },
    renders,
    renderedSamples,
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
  const closeOutcomes: string[] = [];
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
    pending.then(
      () => closeOutcomes.push('fulfilled'),
      () => closeOutcomes.push('rejected'),
    );
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
    closeOutcomes: [...closeOutcomes],
    resumeRequests: resumes.length,
    sourceHandlers: sources.filter((source) => source.onended !== null).length,
    resumeOutcomes: [...resumeOutcomes],
  });
  return { context, nodes, sources, closes, resumes, snapshot };
}

async function nativeDeadline<T>(stage: string, promise: Promise<T>) {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error(`Native audio operation timed out during ${stage}`)),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type SuspensionDiagnostic = {
  stage: string;
  failure: { stage: string; message: string } | null;
  cleanupFailure: string | null;
  history: {
    stage: string;
    activation: boolean;
    states: AudioContextState[];
    contexts: ReturnType<ReturnType<typeof watchContext>['snapshot']>[];
  }[];
};
let suspensionDiagnostic: SuspensionDiagnostic | null = null;

/** Retained even when a native await rejects, so CI attaches the failed stage. */
export function cueSuspensionDiagnostics() {
  return suspensionDiagnostic;
}

/** Real live contexts, nodes, resume and close promises. Instrumented methods
 * forward every call. Only explicit delivery of captured old ended callbacks
 * is controlled; it is not claimed as an observed native event ordering. */
export async function cueSuspension() {
  const contexts = Array.from({ length: 3 }, () => new AudioContext({ sampleRate: 48000 }));
  let watched: ReturnType<typeof watchContext>[] = [];
  const diagnostic: SuspensionDiagnostic = {
    stage: 'created',
    failure: null,
    cleanupFailure: null,
    history: [],
  };
  suspensionDiagnostic = diagnostic;
  const mark = (stage: string) => {
    diagnostic.stage = stage;
    diagnostic.history.push({
      stage,
      activation: navigator.userActivation.hasBeenActive,
      states: contexts.map((context) => context.state),
      contexts: watched.map((item) => item.snapshot()),
    });
  };
  let sounds: UiSounds | null = null;
  try {
    mark('initial-resumes');
    await nativeDeadline(
      'initial-resumes',
      Promise.all(contexts.map((context) => context.resume())),
    );
    watched = contexts.map(watchContext);
    mark('initial-resumes-complete');
    const target = new EventTarget();
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

    mark('suspend-second-context');
    await nativeDeadline('suspend-second-context', contexts[1].suspend());
    mark('second-context-suspended');
    const suspendedState = contexts[1].state;
    const pendingCueAccepted = sounds.cue('tick');
    const resumeWasPending =
      watched[1].resumes.length === 1 && watched[1].snapshot().resumeOutcomes.length === 0;
    sounds.suspend();
    uiCue('confirm', target);
    const replacementBefore = { cues: cueCount(sounds), graph: watched[2].snapshot() };
    for (const { source, handler } of oldHandlers) handler?.call(source, new Event('ended'));
    const replacementAfter = { cues: cueCount(sounds), graph: watched[2].snapshot() };
    mark('settle-old-resumes-and-closes');
    await nativeDeadline(
      'settle-old-resumes-and-closes',
      Promise.allSettled(watched.flatMap((item) => [...item.resumes, ...item.closes])),
    );
    mark('old-resumes-and-closes-settled');
    const afterSettled = watched.map((item) => item.snapshot());
    const deliberateFreshCue = sounds.cue('deny');
    const playedBeforeDispose = sounds.played;
    sounds.dispose();
    sounds.dispose();
    uiCue('confirm', target);
    mark('terminal-closes');
    await nativeDeadline(
      'terminal-closes',
      Promise.allSettled(watched.flatMap((item) => item.closes)),
    );
    mark('complete');
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
  } catch (error) {
    diagnostic.failure = {
      stage: diagnostic.stage,
      message: error instanceof Error ? error.message : String(error),
    };
    mark('failure-snapshot');
    throw error;
  } finally {
    sounds?.dispose();
    mark('cleanup-closes');
    try {
      await nativeDeadline(
        'cleanup-closes',
        Promise.allSettled(
          contexts
            .filter((context) => context.state !== 'closed')
            .map((context) => context.close()),
        ),
      );
      mark('cleanup-complete');
    } catch (error) {
      diagnostic.cleanupFailure = error instanceof Error ? error.message : String(error);
      mark('cleanup-failure');
    }
  }
}
