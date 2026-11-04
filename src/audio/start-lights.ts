import { H } from '../simulation/protocol.ts';
import { clamp } from '../core/math.ts';

/** The start sequence had no sound of its own: five lamps and lights-out passed
 * in silence under the idling engines (rig run, scenario `start`). One short,
 * original synthesised tick per lamp, rising a little with each, and a bright
 * two-note "go" on lights-out. Driven by the recorded snapshot (H.PHASE and
 * H.LIGHTS), so a replay of the start is heard again and a seek does not fire
 * a stale tick. */
/** race.ts PHASE.LIGHTS and PHASE.RACING (a test pins them; importing race.ts would pull the
 * whole simulation into the audio module). */
export const PHASE_LIGHTS = 1;
export const PHASE_RACING = 2;
export type StartLightEvent = { kind: 'light'; lamp: number } | { kind: 'go' } | null;

export interface StartLightState {
  phase: number;
  lights: number;
  time: number;
}
export const newStartLightState = (): StartLightState => ({ phase: NaN, lights: 0, time: NaN });

/** Compare the snapshot with the previous one and name what just happened. */
export function startLightEvent(frame: Float32Array, state: StartLightState): StartLightEvent {
  const phase = frame[H.PHASE],
    lights = Math.round(frame[H.LIGHTS]),
    time = frame[H.TIME];
  let event: StartLightEvent = null;
  const continuous = Number.isFinite(state.time) && time >= state.time && time - state.time < 0.5;
  if (continuous) {
    if (phase === PHASE_LIGHTS && lights > state.lights && lights >= 1 && lights <= 5)
      event = { kind: 'light', lamp: lights };
    else if (state.phase === PHASE_LIGHTS && phase === PHASE_RACING) event = { kind: 'go' };
  }
  state.phase = phase;
  state.lights = lights;
  state.time = time;
  return event;
}

/** Pitch of lamp 1..5 (Hz): a rising minor-ish ladder, so the count is audible. */
export const lampHz = (lamp: number) => 330 * 2 ** ((clamp(lamp, 1, 5) - 1) / 8);
/** Peak amplitude of a lamp tick and of the go chime (before the buses). */
export const LAMP_GAIN = 0.34;
export const GO_GAIN = 0.4;

/** Constant-size graph (also usable with OfflineAudioContext). */
export class StartLightsAudio {
  private readonly state = newStartLightState();
  private readonly oscillator: OscillatorNode;
  private readonly gain: GainNode;
  /** Ticks and go chimes played (diagnostics, tests). */
  played = 0;
  constructor(
    private readonly context: BaseAudioContext,
    output: AudioNode,
  ) {
    this.oscillator = context.createOscillator();
    this.oscillator.type = 'triangle';
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.oscillator.connect(this.gain).connect(output);
    this.oscillator.start();
  }
  update(frame: Float32Array, time: number) {
    const event = startLightEvent(frame, this.state);
    if (!event || !Number.isFinite(time)) return event;
    const at = Math.max(this.context.currentTime, time),
      gain = this.gain.gain,
      freq = this.oscillator.frequency;
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(0, at);
    if (event.kind === 'light') {
      freq.setValueAtTime(lampHz(event.lamp), at);
      gain.linearRampToValueAtTime(LAMP_GAIN, at + 0.006);
      gain.exponentialRampToValueAtTime(0.0005, at + 0.16);
      gain.linearRampToValueAtTime(0, at + 0.17);
    } else {
      // Two notes, the second a fifth up, each with its own attack: the pitch jumps while the
      // gain is near zero, so the change cannot click.
      freq.setValueAtTime(880, at);
      gain.linearRampToValueAtTime(GO_GAIN, at + 0.006);
      gain.exponentialRampToValueAtTime(0.004, at + 0.088);
      gain.linearRampToValueAtTime(0, at + 0.09);
      freq.setValueAtTime(1320, at + 0.09);
      gain.linearRampToValueAtTime(GO_GAIN, at + 0.098);
      gain.exponentialRampToValueAtTime(0.0005, at + 0.42);
      gain.linearRampToValueAtTime(0, at + 0.43);
    }
    this.played++;
    return event;
  }
  reset() {
    this.state.phase = NaN;
    this.state.time = NaN;
    this.state.lights = 0;
    const t = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, 0.01);
  }
  dispose() {
    this.oscillator.stop();
    this.oscillator.disconnect();
    this.gain.disconnect();
  }
}
