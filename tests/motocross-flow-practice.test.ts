import { describe, expect, it } from 'vitest';
import {
  motocrossFlowSections,
  MotocrossFlowPractice,
  type MotocrossFlowSample,
} from '../src/simulation/offroad/flow-practice.ts';
import {
  MotocrossLandingChallenge,
  type LandingChallengeSample,
} from '../src/simulation/offroad/landing-challenge.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { assessMotocrossLanding } from '../src/simulation/offroad/riding-feedback.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { trackPoint } from '../src/simulation/track.ts';

const clean = assessMotocrossLanding(0.1, 2, 0, false);
const hard = assessMotocrossLanding(0.1, 2, 0.8, false);

function harness(id: 'valley-ridge-mx' | 'arena-nord-sx' = 'valley-ridge-mx') {
  const track = rigTrack(id),
    course = offroadCourse(track.circuit)!,
    sections = motocrossFlowSections(course);
  const flow = new MotocrossFlowPractice(),
    targets = new MotocrossLandingChallenge();
  const point = trackPoint();
  const sample: MotocrossFlowSample = {
    course: track,
    machine: 'mx450:sport',
    sections,
    length: track.length,
    time: 0,
    s: 0,
    speed: 20,
    lateral: 0,
    legalHalfWidth: 5,
    moisture: 0.28,
    airborne: false,
    crashed: false,
    eligible: true,
    landing: null,
  };
  const tick = (changes: Partial<MotocrossFlowSample>) => {
    Object.assign(sample, changes);
    flow.update(sample);
  };
  /** Explicit presentation samples; both production judges see the same
   * transitions. This tests sequence/eligibility, not simulated flight. */
  const run = (
    index: number,
    startedAt: number,
    speed: number,
    options: {
      step?: number;
      moisture?: number;
      stopAfterFirst?: boolean;
      skipFirst?: boolean;
      failedLanding?: boolean;
      interrupt?: (sample: MotocrossFlowSample) => Partial<MotocrossFlowSample>;
    } = {},
  ) => {
    const section = sections[index],
      step = options.step ?? 0.5;
    for (let d = -1; d < section.length + 1 + step; d += step) {
      const s = section.from + d;
      const jump = section.jumps.find((jump) => s >= jump.takeoff && s < jump.landing);
      const previous = [...section.jumps].reverse().find((jump) => s >= jump.takeoff);
      const airborne = !!jump && !(options.skipFirst && jump === section.jumps[0]);
      const airTime = previous ? (Math.min(s, previous.landing) - previous.takeoff) / speed : 0;
      track.at(s, point);
      Object.assign(sample, {
        s,
        time: startedAt + (d + 1) / speed,
        speed,
        airborne,
        moisture: options.moisture ?? 0.28,
        legalHalfWidth: course.legalWidth(point.width, s, sample.lateral) - 0.3,
      });
      if (options.interrupt) Object.assign(sample, options.interrupt(sample));
      const targetSample: LandingChallengeSample = {
        ...sample,
        jumps: course.jumps,
        halfWidth: point.width,
        airTime,
        landing: options.failedLanding && previous === section.jumps[0] ? hard : clean,
      };
      targets.update(targetSample);
      sample.landing = targets.last;
      flow.update(sample);
      if (options.stopAfterFirst && flow.active?.linked === 1) break;
    }
  };
  return { flow, targets, sample, sections, track, course, tick, run };
}

describe('linked motocross practice sections', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s links actual surveyed features without changing their profiles',
    (id) => {
      const h = harness(id);
      expect(h.sections).toHaveLength(2);
      expect(h.sections.flatMap((section) => section.jumps).length).toBe(
        id === 'valley-ridge-mx' ? 5 : 4,
      );
      for (const section of h.sections) {
        expect(section.jumps.length).toBeGreaterThanOrEqual(2);
        expect(section.from).toBeLessThan(section.jumps[0].start);
        expect(section.to).toBeGreaterThan(section.jumps.at(-1)!.end);
        expect(section.jumps.every((jump) => h.course.jumps.includes(jump))).toBe(true);
        expect(section.jumps.every((jump) => jump.landingPitch < 0)).toBe(true);
      }
    },
  );

  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    'records every %s section only after the ordered targets and exit',
    (id) => {
      const h = harness(id);
      for (const section of h.sections) {
        h.run(section.id, 1 + section.id * 50, 18, { stopAfterFirst: true });
        expect(h.flow.active?.linked).toBe(1);
        expect(h.flow.last).toBeNull();
        // Restart on the next actual approach, then traverse the full section.
        h.run(section.id, 25 + section.id * 50, 18);
        const result = h.flow.last!;
        expect(result.section).toBe(section);
        expect(result.seconds).toBeCloseTo(section.length / 18, 8);
        expect(result.exitSpeed).toBeCloseTo(18, 8);
        expect(result.delta).toBeNull();
        expect(h.flow.record(section, 'dry')?.attempts).toBe(1);
        h.tick({ time: h.sample.time });
        h.tick({ time: h.sample.time });
        expect(h.flow.record(section, 'dry')?.attempts).toBe(1);
      }
    },
  );

  it('compares only completed runs in the same entry soil, independently of presentation spacing', () => {
    const h = harness(),
      section = h.sections[0];
    h.run(0, 1, 16, { step: 0.5 });
    h.run(0, 50, 20, { step: 1.1 });
    expect(h.flow.last?.seconds).toBeCloseTo(section.length / 20, 8);
    expect(h.flow.last?.delta).toBeCloseTo(section.length / 20 - section.length / 16, 8);
    expect(h.flow.last?.improved).toBe(true);
    expect(h.flow.record(section, 'dry')?.attempts).toBe(2);
    h.run(0, 100, 18, { moisture: 0.7 });
    expect(h.flow.last).toMatchObject({ soil: 'wet', delta: null, improved: false });
    expect(h.flow.record(section, 'wet')?.attempts).toBe(1);
    expect(h.flow.record(section, 'dry')?.attempts).toBe(2);
  });

  it.each(['rolled', 'rough', 'off-course', 'automatic', 'crash', 'teleport', 'reverse'] as const)(
    'rejects an interrupted or %s sequence',
    (reason) => {
      const h = harness();
      const section = h.sections[0];
      let interrupted = false;
      h.run(0, 1, 18, {
        skipFirst: reason === 'rolled',
        failedLanding: reason === 'rough',
        interrupt: (sample) => {
          if (interrupted || sample.s < section.jumps[0].end + 2) return {};
          interrupted = true;
          return reason === 'off-course'
            ? { lateral: 20 }
            : reason === 'automatic'
              ? { eligible: false }
              : reason === 'crash'
                ? { crashed: true }
                : reason === 'teleport'
                  ? { s: sample.s + 50 }
                  : reason === 'reverse'
                    ? { s: sample.s - 10 }
                    : {};
        },
      });
      expect(h.flow.last).toBeNull();
      expect(h.flow.history.size).toBe(0);
    },
  );

  it('counts stops in elapsed time but paused packets cannot advance or duplicate a sequence', () => {
    const h = harness();
    h.run(0, 1, 18, { stopAfterFirst: true });
    const before = { ...h.flow.active! };
    for (let i = 0; i < 20; i++) h.tick({ time: h.sample.time });
    expect(h.flow.active).toEqual(before);
    h.tick({ time: h.sample.time + 1, speed: 0 });
    expect(h.flow.active?.elapsed).toBeCloseTo(before.elapsed + 1, 8);
    expect(h.flow.active?.linked).toBe(1);
    h.tick({ eligible: false });
    h.tick({ eligible: true });
    expect(h.flow.active).toBeNull();
  });

  it('preserves earned records across replay and continuity breaks, but never the partial section', () => {
    const h = harness();
    h.run(0, 1, 18);
    h.run(0, 50, 18, { stopAfterFirst: true });
    h.flow.suspend();
    expect(h.flow.active).toBeNull();
    expect(h.flow.last).toBeNull();
    expect(h.flow.record(h.sections[0], 'dry')?.attempts).toBe(1);
    h.tick({ time: 2 });
    h.tick({ time: 5 });
    expect(h.flow.active).toBeNull();
    expect(h.flow.history.size).toBe(1);
    h.tick({ machine: 'mx250:raw', time: 5.1 });
    expect(h.flow.history.size).toBe(0);
  });

  it('accepts a new complete traversal after a rewind without reusing a future landing timestamp', () => {
    const h = harness();
    h.run(0, 100, 18);
    const future = h.sample.landing!;
    expect(h.flow.record(h.sections[0], 'dry')?.attempts).toBe(1);
    h.flow.suspend();
    h.targets.suspend();
    h.run(0, 10, 18, { stopAfterFirst: true });
    const linked = h.flow.active?.linked;
    h.tick({ time: h.sample.time + 0.01, landing: future });
    expect(h.flow.active?.linked).toBe(linked);
    h.run(0, 30, 18);
    expect(h.flow.record(h.sections[0], 'dry')?.attempts).toBe(2);
    expect(h.flow.last?.delta).toBeCloseTo(0, 8);
  });

  it('never reconstructs a missing entry or credits a previous individual target', () => {
    const h = harness();
    const section = h.sections[0];
    h.tick({ time: 1, s: section.from + 1 });
    h.tick({ time: 1.05, s: section.from + 2 });
    expect(h.flow.active).toBeNull();
    h.run(0, 10, 18, { stopAfterFirst: true });
    const target = h.sample.landing!;
    expect(h.flow.active?.linked).toBe(1);
    for (let i = 0; i < 5; i++) h.tick({ time: h.sample.time + 0.01, landing: target });
    expect(h.flow.active?.linked).toBe(1);
    expect(h.flow.last).toBeNull();
  });
});
