import { describe, expect, it } from 'vitest';
import {
  LIMITER_BAND_RPM,
  PIT_LIMITER_DEPTH,
  PIT_LIMITER_RATE_HZ,
  REV_LIMITER_DEPTH,
  REV_LIMITER_RATE_HZ,
  limiterFlutter,
  pitLimiterOn,
} from '../src/audio/limiter-cue.ts';
import {
  GO_GAIN,
  LAMP_GAIN,
  PHASE_LIGHTS,
  PHASE_RACING,
  StartLightsAudio,
  lampHz,
  newStartLightState,
  startLightEvent,
} from '../src/audio/start-lights.ts';
import { PHASE } from '../src/simulation/race.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { FakeContext, asContext, asNode } from './fake-audio.ts';

const o = carBase(0);
function frame(set: Partial<Record<keyof typeof F, number>> = {}) {
  const f = new Float32Array(HEADER + CAR_STRIDE);
  f[H.CARS] = 1;
  for (const [key, value] of Object.entries(set)) f[o + F[key as keyof typeof F]] = value as number;
  return f;
}

describe('rev limiter and pit limiter flutter', () => {
  it('is silent at ordinary revs and on a lifted throttle', () => {
    expect(limiterFlutter(frame({ RPM: 9000, THROTTLE: 1, GEAR: 4 }), 0, 13700).depth).toBe(0);
    expect(limiterFlutter(frame({ RPM: 13690, THROTTLE: 0.1, GEAR: 4 }), 0, 13700).depth).toBe(0);
    expect(limiterFlutter(frame({ RPM: 13690, THROTTLE: 1, GEAR: 0 }), 0, 13700).depth).toBe(0);
  });
  it('bounces on the limiter at 12 Hz, deeper the further into the band', () => {
    const edge = limiterFlutter(
        frame({ RPM: 13700 - LIMITER_BAND_RPM, THROTTLE: 1, GEAR: 5 }),
        0,
        13700,
      ),
      top = limiterFlutter(frame({ RPM: 13700, THROTTLE: 1, GEAR: 5 }), 0, 13700);
    expect(edge.rateHz).toBe(REV_LIMITER_RATE_HZ);
    expect(top.depth).toBeCloseTo(REV_LIMITER_DEPTH, 9);
    expect(edge.depth).toBeGreaterThan(0);
    expect(edge.depth).toBeLessThan(top.depth);
  });
  it('has a slower, shallower bounce on the pit limiter, in the entry and exit phases only', () => {
    for (const phase of [1, 6]) {
      const f = frame({
        IN_PIT: 1,
        PIT_PHASE: phase,
        SPEED: 22,
        RPM: 7000,
        THROTTLE: 0.4,
        GEAR: 2,
      });
      expect(pitLimiterOn(f, 0)).toBe(true);
      const flutter = limiterFlutter(f, 0, 13700);
      expect(flutter.depth).toBe(PIT_LIMITER_DEPTH);
      expect(flutter.rateHz).toBe(PIT_LIMITER_RATE_HZ);
    }
    expect(pitLimiterOn(frame({ IN_PIT: 1, PIT_PHASE: 3 }), 0)).toBe(false); // in the box
    expect(pitLimiterOn(frame({ IN_PIT: 0, PIT_PHASE: 1 }), 0)).toBe(false);
    // Stopped in the lane: nothing to bounce.
    expect(limiterFlutter(frame({ IN_PIT: 1, PIT_PHASE: 1, SPEED: 1 }), 0, 13700).depth).toBe(0);
  });
  it('lets the rev limiter win when both apply, and ignores the rev limiter for electric drive', () => {
    const f = frame({ IN_PIT: 1, PIT_PHASE: 1, SPEED: 22, RPM: 13700, THROTTLE: 1, GEAR: 3 });
    expect(limiterFlutter(f, 0, 13700).depth).toBe(REV_LIMITER_DEPTH);
    expect(limiterFlutter(f, 0, 0).depth).toBe(PIT_LIMITER_DEPTH); // limiterRPM 0: no rev limiter
  });
  it('is a function of the snapshot alone and survives non-finite input', () => {
    const f = frame({ RPM: NaN, THROTTLE: 1, GEAR: 3 });
    expect(limiterFlutter(f, 0, 13700).depth).toBe(0);
    const a = frame({ RPM: 13699, THROTTLE: 1, GEAR: 3 });
    expect(limiterFlutter(a, 0, 13700)).toEqual(limiterFlutter(a, 0, 13700));
  });
});

describe('start lamps and lights-out', () => {
  const at = (phase: number, lights: number, time: number) => {
    const f = new Float32Array(HEADER + CAR_STRIDE);
    f[H.CARS] = 1;
    f[H.PHASE] = phase;
    f[H.LIGHTS] = lights;
    f[H.TIME] = time;
    return f;
  };
  it('keeps the race phase numbers it mirrors', () => {
    expect(PHASE_LIGHTS).toBe(PHASE.LIGHTS);
    expect(PHASE_RACING).toBe(PHASE.RACING);
  });
  /** Frames every 0.1 s, as the game presents them: lamps at 1..5 s, green at 6.4 s. */
  function startSequence(state = newStartLightState(), from = 0, to = 7) {
    const events = [];
    for (let t = from; t <= to + 1e-9; t += 0.1) {
      const racing = t >= 6.4;
      events.push(
        startLightEvent(
          at(
            racing ? 2 : t < 0.2 ? 0 : 1,
            racing ? 0 : t < 1 ? 0 : Math.min(5, Math.floor(t + 1e-9)),
            t,
          ),
          state,
        ),
      );
    }
    return events.filter(Boolean);
  }
  it('names each lamp as it lights, then lights-out, once each', () => {
    expect(startSequence()).toEqual([
      { kind: 'light', lamp: 1 },
      { kind: 'light', lamp: 2 },
      { kind: 'light', lamp: 3 },
      { kind: 'light', lamp: 4 },
      { kind: 'light', lamp: 5 },
      { kind: 'go' },
    ]);
  });
  it('does not fire on a seek or a replay jump (time discontinuity) or a first frame mid-sequence', () => {
    const state = newStartLightState();
    expect(startLightEvent(at(1, 3, 3), state)).toBeNull(); // first frame we see: no baseline
    expect(startLightEvent(at(1, 4, 3.1), state)).toEqual({ kind: 'light', lamp: 4 });
    expect(startLightEvent(at(1, 5, 30), state)).toBeNull(); // jumped half a minute
    expect(startLightEvent(at(1, 5, 2), state)).toBeNull(); // rewound
    // A replay restarted at the lamps hears them again.
    expect(
      startSequence(newStartLightState(), 0, 2).map((e) => e && 'lamp' in e && e.lamp),
    ).toEqual([1, 2]);
  });
  it('rises in pitch lamp by lamp, within a bounded ladder', () => {
    for (let lamp = 1; lamp < 5; lamp++) expect(lampHz(lamp + 1)).toBeGreaterThan(lampHz(lamp));
    expect(lampHz(0)).toBe(lampHz(1));
    expect(lampHz(9)).toBe(lampHz(5));
    expect(lampHz(5)).toBeLessThan(600);
  });
  it('schedules one enveloped tick per lamp and a two-note chime on go, with the pitch change at low gain', () => {
    const ctx = new FakeContext(),
      audio = new StartLightsAudio(asContext(ctx), asNode(ctx.destination));
    const [osc] = ctx.of('oscillator'),
      [gain] = ctx.of('gain');
    audio.update(at(1, 0, 0.9), 0.9);
    audio.update(at(1, 1, 1), 1);
    expect(audio.played).toBe(1);
    const peak = gain.gain.events.find((e) => e.kind === 'linear' && e.value === LAMP_GAIN);
    expect(peak).toBeDefined();
    expect(osc.frequency.events.find((e) => e.kind === 'set')!.value).toBeCloseTo(lampHz(1), 9);
    audio.update(at(1, 5, 6.3), 6.3);
    audio.update(at(2, 0, 6.4), 6.4);
    audio.update(at(2, 0, 6.5), 6.5);
    expect(audio.played).toBe(2);
    // The go chime: the gain is back near zero at the instant the pitch jumps to the second note.
    const jump = osc.frequency.events.filter((e) => e.kind === 'set' && e.value === 1320)[0];
    const quiet = gain.gain.events
      .filter((e) => e.time <= jump.time && e.time > 6.4 && e.kind !== 'cancel')
      .pop()!;
    expect(quiet.value).toBeLessThan(0.01);
    expect(GO_GAIN).toBeGreaterThan(LAMP_GAIN * 0.9);
  });
});
