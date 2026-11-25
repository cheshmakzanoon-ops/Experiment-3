import { describe, expect, it } from 'vitest';
import {
  GHOST_FIELDS,
  GHOST_MAX_LAP_SECONDS,
  GHOST_MAX_SAMPLES,
  GHOST_MIN_LAP_SECONDS,
  GHOST_MIN_SAMPLES,
  GHOST_VERSION,
  GhostRecorder,
  ghostKey,
  validateGhost,
  type GhostLap,
} from '../src/core/ghost-lap.ts';
import { SIMULATION_VERSION } from '../src/core/session-identity.ts';
import { CAR_STRIDE, F, HEADER, carBase } from '../src/simulation/protocol.ts';

const o = carBase(0);
const context = {
  circuit: 'aurel',
  trackLength: 3000,
  assist: 'sport',
  compound: 'medium',
  weather: 'clear',
};
const poseFields = [F.X, F.Y, F.Z, F.QX, F.QY, F.QZ, F.QW, F.STEER, F.SPEED];

function writeFrame(frame: Float32Array, laps: number, time: number) {
  frame.fill(0);
  frame[o + F.LAPS] = laps;
  frame[o + F.LAP_TIME] = time;
  frame[o + F.LAST_LAP] = 20;
  frame[o + F.LAP_VALID] = frame[o + F.LAST_LAP_VALID] = 1;
  frame[o + F.SECTOR_1] = 6;
  frame[o + F.SECTOR_2] = frame[o + F.SECTOR_3] = 7;
  frame[o + F.S] = time * 150;
  frame[o + F.X] = time * 2;
  frame[o + F.Y] = 0.6;
  frame[o + F.Z] = -time * 3;
  frame[o + F.QY] = time / 100;
  frame[o + F.QW] = 1;
  frame[o + F.STEER] = -time / 50;
  frame[o + F.SPEED] = 40 + time;
  return frame;
}

function frameAt(laps = 0, time = 1 / 32) {
  return writeFrame(new Float32Array(HEADER + CAR_STRIDE), laps, time);
}

function captureLap(recorder: GhostRecorder, laps = 0) {
  const frame = frameAt(laps);
  // Binary-exact 1/32 s snapshots select every second pose under the existing
  // 30 Hz interval, without depending on the implementation's sample counter.
  for (let tick = 1; tick < 20 * 32; tick++) {
    writeFrame(frame, laps, tick / 32);
    recorder.observe(frame, true);
  }
}

function finishLap(recorder: GhostRecorder, laps = 0, time = 20) {
  const frame = frameAt(laps + 1);
  frame[o + F.LAST_LAP] = time;
  return recorder.observe(frame, true);
}

function recordLap(recorder: GhostRecorder, laps = 0) {
  captureLap(recorder, laps);
  return finishLap(recorder, laps);
}

function retainedSamples(recorder: GhostRecorder) {
  // Inspect retained payload to catch a recorder that silently keeps collecting
  // discarded laps. No production API is needed for this memory regression.
  return (recorder as unknown as { samples: number[] }).samples.length / GHOST_FIELDS;
}

function loaded(ghost: GhostLap | null) {
  return validateGhost(ghost, context.circuit, context.trackLength, {
    circuit: context.circuit,
    vehicle: ghost?.vehicle ?? 'apx01',
    physics: SIMULATION_VERSION,
  });
}

function savedGhost(count = 40): GhostLap {
  const samples = new Float32Array(count * GHOST_FIELDS);
  for (let i = 0; i < count; i++) {
    const time = (i / (count - 1)) * 20;
    samples.set([time, time * 150, time, 0.6, 0, 0, 0, 0, 1, 0, 40], i * GHOST_FIELDS);
  }
  return {
    ...context,
    version: GHOST_VERSION,
    lapTime: 20,
    sectors: [6, 7, 7],
    recordedAt: '2026-01-01',
    samples,
    vehicle: 'apx01',
    physics: SIMULATION_VERSION,
  };
}

describe('bounded ghost recording', () => {
  it('releases a prolonged stationary lap at the duration limit and recovers next lap', () => {
    const recorder = new GhostRecorder(context);
    const frame = frameAt();
    frame[o + F.SPEED] = 0;
    let peak = 0;
    for (let tick = 1; tick <= 3600 * 30; tick++) {
      frame[o + F.LAP_TIME] = tick / 30;
      recorder.observe(frame, true);
      peak = Math.max(peak, retainedSamples(recorder));
      if (tick === GHOST_MAX_LAP_SECONDS * 30) expect(retainedSamples(recorder)).toBe(0);
    }
    expect(peak).toBeGreaterThan(GHOST_MIN_SAMPLES);
    expect(peak).toBeLessThan(GHOST_MAX_SAMPLES);
    expect(retainedSamples(recorder)).toBe(0);
    expect(finishLap(recorder, 0, 3600)).toBeNull();
    expect(loaded(recordLap(recorder, 1))).not.toBeNull();
  });

  it('keeps a complete lap just below the limit, including the Float32 crossing endpoint', () => {
    const recorder = new GhostRecorder(context);
    const frame = frameAt();
    for (let tick = 1; tick < GHOST_MAX_LAP_SECONDS * 30; tick++) {
      frame[o + F.LAP_TIME] = tick / 30;
      recorder.observe(frame, true);
    }
    const ghost = finishLap(recorder, 0, GHOST_MAX_LAP_SECONDS - 0.01)!;
    expect(loaded(ghost)).not.toBeNull();
    expect(ghost.samples.length / GHOST_FIELDS).toBeLessThanOrEqual(GHOST_MAX_SAMPLES);
    expect(ghost.samples.at(-GHOST_FIELDS)).toBe(ghost.lapTime);
    expect(ghost.samples.at(-GHOST_FIELDS + 1)).toBe(context.trackLength);
  });

  it.each([
    ['automation', false, F.LAP_VALID, 1],
    ['pit lane', true, F.IN_PIT, 1],
    ['pit request', true, F.PIT_PHASE, 1],
    ['invalid lap', true, F.LAP_VALID, 0],
  ] as const)('releases an ineligible %s lap and does not resume it', (_, driver, field, value) => {
    const recorder = new GhostRecorder(context);
    recorder.observe(frameAt(0, 0.125), true);
    expect(retainedSamples(recorder)).toBe(1);
    const invalid = frameAt(0, 0.25);
    invalid[o + field] = value;
    recorder.observe(invalid, driver);
    expect(retainedSamples(recorder)).toBe(0);
    captureLap(recorder);
    expect(retainedSamples(recorder)).toBe(0);
    expect(finishLap(recorder)).toBeNull();
    expect(loaded(recordLap(recorder, 1))).not.toBeNull();
  });

  it('retains no samples during an hour of automation and can reset on the same lap', () => {
    const recorder = new GhostRecorder(context);
    const frame = frameAt();
    recorder.observe(frame, true);
    for (let tick = 2; tick <= 3600 * 30; tick++) {
      frame[o + F.LAP_TIME] = tick / 30;
      recorder.observe(frame, false);
    }
    expect(retainedSamples(recorder)).toBe(0);
    recorder.reset();
    expect(loaded(recordLap(recorder))).not.toBeNull();
  });

  it('does not retain a lap whose first sample is too late to complete a recording', () => {
    const recorder = new GhostRecorder(context);
    recorder.observe(frameAt(0, 0.5), true);
    captureLap(recorder);
    expect(retainedSamples(recorder)).toBe(0);
    expect(finishLap(recorder)).toBeNull();
    expect(loaded(recordLap(recorder, 1))).not.toBeNull();
  });

  it.each([
    ['lap counter', F.LAPS, NaN],
    ['infinite lap counter', F.LAPS, Infinity],
    ['lap clock', F.LAP_TIME, NaN],
    ['infinite lap clock', F.LAP_TIME, Infinity],
    ['negative lap clock', F.LAP_TIME, -1],
    ['backward lap clock', F.LAP_TIME, 0.0625],
    ['distance', F.S, Infinity],
    ['pit state', F.IN_PIT, NaN],
    ['pit phase', F.PIT_PHASE, Infinity],
    ['lap validity', F.LAP_VALID, NaN],
    ...poseFields.map((field) => [`pose field ${field}`, field, NaN] as const),
  ] as const)('discards a malformed %s until the next lap', (_, field, value) => {
    const recorder = new GhostRecorder(context);
    recorder.observe(frameAt(0, 0.125), true);
    const malformed = frameAt(0, 0.25);
    malformed[o + field] = value;
    expect(recorder.observe(malformed, true)).toBeNull();
    expect(retainedSamples(recorder)).toBe(0);
    recorder.observe(frameAt(0, 0.375), true);
    expect(retainedSamples(recorder)).toBe(0);
    expect(finishLap(recorder)).toBeNull();
    expect(loaded(recordLap(recorder, 1))).not.toBeNull();
  });

  it('discards a truncated snapshot and recovers after reset', () => {
    const recorder = new GhostRecorder(context);
    recorder.observe(frameAt(), true);
    expect(recorder.observe(new Float32Array(HEADER), true)).toBeNull();
    expect(retainedSamples(recorder)).toBe(0);
    recorder.reset();
    expect(loaded(recordLap(recorder))).not.toBeNull();
  });

  it.each([
    ['minimum duration', F.LAST_LAP, GHOST_MIN_LAP_SECONDS],
    ['maximum duration', F.LAST_LAP, GHOST_MAX_LAP_SECONDS],
    ['overlong duration', F.LAST_LAP, 610],
    ['infinite duration', F.LAST_LAP, Infinity],
    ['unknown duration', F.LAST_LAP, NaN],
    ['duration before the last pose', F.LAST_LAP, 15],
    ['first sector', F.SECTOR_1, NaN],
    ['second sector', F.SECTOR_2, Infinity],
    ['third sector', F.SECTOR_3, -1],
    ['crossing pose', F.QW, Infinity],
  ] as const)('rejects an unusable completed %s and recovers next lap', (_, field, value) => {
    const recorder = new GhostRecorder(context);
    captureLap(recorder);
    const crossing = frameAt(1);
    crossing[o + field] = value;
    expect(recorder.observe(crossing, true)).toBeNull();
    // A corrupt crossing pose also belongs to the new lap. Advance past that
    // partial lap before offering a complete, healthy recording again.
    expect(finishLap(recorder, 1)).toBeNull();
    expect(loaded(recordLap(recorder, 2))).not.toBeNull();
  });

  it.each([
    ['automation', false, F.LAP_VALID, 1],
    ['pit lane', true, F.IN_PIT, 1],
    ['pit request', true, F.PIT_PHASE, 1],
    ['invalid next lap', true, F.LAP_VALID, 0],
    ['malformed next clock', true, F.LAP_TIME, NaN],
  ] as const)(
    'finishes the previous lap before applying crossing-frame %s',
    (_, driver, field, value) => {
      const recorder = new GhostRecorder(context);
      captureLap(recorder);
      const crossing = frameAt(1);
      crossing[o + field] = value;
      expect(loaded(recorder.observe(crossing, driver))).not.toBeNull();
      expect(retainedSamples(recorder)).toBe(0);
    },
  );

  it('preserves exact ordinary samples, crossing pose, category, keys and buffer ownership', () => {
    const recorder = new GhostRecorder({ ...context, vehicle: 'tc1' });
    const frame = frameAt();
    const expected: number[] = [];
    for (let tick = 1; tick < 20 * 32; tick++) {
      writeFrame(frame, 0, tick / 32);
      if (tick % 2) {
        expected.push(
          frame[o + F.LAP_TIME],
          frame[o + F.S],
          ...poseFields.map((field) => frame[o + field]),
        );
      }
      recorder.observe(frame, true);
      frame.fill(-123);
    }
    writeFrame(frame, 1, 1 / 32);
    frame[o + F.X] = 12345;
    const crossingBytes = new Uint8Array(frame.slice().buffer);
    expected.push(20, context.trackLength, ...poseFields.map((field) => frame[o + field]));
    const ghost = recorder.observe(frame, true)!;
    expect(new Uint8Array(frame.buffer)).toEqual(crossingBytes);
    frame.fill(-123);
    expect(new Uint8Array(ghost.samples.buffer)).toEqual(
      new Uint8Array(Float32Array.from(expected).buffer),
    );
    expect(ghost.sectors).toEqual([6, 7, 7]);
    expect(ghost.vehicle).toBe('tc1');
    expect(ghost.physics).toBe(SIMULATION_VERSION);
    expect(loaded(structuredClone(ghost))).not.toBeNull();
    expect(ghostKey(context.circuit)).toBe('ghost:v1:aurel');
    expect(ghostKey(context.circuit, 'tc1')).toBe('ghost:v1:aurel:tc1');

    const preserved = ghost.samples.slice();
    const next = recordLap(recorder, 1)!;
    expect(ghost.samples).toEqual(preserved);
    expect(loaded(next)).not.toBeNull();
    expect(next.samples.buffer).not.toBe(ghost.samples.buffer);
    const nextPreserved = next.samples.slice();
    ghost.samples.fill(-1);
    recorder.reset();
    expect(next.samples).toEqual(nextPreserved);
  });
});

describe('shared ghost validation bounds', () => {
  it('accepts the shared sample cap and rejects recordings above it', () => {
    expect(loaded(savedGhost(GHOST_MAX_SAMPLES))).not.toBeNull();
    expect(loaded(savedGhost(GHOST_MAX_SAMPLES + 1))).toBeNull();
    expect(loaded(savedGhost(GHOST_MIN_SAMPLES))).not.toBeNull();
    expect(loaded(savedGhost(GHOST_MIN_SAMPLES - 1))).toBeNull();
  });

  it.each([GHOST_MIN_LAP_SECONDS, GHOST_MAX_LAP_SECONDS, 610, Infinity, NaN])(
    'rejects duration %s using the recorder limits',
    (lapTime) => {
      expect(loaded({ ...savedGhost(), lapTime })).toBeNull();
    },
  );

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite track and sector metadata %s', (value) => {
    const ghost = savedGhost();
    expect(loaded({ ...ghost, trackLength: value })).toBeNull();
    expect(validateGhost(ghost, context.circuit, value)).toBeNull();
    expect(loaded({ ...ghost, sectors: [6, value, 7] })).toBeNull();
  });
});
