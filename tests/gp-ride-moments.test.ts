import { describe, expect, it } from 'vitest';
import { menuPreview } from '../src/rendering/menu-preview.ts';
import { chassisLean } from '../src/simulation/bike-definitions.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { SURFACE, Track } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { GP_MOMENTS, GpRideMoments } from '../src/ui/gp-ride-moments.ts';

const track = new Track(),
  o = carBase(0),
  b = o + BIKE_BASE,
  live = { live: true, human: true };

/** Simulation lean (rad) whose presented chassis lean is `degrees`. */
function leanFor(degrees: number) {
  const bike = VEHICLES.gpr1.bike!;
  let lo = 0,
    hi = 1.5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if ((chassisLean(mid, bike) * 180) / Math.PI < degrees) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function run(
  moments: GpRideMoments,
  steps: readonly {
    t: number;
    speed?: number;
    lean?: number;
    brake?: number;
    pitch?: number;
    rank?: number;
    surface?: number;
    state?: number;
  }[],
  context = live,
) {
  const frame = menuPreview(track, 200, 'gpr1');
  frame[H.CARS] = 4;
  for (const step of steps) {
    frame[H.TIME] = step.t;
    frame[o + F.SPEED] = (step.speed ?? 200) / 3.6;
    frame[b + B.LEAN] = step.lean === undefined ? 0 : leanFor(step.lean);
    frame[o + F.BRAKE] = step.brake ?? 0;
    frame[b + B.PITCH] = step.pitch ?? 0;
    frame[o + F.RANK] = step.rank ?? 3;
    frame[b + B.STATE] = step.state ?? 0;
    for (const wheel of [0, 2])
      frame[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.SURFACE] = step.surface ?? SURFACE.ASPHALT;
    moments.observe(frame, context);
  }
  return frame;
}

describe('GP ride moments from worker snapshots', () => {
  it('banks knee and elbow contact once per bend at the exit, with the peak lean', () => {
    const moments = new GpRideMoments();
    run(moments, [
      { t: 1, lean: 10 },
      { t: 1.1, lean: 40 },
      { t: 1.2, lean: 53 },
      { t: 1.3, lean: 55 },
      { t: 1.4, lean: 30 },
      { t: 1.5, lean: 12 },
      { t: 3, lean: 20 },
      { t: 3.1, lean: 61 },
      { t: 3.2, lean: 10 },
    ]);
    expect(moments.moments.map((m) => [m.kind, m.detail])).toEqual([
      ['knee', '55° lean'],
      ['elbow', '61° lean'],
    ]);
    // The second highlight follows inside the flow window and doubles.
    expect(moments.moments[1].flow).toBe(2);
    expect(moments.score).toBe(GP_MOMENTS.points.knee + GP_MOMENTS.points.elbow * 2);
    expect(moments.best.lean).toBe(61);
  });

  it('reports a hard stop from entry to release speed, and session top speeds', () => {
    const moments = new GpRideMoments();
    run(moments, [
      { t: 1, speed: 300 },
      { t: 1.1, speed: 318 },
      { t: 1.2, speed: 316, brake: 0.9 },
      { t: 1.5, speed: 260, brake: 1 },
      { t: 2.6, speed: 104, brake: 0.6 },
      { t: 2.7, speed: 101, brake: 0.05 },
    ]);
    expect(moments.moments.map((m) => [m.kind, m.detail])).toEqual([
      ['top-speed', '318 km/h · session best'],
      ['stop', '316 → 101 km/h'],
    ]);
    expect(moments.moments[0].points).toBe(0);
  });

  it('times a wheelie from lift to landing and recognises a stoppie', () => {
    const moments = new GpRideMoments();
    run(moments, [
      { t: 1, speed: 120 },
      { t: 1.1, speed: 125, pitch: 0.12 },
      { t: 1.5, speed: 140, pitch: 0.2 },
      { t: 1.8, speed: 150, pitch: 0.01 },
      { t: 4, speed: 150, pitch: -0.08 },
      { t: 4.3, speed: 120, pitch: 0 },
    ]);
    expect(moments.moments.map((m) => m.kind)).toEqual(['wheelie', 'stoppie']);
    expect(moments.moments[0].detail).toBe('0.7 s · 11°');
  });

  it('counts places gained, loses the flow off track, and never scores the AI', () => {
    const moments = new GpRideMoments();
    run(moments, [
      { t: 1, rank: 4 },
      { t: 1.1, rank: 2 },
    ]);
    expect(moments.moments).toMatchObject([
      { kind: 'overtake', detail: 'Up to P2 of 4', points: GP_MOMENTS.points.overtake * 2 },
    ]);
    run(moments, [
      { t: 2, rank: 2, lean: 55 },
      { t: 2.1, rank: 2, lean: 10 },
      { t: 2.2, rank: 2, surface: SURFACE.GRAVEL },
    ]);
    expect(moments.moments.at(-1)).toMatchObject({ kind: 'reset', detail: 'Off the track' });
    expect(moments.flow).toBe(1);
    const ai = new GpRideMoments();
    run(
      ai,
      [
        { t: 1, rank: 4 },
        { t: 1.1, rank: 1 },
      ],
      { live: true, human: false },
    );
    expect(ai.moments).toHaveLength(1);
    expect(ai.score).toBe(0);
  });

  it('ignores replays and rewinds, and needs a fresh frame after a reversal', () => {
    const moments = new GpRideMoments();
    run(moments, [{ t: 5, lean: 55 }], { live: false, human: true });
    run(moments, [{ t: 6, lean: 10 }]);
    expect(moments.moments).toEqual([]);
    run(moments, [
      { t: 7, lean: 56 },
      // A seek backwards abandons the partial bend instead of banking it.
      { t: 2, lean: 10 },
    ]);
    expect(moments.moments).toEqual([]);
    run(moments, [{ t: 2, lean: 10 }]);
    expect(moments.moments).toEqual([]);
  });
});
