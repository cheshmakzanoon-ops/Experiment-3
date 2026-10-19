import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  damperForce,
  defaultSuspension,
  HubSolver,
  resolveSuspension,
  springForce,
} from '../src/simulation/suspension.ts';

const TYRE = 330000;
const DT = 1 / 240;

function solver(bar = 55000, tyreDamping = 350, undamped = false) {
  const def = defaultSuspension();
  const hardware = resolveSuspension(
    def,
    { ...DEFAULT_SETUP, frontARB: bar },
    TYRE,
    tyreDamping,
    0.17,
  );
  if (undamped) for (const h of hardware) h.bump = h.rebound = h.bumpHigh = h.reboundHigh = 0;
  const hub = new HubSolver(hardware);
  hub.tyreRate.fill(TYRE);
  hub.contact.fill(1);
  return hub;
}

/** Forces independently reconstructed from the solved hardware state. At a
 * droop stop this residual is balanced by a non-negative extension reaction. */
function forceResidual(hub: HubSolver, previous: ArrayLike<number>, i: number, dt = DT) {
  const h = hub.hardware[i];
  return (
    hub.tyreForce[i] -
    springForce(h, hub.travel[i]) -
    damperForce(h, (hub.travel[i] - previous[i]) / dt) -
    h.barRate * (hub.travel[i] - hub.travel[i ^ 1])
  );
}

function settle(hub: HubSolver) {
  hub.compression.fill(0.03);
  for (let n = 0; n < 1200; n++) hub.solve(DT);
}

describe('coupled unilateral axle suspension', () => {
  it('gives mirrored kerb loads and balances both bar ends in the same step', () => {
    const right = solver(),
      left = solver();
    settle(right);
    settle(left);
    const previousRight = [...right.travel],
      previousLeft = [...left.travel];
    right.compression[0] = left.compression[1] = 0.085;
    right.rate[0] = left.rate[1] = 4;
    right.solve(DT);
    left.solve(DT);

    // The old two ordered sweeps differed by 3.30867 N at the opposite wheel
    // and left an 18.76917 N residual with these legal setup values.
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(right.tyreForce[i] - left.tyreForce[i ^ 1])).toBeLessThan(1e-7);
      expect(Math.abs(right.travel[i] - left.travel[i ^ 1])).toBeLessThan(1e-12);
      expect(Math.abs(forceResidual(right, previousRight, i))).toBeLessThan(1e-6);
      expect(Math.abs(forceResidual(left, previousLeft, i))).toBeLessThan(1e-6);
    }
  });

  it('has the setup ride and roll rates immediately when the hub has no damping or mass', () => {
    const hub = solver(55000, 0, true);
    hub.compression.set([0.03, 0.015, 0.025, 0.02]);
    const previous = [...hub.travel];
    hub.solve(DT);
    const front = DEFAULT_SETUP.frontSpring,
      rear = DEFAULT_SETUP.rearSpring,
      rearBar = DEFAULT_SETUP.rearARB;
    expect(hub.tyreForce[0]).toBeCloseTo(front * 0.03 + 55000 * 0.015, 7);
    expect(hub.tyreForce[1]).toBeCloseTo(front * 0.015 - 55000 * 0.015, 7);
    expect(hub.tyreForce[2]).toBeCloseTo(rear * 0.025 + rearBar * 0.005, 7);
    expect(hub.tyreForce[3]).toBeCloseTo(rear * 0.02 - rearBar * 0.005, 7);
    for (let i = 0; i < 4; i++)
      expect(Math.abs(forceResidual(hub, previous, i))).toBeLessThan(1e-6);
  });

  it('disconnects the wheels when the bar is removed', () => {
    const a = solver(0),
      b = solver(0);
    settle(a);
    settle(b);
    a.compression[0] = 0.12;
    a.rate[0] = 6;
    a.solve(DT);
    b.solve(DT);
    expect(Math.abs(a.tyreForce[1] - b.tyreForce[1])).toBeLessThan(1e-6);
    expect(a.travel[1]).toBeCloseTo(b.travel[1], 12);
  });

  it('balances a free wheel against its bar while its partner is on a droop stop', () => {
    const hub = solver();
    // Different mechanical droop limits can occur at the two corners. Both
    // start within their limits; the extended wheel pulls its partner down.
    hub.hardware[0].droop = 0.005;
    hub.travel[0] = -0.005;
    hub.travel[1] = -0.05;
    hub.contact.fill(0);
    const previous = [...hub.travel];
    hub.solve(DT);
    expect(hub.travel[0]).toBeCloseTo(-0.005, 12);
    expect(forceResidual(hub, previous, 0)).toBeLessThan(0);
    expect(Math.abs(forceResidual(hub, previous, 1))).toBeLessThan(1e-6);
    expect(hub.travel[1]).toBeGreaterThan(-0.05);
    for (const force of hub.tyreForce) expect(force).toBe(0);
  });

  it('dissipates mechanical energy with no moving road or chassis', () => {
    for (const dt of [DT, 1 / 60, 1 / 30]) {
      const hub = solver(55000, 0);
      hub.compression.fill(0.03);
      hub.travel.set([0.012, 0.028, 0.007, 0.035]);
      const energy = () => {
        let total = 0;
        for (let i = 0; i < 4; i++) {
          const x = hub.travel[i],
            compression = Math.max(0, hub.compression[i] - x);
          total += 0.5 * hub.hardware[i].wheelRate * x * x + 0.5 * TYRE * compression ** 2;
          if (i % 2 === 0) total += 0.5 * hub.hardware[i].barRate * (x - hub.travel[i + 1]) ** 2;
        }
        return total;
      };
      let previousEnergy = energy();
      for (let n = 0; n < 120; n++) {
        const previous = [...hub.travel];
        hub.contact.fill(1);
        hub.solve(dt);
        let dissipatedWork = 0;
        for (let i = 0; i < 4; i++) {
          const travel = hub.travel[i] - previous[i];
          dissipatedWork += damperForce(hub.hardware[i], travel / dt) * travel;
        }
        const nextEnergy = energy();
        expect(dissipatedWork).toBeGreaterThanOrEqual(0);
        expect(nextEnergy + dissipatedWork).toBeLessThanOrEqual(previousEnergy + 1e-8);
        previousEnergy = nextEnergy;
      }
    }
  });

  it('satisfies unilateral force balance across pressure, bar, kerb and timestep extremes', () => {
    const cases = [
      { previous: [0.02, 0.02], compression: [0.15, 0.002], rate: [8, -6] },
      { previous: [0.12, 0.005], compression: [0.002, 0.1], rate: [-8, 6] },
      { previous: [-0.04, 0.12], compression: [0.04, 0.2], rate: [0, 0] },
      { previous: [0.03, 0.015], compression: [0.02, -0.02], rate: [-5, -5] },
    ];
    for (const dt of [DT, 1 / 60, 1 / 30])
      for (const bar of [0, 26000, 55000])
        for (const rates of [
          [TYRE, TYRE],
          [TYRE * 0.25, TYRE * 1.6],
          [5e6, 5e6],
        ])
          for (const input of cases) {
            const hub = solver(bar);
            for (let i = 0; i < 4; i++) {
              hub.tyreRate[i] = rates[i % 2];
              hub.travel[i] = input.previous[i % 2];
              hub.compression[i] = input.compression[i % 2];
              hub.rate[i] = input.rate[i % 2];
              hub.contact[i] = hub.compression[i] > 0 ? 1 : 0;
              hub.hardware[i].progression = 0.4;
            }
            const previous = [...hub.travel];
            hub.solve(dt);
            for (let i = 0; i < 4; i++) {
              expect(Number.isFinite(hub.travel[i] + hub.tyreForce[i])).toBe(true);
              expect(hub.tyreForce[i]).toBeGreaterThanOrEqual(0);
              expect(hub.travel[i]).toBeGreaterThanOrEqual(-hub.hardware[i].droop);
              if (!hub.contact[i]) expect(hub.tyreForce[i]).toBe(0);
              const residual = forceResidual(hub, previous, i, dt);
              if (hub.travel[i] === -hub.hardware[i].droop)
                expect(residual).toBeLessThanOrEqual(1e-6);
              else expect(Math.abs(residual)).toBeLessThan(1e-6);
            }
          }
  });
});
