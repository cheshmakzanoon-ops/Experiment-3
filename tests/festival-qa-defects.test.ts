import { describe, expect, it } from 'vitest';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import type { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { approachPath, DT, defaultRun, newSim, Pilot } from '../scripts/studio/tools/festival-qa.ts';

/** Defects the festival QA harness found (docs/studio/reports/qa-festival.md):
 * each test drives or measures the exact place that failed. */
const eh3 = (sim: OpenWorldSimulation) => sim.events.find((e) => e.spec.id === 'grand-loop')!;
/** Put the player on the Grand Loop at route distance d, already doing `speed` m/s. */
function launch(sim: OpenWorldSimulation, d: number, speed: number) {
  const event = eh3(sim),
    p = pathPoint();
  event.path.at(d, p);
  sim.placeAt(sim.player, p.x, p.z, Math.atan2(p.tx, p.tz), p.y + 0.5);
  sim.player.body.velocity.set(p.tx * speed, 0, p.tz * speed);
  for (const t of sim.player.tires) t.omega = speed / t.radius;
  const pilot = new Pilot(sim, event.path, 0.92);
  pilot.step(DT);
  return pilot;
}

describe('festival road profile', () => {
  it('has no sharp sag on any highway (a 200 km/h car must not be launched by the road)', () => {
    const sim = newSim(defaultRun('', { vehicle: 'eh3' }));
    const net = sim.world.network,
      p = { s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, curvature: 0, width: 0, bank: 0, gradient: 0 };
    let worst = 0,
      where = '';
    for (const e of net.edges) {
      if (e.roadClass !== 'highway') continue;
      const ys: number[] = [];
      for (let s = 0; s <= e.length; s += 3) {
        net.at(e.offset + s, p);
        ys.push(p.y);
      }
      // Vertical curvature over a 9 m baseline: positive is a sag.
      for (let i = 3; i < ys.length - 3; i++) {
        const sag = (ys[i - 3] - 2 * ys[i] + ys[i + 3]) / 81;
        if (sag > worst) {
          worst = sag;
          net.at(e.offset + i * 3, p);
          where = `${e.road.name} (${Math.round(p.x)}, ${Math.round(p.z)})`;
        }
      }
    }
    // 0.0075 /m is 55 m/s over a 130 m radius sag: 2.3 g of compression.
    expect(worst, where).toBeLessThan(0.0075);
  });
  it('keeps a hypercar upright over the Ridge Highway bridge approach at 200 km/h', () => {
    const sim = newSim(defaultRun('', { vehicle: 'eh3' }));
    const pilot = launch(sim, 7500, 55);
    let lowest = 1;
    for (let i = 0; i < 120 * 9; i++) {
      pilot.step(DT);
      sim.step(DT);
      lowest = Math.min(lowest, sim.player.up.y);
    }
    // It passed m 7732-7760, where the road used to dip and kick the nose up.
    expect(pilot.d).toBeGreaterThan(7900);
    expect(lowest).toBeGreaterThan(0.9);
  }, 60_000);
});

describe('festival route driver at open-road speed', () => {
  it('brakes in time for the T-junction at the end of the Coast Highway from 300 km/h', () => {
    const sim = newSim(defaultRun('', { vehicle: 'eh3' }));
    const pilot = launch(sim, 11750, 86);
    const car = sim.player;
    let widest = 0;
    for (let i = 0; i < 120 * 14; i++) {
      pilot.step(DT);
      sim.step(DT);
      widest = Math.max(widest, Math.abs(pilot.lateral));
    }
    // The highway is 7.6 m either side: staying on it means not ploughing on.
    expect(sim.player).toBe(car);
    expect(pilot.d).toBeGreaterThan(12300);
    expect(widest).toBeLessThan(7.6);
    expect(pilot.resets).toBe(0);
  }, 60_000);
});

describe('festival TRY AGAIN on a skill challenge', () => {
  it('arrives on the road behind the gate and drives in, so a retry can match the first run', () => {
    const run = (runUp: boolean) => {
      const sim = newSim(defaultRun('', { vehicle: 'eh3' }));
      const trap = sim.events.find((e) => e.spec.id === 'ridge-trap')!;
      expect(trap.runUp).not.toBeNull();
      sim.command({ type: 'travel', event: 'ridge-trap', runUp });
      let pilot: Pilot;
      if (!runUp) {
        // The old retry: travel, then start on the gate from a standstill.
        sim.command({ type: 'start', event: 'ridge-trap' });
        pilot = new Pilot(sim, trap.path, 0.92);
        pilot.horizon = trap.distance;
      } else {
        const gate = trap.path.at(0, pathPoint());
        expect(sim.mode).toBe('free');
        expect(
          Math.hypot(sim.player.body.position.x - gate.x, sim.player.body.position.z - gate.z),
        ).toBeGreaterThan(150);
        const approach = approachPath(trap)!;
        pilot = new Pilot(sim, approach.path, 0.92);
        pilot.horizon = approach.entry + trap.distance;
      }
      for (let i = 0; i < 120 * 40; i++) {
        pilot.step(DT);
        sim.step(DT);
        const r = sim.takeResult();
        if (r) return r.trapKmh!;
      }
      throw new Error('no trap result');
    };
    const standing = run(false),
      driven = run(true);
    // From a standstill at the gate this hypercar cannot pass ~230 km/h (2
    // stars); arriving on the run-up it matches the first attempt (297, 3 stars).
    expect(standing).toBeLessThan(250);
    expect(driven).toBeGreaterThan(270);
  }, 90_000);
  it('has a run-up for skill challenges only', () => {
    const sim = newSim(defaultRun('', { vehicle: 'eh3' }));
    for (const e of sim.events) {
      const race = ['road-race', 'circuit', 'sprint', 'showcase'].includes(e.spec.kind);
      if (race) expect(e.runUp, e.spec.id).toBeNull();
    }
    expect(sim.events.filter((e) => e.runUp).length).toBeGreaterThanOrEqual(6);
  });
});
