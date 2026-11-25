import { describe, expect, it } from 'vitest';
import {
  GHOST_FIELDS,
  GHOST_VERSION,
  GhostPlayer,
  ghostPose,
  validateGhost,
  type GhostLap,
} from '../src/core/ghost-lap.ts';
import { SIMULATION_VERSION } from '../src/core/session-identity.ts';

function acceptedLap(stations: number[]): GhostLap {
  const samples = new Float32Array(stations.length * GHOST_FIELDS);
  stations.forEach((station, i) => {
    samples.set([i, station, i, 0, 0, 0, 0, 0, 1, 0, 1], i * GHOST_FIELDS);
  });
  const lap: GhostLap = {
    version: GHOST_VERSION,
    circuit: 'aurel',
    trackLength: stations[stations.length - 1],
    lapTime: 19,
    sectors: [6, 6, 7],
    assist: 'sport',
    compound: 'medium',
    weather: 'clear',
    recordedAt: '2026-11-25',
    vehicle: 'apx01',
    physics: SIMULATION_VERSION,
    samples,
  };
  expect(stations).toHaveLength(20);
  const accepted = validateGhost(lap, lap.circuit, lap.trackLength);
  expect(accepted).not.toBeNull();
  return accepted!;
}

describe('reviewed ghost record boundaries', () => {
  it('returns the first recorded time at tiny exact knots before and at a later plateau', () => {
    const lap = acceptedLap([
        0,
        1e-8,
        2e-8,
        3e-8,
        3e-8,
        ...Array.from({ length: 15 }, (_, i) => i + 1),
      ]),
      before = structuredClone(lap),
      player = new GhostPlayer(lap);
    for (const i of [1, 2, 3]) {
      const station = lap.samples[i * GHOST_FIELDS + 1];
      expect(player.timeAt(station)).toBe(i);
      expect(player.delta(station, 7)).toBe(7 - i);
    }
    // The repeated station belongs to sample 3, while pose playback still
    // traverses the original samples 3 and 4 in chronological order.
    const pose = ghostPose();
    expect(player.poseAt(3.5, pose)).toBe(true);
    expect(pose.s).toBe(lap.samples[3 * GHOST_FIELDS + 1]);
    expect(pose.x).toBe(3.5);
    expect(lap).toEqual(before);
  });

  it('keeps the earliest repeated start and the exact final indexed endpoint', () => {
    const lap = acceptedLap([0, 0, ...Array.from({ length: 18 }, (_, i) => (i + 1) * 1e-8)]),
      player = new GhostPlayer(lap),
      finish = lap.samples[19 * GHOST_FIELDS + 1];
    expect(player.timeAt(0)).toBe(0);
    expect(player.timeAt(finish)).toBe(19);
    expect(player.timeAt(finish + 1e-8)).toBe(19);
  });

  it('preserves interior denominator-floor arithmetic and strictly increasing exact knots', () => {
    for (const repeated of [false, true]) {
      const lap = acceptedLap([
          0,
          1e-8,
          2e-8,
          3e-8,
          repeated ? 3e-8 : 4e-8,
          ...Array.from({ length: 15 }, (_, i) => i + 1),
        ]),
        player = new GhostPlayer(lap);
      for (const i of [0, 1, 2]) {
        const start = lap.samples[i * GHOST_FIELDS + 1],
          end = lap.samples[(i + 1) * GHOST_FIELDS + 1],
          inside = start + (end - start) / 2;
        expect(player.timeAt(inside)).toBe(i + (inside - start) / 1e-6);
      }
      if (!repeated) {
        for (const i of [1, 2, 3, 4])
          expect(player.timeAt(lap.samples[i * GHOST_FIELDS + 1])).toBe(i);
      }
    }
  });
});
