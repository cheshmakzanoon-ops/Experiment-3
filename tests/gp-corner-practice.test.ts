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
  gpPracticeSplits,
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

function streakRig(venue: Track = track) {
  const h = rig(venue),
    corners = [...gpPracticeCorners(venue)].sort(
      (a, b) =>
        mod(a.from - h.corner.from, venue.length) - mod(b.from - h.corner.from, venue.length),
    ),
    after = (index: number) =>
      mod(corners[index].from - h.corner.from, venue.length) + corners[index].length + 5;
  let distance = -5;
  const time = () => 1 + (distance + 5) / 40;
  h.sample(distance, time());
  function rideTo(end: number, edit?: (frame: Float32Array) => void, context = human) {
    while (distance < end) {
      distance = Math.min(end, distance + 8);
      h.sample(distance, time(), 40, edit, context);
    }
  }
  return { ...h, corners, after, rideTo, time, distance: () => distance };
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

  it('measures both sides of the actual apex independent of snapshot spacing', () => {
    for (const spacing of [1, 8, 29, 47]) {
      const h = rig();
      h.run(1, 40, spacing);
      const result = h.practice.last!;
      expect(result.splits.entry).toBeCloseTo(h.corner.apex / 40, 4);
      expect(result.splits.exit).toBeCloseTo((h.corner.length - h.corner.apex) / 40, 4);
      expect(result.splits.entry + result.splits.exit).toBeCloseTo(result.seconds, 8);
      expect(result.splits.entryDelta).toBeNull();
      expect(result.splits.exitDelta).toBeNull();
      expect(gpPracticeSplits(result)).toMatch(/^Entry \d+\.\d{2} s · exit \d+\.\d{2} s$/);
    }
  });

  it('distinguishes a faster entry from a slower exit against one complete reference run', () => {
    const h = rig(),
      apex = h.corner.apex,
      exitLength = h.corner.length - apex;
    h.run(1, 40);
    const run = (start: number, entrySpeed: number, exitSpeed: number) => {
      const stations = [
        ...new Set([
          -5,
          0,
          apex,
          h.corner.length + 5,
          ...Array.from({ length: Math.ceil((h.corner.length + 10) / 8) }, (_, i) => i * 8 - 5),
        ]),
      ].sort((a, b) => a - b);
      for (const distance of stations) {
        const time =
          start +
          Math.min(distance + 5, apex + 5) / entrySpeed +
          Math.max(0, distance - apex) / exitSpeed;
        h.sample(distance, time, distance <= apex ? entrySpeed : exitSpeed);
      }
    };
    run(30, 50, 30);
    const result = h.practice.last!;
    expect(result.splits.entryDelta).toBeCloseTo(apex / 50 - apex / 40, 4);
    expect(result.splits.exitDelta).toBeCloseTo(exitLength / 30 - exitLength / 40, 4);
    expect(result.splits.entryDelta!).toBeLessThan(0);
    expect(result.splits.exitDelta!).toBeGreaterThan(0);
    expect(result.splits.entryDelta! + result.splits.exitDelta!).toBeCloseTo(result.delta!, 8);
    // A following comparison must use whichever complete run was faster,
    // including its slower phase. Combining independent split records would
    // invent a target the player has never ridden.
    const changedBest = result.seconds < h.corner.length / 40;
    run(60, 45, 45);
    expect(h.practice.last!.splits.entryDelta).toBeCloseTo(
      apex / 45 - apex / (changedBest ? 50 : 40),
      4,
    );
    expect(h.practice.last!.splits.exitDelta).toBeCloseTo(
      exitLength / 45 - exitLength / (changedBest ? 30 : 40),
      4,
    );
  });

  it('keeps completed phase timings stable across repeated frames and an interrupted retry', () => {
    const h = rig();
    h.run(1, 40);
    const completed = h.practice.last!;
    h.sample(h.corner.length + 5, 1 + (h.corner.length + 10) / 40);
    expect(h.practice.last).toBe(completed);
    h.sample(-5, 30, 50);
    h.sample(15, 30.4, 50);
    h.sample(25, 30.6, 50, (frame) => {
      frame[rear + W.SURFACE] = SURFACE.GRAVEL;
    });
    expect(h.practice.active).toBeNull();
    expect(h.practice.last).toBe(completed);
    h.run(60, 45);
    expect(h.practice.last!.splits.entryDelta).toBeCloseTo(
      h.corner.apex / 45 - h.corner.apex / 40,
      4,
    );
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

  describe('clean corner streaks', () => {
    it('links complete corners in road order through the lap seam without duplicate-frame credit', () => {
      const h = streakRig();
      h.rideTo(h.after(0));
      expect(h.practice.streak).toEqual({ current: 1, best: 1, next: h.corners[1] });
      for (let i = 0; i < 5; i++) h.sample(h.distance(), h.time());
      expect(h.practice.streak.current).toBe(1);
      h.rideTo(h.after(1));
      expect(h.practice.streak).toEqual({ current: 2, best: 2, next: h.corners[2] });
      h.rideTo(track.length + h.after(1));
      expect(h.practice.streak).toEqual({
        current: h.corners.length + 2,
        best: h.corners.length + 2,
        next: h.corners[2],
      });
    });

    it('requires the next actual corner even when circuit labels are stored in another order', () => {
      const reordered = {
        length: track.length,
        circuit: {
          ...track.circuit,
          corners: [...track.circuit.corners].reverse(),
        },
        at: (s: number, out = trackPoint()) => track.at(s, out),
      } as unknown as Track;
      const h = streakRig(reordered);
      h.rideTo(h.after(2));
      expect(h.practice.streak.current).toBe(3);
      expect(h.practice.streak.next).toEqual(h.corners[3]);
      expect(h.practice.last?.corner).toEqual(h.corners[2]);
    });

    it.each([
      [
        'track cut',
        (f: Float32Array) => {
          f[rear + W.SURFACE] = SURFACE.GRASS;
        },
      ],
      [
        'collision',
        (f: Float32Array) => {
          f[o + F.IMPACT] = 1;
        },
      ],
      [
        'crash',
        (f: Float32Array) => {
          f[b + B.STATE] = 1;
        },
      ],
      [
        'yellow flag',
        (f: Float32Array) => {
          f[o + F.LOCAL_FLAG] = FLAG.YELLOW;
        },
      ],
      [
        'pit autopilot',
        (f: Float32Array) => {
          f[o + RACE_BASE + R.NEXT_COMPOUND] = 1;
        },
      ],
      [
        'missed cut warning',
        (f: Float32Array) => {
          f[o + F.WARNINGS] = 1;
        },
      ],
      [
        'wetness change',
        (f: Float32Array) => {
          f[front + W.WATER] = f[rear + W.WATER] = 0.3;
        },
      ],
      [
        'compound change',
        (f: Float32Array) => {
          f[o + F.COMPOUND] = 2;
        },
      ],
      [
        'reverse riding',
        (f: Float32Array) => {
          f[o + F.VX] *= -1;
          f[o + F.VZ] *= -1;
        },
      ],
    ] as const)('breaks the current streak on %s but retains earned records', (_, edit) => {
      const h = streakRig();
      h.rideTo(h.after(1));
      const earned = h.practice.last;
      h.rideTo(h.distance() + 8, edit);
      expect(h.practice.streak).toEqual({ current: 0, best: 2, next: null });
      expect(h.practice.last).toBe(earned);
      h.rideTo(h.after(2));
      expect(h.practice.streak.current).toBe(1);
      expect(h.practice.streak.best).toBe(2);
      // A later retry still compares against the earlier clean personal best.
      h.run(500, 50);
      expect(h.practice.last?.delta).toBeCloseTo(h.corner.length / 50 - h.corner.length / 40, 4);
      expect(h.practice.streak.current).toBe(1);
      expect(h.practice.streak.best).toBe(2);
    });

    it.each([
      ['AI demonstration', { ...human, human: false }],
      ['replay', { ...human, replay: true }],
      ['race', { ...human, practice: false }],
    ] as const)('never extends a manual streak through %s', (_, context) => {
      const h = streakRig();
      h.rideTo(h.after(1));
      const earned = h.practice.last;
      h.rideTo(h.after(2), undefined, context);
      expect(h.practice.streak).toEqual({ current: 0, best: 2, next: null });
      expect(h.practice.last).toBe(earned);
      h.rideTo(h.after(3));
      expect(h.practice.streak.current).toBe(1);
      expect(h.practice.streak.best).toBe(2);
    });

    it.each(['teleport', 'gap', 'rewind'] as const)(
      'cannot connect a streak across a %s',
      (kind) => {
        const h = streakRig();
        h.rideTo(h.after(1));
        const earned = h.practice.last;
        h.sample(
          h.distance() + (kind === 'teleport' ? 200 : 8),
          h.time() + (kind === 'gap' ? 2 : kind === 'rewind' ? -1 : 0.2),
        );
        expect(h.practice.streak).toEqual({ current: 0, best: 2, next: null });
        expect(h.practice.last).toBe(earned);
      },
    );

    it('clears current and best streaks with the session or assistance setting', () => {
      const h = streakRig();
      h.rideTo(h.after(1));
      h.rideTo(h.distance() + 8, undefined, { ...human, assist: 'expert' });
      expect(h.practice.streak).toEqual({ current: 0, best: 0, next: null });
      h.run(500, 50);
      expect(h.practice.streak.best).toBe(1);
      h.practice.reset();
      expect(h.practice.streak).toEqual({ current: 0, best: 0, next: null });
    });
  });
});
