import { beforeAll, describe, expect, it } from 'vitest';
import {
  AIR_SCENARIOS, PLAYER_CASES, runPlayerAcceptance, type PlayerCase,
} from '../scripts/bench/motocross-player-dynamics.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { LANDING_RULES } from '../src/simulation/offroad/riding-feedback.ts';

let acceptance: ReturnType<typeof runPlayerAcceptance>;
beforeAll(() => { acceptance = runPlayerAcceptance(); }, 60_000);
const matches = (a: PlayerCase, b: PlayerCase) =>
  a.machine === b.machine && a.venue === b.venue && a.assist === b.assist;

describe('combined player motocross approach, control and recovery acceptance', () => {
  it.each(PLAYER_CASES)('$machine $venue $assist settles its weight before independent ground braking', config => {
    const rows = acceptance.ground.filter(run => matches(run.config, config));
    expect(rows).toHaveLength(6);
    for (const run of rows) {
      expect(run.violations).toEqual([]);
      expect(run.playerSteps).toBe(run.steps);
      expect(run.freeSteps).toBe(0);
      expect(run.crashes).toBe(0);
      expect(run.final.riding && !run.final.airborne).toBe(true);
    }
    const back = rows.find(run => run.brake === 'coast' && run.lean === -1)!;
    const forward = rows.find(run => run.brake === 'coast' && run.lean === 1)!;
    expect(forward.beforeBraking.frontLoad - back.beforeBraking.frontLoad).toBeGreaterThan(150);
    expect(forward.beforeBraking.fork - back.beforeBraking.fork).toBeGreaterThan(0.01);
    for (const lean of [-1, 1]) {
      const coast = rows.find(run => run.brake === 'coast' && run.lean === lean)!;
      const front = rows.find(run => run.brake === 'front' && run.lean === lean)!;
      const rear = rows.find(run => run.brake === 'rear' && run.lean === lean)!;
      // Identical real approach and settled stroke precede each control arm.
      expect(front.beforeBraking).toEqual(coast.beforeBraking);
      expect(rear.beforeBraking).toEqual(coast.beforeBraking);
      expect(rear.peakFrontBrake).toBe(0);
      expect(rear.peakRearBrake).toBeGreaterThan(200);
      expect(front.peakFrontBrake).toBeGreaterThan(500);
      expect(rear.final.speed).toBeLessThan(coast.final.speed - 0.5);
      expect(front.final.speed).toBeLessThan(rear.final.speed - 0.4);
      expect(front.final.fork).toBeGreaterThan(rear.final.fork + 0.01);
      expect(front.totalRotorWorkJ[0]).toBeGreaterThan(coast.totalRotorWorkJ[0] + 100);
      expect(rear.totalRotorWorkJ[1]).toBeGreaterThan(coast.totalRotorWorkJ[1] + 50);
    }
  });

  it.each(PLAYER_CASES)('$machine $venue $assist carries ordinary player air controls through touchdown', config => {
    const rows = acceptance.flights.filter(run => matches(run.config, config));
    const definition = config.machine === 'mx250' ? MX_250 : MX_450;
    expect(rows.map(run => run.scenario)).toEqual([...AIR_SCENARIOS]);
    for (const run of rows) {
      expect(run.violations).toEqual([]);
      expect(run.departed).toBe(true);
      expect(run.playerSteps).toBe(run.steps);
      expect(run.freeSteps).toBeGreaterThan(180);
      expect(run.rearAirWorkChecks).toBe(run.freeSteps);
      expect(run.incomingStable).toBe(true);
      expect(run.landing).not.toBeNull();
      const landing = run.landing!;
      expect(landing.airTime).toBeGreaterThan(0.8);
      expect(landing.distance).toBeGreaterThan(8);
      expect(landing.normalSpeed).toBeGreaterThan(0);
      expect(landing.time).toBeLessThanOrEqual(run.touchdownAt);
      expect(landing.time).toBeGreaterThan(run.touchdownAt - 1 / 240 - 1e-12);
      expect(run.after300ms).not.toBeNull();
      expect(run.final.riding).toBe(true);
      if (run.crashes > 0) {
        expect(run.crashes).toBe(1);
        expect(run.states).toContain('separated');
        expect(run.states).toContain('remount');
        expect(run.recoverySeconds).toBeGreaterThan(1);
        expect(run.recoverySeconds).toBeLessThan(12);
        expect(run.recoverySteps).toBeGreaterThan(200);
        expect(run.remount).not.toBeNull();
        expect(run.remount!.riding && !run.remount!.airborne).toBe(true);
        expect([run.remount!.airTime, run.remount!.vy, run.remount!.pitchRate, run.remount!.yaw]).toEqual([0, 0, 0, 0]);
        expect(run.remount!.frontSpin * definition.bike!.frontWheelRadius).toBeCloseTo(run.remount!.speed, 12);
        expect(run.remount!.rearSpin * definition.bike!.rearWheelRadius).toBeCloseTo(run.remount!.speed, 12);
        expect(run.historicalLandingRetained).toBe(true);
        expect(run.crashCauses[0].cause).toBe(landing.outcome);
        // Bad commands are allowed to fall, but their recorded incoming
        // severity must explain the specific verdict without a weaker limit.
        if (landing.outcome === 'crash-side')
          expect(Math.abs(landing.lateralSpeed)).toBeGreaterThan(LANDING_RULES.crossedCrashSpeed);
        else if (landing.outcome === 'crash-flat')
          expect(landing.bottomSpeed).toBeGreaterThan(definition.bike!.offroad!.bottomOutSpeed);
        else if (landing.outcome === 'crash-front') {
          expect(landing.pitchError).toBeLessThan(-definition.bike!.offroad!.noseDownLimit);
          expect(landing.normalSpeed).toBeGreaterThan(LANDING_RULES.noseDownNormalSpeed);
        } else throw new Error(`Unexplained player landing verdict: ${landing.outcome}`);
      }
    }
    const baseline = rows.find(run => run.scenario === 'feedback')!;
    const front = rows.find(run => run.scenario === 'front-lock')!;
    const rear = rows.find(run => run.scenario === 'rear-tap')!;
    const body = rows.find(run => run.scenario === 'body-reversal')!;
    const whip = rows.find(run => run.scenario === 'whip-early')!;
    const held = rows.find(run => run.scenario === 'held-whip')!;
    for (const run of [baseline, rear, body, whip]) expect(run.crashes).toBe(0);
    expect(baseline.bottomed).toEqual([true, true]);
    expect(baseline.rebound).toEqual([true, true]);
    expect(front.stoppedFrontAirSteps).toBeGreaterThan(50);
    expect(front.touchdown!.frontSpin).toBe(0);
    expect(front.freeRotorWorkJ[0]).toBeGreaterThan(300);
    expect(rear.samples[1].rear).toBeLessThan(baseline.samples[1].rear - 30);
    expect(rear.freeRotorWorkJ[1]).toBeGreaterThan(500);
    expect(body.samples[0].body).toBeGreaterThan(baseline.samples[0].body + 0.25);
    expect(body.samples[2].body).toBeLessThan(body.samples[0].body - 0.15);
    expect(whip.maxYaw).toBeGreaterThan(0.2);
    expect(whip.landing!.airTime).toBeLessThan(baseline.landing!.airTime - 0.1);
    expect(Math.abs(whip.landing!.yawError)).toBeLessThan(0.02);
    expect(whip.rollingSeconds).toBeGreaterThan(0);
    expect(whip.rollingSeconds).toBeLessThan(0.2);
    if (front.crashes === 0) {
      expect(front.firstPickupSeconds).toBeGreaterThan(0);
      expect(front.rollingSeconds).toBeGreaterThan(front.firstPickupSeconds!);
      expect(front.rollingSeconds).toBeLessThan(0.2);
    }
    expect(held.landing!.outcome).toBe(config.assist === 'raw' ? 'crash-side' : 'bottomed');
    const frontVerdict = config.assist === 'raw' && config.venue === 'arena-nord-sx' ? 'crash-front' :
      config.assist === 'raw' && config.machine === 'mx450' ? 'crash-flat' : 'bottomed';
    expect(front.landing!.outcome).toBe(frontVerdict);
  });

  it.each(['mx250', 'mx450'] as const)('%s samples the real outdoor rain film during player braking', machine => {
    const wet = acceptance.wet.find(run => run.config.machine === machine)!;
    const dry = acceptance.ground.find(run => run.config.machine === machine &&
      run.config.venue === 'valley-ridge-mx' && run.config.assist === 'sport' &&
      run.brake === 'front' && run.lean === 1)!;
    expect(wet.violations).toEqual([]);
    expect(wet.maxContactWaterMm).toBeGreaterThan(0.5);
    expect(wet.crashes).toBe(0);
    expect(wet.final.riding && !wet.final.airborne).toBe(true);
    expect(wet.peakFrontBrake).toBeLessThan(dry.peakFrontBrake * 0.9);
    expect(wet.beforeBraking.speed - wet.final.speed)
      .toBeLessThan(dry.beforeBraking.speed - dry.final.speed);
  });

  it('retains all seven adverse verdicts when the entire player trajectory is refined to 480 Hz', () => {
    expect(acceptance.refinedAdverse).toHaveLength(7);
    for (const finer of acceptance.refinedAdverse) {
      const coarse = acceptance.flights.find(run => matches(run.config, finer.config) && run.scenario === finer.scenario)!;
      expect(finer.violations).toEqual([]);
      expect(finer.landing!.outcome).toBe(coarse.landing!.outcome);
      expect(finer.crashes).toBe(1);
      expect(finer.final.riding).toBe(true);
      expect(Math.abs(finer.landing!.normalSpeed - coarse.landing!.normalSpeed)).toBeLessThan(0.15);
      expect(Math.abs(finer.landing!.bottomSpeed - coarse.landing!.bottomSpeed)).toBeLessThan(0.1);
    }
  });

  it('repeats every 240 Hz trajectory exactly, including physical-state hashes and thermal accounting', () => {
    expect(acceptance.flights).toHaveLength(48);
    expect(acceptance.ground).toHaveLength(48);
    expect(acceptance.wet).toHaveLength(2);
    expect(acceptance.repeatIdentical).toBe(true);
    expect(acceptance.violations).toEqual([]);
    for (const run of [...acceptance.flights, ...acceptance.ground, ...acceptance.wet])
      expect(run.traceSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
