import { describe, expect, it } from 'vitest';
import { InputLog, Resimulation, applyLoggedInput } from '../src/core/flashback.ts';
import {
  GHOST_FIELDS,
  GHOST_MAX_SAMPLES,
  GhostPlayer,
  GhostRecorder,
  ghostKey,
  ghostPose,
  validateGhost,
  type GhostLap,
} from '../src/core/ghost-lap.ts';
import { recordCategory } from '../src/core/session-identity.ts';
import { DEFAULT_OPTIONS, controls } from '../src/simulation/config.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import { TelemetryRecorder } from '../src/storage/recorders.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';
import { CHANNELS, packTelemetry } from '../src/storage/telemetry-schema.ts';
import { TelemetrySampler } from '../src/storage/telemetry-sampler.ts';

const dt = 1 / 120;
const options = { ...DEFAULT_OPTIONS, mode: 'practice' as const, opponents: 0, seed: 72027 };
const tickColumn = CHANNELS.indexOf('tick');
const sessionColumn = CHANNELS.indexOf('session_time_s');

class MemoryPages implements ReplayPageStore {
  readonly pages = new Map<number, ReplayPage>();
  async put(page: ReplayPage) {
    this.pages.set(page.id, structuredClone(page));
  }
  async get(id: number) {
    const page = this.pages.get(id);
    if (!page) throw new Error(`Missing replay page ${id}`);
    return structuredClone(page);
  }
  async dispose() {
    this.pages.clear();
  }
}

/** The real recording producer transfers its pages in both directions. The
 * host recorders must own copies before the next worker capture reuses them. */
function recordingStream(
  simulation: Simulation,
  telemetry: TelemetryRecorder,
  replay: SessionReplay,
) {
  const warnings: string[] = [];
  const sampler: TelemetrySampler = new TelemetrySampler(
    simulation,
    (buffer, rows) => {
      const values = structuredClone(new Float32Array(buffer), { transfer: [buffer] });
      telemetry.appendBatch(values, rows);
      sampler.recycle(structuredClone(values.buffer, { transfer: [values.buffer] }));
    },
    (message) => warnings.push(message),
    (buffer, rows) => {
      const values = structuredClone(new Float32Array(buffer), { transfer: [buffer] });
      const stride = replay.stride;
      for (let row = 0; row < rows; row++)
        replay.append(values.subarray(row * stride, (row + 1) * stride));
      sampler.recycleReplay(structuredClone(values.buffer, { transfer: [values.buffer] }));
    },
  );
  return { sampler, warnings };
}

async function capture(
  simulation: Simulation,
  sampler: TelemetrySampler,
  replay: SessionReplay,
  endTick: number,
  frames: Map<number, Float32Array>,
) {
  while (simulation.tick < endTick) {
    simulation.step(dt);
    sampler.capture();
    if (simulation.tick % 2 === 0) {
      const frame = simulation.makeFrame();
      simulation.writeFrame(frame);
      frames.set(simulation.tick, frame);
    }
    // Tiny test pages exercise page boundaries quickly; let each bounded
    // partial delivery finish persisting before the next four-pose page.
    if (simulation.tick % 32 === 0) {
      sampler.flushReplay();
      await replay.settle();
    }
  }
  sampler.flush();
  sampler.flushReplay();
  await replay.settle();
}

describe('production recording streams across a recreated timeline', () => {
  it('keeps negative and nonfinite cutoffs invalid at a zero-time race snapshot', async () => {
    const simulation = new Simulation({ ...options, mode: 'race' });
    const frame = simulation.makeFrame();
    simulation.writeFrame(frame);
    expect(frame[H.TIME]).toBe(0);
    const replay = new SessionReplay(1, new MemoryPages(), undefined, 4);
    try {
      replay.append(frame);
      for (const invalid of [-Number.MIN_VALUE, -1, NaN, Infinity, -Infinity]) {
        expect(replay.canTruncate(invalid)).toBe(false);
        expect(replay.truncate(invalid)).toBe(false);
      }
      expect(replay.count).toBe(1);
      expect(replay.canTruncate(0)).toBe(true);
      expect(replay.truncate(0)).toBe(true);
    } finally {
      await replay.dispose();
    }
  });

  it.each([
    { target: 160, endTick: 240, location: 'last frame of a sealed page', roundsUp: true },
    { target: 136, endTick: 240, location: 'first frame of a sealed page', roundsUp: true },
    { target: 200, endTick: 208, location: 'first frame of the open page', roundsUp: true },
    { target: 168, endTick: 240, location: 'downward-rounded frame', roundsUp: false },
  ])(
    'retains the selected $location in replay and telemetry',
    async ({ target, endTick, roundsUp }) => {
      const original = new Simulation(options);
      const log = new InputLog();
      applyLoggedInput(original, log, { ...controls(), throttle: 0.3 });
      const telemetry = new TelemetryRecorder(1);
      const replay = new SessionReplay(1, new MemoryPages(), undefined, 4);
      const originalFrames = new Map<number, Float32Array>();
      const first = recordingStream(original, telemetry, replay);
      try {
        await capture(original, first.sampler, replay, endTick, originalFrames);
        expect(telemetry.count).toBe(60);
        expect(replay.error).toBeNull();
        expect(replay.count).toBe(endTick / 8);
        expect(first.warnings).toEqual([]);
        const selected = originalFrames.get(target)!;
        expect(replay.canTruncate(selected[H.TIME])).toBe(true);

        const rewind = new Resimulation(options, log.entries, target, { now: () => 0 });
        expect(rewind.run(1000)).toBe(true);
        const resumed = rewind.simulation;
        const frame = resumed.makeFrame();
        resumed.writeFrame(frame);
        expect(frame).toEqual(selected);
        const completionTime = resumed.race.time; // The worker's flashback receipt is Float64.
        expect(selected[H.TIME] > completionTime).toBe(roundsUp);
        expect(replay.canTruncate(completionTime)).toBe(true);
        expect(replay.truncate(completionTime)).toBe(true);
        expect(replay.count).toBe(target / 8);
        expect(replay.end).toBe(selected[H.TIME]);
        expect(telemetry.truncate(completionTime)).toBe((endTick - target) / 2);
        expect(telemetry.at(telemetry.count - 1, tickColumn)).toBe(target);
        expect(telemetry.at(telemetry.count - 1, sessionColumn)).toBe(replay.end);
        expect(telemetry.at(0, sessionColumn) - telemetry.at(0, 0)).toBeCloseTo(
          original.race.greenAt,
          5,
        );

        log.truncate(target);
        applyLoggedInput(resumed, log, { ...controls(), brake: 0.7 });
        const branchFrames = new Map<number, Float32Array>();
        const branch = recordingStream(resumed, telemetry, replay);
        await capture(resumed, branch.sampler, replay, target + 80, branchFrames);
        expect(branch.warnings).toEqual([]);
        expect(replay.count).toBe((target + 80) / 8);
        expect(replay.error).toBeNull();

        const expectedFrames = [
          ...[...originalFrames.entries()].filter(
            ([tick]) => tick >= endTick - 118 && tick <= target,
          ),
          ...branchFrames.entries(),
        ].slice(-telemetry.capacity);
        const expected = new Float32Array(expectedFrames.length * telemetry.stride);
        expectedFrames.forEach(([, value], row) =>
          packTelemetry(value, expected, row * telemetry.stride),
        );
        expect(new Uint8Array(telemetry.snapshot().buffer)).toEqual(
          new Uint8Array(expected.buffer),
        );
        const a = replay.makeFrame();
        const b = replay.makeFrame();
        expect(replay.sample(replay.duration, a, b)).toBe(0);
        expect(a).toEqual(branchFrames.get(target + 80));
        expect(b).toEqual(a);
        expect(a[carBase(0) + F.BRAKE]).toBeCloseTo(0.7, 6);
        if (originalFrames.has(target + 80)) expect(a).not.toEqual(originalFrames.get(target + 80));
      } finally {
        await replay.dispose();
      }
    },
  );

  it('uses the pose clock for the first retained frame without admitting a later surface keyframe', async () => {
    const simulation = new Simulation(options);
    while (simulation.tick < 40) simulation.step(dt);
    const frame = simulation.makeFrame();
    simulation.writeFrame(frame);
    const cutoff = simulation.race.time;
    expect(frame[H.TIME]).toBeGreaterThan(cutoff);
    const replay = new SessionReplay(1, new MemoryPages(), undefined, 4);
    try {
      replay.recordSurface(new Float32Array([0.1]), new Float32Array([0.2]), cutoff);
      replay.recordSurface(new Float32Array([0.9]), new Float32Array([0.8]), cutoff + 1e-8);
      replay.append(frame);
      expect(replay.canTruncate(cutoff)).toBe(true);
      expect(replay.truncate(cutoff)).toBe(true);
      expect(replay.count).toBe(1);
      const a = replay.makeFrame();
      const b = replay.makeFrame();
      expect(replay.sample(0, a, b)).toBe(0);
      expect(a).toEqual(frame);
      expect(replay.surfaceState.time).toBe(cutoff);
      expect(replay.surfaceState.water[0]).toBeCloseTo(0.1, 6);
      expect(replay.error).toBeNull();
    } finally {
      await replay.dispose();
    }
  });
});

it('saves only the complete human lap after real simulation automation hands back control', () => {
  const simulation = new Simulation({ ...options, mode: 'time-trial' });
  const recorder = new GhostRecorder({
    circuit: simulation.track.circuit.id,
    trackLength: simulation.track.length,
    assist: simulation.options.assist,
    compound: simulation.options.compound,
    weather: simulation.options.weather,
  });
  const frame = simulation.makeFrame();
  const completed: GhostLap[] = [];
  simulation.autoPlayer = true;
  let handedBack = false;
  let previousLap = 0;
  for (let tick = 0; tick < 120 * 220 && simulation.race.laps[0].completed < 2; tick++) {
    const lap = simulation.race.laps[0];
    if (!handedBack && lap.lapTime > 10 && simulation.cars[0].s > simulation.track.length - 20) {
      simulation.autoPlayer = false;
      handedBack = true;
    }
    if (!simulation.autoPlayer)
      simulation.ai[0].update(dt, simulation.track, simulation.cars, simulation.race);
    simulation.step(dt);
    if (simulation.tick % 2 && simulation.race.laps[0].completed === previousLap) continue;
    simulation.writeFrame(frame);
    const ghost = recorder.observe(frame, !simulation.autoPlayer);
    if (ghost) completed.push(ghost);
    if (simulation.race.laps[0].completed === 1 && previousLap !== 1) expect(completed).toEqual([]);
    previousLap = simulation.race.laps[0].completed;
  }
  expect(handedBack).toBe(true);
  expect(simulation.race.laps[0].completed).toBe(2);
  expect(completed).toHaveLength(1);
  const ghost = completed[0];
  expect(ghost.lapTime).toBe(Math.fround(simulation.race.laps[0].last));
  expect(ghost.samples.length / GHOST_FIELDS).toBeLessThanOrEqual(GHOST_MAX_SAMPLES);
  const key = ghostKey(ghost.circuit, ghost.vehicle);
  const saved = new Map([[key, structuredClone(ghost)]]);
  const loaded = validateGhost(
    saved.get(key),
    ghost.circuit,
    simulation.track.length,
    recordCategory(simulation.options),
  );
  expect(loaded).not.toBeNull();
  expect(loaded!.samples.buffer).not.toBe(ghost.samples.buffer);
  expect(new Uint8Array(loaded!.samples.buffer)).toEqual(new Uint8Array(ghost.samples.buffer));
  const player = new GhostPlayer(loaded!);
  const pose = ghostPose();
  expect(player.poseAt(loaded!.lapTime, pose)).toBe(true);
  expect(pose.s).toBeCloseTo(simulation.track.length, 3);
  expect(player.poseAt(loaded!.lapTime + dt, pose)).toBe(false);
});
