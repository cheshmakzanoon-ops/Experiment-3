import { describe, expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import {
  motocrossBermLine,
  motocrossBermSectors,
  MotocrossBermPractice,
  type BermPracticeSample,
  type BermPracticeSector,
} from '../src/simulation/offroad/berm-practice.ts';
import { relief } from '../src/simulation/offroad/course.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { trackPoint } from '../src/simulation/track.ts';

const sector: BermPracticeSector = {
  id: 0,
  name: 'TEST BANK',
  from: 20,
  apex: 50,
  to: 80,
  length: 60,
  outside: 1,
  halfWidth: 5,
};

function harness(selected = sector) {
  const practice = new MotocrossBermPractice();
  const sample: BermPracticeSample = {
    course: {},
    machine: 'mx450:sport',
    sectors: [selected],
    length: 300,
    time: 0,
    s: 0,
    speed: 20,
    lateral: 0,
    legalHalfWidth: 6.3,
    moisture: 0.2,
    airborne: false,
    crashed: false,
    eligible: true,
  };
  const tick = (values: Partial<BermPracticeSample>) => {
    Object.assign(sample, values);
    practice.update(sample);
  };
  const traverse = (start: number, speed = 20, lateral = 0, spacing = 4) => {
    const from = selected.from - 4;
    for (let d = 0; d <= selected.length + 8; d += spacing)
      tick({ time: start + d / speed, s: mod(from + d, sample.length), speed, lateral });
  };
  return { practice, sample, tick, traverse };
}

describe('authored berm practice sectors', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s identifies actual named banks and uses their physical outside sign',
    (id) => {
      const track = rigTrack(id),
        course = offroadCourse(track.circuit)!,
        sectors = motocrossBermSectors(track, course),
        p = trackPoint(),
        r = relief();
      expect(sectors.length).toBeGreaterThanOrEqual(3);
      for (const s of sectors) {
        expect(track.circuit.corners.some((corner) => corner.name === s.name)).toBe(true);
        track.at(s.apex, p);
        course.relief(s.apex, s.outside * p.width, p, r);
        const outsideHeight = r.h;
        course.relief(s.apex, -s.outside * p.width, p, r);
        expect(outsideHeight - r.h, s.name).toBeGreaterThan(0.3);
        expect(motocrossBermLine(s.outside * p.width * 0.7, s)).toBe('outside');
        expect(motocrossBermLine(-s.outside * p.width * 0.7, s)).toBe('inside');
        expect(motocrossBermLine(0, s)).toBe('middle');
        for (let d = 0; d <= s.length; d += 0.25) {
          const at = mod(s.from + d, track.length);
          expect(course.jumpAt(at), `${s.name} at ${d}`).toBeNull();
          expect(course.isRough(at), `${s.name} at ${d}`).toBe(false);
        }
      }
    },
  );
});

describe('observed berm entry, apex and exit', () => {
  it('records the traversed line, elapsed time and interpolated exit speed only once', () => {
    const h = harness();
    h.tick({ time: 0, s: 18, lateral: -3, speed: 20 });
    h.tick({ time: 0.25, s: 23 });
    expect(h.practice.active?.startedAt).toBeCloseTo(0.1, 8);
    h.tick({ time: 1.5, s: 48 });
    h.tick({ time: 1.75, s: 53 });
    h.tick({ time: 2.8, s: 74 });
    h.tick({ time: 3.3, s: 84, speed: 30 });
    expect(h.practice.last).toMatchObject({
      line: 'inside',
      soil: 'dry',
      delta: null,
      improved: false,
    });
    expect(h.practice.last?.seconds).toBeCloseTo(3, 8);
    expect(h.practice.last?.exitSpeed).toBeCloseTo(26, 8);
    expect(h.practice.history.size).toBe(1);
    expect(h.practice.record(sector, 'dry')?.attempts).toBe(1);
    h.tick({ time: 3.3 });
    h.tick({ time: 3.5, s: 88 });
    expect(h.practice.record(sector, 'dry')?.attempts).toBe(1);
  });

  it('measures equivalent traversals at different presentation rates', () => {
    for (const spacing of [1, 4, 8, 17]) {
      const h = harness();
      h.traverse(1, 20, 3, spacing);
      // End the coarsest traversal just beyond the exit if the stride skipped it.
      h.tick({ time: 1 + 68 / 20, s: 84 });
      expect(h.practice.last?.seconds, `spacing ${spacing}`).toBeCloseTo(3, 8);
    }
  });

  it('continues timing a stopped bike, and the wait is included in the result', () => {
    const h = harness();
    h.tick({ time: 0, s: 18 });
    h.tick({ time: 0.2, s: 22 });
    h.tick({ time: 0.6, s: 30, speed: 0 });
    h.tick({ time: 1.6 });
    expect(h.practice.active?.elapsed).toBeCloseTo(1.5, 8);
    h.tick({ time: 2.6 });
    h.tick({ time: 3.6, s: 40, speed: 20 });
    h.tick({ time: 4.1, s: 50 });
    h.tick({ time: 5.1, s: 70 });
    h.tick({ time: 5.7, s: 82 });
    expect(h.practice.last?.seconds).toBeCloseTo(5.5, 8);
  });

  it('keeps each tried line and compares only the same corner and soil category', () => {
    const h = harness();
    h.traverse(1, 20, -3);
    h.traverse(10, 24, 3);
    expect(h.practice.last).toMatchObject({ line: 'outside', improved: true });
    expect(h.practice.last?.delta).toBeCloseTo(-0.5, 8);
    h.traverse(20, 18, 0);
    const record = h.practice.record(sector, 'dry')!;
    expect(record.attempts).toBe(3);
    expect(record.best.line).toBe('outside');
    expect(Object.keys(record.lines).sort()).toEqual(['inside', 'middle', 'outside']);
    h.tick({ moisture: 0.8 });
    h.traverse(30, 30, -3);
    expect(h.practice.last).toMatchObject({ soil: 'wet', delta: null, improved: false });
    expect(h.practice.record(sector, 'wet')?.best.line).toBe('inside');
    expect(h.practice.record(sector, 'dry')?.best.line).toBe('outside');
  });

  it('accepts the rideable outer bank beyond the groomed width and samples line at the apex', () => {
    const h = harness();
    h.tick({ time: 0, s: 16, lateral: 6.1 });
    h.tick({ time: 0.5, s: 26 });
    h.tick({ time: 1.5, s: 46 });
    h.tick({ time: 2, s: 56, lateral: 5.8 });
    h.tick({ time: 3, s: 76, lateral: -2 });
    h.tick({ time: 3.5, s: 86 });
    expect(h.practice.last?.line).toBe('outside');
  });

  it('measures a bank which crosses the lap seam', () => {
    const wrap = { ...sector, from: 280, apex: 10, to: 40 };
    const h = harness(wrap);
    h.traverse(1, 20, -3);
    expect(h.practice.last?.seconds).toBeCloseTo(3, 8);
    expect(h.practice.last?.line).toBe('inside');
  });

  it('does not credit a spawn or return of human control inside the bank', () => {
    for (const source of ['spawn', 'autopilot']) {
      const h = harness();
      h.tick({ time: 1, s: 19, eligible: source === 'spawn' });
      if (source === 'spawn') h.practice.suspend();
      h.tick({ time: 1.1, s: 21, eligible: true });
      h.tick({ time: 2.5, s: 49 });
      h.tick({ time: 4.1, s: 81 });
      expect(h.practice.last, source).toBeNull();
    }
  });

  it.each(['cut', 'crash', 'air', 'autopilot', 'teleport', 'reverse', 'seek', 'gap'] as const)(
    'invalidates a partial run on %s without discarding the earned best',
    (reason) => {
      const h = harness();
      h.traverse(1, 20);
      h.tick({ time: 10, s: 18 });
      h.tick({ time: 10.2, s: 22 });
      h.tick({ time: 10.6, s: 30 });
      h.tick({
        time: reason === 'seek' ? 10.5 : reason === 'gap' ? 15 : 10.8,
        s: reason === 'teleport' ? 70 : reason === 'reverse' ? 27 : 34,
        lateral: reason === 'cut' ? 6.5 : 0,
        crashed: reason === 'crash',
        airborne: reason === 'air',
        eligible: reason !== 'autopilot',
      });
      const continuedAt = h.sample.time + 0.1;
      const continuedS = h.sample.s + 2;
      h.tick({
        time: continuedAt,
        s: continuedS,
        lateral: 0,
        crashed: false,
        airborne: false,
        eligible: true,
      });
      for (let s = continuedS + 2; s <= 84; s += 2)
        h.tick({ time: continuedAt + (s - continuedS) / 20, s });
      expect(h.practice.record(sector, 'dry')?.attempts).toBe(1);
    },
  );

  it('cancels on an ineligible repeated packet, and replay suspension preserves records', () => {
    const h = harness();
    h.traverse(1);
    h.tick({ time: 10, s: 18 });
    h.tick({ time: 10.2, s: 22 });
    h.tick({ eligible: false });
    expect(h.practice.active).toBeNull();
    h.tick({ eligible: true });
    h.tick({ time: 11.6, s: 50 });
    h.tick({ time: 13.2, s: 82 });
    expect(h.practice.record(sector, 'dry')?.attempts).toBe(1);
    h.practice.suspend();
    expect(h.practice.record(sector, 'dry')?.attempts).toBe(1);
    h.traverse(20);
    expect(h.practice.record(sector, 'dry')?.attempts).toBe(2);
  });

  it('resets comparison for another course, machine or invalid packet', () => {
    for (const reset of ['course', 'machine', 'invalid'] as const) {
      const h = harness();
      h.traverse(1);
      h.tick({
        time: 5,
        ...(reset === 'course' ? { course: {} } : {}),
        ...(reset === 'machine' ? { machine: 'mx250:raw' } : {}),
        ...(reset === 'invalid' ? { s: NaN } : {}),
      });
      expect(h.practice.history.size, reset).toBe(0);
      expect(h.practice.last, reset).toBeNull();
    }
  });
});
