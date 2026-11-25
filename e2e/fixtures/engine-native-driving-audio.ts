import { RacingAudio } from '../../src/audio/engine.ts';
import {
  validateDrivingAudio,
  type DrivingCueDirector,
} from '../../src/audio/driving-cues.ts';
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
  cueTrack: Track | null;
  cueDirector: DrivingCueDirector | null;
  cueSynth: CueNodes | null;
  bus: { output: AudioNode } | null;
};
type Automation = { parameter: string; method: string; args: number[] };
type Signal = { samples: number; peak: number; rms: number; finite: boolean };
type Capture = { cue: Signal; mix: Signal };

// This observer records real rendered input in the audio thread, so a busy
// browser task cannot miss the 90 ms cue. Its output is silent; the production
// graph remains connected to its original destination. It does not synthesize,
// reschedule or replace any production audio. The first channel is sufficient
// for these centred gear cues; this is not a stereo or physical-speaker test.
const PROBE_SOURCE = `
class DrivingAudioProbe extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.stats = [];
    this.port.onmessage = ({ data }) => {
      if (data === 'begin') {
        this.stats = Array.from({ length: 2 }, () =>
          ({ samples: 0, peak: 0, squares: 0, finite: true }));
        this.recording = true;
      } else {
        this.recording = false;
      }
      const summarize = ({ samples, peak, squares, finite }) =>
        ({ samples, peak, rms: samples ? Math.sqrt(squares / samples) : 0, finite });
      this.port.postMessage({ cue: summarize(this.stats[0]), mix: summarize(this.stats[1]) });
    };
  }
  process(inputs) {
    if (this.recording) {
      for (let i = 0; i < 2; i++) {
        const channel = inputs[i][0];
        if (!channel) continue;
        const stats = this.stats[i];
        for (const value of channel) {
          stats.samples++;
          stats.finite = stats.finite && Number.isFinite(value);
          stats.peak = Math.max(stats.peak, Math.abs(value));
          stats.squares += value * value;
        }
      }
    }
    return true;
  }
}
registerProcessor('engine-driving-audio-probe', DrivingAudioProbe);
`;

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

/** Advance by rendered audio, without changing currentTime or using a wall-clock sleep. */
async function advance(context: AudioContext, seconds = 0.04) {
  const source = context.createBufferSource();
  source.buffer = context.createBuffer(
    1,
    Math.ceil(seconds * context.sampleRate),
    context.sampleRate,
  );
  source.connect(context.destination);
  try {
    await deadline(
      'native render barrier',
      new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      }),
    );
  } finally {
    source.onended = null;
    source.disconnect();
  }
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

async function observeOutput(context: AudioContext, synth: CueNodes, output: AudioNode) {
  const url = URL.createObjectURL(new Blob([PROBE_SOURCE], { type: 'text/javascript' }));
  try {
    await deadline('PCM observer module', context.audioWorklet.addModule(url));
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(context, 'engine-driving-audio-probe', {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  synth.pan.connect(node, 0, 0);
  output.connect(node, 0, 1);
  node.connect(context.destination);
  const command = (action: 'begin' | 'end') =>
    deadline(
      `PCM observer ${action}`,
      new Promise<Capture>((resolve, reject) => {
        node.onprocessorerror = () => reject(new Error('Native PCM observer failed'));
        node.port.onmessage = (event: MessageEvent<Capture>) => resolve(event.data);
        node.port.postMessage(action);
      }),
    );
  return {
    begin: () => command('begin'),
    end: () => command('end'),
    dispose() {
      node.port.onmessage = null;
      node.onprocessorerror = null;
      node.port.close();
      node.disconnect();
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
  const context = new AudioContext({ sampleRate: 48000 }),
    audio = new RacingAudio(),
    input = fixture(),
    internals = audio as unknown as AudioInternals;
  // Real public mixer controls isolate the accessibility path while every
  // production bus/voice remains present and receives normal frame updates.
  audio.setLevels({ engine: 0, effects: 0, ambience: 0, ui: 0, music: 0 });
  let observation: ReturnType<typeof observeSynth> | null = null;
  let output: Awaited<ReturnType<typeof observeOutput>> | null = null;
  let mutations = 0;
  let started: AudioContextState | null = null;
  const snapshot = () => ({
    trackSamples: input.trackSamples(),
    hasDirector: internals.cueDirector !== null,
    drivingCues: audio.diagnostics().drivingCues,
  });
  return {
    ...input,
    context,
    audio,
    internals,
    snapshot,
    get observation() {
      if (!observation) throw new Error('Native cue synth has not started');
      return observation;
    },
    get output() {
      if (!output) throw new Error('Native output observer has not started');
      return output;
    },
    async start() {
      await deadline('RacingAudio.start', audio.start(context));
      started = context.state;
      if (started !== 'running') throw new Error(`Native context did not run: ${started}`);
      if (!internals.cueSynth || !internals.bus)
        throw new Error('Production cue graph is missing');
      observation = observeSynth(internals.cueSynth);
      output = await observeOutput(context, internals.cueSynth, internals.bus.output);
    },
    update(playing = true, liveHuman = true) {
      input.frame[H.TICK]++;
      const before = input.frame.slice();
      audio.update(input.frame, true, playing, view, liveHuman);
      if (!input.frame.every((value, index) => Object.is(value, before[index]))) mutations++;
      return snapshot();
    },
    async dispose() {
      let ownerClosed = false;
      try {
        output?.dispose();
      } finally {
        try {
          await deadline('RacingAudio.dispose', audio.dispose());
          await deadline('repeated RacingAudio.dispose', audio.dispose());
        } finally {
          ownerClosed = context.state === 'closed';
          if (!ownerClosed) await deadline('fallback native close', context.close());
        }
      }
      return {
        started,
        state: context.state,
        ownerClosed,
        ownerState: audio.diagnostics().state,
        cueStops: observation?.stops() ?? 0,
        retainedTrack: internals.cueTrack !== null,
        retainedDirector: internals.cueDirector !== null,
        retainedSynth: internals.cueSynth !== null,
        frameMutations: mutations,
      };
    },
  };
}

async function run<T extends object>(
  scenario: (owner: ReturnType<typeof graph>) => Promise<T>,
) {
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
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } finally {
      window.removeEventListener('unhandledrejection', onRejection);
    }
  }
  return {
    ...report,
    lifecycle,
    unhandled,
    activation: navigator.userActivation.hasBeenActive,
    sampleRate: owner.context.sampleRate,
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
    await g.output.begin();
    const cases = [];
    for (const [name, value] of inactive) {
      g.audio.configureDriving(g.track, value);
      g.observation.automation.length = 0;
      await advance(g.context);
      cases.push({ name, ...g.update(), automation: [...g.observation.automation] });
    }
    await advance(g.context);
    return { beforeStart, cases, signal: await g.output.end() };
  });
}

export function lazyRouteReuse() {
  return run(async (g) => {
    g.audio.configureDriving(g.track, settings);
    g.update();
    const beforeStart = g.snapshot();
    await g.start();
    await g.output.begin();
    const gated = [];
    for (const [name, playing, liveHuman, muted] of [
      ['paused', false, true, false],
      ['nonhuman', true, false, false],
      ['muted', true, true, true],
    ] as const) {
      g.audio.muted = muted;
      await advance(g.context);
      gated.push({ name, ...g.update(playing, liveHuman) });
    }
    await advance(g.context);
    const gatedSignal = await g.output.end();
    g.audio.muted = false;
    const latest = { ...settings };
    g.audio.configureDriving(g.track, latest);
    latest.volume = 0;
    g.observation.automation.length = 0;
    await g.output.begin();
    const first = g.update(),
      director = g.internals.cueDirector,
      route = director?.route,
      automation = [...g.observation.automation];
    await advance(g.context, 0.16);
    const signal = await g.output.end();
    // Below the shift threshold: reuse should not depend on a wall-clock
    // cooldown remaining unexpired while the hosted runner schedules tasks.
    g.frame[o + F.RPM] = 6000;
    await advance(g.context);
    const reused = g.update();
    g.audio.configureDriving(g.track, { ...settings, enabled: false });
    await advance(g.context);
    const disabled = g.update();
    g.audio.configureDriving(g.track, settings);
    await advance(g.context);
    const reenabled = g.update();
    return {
      beforeStart,
      gated,
      gatedSignal,
      first,
      reused,
      disabled,
      reenabled,
      routeSamples: g.routeSamples,
      retainedDirector: g.internals.cueDirector === director,
      retainedRoute: g.internals.cueDirector?.route === route,
      routePoints: route ? route.points.length / 3 : 0,
      automation,
      signal,
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
      await advance(g.context);
      g.observation.automation.length = 0;
      await g.output.begin();
      const emittedBefore = g.audio.diagnostics().drivingCues.emitted,
        snapshot = g.update(),
        automation = [...g.observation.automation];
      await advance(g.context, 0.16);
      cases.push({
        vehicle,
        rpm,
        gear,
        ...snapshot,
        emitted: snapshot.drivingCues.emitted - emittedBefore,
        automation,
        signal: await g.output.end(),
      });
    }
    return { cases, routeSamples: g.routeSamples };
  });
}
