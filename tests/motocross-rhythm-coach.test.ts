import { describe, expect, it } from 'vitest';
import { jumpHoldSpeed as aiTarget } from '../src/simulation/offroad/ai.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { Track } from '../src/simulation/track.ts';
import { assessMotocrossLanding } from '../src/simulation/offroad/riding-feedback.ts';
import { motocrossApproachCue, MotocrossRhythm } from '../src/simulation/offroad/rhythm-coach.ts';

const clean = assessMotocrossLanding(0.1, 2, 0, false);
const hard = assessMotocrossLanding(0.1, 2, 0.8, false);
function harness() {
  const rhythm = new MotocrossRhythm(),
    course = {};
  const tick = (
    time: number,
    airborne = false,
    airTime = 0.8,
    bad = false,
    crashed = false,
    selectedCourse = course,
    eligible = true,
    machine = 'mx450:sport',
  ) => {
    rhythm.update({
      time,
      course: selectedCourse,
      machine,
      airborne,
      airTime,
      crashed,
      eligible,
      landing: bad ? hard : clean,
    });
  };
  const jump = (t: number, bad = false) => {
    tick(t - 0.01, false, 0);
    tick(t, true);
    tick(t + 0.02, false);
    tick(t + 0.12, false, 0.8, bad);
    tick(t + 0.28, false);
  };
  return { rhythm, tick, jump };
}

describe('surveyed jump approach information', () => {
  it.each(['arena-nord-sx', 'valley-ridge-mx'] as const)(
    'shares %s production AI target without changing its calibration',
    (id) => {
      const course = (Track.offroadOf(rigTrack(id)) as TrackTerrainSurface).course;
      for (const jump of course.jumps) {
        const speed = jumpHoldSpeed(jump);
        expect(aiTarget(jump)).toBe(speed);
        expect(motocrossApproachCue(jump, 70, speed)?.kind).toBe('hold');
        expect(motocrossApproachCue(jump, 70, 0)?.kind).toBe('build');
        expect(motocrossApproachCue(jump, 70, speed + 3)?.kind).toBe('ease');
        expect(motocrossApproachCue(jump, 4, 0)?.kind).toBe('roll');
        expect(motocrossApproachCue(jump, 70, 0, true)?.cue).toContain('Wet soil');
        expect(motocrossApproachCue(jump, 70, speed)?.targetKph).toBe(Math.round(speed * 3.6));
        for (const distance of [-1, Infinity, NaN, 101])
          expect(motocrossApproachCue(jump, distance, speed)).toBeNull();
        expect(motocrossApproachCue(jump, 20, NaN)).toBeNull();
      }
    },
  );
});

describe('practice rhythm objective from real snapshot transitions', () => {
  it('requires settlement, counts a landing once, and records three clean jumps', () => {
    const h = harness();
    h.tick(0.98, false, 0);
    h.tick(1, true);
    h.tick(1.02);
    expect(h.rhythm.streak).toBe(0);
    h.tick(1.1);
    h.tick(1.28);
    expect(h.rhythm.streak).toBe(1);
    h.tick(1.28);
    h.tick(1.28);
    h.tick(1.6);
    expect(h.rhythm.streak).toBe(1);
    h.jump(2);
    h.jump(3);
    expect(h.rhythm.streak).toBe(3);
    expect(h.rhythm.best).toBe(3);
    expect(h.rhythm.completed).toBe(3);
  });
  it('keeps the worst bottom-out during settlement, rather than celebrating a decaying signal', () => {
    const h = harness();
    h.jump(1);
    h.jump(2, true);
    expect(h.rhythm.streak).toBe(0);
    expect(h.rhythm.best).toBe(1);
    expect(h.rhythm.completed).toBe(2);
  });
  it('does not count little wheel hops or an unsettled rebound as a clean landing', () => {
    const h = harness();
    h.tick(1, true, 0.05);
    h.tick(1.03, false, 0.08);
    h.tick(1.4, false, 0.08);
    expect(h.rhythm.completed).toBe(0);
    h.tick(2, true);
    h.tick(2.02);
    h.tick(2.08, true, 0.03);
    h.tick(2.12, false, 0.07);
    h.tick(2.4, false, 0.07);
    expect(h.rhythm.completed).toBe(0);
    expect(h.rhythm.streak).toBe(0);
  });
  it('breaks a run on an actual crash without discarding its earlier best', () => {
    const h = harness();
    h.jump(1);
    h.jump(2);
    h.tick(2.4, false, 0.8, false, true);
    expect(h.rhythm.streak).toBe(0);
    expect(h.rhythm.best).toBe(2);
  });
  it('does not turn a long early rebound into a second eligible flight', () => {
    const h = harness();
    h.tick(0.9, false, 0);
    h.tick(1, true, 0.8);
    h.tick(1.02, false, 0.82);
    h.tick(1.09, true, 0.03);
    h.tick(1.5, true, 0.44);
    h.tick(1.6, false, 0.54);
    h.tick(1.9, false, 0.54);
    expect(h.rhythm.completed).toBe(0);
    expect(h.rhythm.streak).toBe(0);
  });
  it('resets on a seek, long presentation gap, invalid packet, or course switch', () => {
    for (const reset of ['seek', 'gap', 'invalid', 'course', 'machine']) {
      const h = harness();
      h.jump(1);
      if (reset === 'seek') h.tick(1.2);
      if (reset === 'gap') h.tick(10);
      if (reset === 'invalid') h.tick(NaN);
      if (reset === 'course') h.tick(1.5, false, 0.8, false, false, {});
      if (reset === 'machine') h.tick(1.5, false, 0.8, false, false, undefined, true, 'mx250:raw');
      expect(h.rhythm.streak, reset).toBe(0);
      expect(h.rhythm.best, reset).toBe(0);
      expect(h.rhythm.completed, reset).toBe(0);
    }
  });

  it('requires an observed human takeoff and never credits control returned in midair', () => {
    for (const takeover of ['already-airborne', 'automatic-takeoff'] as const) {
      const h = harness();
      if (takeover === 'automatic-takeoff') h.tick(0.9, false, 0, false, false, undefined, false);
      h.tick(1, true, 0.3, false, false, undefined, takeover !== 'automatic-takeoff');
      h.tick(1.1, true, 0.4);
      h.tick(1.4, false, 0.7);
      h.tick(1.7, false, 0.7);
      expect(h.rhythm.completed, takeover).toBe(0);
      expect(h.rhythm.streak, takeover).toBe(0);
      h.jump(2);
      expect(h.rhythm.completed, takeover).toBe(1);
    }
  });

  it('breaks a run when control is lost during settling, including a paused packet', () => {
    const h = harness();
    h.jump(1);
    h.tick(1.9, false, 0);
    h.tick(2, true);
    h.tick(2.02);
    h.tick(2.02, false, 0.8, false, false, undefined, false);
    h.tick(2.02);
    h.tick(2.4);
    expect(h.rhythm.completed).toBe(1);
    expect(h.rhythm.streak).toBe(0);
    expect(h.rhythm.best).toBe(1);
  });

  it('preserves earned best while a replay suspends and cancels the unfinished flight', () => {
    const h = harness();
    h.jump(1);
    h.tick(1.9, false, 0);
    h.tick(2, true);
    h.rhythm.suspend();
    h.rhythm.suspend();
    h.tick(2.1, true);
    h.tick(2.4);
    h.tick(2.7);
    expect(h.rhythm.completed).toBe(1);
    expect(h.rhythm.best).toBe(1);
    expect(h.rhythm.streak).toBe(0);
    h.jump(3);
    expect(h.rhythm.completed).toBe(2);
    expect(h.rhythm.streak).toBe(1);
  });
});
