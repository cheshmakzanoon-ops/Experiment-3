import { describe, expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import { menuPreview } from '../src/rendering/menu-preview.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { SURFACE, Track, trackPoint } from '../src/simulation/track.ts';
import {
  GpCornerPractice,
  gpPracticeCorners,
  gpPracticeDelta,
  type GpPracticeContext,
} from '../src/ui/gp-corner-practice.ts';

const track = new Track('clear', false, undefined, circuitDefinition('poggio-alto'));
const o = carBase(0),
  b = o + BIKE_BASE,
  front = o + WHEEL_BASE,
  rear = front + 2 * WHEEL_STRIDE;
const human: GpPracticeContext = { practice: true, human: true, replay: false, assist: 'sport' };

function rig(venue: Track = track) {
  const practice = new GpCornerPractice(),
    corner = gpPracticeCorners(venue)[0];
  function sample(
    distance: number,
    time: number,
    speed = 40,
    edit?: (frame: Float32Array) => void,
    context = human,
  ) {
    const s = mod(corner.from + distance, venue.length);
    const frame = menuPreview(venue, s, 'gpr1'),
      road = venue.at(s, trackPoint());
    frame[H.PHASE] = 2;
    frame[H.TIME] = time;
    frame[o + F.SPEED] = speed;
    frame[o + F.VX] = speed * road.tx;
    frame[o + F.VZ] = speed * road.tz;
    frame[o + F.LATERAL] = 0;
    frame[o + F.IMPACT] = 0;
    frame[o + F.LOCAL_FLAG] = FLAG.GREEN;
    frame[o + F.LAP_VALID] = 1;
    frame[o + RACE_BASE + R.NEXT_COMPOUND] = -1;
    for (const p of [front, rear]) {
      frame[p + W.SURFACE] = SURFACE.ASPHALT;
      frame[p + W.WATER] = 0;
    }
    edit?.(frame);
    const before = frame.slice();
    practice.observe(frame, venue, context);
    expect(frame).toEqual(before);
    return frame;
  }
  function run(
    start: number,
    speed = 40,
    spacing = 8,
    edit?: (frame: Float32Array) => void,
    context = human,
  ) {
    for (let d = -5; d < corner.length + 5; d += spacing)
      sample(d, start + (d + 5) / speed, speed, edit, context);
    sample(corner.length + 5, start + (corner.length + 10) / speed, speed, edit, context);
  }
  return { practice, corner, sample, run };
}

describe('personal GP corner practice', () => {
  it.each(['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'])(
    '%s uses ordered nonoverlapping measured corner windows',
    (id) => {
      const venue = new Track('clear', false, undefined, circuitDefinition(id));
      const corners = gpPracticeCorners(venue);
      expect(corners.length).toBeGreaterThan(3);
      for (const corner of corners) {
        expect(corner.length).toBeGreaterThanOrEqual(24);
        expect(corner.apex).toBeGreaterThan(0);
        expect(corner.apex).toBeLessThan(corner.length);
        for (const other of corners)
          if (other !== corner)
            expect(mod(other.from - corner.from, venue.length)).toBeGreaterThanOrEqual(
              corner.length,
            );
      }
    },
  );

  it('interpolates entry/exit times independent of presentation cadence', () => {
    for (const spacing of [1, 8, 29, 47]) {
      const h = rig();
      h.run(1, 40, spacing);
      expect(h.practice.last?.seconds).toBeCloseTo(h.corner.length / 40, 4);
      expect(h.practice.last).toMatchObject({ exitSpeed: 40, condition: 'dry', delta: null });
      const last = h.practice.last;
      h.sample(h.corner.length + 5, 1 + (h.corner.length + 10) / 40);
      expect(h.practice.last).toBe(last);
    }
  });

  it('compares completed human runs with their previous best, then retains the fastest target', () => {
    const h = rig();
    h.run(1, 40);
    h.run(30, 50);
    expect(h.practice.last?.delta).toBeCloseTo(h.corner.length / 50 - h.corner.length / 40, 4);
    h.run(60, 45);
    expect(h.practice.last?.delta).toBeCloseTo(h.corner.length / 45 - h.corner.length / 50, 4);
  });

  it('shows time gained at the same road position, including stationary lost time', () => {
    const h = rig();
    h.run(1, 40);
    h.sample(-5, 30, 50);
    h.sample(15, 30.4, 50);
    expect(h.practice.active?.delta).toBeCloseTo(15 / 50 - 15 / 40, 4);
    h.sample(15, 31.4, 0);
    expect(h.practice.active?.delta).toBeCloseTo(15 / 50 + 1 - 15 / 40, 4);
    const held = h.practice.active?.delta;
    h.sample(15, 31.4, 0);
    expect(h.practice.active?.delta).toBe(held);
  });

  it('compares against the best spatial pace instead of scaling its total corner time', () => {
    const h = rig(),
      midpoint = h.corner.length / 2;
    // One complete clean run: quick entry followed by a slower exit. The
    // reference profile needs to remember where time was actually spent.
    const timeAt = (d: number) =>
      1 + Math.min(d + 5, midpoint + 5) / 50 + Math.max(0, d - midpoint) / 25;
    h.sample(-5, timeAt(-5), 50);
    for (let d = 0; d < midpoint; d += 5) h.sample(d, timeAt(d), 50);
    h.sample(midpoint, timeAt(midpoint), 50);
    for (let d = midpoint + 5; d < h.corner.length + 5; d += 5) h.sample(d, timeAt(d), 25);
    h.sample(h.corner.length + 5, timeAt(h.corner.length + 5), 25);
    expect(h.practice.last).not.toBeNull();
    h.sample(-5, 60, 40);
    for (let d = 0; d < midpoint; d += 5) h.sample(d, 60 + (d + 5) / 40, 40);
    h.sample(midpoint, 60 + (midpoint + 5) / 40, 40);
    expect(h.practice.active?.delta).toBeCloseTo(midpoint / 40 - midpoint / 50, 3);
    expect(h.practice.active!.delta).toBeGreaterThan(0);
    // Linear scaling of the final time would incorrectly call this faster.
    expect(h.practice.active!.elapsed - h.practice.active!.best! / 2).toBeLessThan(0);
  });

  it('stores the fastest complete trace and compares its associated exit speed', () => {
    const h = rig();
    h.run(1, 40);
    expect(h.practice.last?.exitDelta).toBeNull();
    h.run(30, 50);
    expect(h.practice.last?.exitDelta).toBeCloseTo(10);
    h.run(60, 45);
    expect(h.practice.last?.exitDelta).toBeCloseTo(-5);
    h.sample(-5, 90, 40);
    h.sample(15, 90.5, 40);
    expect(h.practice.active?.delta).toBeCloseTo(15 / 40 - 15 / 50, 4);
  });

  it('retains best pace across invalid attempts but never credits their split samples', () => {
    const h = rig();
    h.run(1, 40);
    h.sample(-5, 30, 50);
    h.sample(15, 30.4, 50);
    h.sample(25, 30.6, 50, (f) => {
      f[rear + W.SURFACE] = SURFACE.GRAVEL;
    });
    expect(h.practice.active).toBeNull();
    h.sample(-5, 60, 45);
    h.sample(13, 60.4, 45);
    expect(h.practice.active?.best).toBeCloseTo(h.corner.length / 40, 4);
    expect(h.practice.active?.delta).toBeCloseTo(13 / 45 - 13 / 40, 4);
    h.practice.reset();
    h.sample(-5, 90);
    h.sample(15, 90.5);
    expect(h.practice.active?.delta).toBeNull();
  });

  it('keeps live best pace independent of render repeats and original sample spacing', () => {
    for (const spacing of [1, 8, 29, 47]) {
      const h = rig();
      h.run(1, 40, spacing);
      h.sample(-5, 30, 50);
      h.sample(15, 30.4, 50);
      const delta = h.practice.active?.delta;
      for (let repeat = 0; repeat < 5; repeat++) h.sample(15, 30.4, 50);
      expect(h.practice.active?.delta).toBe(delta);
      expect(delta).toBeCloseTo(-0.075, 4);
    }
  });

  it('formats meaningful gains/losses and neutral rounding without a false signed zero', () => {
    expect(gpPracticeDelta(-0.075)).toBe('−0.08 s');
    expect(gpPracticeDelta(0.075)).toBe('+0.08 s');
    expect(gpPracticeDelta(-0.004)).toBe('±0.00 s');
    expect(gpPracticeDelta(0)).toBe('±0.00 s');
  });

  it('separates wetness and compounds, and resets targets when assistance or session changes', () => {
    const h = rig();
    h.run(1, 40);
    h.run(30, 50, 8, (f) => {
      f[front + W.WATER] = f[rear + W.WATER] = 0.3;
    });
    expect(h.practice.last).toMatchObject({ condition: 'wet', delta: null });
    h.run(60, 50, 8, (f) => {
      f[o + F.COMPOUND] = 2;
    });
    expect(h.practice.last?.delta).toBeNull();
    h.run(90, 50, 8, undefined, { ...human, assist: 'expert' });
    expect(h.practice.last?.delta).toBeNull();
    h.practice.reset();
    h.run(1);
    expect(h.practice.last?.delta).toBeNull();
  });

  it('does not award partial, reverse, teleported or unobserved corner traversals', () => {
    for (const kind of ['spawn', 'reverse', 'teleport', 'gap'] as const) {
      const h = rig();
      h.sample(kind === 'spawn' ? 5 : -5, 0);
      h.sample(kind === 'reverse' ? -10 : 8, 0.3);
      if (kind === 'teleport') h.sample(h.corner.length + 5, 0.31);
      else {
        const delayed = kind === 'gap' ? 3 : 0;
        for (let d = 16; d <= h.corner.length + 8; d += 8)
          h.sample(d, delayed + 0.3 + (d - 8) / 40);
      }
      expect(h.practice.last, kind).toBeNull();
    }
  });

  it.each([
    ['AI driver', { ...human, human: false }],
    ['replay', { ...human, replay: true }],
    ['race', { ...human, practice: false }],
  ] as const)('does not credit %s or an unobserved control handoff', (_, context) => {
    const h = rig();
    h.run(1, 40, 8, undefined, context);
    expect(h.practice.last).toBeNull();
    h.sample(-5, 30);
    h.sample(5, 30.25);
    h.sample(13, 30.45, 40, undefined, context);
    for (let d = 21; d <= h.corner.length + 8; d += 8) h.sample(d, 30.65 + (d - 21) / 40);
    expect(h.practice.last).toBeNull();
  });

  it.each([
    [
      'track edge',
      (f: Float32Array) => {
        f[o + F.LATERAL] = 50;
      },
    ],
    [
      'grass contact',
      (f: Float32Array) => {
        f[rear + W.SURFACE] = SURFACE.GRASS;
      },
    ],
    [
      'pit entry',
      (f: Float32Array) => {
        f[o + F.IN_PIT] = 1;
      },
    ],
    [
      'requested pit autopilot before pit entry',
      (f: Float32Array) => {
        f[o + RACE_BASE + R.NEXT_COMPOUND] = 1;
      },
    ],
    [
      'crash',
      (f: Float32Array) => {
        f[b + B.STATE] = 1;
      },
    ],
    [
      'puncture',
      (f: Float32Array) => {
        f[front + W.PUNCTURED] = 1;
      },
    ],
    [
      'yellow flag',
      (f: Float32Array) => {
        f[o + F.LOCAL_FLAG] = FLAG.YELLOW;
      },
    ],
    [
      'safety car',
      (f: Float32Array) => {
        f[H.SC_PHASE] = 1;
      },
    ],
    [
      'collision',
      (f: Float32Array) => {
        f[o + F.IMPACT] = 1;
      },
    ],
    [
      'brief cut between observations',
      (f: Float32Array) => {
        f[o + F.LAP_VALID] = 0;
      },
    ],
    [
      'missed warning',
      (f: Float32Array) => {
        f[o + F.WARNINGS] = 1;
      },
    ],
    [
      'missed crash',
      (f: Float32Array) => {
        f[b + B.CRASHES] = 1;
      },
    ],
  ] as const)('invalidates an attempt through %s', (_, invalidate) => {
    const h = rig();
    h.run(1, 40, 8, (f) => {
      if (mod(f[o + F.S] - h.corner.from, track.length) > 10) invalidate(f);
    });
    expect(h.practice.last).toBeNull();
  });

  it('preserves earned records through replay, duplicate pause snapshots and rewinds', () => {
    const h = rig();
    h.run(1, 40);
    const earned = h.practice.last;
    h.run(30, 60, 8, undefined, { ...human, replay: true });
    expect(h.practice.last).toBe(earned);
    h.sample(-5, 10);
    h.sample(-5, 10);
    h.run(60, 50);
    expect(h.practice.last?.delta).toBeCloseTo(h.corner.length / 50 - h.corner.length / 40, 4);
  });

  it('allows a later clean corner on an already invalid lap', () => {
    const h = rig();
    h.run(1, 40, 8, (f) => {
      f[o + F.LAP_VALID] = 0;
    });
    expect(h.practice.last?.seconds).toBeCloseTo(h.corner.length / 40, 4);
  });

  it('times a corner across the lap seam and includes a stationary wait', () => {
    const original = gpPracticeCorners(track)[0];
    const shift = original.from + 20;
    const wrapped = {
      length: track.length,
      circuit: {
        ...track.circuit,
        corners: track.circuit.corners.map((c) => ({ ...c, s: mod(c.s - shift, track.length) })),
      },
      at: (s: number, out = trackPoint()) => {
        track.at(s + shift, out);
        out.s = mod(s, track.length);
        return out;
      },
    } as unknown as Track;
    const h = rig(wrapped);
    h.sample(-5, 0);
    h.sample(5, 0.25);
    // Deceleration/acceleration samples integrate to their average velocity:
    // each 8 m transition takes 0.4 s, with two stationary seconds between.
    h.sample(13, 0.65, 0);
    h.sample(13, 1.65, 0);
    h.sample(13, 2.65, 0);
    for (let d = 21; d <= h.corner.length + 8; d += 8) h.sample(d, 3.05 + (d - 21) / 40);
    expect(h.practice.last?.seconds).toBeCloseTo(h.corner.length / 40 + 2.4, 3);
  });
});
