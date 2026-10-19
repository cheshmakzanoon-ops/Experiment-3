import { describe, expect, it } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import { RouteDriver } from '../src/simulation/open-world/route-driver.ts';
import { RoutePath } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import {
  FESTIVAL_SKILLS,
  FestivalSkillChain,
  type FestivalSkillMotion,
  type FestivalSkillSample,
} from '../src/simulation/open-world/skill-chain.ts';
import { trackPoint } from '../src/simulation/track.ts';

/** Analytic sample fixture for state-machine boundaries, not vehicle evidence. */
function driving(hz = 120, speed = 20) {
  const chain = new FestivalSkillChain();
  const motion: FestivalSkillMotion = {
    x: 0,
    y: 1,
    z: 0,
    vertical: 0,
    surfaceVelocity: 0,
    upright: 1,
    settled: true,
  };
  const sample: FestivalSkillSample = {
    lateral: 0,
    forward: speed,
    grounded: true,
    onRoad: true,
    impact: false,
    assisted: false,
    motion,
  };
  const tick = () => {
    motion.x += speed / hz;
    chain.update(sample, 1 / hz);
  };
  const ground = (seconds: number, onRoad = true, settled = true) => {
    sample.grounded = true;
    sample.onRoad = onRoad;
    motion.y = 1;
    motion.vertical = motion.surfaceVelocity = 0;
    motion.settled = settled;
    for (let i = 0; i < Math.round(seconds * hz); i++) tick();
  };
  const flight = (seconds = 0.8, onRoad = true, ballistic = true) => {
    sample.grounded = false;
    sample.onRoad = onRoad;
    motion.settled = false;
    for (let i = 1; i <= Math.round(seconds * hz); i++) {
      const t = i / hz;
      motion.y = ballistic ? 1 + 4.905 * t * (seconds - t) : 1;
      motion.vertical = motion.surfaceVelocity = ballistic ? 4.905 * (seconds - 2 * t) : 0;
      tick();
    }
  };
  return { chain, motion, sample, tick, ground, flight };
}

describe('festival airborne driving skills', () => {
  it('shows provisional flight, pays only after a stable landing, and pays once', () => {
    const d = driving();
    d.ground(0.8);
    d.flight();
    expect(d.chain.status()).toMatchObject({ phase: 'active', score: 0, sessionTotal: 0 });
    expect(d.chain.status().air).toMatchObject({ phase: 'airborne' });
    expect(d.chain.status().air!.seconds).toBeCloseTo(0.8, 8);
    expect(d.chain.status().air!.distance).toBeGreaterThan(15);
    d.ground(0.2);
    expect(d.chain.status()).toMatchObject({ score: 0, air: { phase: 'landing' } });
    d.ground(0.1);
    expect(d.chain.status()).toMatchObject({ score: 230, label: 'AIR · CLEAN LANDING', air: null });
    d.ground(1);
    expect(d.chain.status().score).toBe(230);
    d.ground(4);
    expect(d.chain.status()).toMatchObject({ score: 0, lastBank: 230, sessionTotal: 230 });
  });

  it('keeps the existing chain and bank timer through a real attempt', () => {
    const d = driving();
    d.sample.lateral = 10;
    d.ground(1);
    d.sample.lateral = 0;
    d.ground(3.5);
    const before = d.chain.status();
    expect(before.score).toBeGreaterThan(0);
    d.flight();
    expect(d.chain.status().score).toBe(before.score);
    expect(d.chain.status().bankRemaining).toBeCloseTo(before.bankRemaining, 8);
    expect(d.chain.status().sessionTotal).toBe(0);
    d.ground(0.3);
    expect(d.chain.status().score).toBe(before.score + 230);
    expect(d.chain.status().bankRemaining).toBeGreaterThan(3.9);
  });

  it('awards the same flight at 30 Hz and 120 Hz', () => {
    const scores = [30, 120].map((hz) => {
      const d = driving(hz);
      d.ground(0.8);
      d.flight();
      d.ground(0.3);
      return d.chain.status().total;
    });
    expect(scores).toEqual([230, 230]);
  });

  it('retains physical run-up when an earlier chain banks immediately before a crest', () => {
    const d = driving();
    d.sample.lateral = 10;
    d.ground(1);
    d.sample.lateral = 0;
    d.ground(4);
    const banked = d.chain.status().sessionTotal;
    expect(banked).toBeGreaterThan(0);
    d.flight();
    expect(d.chain.status().air?.phase).toBe('airborne');
    d.ground(0.3);
    expect(d.chain.status()).toMatchObject({ score: 230, sessionTotal: banked });
  });

  it('allows a brief suspension bounce, then requires continuous stable contact', () => {
    const d = driving();
    d.ground(0.8);
    d.flight();
    d.ground(0.1);
    d.sample.grounded = false;
    d.motion.settled = false;
    for (let i = 0; i < 4; i++) d.tick();
    d.ground(0.2);
    expect(d.chain.status().score).toBe(0);
    d.ground(0.1);
    expect(d.chain.status().score).toBe(230);
  });

  it('rejects slow hops, spawn-in-air, level motion, short hops and unsteady landings', () => {
    for (const kind of ['slow', 'spawn', 'level', 'short', 'unstable', 'hard']) {
      const d = driving(120, kind === 'slow' ? 5 : 20);
      if (kind !== 'spawn') d.ground(0.8);
      d.flight(kind === 'short' ? 0.15 : 0.8, true, kind !== 'level');
      if (kind === 'hard') {
        d.motion.surfaceVelocity = -9;
        d.tick();
      }
      d.ground(1, true, kind !== 'unstable');
      expect(d.chain.status().score, kind).toBe(0);
      expect(d.chain.status().air, kind).toBeNull();
      d.ground(5);
      expect(d.chain.status().sessionTotal, kind).toBe(0);
    }
  });

  it('cannot combine repeated tiny hops or negligible world displacement into a jump', () => {
    const d = driving();
    d.ground(0.8);
    for (let i = 0; i < 12; i++) {
      d.flight(0.1);
      d.ground(0.05);
    }
    d.ground(5);
    expect(d.chain.status().sessionTotal).toBe(0);
    const still = driving(120, 0);
    still.sample.forward = 20; // A false speed report cannot replace measured travel.
    still.ground(0.8);
    still.flight();
    still.ground(5);
    expect(still.chain.status().sessionTotal).toBe(0);
  });

  it('clears a candidate on impact, automation, reset, flip, teleport or invalid motion', () => {
    for (const kind of ['impact', 'assisted', 'reset', 'flip', 'teleport', 'invalid']) {
      const d = driving();
      d.sample.lateral = 10;
      d.ground(0.8);
      d.sample.lateral = 0;
      d.flight();
      expect(d.chain.status().air, kind).not.toBeNull();
      if (kind === 'reset') d.chain.reset();
      else {
        if (kind === 'impact') d.sample.impact = true;
        if (kind === 'assisted') d.sample.assisted = true;
        if (kind === 'flip') d.motion.upright = -0.9;
        if (kind === 'teleport') d.motion.x += 300;
        if (kind === 'invalid') d.motion.vertical = NaN;
        d.tick();
      }
      expect(d.chain.status(), kind).toMatchObject({ phase: 'lost', score: 0, air: null });
      d.sample.impact = d.sample.assisted = false;
      d.motion.upright = 1;
      d.ground(6);
      expect(d.chain.status().sessionTotal, kind).toBe(0);
    }
  });

  it('bounds the flight window and cannot preserve a chain indefinitely off-road', () => {
    const d = driving();
    d.sample.lateral = 10;
    d.ground(0.8);
    d.sample.lateral = 0;
    d.flight(FESTIVAL_SKILLS.maxAirTime + 0.2, false);
    expect(d.chain.status()).toMatchObject({ phase: 'lost', score: 0, air: null });
    d.ground(6);
    expect(d.chain.status().sessionTotal).toBe(0);
  });

  it('lets a grass-crossing jump recover to the road, but never banks or farms on grass', () => {
    for (const returns of [true, false]) {
      const d = driving();
      d.ground(0.8);
      d.flight(0.8, false);
      d.ground(0.3, false);
      expect(d.chain.status().score).toBe(230);
      expect(d.chain.status().sessionTotal).toBe(0);
      if (returns) {
        d.ground(4.5);
        expect(d.chain.status().sessionTotal).toBe(230);
      } else {
        d.ground(1, false);
        expect(d.chain.status()).toMatchObject({ phase: 'lost', score: 0, sessionTotal: 0 });
        // Off-road ground driving cannot rearm a fresh stunt.
        d.ground(0.8, false);
        d.flight(0.8, false);
        d.ground(5);
        expect(d.chain.status().sessionTotal).toBe(0);
      }
    }
  });
});

/** Actual Solvane physics at the authored Quarry Track crest. Only the
 * initial rolling velocity/wheel speed is set; all subsequent movement is
 * integrated by OpenWorldSimulation. Steering is scripted, not human input. */
function quarryDrive(speed: number, interruptAir = false) {
  const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 12 });
  const network = sim.world.network;
  const edge = network.edges.find((e) => e.id === 'quarry#0')!;
  const p = network.at(edge.offset + 1940, trackPoint());
  sim.placeAt(sim.player, p.x, p.z, Math.atan2(p.tx, p.tz), p.y + 0.5);
  for (let i = 0; i < 120; i++) sim.step(1 / 120);
  const car = sim.player;
  const path = new RoutePath(network, [{ edge: edge.index, dir: 1, from: 1900, to: 2200 }], false);
  const driver = new RouteDriver(car, path, 1);
  driver.relocate(40);
  car.body.velocity.set(p.tx * speed, p.gradient * speed, p.tz * speed);
  car.gear = 4;
  for (const tire of car.tires) tire.omega = speed / tire.radius;
  sim.setInput({ ...controls(), throttle: 0.3 });
  let air = 0,
    longestAir = 0,
    minUp = 1,
    maxImpact = 0,
    offRoad = 0,
    peakClearance = 0;
  let pending = false,
    credited = false;
  for (let i = 0; i < 420; i++) {
    driver.update(1 / 120, [car]);
    sim.setInput({ ...car.input, throttle: 0.3, brake: 0 });
    sim.step(1 / 120);
    const grounded = car.tires.some((t) => t.load > 20);
    air = grounded ? 0 : air + 1 / 120;
    longestAir = Math.max(longestAir, air);
    minUp = Math.min(minUp, car.up.y);
    maxImpact = Math.max(maxImpact, car.impact);
    offRoad += Number(!sim.track.query.onRoad);
    const pos = car.body.position;
    peakClearance = Math.max(peakClearance, pos.y - sim.track.groundHeight(pos.x, pos.z, pos.y));
    const skills = sim.skills.status();
    if (skills.air) {
      pending = true;
      expect(skills.score).toBe(0);
      expect(skills.sessionTotal).toBe(0);
      if (interruptAir) {
        sim.command({ type: 'reset' });
        expect(sim.skills.status()).toMatchObject({ score: 0, sessionTotal: 0, air: null });
        for (let rest = 0; rest < 600; rest++) sim.step(1 / 120);
        expect(sim.skills.status().sessionTotal).toBe(0);
        return { interrupted: true };
      }
    }
    if (skills.label.includes('CLEAN LANDING')) {
      credited = true;
      expect(grounded).toBe(true);
      expect(car.up.y).toBeGreaterThan(0.85);
    }
  }
  expect(sim.player).toBe(car);
  expect(sim.mode).toBe('free');
  return {
    interrupted: false,
    pending,
    credited,
    longestAir,
    minUp,
    maxImpact,
    offRoad,
    peakClearance,
    skills: sim.skills.status(),
  };
}

describe('Quarry Track vehicle-integrated airtime', () => {
  it('launches naturally, lands cleanly and earns the measured air bonus on a dirt road', () => {
    const result = quarryDrive(32);
    expect(result.pending).toBe(true);
    expect(result.credited).toBe(true);
    expect(result.longestAir).toBeGreaterThan(0.7);
    expect(result.longestAir).toBeLessThan(0.9);
    expect(result.peakClearance).toBeGreaterThan(0.9);
    expect(result.minUp).toBeGreaterThan(0.9);
    expect(result.maxImpact).toBe(0);
    expect(result.offRoad).toBe(0);
    expect(result.skills).toMatchObject({ score: 230, air: null, sessionTotal: 0 });
  });

  it('does not award ordinary suspension contact chatter on the same crest at lower speed', () => {
    const result = quarryDrive(24);
    expect(result.longestAir).toBeLessThan(FESTIVAL_SKILLS.minAirTime);
    expect(result.pending).toBe(false);
    expect(result.credited).toBe(false);
    expect(result.skills).toMatchObject({ score: 0, sessionTotal: 0 });
  });

  it('discards a live physical flight when the player resets to the road', () => {
    expect(quarryDrive(32, true).interrupted).toBe(true);
  });
});
