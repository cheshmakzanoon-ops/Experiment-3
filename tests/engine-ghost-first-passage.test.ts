import { describe, expect, it } from 'vitest';
import {
  GHOST_FIELDS,
  GHOST_MAX_SAMPLES,
  GHOST_VERSION,
  GhostPlayer,
  GhostRecorder,
  ghostPose,
  validateGhost,
  type GhostLap,
} from '../src/core/ghost-lap.ts';
import { SIMULATION_VERSION } from '../src/core/session-identity.ts';
import { CAR_STRIDE, F, HEADER, carBase } from '../src/simulation/protocol.ts';
import { LapTracker } from '../src/simulation/race.ts';

function fixture(stations: readonly number[], lapTime = stations.length - 1): GhostLap {
  const samples = new Float32Array(stations.length * GHOST_FIELDS);
  stations.forEach((s, i) => {
    samples.set(
      [
        (i * lapTime) / (stations.length - 1),
        s,
        i * i,
        0.5 + i / 16,
        -2 * i,
        0,
        0,
        0,
        1,
        i / 32,
        30 - i,
      ],
      i * GHOST_FIELDS,
    );
  });
  return {
    version: GHOST_VERSION,
    circuit: 'aurel',
    trackLength: stations[stations.length - 1],
    lapTime,
    sectors: [lapTime / 3, lapTime / 3, lapTime / 3],
    assist: 'sport',
    compound: 'medium',
    weather: 'clear',
    recordedAt: '2026-11-25',
    samples,
    vehicle: 'apx01',
    physics: SIMULATION_VERSION,
  };
}

function interpolatedTime(samples: Float32Array, a: number, b: number, s: number) {
  const fraction = Math.min(
    1,
    Math.max(0, (s - samples[a + 1]) / Math.max(1e-6, samples[b + 1] - samples[a + 1])),
  );
  return samples[a] + (samples[b] - samples[a]) * fraction;
}

/** Deliberately linear: the earliest ascending original segment containing s. */
function firstCrossing(lap: GhostLap, s: number) {
  const d = lap.samples;
  if (!(s > d[1])) return d[0];
  for (let b = GHOST_FIELDS; b < d.length; b += GHOST_FIELDS) {
    const a = b - GHOST_FIELDS;
    if (d[a + 1] <= s && d[b + 1] >= s && d[b + 1] > d[a + 1]) return interpolatedTime(d, a, b, s);
  }
  return d[d.length - GHOST_FIELDS];
}

/** Original monotone interpolation policy, located by a linear scan. */
function monotoneReference(lap: GhostLap, s: number) {
  const d = lap.samples;
  if (!(s >= d[1])) return d[0];
  let a = 0;
  while (a < d.length - 2 * GHOST_FIELDS && d[a + GHOST_FIELDS + 1] <= s) a += GHOST_FIELDS;
  return interpolatedTime(d, a, a + GHOST_FIELDS, s);
}

function queries(lap: GhostLap) {
  const stations = Array.from(
    { length: lap.samples.length / GHOST_FIELDS },
    (_, i) => lap.samples[i * GHOST_FIELDS + 1],
  );
  const maximum = Math.max(...stations);
  return [
    -1,
    maximum + 1,
    ...stations.flatMap((s, i) => [s - 1e-8, s, s + 1e-8, (s + (stations[i + 1] ?? s)) / 2]),
    ...Array.from({ length: 201 }, (_, i) => (maximum * i) / 200),
  ];
}

function recordReversingLap() {
  const length = 3000,
    tracker = new LapTracker(length, length - 0.25),
    recorder = new GhostRecorder({
      circuit: 'aurel',
      trackLength: length,
      assist: 'sport',
      compound: 'medium',
      weather: 'clear',
    }),
    frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[o + F.QW] = 1;
  let s = length - 0.25,
    phase = 0,
    reverseTicks = 0,
    saved: GhostLap | null = null;
  for (let tick = 1; tick < 18000 && !saved; tick++) {
    let movement = 0.25;
    if (phase === 0 && s >= 1500 && s < 1501) phase = 1;
    if (phase === 1) {
      movement = -0.25;
      if (++reverseTicks === 40) phase = 2;
    }
    s = (s + movement + length) % length;
    tracker.update(s, tick / 120, false);
    if (tick % 4 !== 0 && !tracker.crossedFinish) continue;
    frame[o + F.S] = frame[o + F.X] = s;
    frame[o + F.LAPS] = tracker.completed;
    frame[o + F.LAP_TIME] = tracker.lapTime;
    frame[o + F.LAST_LAP] = tracker.last;
    frame[o + F.LAP_VALID] = +tracker.valid;
    frame[o + F.LAST_LAP_VALID] = +tracker.lastValid;
    frame[o + F.LAST_LAP_ASSISTED] = +tracker.lastAssisted;
    frame[o + F.SECTOR_1] = tracker.lastSectors[0];
    frame[o + F.SECTOR_2] = tracker.lastSectors[1];
    frame[o + F.SECTOR_3] = tracker.lastSectors[2];
    saved = recorder.observe(frame, true);
  }
  if (!saved) throw new Error('The real timing and recorder did not complete a valid lap');
  return { lap: saved, tracker };
}

describe('ghost first-passage distance timing', () => {
  it('uses the first crossing of a valid real LapTracker/GhostRecorder lap with a 10 m reversal', () => {
    const { lap, tracker } = recordReversingLap();
    expect(tracker.lastValid).toBe(true);
    expect(tracker.lastAssisted).toBe(false);
    expect(lap.samples.length / GHOST_FIELDS).toBe(3021);
    expect(validateGhost(lap, lap.circuit, lap.trackLength)).not.toBeNull();
    let reversals = 0;
    for (let i = GHOST_FIELDS; i < lap.samples.length; i += GHOST_FIELDS)
      if (lap.samples[i + 1] < lap.samples[i - GHOST_FIELDS + 1]) reversals++;
    expect(reversals).toBe(10);
    const player = new GhostPlayer(lap);
    expect(player.timeAt(1495)).toBeCloseTo(49.833334, 6);
    const stations = [
      ...Array.from({ length: 401 }, (_, i) => i * 7.5),
      ...Array.from({ length: 97 }, (_, i) => 1490 + i / 8),
    ];
    for (const s of stations) {
      const first = firstCrossing(lap, s);
      expect(player.timeAt(s)).toBe(first);
      expect(player.delta(s, 51)).toBe(51 - first);
    }
  });

  it.each([
    {
      name: 'pauses and two reversals',
      stations: [0, 0, 0, 1, 5, 10, 10, 10, 8, 6, 8, 12, 12, 14, 11, 9, 9, 13, 14, 16, 18, 20],
    },
    {
      name: 'repeated finish station',
      stations: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 20, 20, 18, 19, 20, 20],
    },
    {
      name: 'an initial reversal',
      stations: [5, 4, 3, 3, 4, 5, 6, 7, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    },
    { name: 'entirely stationary samples', stations: Array.from({ length: 20 }, () => 7) },
  ])('matches the slow crossing oracle with $name', ({ stations }) => {
    const lap = fixture(stations),
      player = new GhostPlayer(lap);
    expect(validateGhost(lap, lap.circuit, lap.trackLength)).not.toBeNull();
    for (const s of queries(lap)) expect(player.timeAt(s)).toBe(firstCrossing(lap, s));
    expect(player.timeAt(stations[0])).toBe(lap.samples[0]);
    expect(player.timeAt(lap.trackLength)).toBe(firstCrossing(lap, lap.trackLength));
  });

  it('uses adjacent original endpoints when progress resumes after a pause and reversal', () => {
    const lap = fixture([0, 2, 4, 6, 8, 10, 10, 10, 7, 5, 8, 14, 16, 18, 19, 20, 21, 22, 23, 24]),
      player = new GhostPlayer(lap);
    expect(player.timeAt(10)).toBe(5);
    expect(player.timeAt(10.001)).toBe(10 + 2.001 / 6);
    // The 12 m crossing lies on 8 m @ 10 s -> 14 m @ 11 s. Joining the
    // record highs (10 m @ 5 s -> 14 m @ 11 s) would invent an 8 s crossing.
    expect(player.timeAt(12)).toBe(10 + 4 / 6);
    expect(player.timeAt(14)).toBe(11);
  });

  it.each([
    {
      name: 'nonuniform ordinary intervals',
      stations: [0, 1e-8, 2e-8, ...Array.from({ length: 22 }, (_, i) => (i + 1) ** 2)],
    },
    { name: 'sub-micrometre intervals', stations: Array.from({ length: 20 }, (_, i) => i * 1e-8) },
  ])('preserves every monotone result exactly with $name', ({ stations }) => {
    const lap = fixture(stations),
      player = new GhostPlayer(lap);
    for (const s of [...queries(lap), -Infinity, Infinity, NaN])
      expect(player.timeAt(s)).toBe(monotoneReference(lap, s));
    expect(
      (player as unknown as { distanceMaxima: Float32Array | null }).distanceMaxima,
    ).toBeNull();
  });

  it('keeps original pose interpolation, sample bytes and persisted fields unchanged', () => {
    const stations = [0, 1, 2, 3, 4, 5, 5, 5, 3, 2, 4, 8, 9, 9, 7, 6, 10, 11, 12, 13],
      lap = fixture(stations),
      saved = structuredClone(lap),
      bytes = new Uint8Array(lap.samples.buffer).slice(),
      player = new GhostPlayer(lap),
      pose = ghostPose();
    for (let i = 0; i < stations.length - 1; i++) {
      player.timeAt(stations[i]);
      expect(player.poseAt(i + 0.5, pose)).toBe(true);
      expect(pose).toEqual({
        s: (stations[i] + stations[i + 1]) / 2,
        x: i * i + i + 0.5,
        y: 0.5 + (i + 0.5) / 16,
        z: -2 * (i + 0.5),
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        steer: (i + 0.5) / 32,
        speed: 30 - i - 0.5,
      });
    }
    expect(player.poseAt(lap.lapTime, pose)).toBe(true);
    expect(pose.s).toBe(lap.trackLength);
    expect(player.lap).toBe(lap);
    expect(lap).toEqual(saved);
    expect(new Uint8Array(lap.samples.buffer)).toEqual(bytes);
  });

  it('bounds the first-passage index to one Float32 per accepted sample at the cap', () => {
    const stations = Array.from({ length: GHOST_MAX_SAMPLES }, (_, i) => i),
      middle = Math.floor(stations.length / 2);
    stations[middle] -= 10;
    const lap = fixture(stations, 120),
      accepted = validateGhost(lap, lap.circuit, lap.trackLength);
    expect(accepted).not.toBeNull();
    const player = new GhostPlayer(accepted!),
      maxima = (player as unknown as { distanceMaxima: Float32Array }).distanceMaxima;
    expect(maxima).toBeInstanceOf(Float32Array);
    expect(maxima.length).toBe(GHOST_MAX_SAMPLES);
    expect(maxima.byteLength).toBe(GHOST_MAX_SAMPLES * Float32Array.BYTES_PER_ELEMENT);
    for (const s of [0, middle - 9, middle - 0.5, middle, middle + 0.5, lap.trackLength])
      expect(player.timeAt(s)).toBe(firstCrossing(lap, s));
  });

  it('retains existing nonfinite query behavior without poisoning later queries', () => {
    const lap = fixture([0, 1, 2, 3, 4, 5, 5, 5, 3, 2, 4, 8, 9, 9, 7, 6, 10, 11, 12, 13]),
      player = new GhostPlayer(lap),
      pose = ghostPose();
    expect(player.timeAt(NaN)).toBe(0);
    expect(player.timeAt(-Infinity)).toBe(0);
    expect(player.timeAt(Infinity)).toBe(lap.lapTime);
    expect(player.delta(8, NaN)).toBeNaN();
    expect(player.delta(8, Infinity)).toBe(Infinity);
    for (const time of [NaN, -Infinity, Infinity]) expect(player.poseAt(time, pose)).toBe(false);
    expect(player.timeAt(8)).toBe(firstCrossing(lap, 8));
  });

  it.each([NaN, Infinity, -Infinity])(
    'rejects nonfinite recorded time and distance %s before indexing',
    (value) => {
      for (const field of [0, 1]) {
        const lap = fixture(Array.from({ length: 20 }, (_, i) => i));
        lap.samples[8 * GHOST_FIELDS + field] = value;
        expect(validateGhost(lap, lap.circuit, lap.trackLength)).toBeNull();
      }
    },
  );
});
