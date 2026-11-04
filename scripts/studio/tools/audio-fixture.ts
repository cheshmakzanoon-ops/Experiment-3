import { RacingAudio } from '../../../src/audio/engine.ts';
import { UI_SOUNDS, UiSounds, type UiSoundId } from '../../../src/audio/ui-sounds.ts';
import { H } from '../../../src/simulation/protocol.ts';
import type { UiCue } from '../../../src/ui/ui-cue.ts';
import {
  FRAME_STEP,
  SAMPLE_RATE,
  effectScenarios,
  engineScenarios,
  mixScenarios,
  type Scenario,
  type ScenarioMeta,
} from './audio-scenarios.ts';

/** Browser side of the offline audio rig (audio-render.mjs bundles this file as
 * an IIFE named MotoAudioRig and injects it into a blank page). Every render
 * runs the production RacingAudio graph in an OfflineAudioContext, stepping the
 * presented snapshot with context.suspend() exactly like the game's per-frame
 * update, so the numbers describe the shipped signal path. */

export interface RigOptions {
  /** The player's master volume setting (the game default is 0.45). */
  volume?: number;
  /** Bus levels (0..1) layered over the scenario's own stems. */
  buses?: Record<string, number>;
  bypassDynamics?: boolean;
}

function catalogue(): Scenario[] {
  return [...engineScenarios(), ...effectScenarios(), ...mixScenarios()];
}

const meta = (s: Scenario): ScenarioMeta => ({
  id: s.id,
  group: s.group,
  vehicle: s.vehicle,
  family: s.family,
  label: s.label,
  seconds: s.seconds,
  view: s.view,
  events: s.events,
  transients: s.transients ?? [],
  f0: s.f0,
  tags: s.tags,
});

function encode(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export interface Rendered {
  meta: ScenarioMeta & { sampleRate: number; options: RigOptions };
  left: string;
  right: string;
}

/** Applies mixer settings when the build under test has them (the baseline does not). */
function configure(audio: RacingAudio, buses: Record<string, number>, bypass: boolean) {
  const target = audio as unknown as {
    levels?: Record<string, number>;
    bypassDynamics?: (on: boolean) => void;
  };
  if (target.levels) for (const [k, v] of Object.entries(buses)) target.levels[k] = v;
  if (bypass) target.bypassDynamics?.(true);
}

async function renderScene(sc: Scenario, options: RigOptions): Promise<Rendered> {
  const length = Math.ceil(sc.seconds * SAMPLE_RATE);
  const context = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const audio = new RacingAudio();
  audio.volume = options.volume ?? 0.45;
  await audio.start(context);
  configure(
    audio,
    { ...(sc.buses ?? {}), ...(options.buses ?? {}) },
    options.bypassDynamics ?? sc.bypassDynamics ?? false,
  );
  const cockpit = sc.view === 'cockpit';
  const step = (t: number) => {
    const frame = sc.frameAt(t);
    if (frame[H.TIME] === 0) frame[H.TIME] = t;
    audio.update(frame, cockpit, true, sc.viewAt(t), false);
  };
  step(0);
  const steps = Math.floor(sc.seconds / FRAME_STEP);
  for (let k = 1; k < steps; k++) {
    const t = k * FRAME_STEP;
    void context.suspend(t).then(() => {
      step(t);
      return context.resume();
    });
  }
  const buffer = await context.startRendering();
  await audio.dispose();
  return {
    meta: { ...meta(sc), sampleRate: SAMPLE_RATE, options },
    left: encode(buffer.getChannelData(0)),
    right: encode(buffer.getChannelData(1)),
  };
}

/** Menu sounds through the real UiSounds recipes into an offline context. */
async function renderUi(cue: UiCue, volume: number): Promise<Rendered> {
  const seconds = 0.7;
  const context = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const standIn = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: context.destination,
    sampleRate: context.sampleRate,
    resume: async () => undefined,
    close: async () => undefined,
    createGain: () => context.createGain(),
    createOscillator: () => context.createOscillator(),
    createBufferSource: () => context.createBufferSource(),
    createBiquadFilter: () => context.createBiquadFilter(),
    createBuffer: (c: number, l: number, r: number) => context.createBuffer(c, l, r),
    createWaveShaper: () => context.createWaveShaper(),
  };
  const sounds = new UiSounds({
    settings: () => ({ volume, muted: false }),
    target: new EventTarget(),
    activated: () => true,
    createContext: () => standIn,
  });
  sounds.cue(cue);
  const buffer = await context.startRendering();
  sounds.dispose();
  return {
    meta: {
      id: `ui__${cue}`,
      group: 'ui',
      vehicle: null,
      family: null,
      label: `Menu sound: ${cue}`,
      seconds,
      view: 'cockpit',
      events: [0],
      f0: null,
      tags: { stem: 'ui', cue, volume },
      sampleRate: SAMPLE_RATE,
      options: { volume },
    },
    left: encode(buffer.getChannelData(0)),
    right: encode(buffer.getChannelData(1)),
  };
}

/** The accessibility driving tones (turn left, brake, turn right) through the
 * game's master bus. */
async function renderDrivingCues(): Promise<Rendered> {
  const seconds = 1.2;
  const context = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const audio = new RacingAudio();
  audio.volume = 0.45;
  await audio.start(context);
  await audio.previewDriving({
    enabled: true,
    volume: 0.35,
    lookahead: 30,
    invertStereo: false,
    brake: true,
    turns: true,
    gears: true,
    trackLimits: true,
    wrongWay: true,
  });
  const buffer = await context.startRendering();
  await audio.dispose();
  return {
    meta: {
      id: 'ui__driving-cues',
      group: 'ui',
      vehicle: null,
      family: null,
      label: 'Accessibility driving tones preview (left, centre, right)',
      seconds,
      view: 'cockpit',
      events: [0, 0.25, 0.5],
      f0: null,
      tags: { stem: 'cues' },
      sampleRate: SAMPLE_RATE,
      options: {},
    },
    left: encode(buffer.getChannelData(0)),
    right: encode(buffer.getChannelData(1)),
  };
}

/** Live-context smoke test (autoplay policy, unlock, review tap): driven in steps by
 * audio-render.mjs --live, which supplies the real user gesture between them. */
let live: RacingAudio | null = null;
async function liveStart() {
  live = new RacingAudio();
  const t0 = performance.now();
  await live.start();
  return {
    ms: Math.round(performance.now() - t0),
    state: live.diagnostics().state,
    locked: live.locked,
    activation: navigator.userActivation?.hasBeenActive ?? null,
  };
}
const liveState = () => ({
  state: live?.diagnostics().state ?? null,
  locked: live?.locked ?? null,
});
async function liveTap() {
  if (!live) throw new Error('liveStart first');
  const scene = catalogue().find((s) => s.id === 'engine__apx01__mid__cockpit')!;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 6; i++) {
    live.update(scene.frameAt(0), true, true, scene.viewAt(0), false);
    await wait(60);
  }
  const stream = live.captureOutput().stream;
  const listener = new AudioContext();
  await listener.resume();
  const analyser = listener.createAnalyser();
  analyser.fftSize = 2048;
  listener.createMediaStreamSource(stream).connect(analyser);
  let peak = 0;
  const data = new Float32Array(analyser.fftSize);
  for (let i = 0; i < 10; i++) {
    live.update(scene.frameAt(0), true, true, scene.viewAt(0), false);
    await wait(60);
    analyser.getFloatTimeDomainData(data);
    for (const v of data) peak = Math.max(peak, Math.abs(v));
  }
  await listener.close();
  await live.dispose();
  live = null;
  return { peak, peakDbfs: 20 * Math.log10(Math.max(peak, 1e-9)) };
}

/** What the browser does with resume() before any gesture: the premise of unlock.ts. */
async function probeResume() {
  const context = new AudioContext();
  const initial = context.state;
  const outcome = await Promise.race([
    context.resume().then(() => 'resolved'),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve('still pending after 1500 ms'), 1500),
    ),
  ]);
  const state = context.state;
  await context.close();
  return { initial, outcome, state };
}

export const MotoAudioRig = {
  probeResume,
  liveStart,
  liveState,
  liveTap,
  sampleRate: SAMPLE_RATE,
  list: () => catalogue().map(meta),
  uiCues: () => Object.keys(UI_SOUNDS) as UiSoundId[],
  render: async (id: string, options: RigOptions = {}) => {
    const scene = catalogue().find((s) => s.id === id);
    if (!scene) throw new Error(`Unknown audio scenario ${id}`);
    return renderScene(scene, options);
  },
  renderUi,
  renderDrivingCues,
};
