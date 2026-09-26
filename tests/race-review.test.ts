import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import {
  RaceReviewEvents,
  RACE_REVIEW_COLUMNS,
  raceReviewFrame,
  readRaceReviewFrame,
  raceReviewValues,
  restoreRaceReviewFrame,
  validRaceReviewFrame,
} from '../src/rendering/race-review.ts';
import {
  PresentationReview,
  readPresentationReport,
  reviewBudget,
  reviewFrame,
  type ReviewContext,
} from '../src/rendering/presentation-review.ts';
import { Effects, PARTICLE_KIND } from '../src/rendering/effects.ts';

const context: ReviewContext = {
  source: 'a'.repeat(64),
  machine: 'Synthetic unit fixture',
  browser: 'Not physical hardware',
  configuration: '{}',
  workload: 'close-racing',
  camera: 'chase',
  mode: 'timed-scene',
  trackLength: 1000,
  startS: 100,
  startLaps: 0,
  startTime: 0,
  followedCar: 0,
  videoRequested: false,
  racingEvidence: 1,
};
function frame() {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 2 });
  const f = sim.makeFrame();
  f[H.LENGTH] = 1000;
  f[H.PHASE] = 2;
  for (let id = 0; id < 3; id++) {
    const b = carBase(id);
    f[b + F.X] = 0;
    f[b + F.Y] = 0.5;
    f[b + F.Z] = id * 10;
    f[b + F.QX] = f[b + F.QY] = f[b + F.QZ] = 0;
    f[b + F.QW] = 1;
    f[b + F.SPEED] = 30;
    f[b + F.S] = 100 + id * 10;
    for (let w = 0; w < 4; w++) {
      const p = b + WHEEL_BASE + w * WHEEL_STRIDE;
      f[p + W.LOAD] = 2000;
      f[p + W.WATER] = 0.6;
    }
  }
  return f;
}
const observe = (f: Float32Array, follow = 0) => {
  const out = raceReviewFrame();
  readRaceReviewFrame(f, follow, 0, 0, out);
  return out;
};
function closeFrame() {
  return {
    ...reviewFrame(),
    time: 0,
    s: 100,
    racePhase: 2,
    speed: 25,
    opponents: 2,
    closeRival: 1,
    closeGap: 10,
    leader: 1,
    leaderGap: 10,
    contactWater: 0.6,
    leaderWater: 0.6,
    rain: 8,
    water: 0.6,
    sprayParticles: 30,
  };
}
function complete(workload: 'close-racing' | 'wet-following' = 'close-racing') {
  const r = new PresentationReview(),
    f = closeFrame();
  r.start({ ...context, workload }, 0);
  for (let i = 1; i <= 300; i++) {
    f.time = i / 10;
    r.record(i * 100, f);
  }
  return r;
}

describe('same-presented-frame racing evidence', () => {
  it('selects a moving rival ahead without changing snapshot bytes', () => {
    const f = frame(),
      before = f.slice(),
      out = observe(f);
    expect(out).toMatchObject({
      opponents: 2,
      closeRival: 1,
      leader: 1,
      closeGap: 10,
      leaderGap: 10,
    });
    expect(out.contactWater).toBeCloseTo(0.6);
    expect(out.leaderWater).toBeCloseTo(0.6);
    expect(f).toEqual(before);
    expect(validRaceReviewFrame(out, 0)).toBe(true);
  });
  it.each(['bridge', 'opposite', 'pit', 'retired', 'finished', 'stationary', 'separate-road'])(
    'does not count %s as eligible nearby racing',
    (kind) => {
      const f = frame();
      for (const id of [1, 2]) {
        const b = carBase(id);
        if (kind === 'bridge') f[b + F.Y] += 4;
        if (kind === 'opposite') {
          f[b + F.QY] = 1;
          f[b + F.QW] = 0;
        }
        if (kind === 'pit') f[b + F.IN_PIT] = 1;
        if (kind === 'retired') f[b + F.RETIRED] = 1;
        if (kind === 'finished') f[b + F.FINISH] = 1;
        if (kind === 'stationary') f[b + F.SPEED] = 0;
        if (kind === 'separate-road') f[b + F.S] += 200;
      }
      expect(observe(f)).toMatchObject({ closeRival: -1, leader: -1 });
    },
  );
  it('handles the lap seam and rejects offset or trailing spray sources', () => {
    const f = frame(),
      b = carBase(0),
      n = carBase(1);
    f[b + F.S] = 995;
    f[n + F.S] = 5;
    f[carBase(2) + F.RETIRED] = 1;
    expect(observe(f).leader).toBe(1);
    f[n + F.X] = 4;
    expect(observe(f).leader).toBe(-1);
    f[n + F.X] = 0;
    f[n + F.Z] = -10;
    expect(observe(f).leader).toBe(-1);
  });
  it('requires local loaded contact water rather than global wet-weather labels', () => {
    const f = frame();
    f[H.WATER] = 3;
    f[H.RAIN] = 10;
    for (let w = 0; w < 4; w++) f[carBase(1) + WHEEL_BASE + w * WHEEL_STRIDE + W.LOAD] = 0;
    expect(observe(f).leaderWater).toBe(0);
  });
  it.each([NaN, 0, 13, 1.5])('rejects malformed car count %s', (count) => {
    const f = frame();
    f[H.CARS] = count;
    expect(() => observe(f)).toThrow(/snapshot/);
  });
  it('rejects out-of-bounds followed identities and short buffers', () => {
    expect(() => observe(frame(), 3)).toThrow();
    expect(() => observe(frame(), -1)).toThrow();
    expect(() => observe(frame().subarray(0, 20))).toThrow();
  });
  it('round-trips all numeric racing fields, preserving absent rivals as -1', () => {
    const f = observe(frame()),
      values = raceReviewValues(f),
      out = raceReviewFrame();
    expect(values.length).toBe(RACE_REVIEW_COLUMNS.length);
    restoreRaceReviewFrame(values, out);
    expect(out).toEqual(f);
    expect(() => restoreRaceReviewFrame([NaN], out)).toThrow();
  });
  it('attributes live spray to its real emitter and clears ownership on reset', () => {
    const f = frame(),
      fx = new Effects();
    // Only car 1 touches water; the other moving cars must not inherit its pool.
    for (const id of [0, 2])
      for (let w = 0; w < 4; w++) f[carBase(id) + WHEEL_BASE + w * WHEEL_STRIDE + W.WATER] = 0;
    for (let i = 0; i < 30; i++) fx.update(f, 1 / 60);
    expect(fx.diagnostics().active[PARTICLE_KIND.SPRAY]).toBeGreaterThan(0);
    expect(fx.activeSprayCountFor(1)).toBeGreaterThan(0);
    expect(fx.activeSprayCountFor(0)).toBe(0);
    expect(fx.activeSprayCountFor(2)).toBe(0);
    const before = fx.diagnostics();
    fx.activeSprayCountFor(1);
    expect(fx.diagnostics()).toEqual(before);
    fx.enabled = false;
    expect(fx.activeSprayCountFor(1)).toBe(0);
    fx.enabled = true;
    fx.clear();
    expect(fx.activeSprayCountFor(1)).toBe(0);
    expect(fx.activeSprayCountFor(-1)).toBe(0);
  });
});

describe('qualifying the existing presentation capture', () => {
  it.each(['grid-start', 'close-racing', 'wet-following', 'pit-service'] as const)(
    'thirty seconds alone cannot complete %s',
    (workload) => {
      const r = new PresentationReview(),
        f = reviewFrame();
      r.start({ ...context, workload }, 0);
      f.s = 100;
      f.time = 30;
      r.record(30000, f);
      expect(r.state).toBe('recording');
      expect(r.racing?.qualified).toBe(false);
      r.interrupt('No observed event');
      expect(readPresentationReport(r.report()).state).toBe('interrupted');
    },
  );
  it('completes after sustained racing AND the minimum observed duration', () => {
    for (const workload of ['close-racing', 'wet-following'] as const) {
      const r = complete(workload),
        report = readPresentationReport(r.report());
      expect(r.state).toBe('complete');
      expect(report.racing?.summary.qualified).toBe(true);
      expect(report.racing?.rows).toHaveLength(report.rows.length);
      expect(report.racing?.summary.visualAccepted).toBe(false);
      expect(report.summary.gpuVRAMBytes).toBeNull();
    }
  });
  it('retains the existing full-lap traversal gate even when an event qualifies early', () => {
    const r = new PresentationReview(),
      f = closeFrame();
    r.start({ ...context, mode: 'full-lap' }, 0);
    for (let i = 1; i <= 300; i++) {
      f.time = i / 10;
      r.record(i * 100, f);
    }
    expect(r.racing?.qualified).toBe(true);
    expect(r.state).toBe('recording');
  });
  it('does not accumulate stale snapshots, short alternating rivals, or unseen long gaps', () => {
    const f = closeFrame(),
      e = new RaceReviewEvents();
    for (let i = 0; i < 100; i++) e.observe(0, 8, 0.6, f);
    expect(e.qualified('wet-following')).toBe(false);
    for (let i = 1; i <= 100; i++) {
      f.leader = f.closeRival = i % 2 ? 2 : 1;
      e.observe(i / 10, 8, 0.6, f);
    }
    expect(e.closeSeconds).toBe(0);
    expect(e.wetFollowingSeconds).toBe(0);
    for (let i = 1; i < 100; i++) e.observe(10 + i * 2, 8, 0.6, f);
    expect(e.qualified('close-racing')).toBe(false);
  });
  it.each(['no-rain', 'dry-player', 'dry-leader', 'no-spray'])(
    'rejects a wet following label with %s',
    (kind) => {
      const f = closeFrame(),
        e = new RaceReviewEvents();
      if (kind === 'dry-player') f.contactWater = 0;
      if (kind === 'dry-leader') f.leaderWater = 0;
      if (kind === 'no-spray') f.sprayParticles = 0;
      for (let i = 0; i <= 100; i++) e.observe(i / 10, kind === 'no-rain' ? 0 : 8, 0.6, f);
      expect(e.qualified('wet-following')).toBe(false);
    },
  );
  it('requires observed populated lights before actual launch motion', () => {
    const f = closeFrame(),
      e = new RaceReviewEvents();
    for (let i = 0; i < 50; i++) e.observe(i / 10, 0, 0, f);
    expect(e.gridLaunched).toBe(false);
    f.racePhase = 1;
    f.speed = 0;
    e.observe(5, 0, 0, f);
    f.racePhase = 2;
    f.speed = 25;
    for (let i = 51; i <= 90; i++) e.observe(i / 10, 0, 0, f);
    expect(e.gridLaunched).toBe(true);
  });
  it.each([
    'missing-entry',
    'missing-removal',
    'early-removal-frame',
    'missing-installation',
    'loaded-installation',
    'wrong-installation-crew',
    'loaded-wheels',
    'wrong-crew',
    'missing-release',
    'wrong-stop',
  ])('cannot certify pit service with %s', (problem) => {
    const e = pitSequence(problem);
    expect(e.qualified('pit-service')).toBe(false);
  });
  it('requires road → entry → wheel removal → installation → release → road exit for the same stop', () => {
    const e = pitSequence();
    expect(e.pitStage).toBe('exit');
    expect(e.qualified('pit-service')).toBe(true);
  });
  it('recomputes qualification rather than trusting an edited summary or completion label', () => {
    const report = complete().report()!;
    report.racing!.summary.closeSeconds = 99999;
    expect(readPresentationReport(report).racing!.summary.closeSeconds).toBeLessThan(31);
    const short = structuredClone(report);
    short.rows = short.rows.slice(0, 10);
    short.racing!.rows = short.racing!.rows.slice(0, 10);
    expect(() => readPresentationReport(short)).toThrow(/completion/);
    const absent = structuredClone(report);
    delete absent.racing;
    expect(() => readPresentationReport(absent)).toThrow(/racing/);
    const damaged = structuredClone(report);
    damaged.racing!.rows[1][3] = 0;
    expect(() => readPresentationReport(damaged)).toThrow();
  });
  it('does not combine evidence between captures, and exports detached rows', () => {
    const r = complete(),
      report = r.report()!;
    report.racing!.rows[0][0] = 99;
    expect(r.report()!.racing!.rows[0][0]).toBe(2);
    r.start({ ...context, workload: 'wet-following' }, 31000);
    expect(r.racing?.wetFollowingSeconds).toBe(0);
  });
  it('reads historical reports without relabelling a timed scene as a qualified race event', () => {
    const r = new PresentationReview(),
      f = reviewFrame();
    r.start({ ...context, workload: 'pit-service', racingEvidence: undefined }, 0);
    f.s = 100;
    for (let i = 1; i <= 300; i++) {
      f.time = i / 10;
      r.record(i * 100, f);
    }
    const report = readPresentationReport(r.report());
    expect(report.state).toBe('complete');
    expect(report.racing).toBeUndefined();
    expect(report.summary.samples).toBe(300);
    expect(reviewBudget(report).checks.every((c) => c.state === 'unmeasured')).toBe(true);
  });
});
function pitSequence(problem = '') {
  const e = new RaceReviewEvents(),
    f = raceReviewFrame();
  let t = 0;
  const add = () => e.observe((t += 0.2), 8, 0.6, f);
  f.racePhase = 2;
  f.speed = 20;
  if (problem !== 'missing-entry') add();
  f.inPit = 1;
  f.pitPhase = 1;
  add();
  f.pitPhase = 2;
  f.speed = 0;
  add();
  f.pitPhase = 3;
  // Exact kind of missed interval in hosted run 36220062871: phase 3 alone
  // cannot stand in for an actually raised/unloaded wheel-removal observation.
  f.jackHeight = problem === 'early-removal-frame' ? 0.0573333315551281 : 0.2;
  f.unloadedWheels = problem === 'loaded-wheels' ? 0 : 4;
  f.crewActors = problem === 'wrong-crew' ? 0 : 15;
  if (problem !== 'missing-removal') add();
  f.pitPhase = 4;
  f.jackHeight = 0.2;
  if (problem === 'loaded-installation') f.unloadedWheels = 0;
  if (problem === 'wrong-installation-crew') f.crewActors = 0;
  if (problem !== 'missing-installation') add();
  f.pitPhase = 6;
  f.pitStops = problem === 'wrong-stop' ? 2 : 1;
  f.speed = 12;
  if (problem !== 'missing-release') add();
  f.inPit = 0;
  f.pitPhase = 0;
  add();
  return e;
}
