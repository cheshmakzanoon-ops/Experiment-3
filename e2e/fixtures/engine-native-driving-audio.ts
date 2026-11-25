import { RacingAudio } from '../../src/audio/engine.ts';
import { validateDrivingAudio, type DrivingCueDirector } from '../../src/audio/driving-cues.ts';
import type { AudioView } from '../../src/audio/spatial.ts';
import { GUIDE_SPACING } from '../../src/rendering/driving-guide.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  carBase,
  snapshotIncompatibility,
} from '../../src/simulation/protocol.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { VEHICLE_IDS, vehicleIndex } from '../../src/simulation/vehicles.ts';

const SAMPLE_RATE = 48000;
const RENDER_FRAMES = SAMPLE_RATE;

const settings = validateDrivingAudio({
  enabled: true,
  volume: 0.7,
  brake: false,
  turns: false,
  trackLimits: false,
  wrongWay: false,
});
const view: AudioView = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  rightX: 1,
  rightY: 0,
  rightZ: 0,
  interior: true,
  followedCar: 0,
};
const o = carBase(0);

type CueNodes = { oscillator: OscillatorNode; gain: GainNode; pan: StereoPannerNode };
type AudioInternals = {
  context: BaseAudioContext | null;
  cueTrack: Track | null;
  cueDirector: DrivingCueDirector | null;
  cueSynth: CueNodes | null;
  bus: { output: AudioNode } | null;
};
type Automation = { parameter: string; method: string; args: number[] };
type Signal = { samples: number; peak: number; rms: number; finite: boolean };
type Capture = { start: number; end: number; cue: Signal; mix: Signal };
type Checkpoint = { from: number; requested: number; time: number; state: AudioContextState };

// These deadlines only fail a stuck native operation; they never advance audio.
async function deadline<T>(stage: string, pending: Promise<T>): Promise<T> {
  let timer = 0;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error(`Native audio timeout: ${stage}`)),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function signal(samples: Float32Array): Signal {
  let peak = 0;
  let squareSum = 0;
  let finite = true;
  for (const sample of samples) {
    finite &&= Number.isFinite(sample);
    peak = Math.max(peak, Math.abs(sample));
    squareSum += sample * sample;
  }
  return { samples: samples.length, peak, rms: Math.sqrt(squareSum / samples.length), finite };
}

/** Read actual native PCM only after the complete offline render. Window
 * boundaries come from native suspension checkpoints, not a simulated clock. */
function capture(buffer: AudioBuffer, start: number, end: number): Capture {
  const from = Math.round(start * buffer.sampleRate),
    to = Math.round(end * buffer.sampleRate);
  if (from < 0 || to <= from || to > buffer.length)
    throw new Error('Invalid native PCM capture window');
  return {
    start,
    end,
    cue: signal(buffer.getChannelData(0).subarray(from, to)),
    mix: signal(buffer.getChannelData(1).subarray(from, to)),
  };
}

function observeSynth(synth: CueNodes) {
  const automation: Automation[] = [];
  let stops = 0;
  for (const [name, parameter] of [
    ['frequency', synth.oscillator.frequency],
    ['gain', synth.gain.gain],
    ['pan', synth.pan.pan],
  ] as const) {
    for (const method of [
      'setValueAtTime',
      'linearRampToValueAtTime',
      'cancelScheduledValues',
      'setTargetAtTime',
    ] as const) {
      const native = parameter[method];
      Object.defineProperty(parameter, method, {
        configurable: true,
        value: (...args: number[]) => {
          automation.push({ parameter: name, method, args });
          return Reflect.apply(native, parameter, args);
        },
      });
    }
  }
  const stop = synth.oscillator.stop.bind(synth.oscillator);
  synth.oscillator.stop = (...args) => {
    stops++;
    stop(...args);
  };
  return { automation, stops: () => stops };
}

/** Preserve the production cue -> master -> dynamics path. Route the left
 * channel of its cue stem and final mix to separate offline buffer channels.
 * Only the final destination connection changes: no gain, synthesis, envelope
 * or production clock is replaced, and the two measurements cannot sum. */
function observeOutput(context: OfflineAudioContext, synth: CueNodes, output: AudioNode) {
  const cue = context.createChannelSplitter(2),
    mix = context.createChannelSplitter(2),
    channels = context.createChannelMerger(2);
  synth.pan.connect(cue);
  cue.connect(channels, 0, 0);
  output.disconnect(context.destination);
  output.connect(mix);
  mix.connect(channels, 0, 1);
  channels.connect(context.destination);
  return {
    dispose() {
      cue.disconnect();
      mix.disconnect();
      channels.disconnect();
    },
  };
}

function fixture() {
  const track = new Track('clear', true),
    point = track.at(30, trackPoint()),
    frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  frame[H.PHASE] = 2;
  frame[H.TICK] = 1;
  frame[o + F.S] = 30;
  frame[o + F.QW] = 1;
  frame[o + F.SPEED] = 35;
  frame[o + F.VX] = point.tx * 35;
  frame[o + F.VZ] = point.tz * 35;
  frame[o + F.RPM] = 8090;
  frame[o + F.GEAR] = 3;
  frame[o + F.THROTTLE] = 1;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('tc1');
  let trackSamples = 0;
  const at = track.at.bind(track);
  // Count the real instance after fixture construction. GuideRoute, Track.at,
  // the director, the cue synth and the native clock retain their real behavior.
  track.at = (...args) => {
    trackSamples++;
    return at(...args);
  };
  return {
    track,
    frame,
    trackSamples: () => trackSamples,
    routeSamples: Math.ceil(track.length / GUIDE_SPACING),
  };
}

function graph() {
  const context = new OfflineAudioContext(2, RENDER_FRAMES, SAMPLE_RATE),
    initial = context.state,
    audio = new RacingAudio(),
    input = fixture(),
    internals = audio as unknown as AudioInternals,
    checkpoints: Checkpoint[] = [];
  // Real public mixer controls isolate the accessibility path while every
  // production bus/voice remains present and receives normal frame updates.
  audio.setLevels({ engine: 0, effects: 0, ambience: 0, ui: 0, music: 0 });
  let observation: ReturnType<typeof observeSynth> | null = null;
  let output: ReturnType<typeof observeOutput> | null = null;
  let mutations = 0;
  let started: AudioContextState | null = null;
  let renderedState: AudioContextState | null = null;
  let rendering: Promise<AudioBuffer> | null = null;
  let rendered: AudioBuffer | null = null;
  const completed = new Promise<void>((resolve) => {
    context.addEventListener('complete', () => resolve(), { once: true });
  });
  const snapshot = () => ({
    time: context.currentTime,
    trackSamples: input.trackSamples(),
    hasDirector: internals.cueDirector !== null,
    drivingCues: audio.diagnostics().drivingCues,
  });
  async function render() {
    if (rendered) return rendered;
    if (!rendering) rendering = context.startRendering();
    else if (context.state === 'suspended')
      await deadline('offline final resume', context.resume());
    const [buffer] = await deadline(
      'offline render completion',
      Promise.all([rendering, completed]),
    );
    rendered = buffer;
    renderedState = context.state;
    return buffer;
  }
  return {
    ...input,
    context,
    audio,
    internals,
    checkpoints,
    snapshot,
    render,
    get observation() {
      if (!observation) throw new Error('Native cue synth has not started');
      return observation;
    },
    get renderInfo() {
      return {
        frames: rendered?.length ?? 0,
        channels: rendered?.numberOfChannels ?? 0,
        finalTime: context.currentTime,
      };
    },
    async start() {
      await deadline('RacingAudio.start', audio.start(context));
      started = context.state;
      if (started !== 'suspended' || context.currentTime !== 0)
        throw new Error('Offline startup must build the graph before native rendering');
      if (!internals.cueSynth || !internals.bus)
        throw new Error('Production cue graph is missing');
      observation = observeSynth(internals.cueSynth);
      output = observeOutput(context, internals.cueSynth, internals.bus.output);
    },
    /** Schedule while suspended, then let the native renderer reach the next
     * checkpoint. The 40 ms steps exceed RacingAudio's 25 ms update throttle;
     * the 160 ms captures include the whole 90 ms cue and mixer tail. */
    async advance(seconds = 0.04) {
      if (context.state !== 'suspended')
        throw new Error('Offline checkpoints must be scheduled while suspended');
      const from = context.currentTime,
        requested =
          (Math.round(from * SAMPLE_RATE) + Math.round(seconds * SAMPLE_RATE)) / SAMPLE_RATE;
      if (requested >= RENDER_FRAMES / SAMPLE_RATE)
        throw new Error('Offline checkpoint exceeds the bounded render');
      const suspended = context.suspend(requested);
      let resumed: Promise<void> = Promise.resolve();
      if (!rendering) {
        rendering = context.startRendering();
        // The final render is awaited by render(); also handle an early native
        // rejection while a suspension promise is still pending.
        void rendering.catch(() => undefined);
      } else resumed = context.resume();
      await deadline('offline suspension checkpoint', Promise.all([suspended, resumed]));
      checkpoints.push({ from, requested, time: context.currentTime, state: context.state });
    },
    update(playing = true, liveHuman = true) {
      input.frame[H.TICK]++;
      const before = input.frame.slice();
      audio.update(input.frame, true, playing, view, liveHuman);
      if (!input.frame.every((value, index) => Object.is(value, before[index]))) mutations++;
      return snapshot();
    },
    async dispose() {
      const beforeDispose = context.state,
        first = audio.dispose(),
        repeated = audio.dispose(),
        sameDisposal = first === repeated;
      try {
        await deadline('repeated RacingAudio.dispose', Promise.all([first, repeated]));
      } finally {
        output?.dispose();
        // An assertion/setup failure can leave native rendering suspended.
        // Finish that finite buffer after releasing the production graph.
        if (rendering && !rendered) await render();
      }
      return {
        initial,
        started,
        rendered: renderedState,
        beforeDispose,
        state: context.state,
        ownerReleased: internals.context === null,
        ownerState: audio.diagnostics().state,
        sameDisposal,
        cueStops: observation?.stops() ?? 0,
        retainedTrack: internals.cueTrack !== null,
        retainedDirector: internals.cueDirector !== null,
        retainedSynth: internals.cueSynth !== null,
        retainedBus: internals.bus !== null,
        frameMutations: mutations,
      };
    },
  };
}

/** Yield one event-loop task to observe unhandled rejections from cleanup.
 * This is a message turn, never a wall-clock or audio-clock sleep. */
function drainTask() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

async function run<T extends object>(scenario: (owner: ReturnType<typeof graph>) => Promise<T>) {
  const owner = graph(),
    unhandled: string[] = [];
  const onRejection = (event: PromiseRejectionEvent) => unhandled.push(String(event.reason));
  window.addEventListener('unhandledrejection', onRejection);
  let report!: T;
  let lifecycle!: Awaited<ReturnType<typeof owner.dispose>>;
  try {
    report = await scenario(owner);
  } finally {
    try {
      lifecycle = await owner.dispose();
      await drainTask();
    } finally {
      window.removeEventListener('unhandledrejection', onRejection);
    }
  }
  return {
    ...report,
    lifecycle,
    unhandled,
    contextKind: 'OfflineAudioContext' as const,
    sampleRate: owner.context.sampleRate,
    checkpoints: owner.checkpoints,
    render: owner.renderInfo,
    frameCompatibility: snapshotIncompatibility(owner.frame, undefined, VEHICLE_IDS.length),
  };
}

export function disabledConfiguration() {
  return run(async (g) => {
    const inactive = [
      ['disabled', validateDrivingAudio(null)],
      ['zero volume', { ...settings, volume: 0 }],
      ['all cue types disabled', { ...settings, gears: false }],
    ] as const;
    for (const [, value] of inactive) {
      g.audio.configureDriving(g.track, value);
      g.audio.configureDriving(g.track, value);
      g.update();
    }
    const beforeStart = { ...g.snapshot(), state: g.audio.diagnostics().state };
    await g.start();
    const start = g.context.currentTime,
      cases = [];
    for (const [name, value] of inactive) {
      g.audio.configureDriving(g.track, value);
      g.observation.automation.length = 0;
      await g.advance();
      cases.push({ name, ...g.update(), automation: [...g.observation.automation] });
    }
    await g.advance();
    const end = g.context.currentTime,
      buffer = await g.render();
    return { beforeStart, cases, signal: capture(buffer, start, end) };
  });
}

export function lazyRouteReuse() {
  return run(async (g) => {
    g.audio.configureDriving(g.track, settings);
    g.update();
    const beforeStart = g.snapshot();
    await g.start();
    const gatedStart = g.context.currentTime,
      gated = [];
    for (const [name, playing, liveHuman, muted] of [
      ['paused', false, true, false],
      ['nonhuman', true, false, false],
      ['muted', true, true, true],
    ] as const) {
      g.audio.muted = muted;
      await g.advance();
      gated.push({ name, ...g.update(playing, liveHuman) });
    }
    await g.advance();
    const gatedEnd = g.context.currentTime;
    g.audio.muted = false;
    const latest = { ...settings };
    g.audio.configureDriving(g.track, latest);
    latest.volume = 0;
    g.observation.automation.length = 0;
    const cueStart = g.context.currentTime,
      first = g.update(),
      director = g.internals.cueDirector,
      route = director?.route,
      automation = [...g.observation.automation];
    await g.advance(0.16);
    const cueEnd = g.context.currentTime;
    // Below the shift threshold: reuse does not depend on cue cooldown.
    g.frame[o + F.RPM] = 6000;
    await g.advance();
    const reused = g.update();
    g.audio.configureDriving(g.track, { ...settings, enabled: false });
    await g.advance();
    const disabled = g.update();
    g.audio.configureDriving(g.track, settings);
    await g.advance();
    const reenabled = g.update(),
      retainedDirector = g.internals.cueDirector === director,
      retainedRoute = g.internals.cueDirector?.route === route,
      buffer = await g.render();
    return {
      beforeStart,
      gated,
      gatedSignal: capture(buffer, gatedStart, gatedEnd),
      first,
      reused,
      disabled,
      reenabled,
      routeSamples: g.routeSamples,
      retainedDirector,
      retainedRoute,
      routePoints: route ? route.points.length / 3 : 0,
      automation,
      signal: capture(buffer, cueStart, cueEnd),
    };
  });
}

export function vehicleGearCues() {
  return run(async (g) => {
    g.audio.configureDriving(g.track, settings);
    await g.start();
    const cases = [];
    for (const [vehicle, rpm, gear] of [
      ['gpr1', 18190, 6],
      ['gpr1', 18190, 5],
      ['tc1', 8090, 3],
    ] as const) {
      g.frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
      g.frame[o + F.RPM] = rpm;
      g.frame[o + F.GEAR] = gear;
      // The same-track production configuration resets any prior cue cooldown.
      g.audio.configureDriving(g.track, settings);
      await g.advance();
      g.observation.automation.length = 0;
      const start = g.context.currentTime,
        emittedBefore = g.audio.diagnostics().drivingCues.emitted,
        snapshot = g.update(),
        automation = [...g.observation.automation];
      await g.advance(0.16);
      cases.push({
        vehicle,
        rpm,
        gear,
        ...snapshot,
        emitted: snapshot.drivingCues.emitted - emittedBefore,
        automation,
        start,
        end: g.context.currentTime,
      });
    }
    const buffer = await g.render();
    return {
      cases: cases.map(({ start, end, ...item }) => ({
        ...item,
        signal: capture(buffer, start, end),
      })),
      routeSamples: g.routeSamples,
    };
  });
}
