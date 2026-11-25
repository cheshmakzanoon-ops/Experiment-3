import { expect, it } from 'vitest';
import {
  coupledHardStopImpulses, hardStopImpulse,
  type HardStopContact, type HardStopVelocity,
} from '../src/simulation/offroad/contact-impulse.ts';

const mass = 184, pitchInertia = 43, yawInertia = 92;
const front: HardStopContact = { grade: 0, lever: 0.82 };
const rear: HardStopContact = { grade: 0, lever: -0.66 };

function apply(
  state: HardStopVelocity, f: HardStopContact | undefined, r: HardStopContact | undefined,
  impulses: { front: number; rear: number },
) {
  const next = { lateral: 0, yawRate: 0, ...state };
  for (const [contact, impulse] of [[f, impulses.front], [r, impulses.rear]] as const) {
    if (!contact) {
      expect(impulse).toBe(0);
      continue;
    }
    next.horizontal -= contact.grade * impulse / mass;
    next.lateral -= (contact.crossGrade ?? 0) * impulse / mass;
    next.vertical += impulse / mass;
    next.pitchRate += contact.lever * impulse / pitchInertia;
    next.yawRate -= (contact.yawArm ?? 0) * impulse / yawInertia;
  }
  return next;
}

function closing(state: HardStopVelocity, contact: HardStopContact) {
  return contact.grade * state.horizontal + (contact.crossGrade ?? 0) * (state.lateral ?? 0) -
    state.vertical - contact.lever * state.pitchRate + (contact.yawArm ?? 0) * (state.yawRate ?? 0);
}

function energy(state: HardStopVelocity) {
  return 0.5 * (mass * (state.horizontal ** 2 + state.vertical ** 2 + (state.lateral ?? 0) ** 2) +
    pitchInertia * state.pitchRate ** 2 + yawInertia * (state.yawRate ?? 0) ** 2);
}

it('stops a flat two-wheel landing without the residual front closure of a sequential pass', () => {
  const state = { horizontal: 0, vertical: -6, pitchRate: 0 };
  const first = hardStopImpulse(0, -6, 0, 0, front.lever, mass, pitchInertia);
  const halfway = apply(state, front, undefined, { front: first, rear: 0 });
  const second = hardStopImpulse(0, halfway.vertical, halfway.pitchRate, 0, rear.lever, mass, pitchInertia);
  const sequential = apply(halfway, undefined, rear, { front: 0, rear: second });
  expect(closing(sequential, front)).toBeGreaterThan(3.69);

  const impulses = coupledHardStopImpulses(state, mass, pitchInertia, front, rear);
  const resolved = apply(state, front, rear, impulses);
  expect(impulses.front + impulses.rear).toBeCloseTo(6 * mass, 10);
  expect(front.lever * impulses.front + rear.lever * impulses.rear).toBeCloseTo(0, 10);
  expect(resolved.vertical).toBeCloseTo(0, 12);
  expect(resolved.pitchRate).toBeCloseTo(0, 12);
  expect(energy(resolved)).toBeLessThan(1e-20);
});

it('keeps the isolated-axle result and leaves freely separating or absent contacts alone', () => {
  const state = { horizontal: 14, lateral: 2, vertical: -4, pitchRate: -0.8, yawRate: 1.2 };
  const contact = { grade: -0.3, crossGrade: 0.4, lever: 0.73, yawArm: -0.28 };
  const expected = hardStopImpulse(
    state.horizontal, state.vertical, state.pitchRate, contact.grade, contact.lever,
    mass, pitchInertia, state.lateral, contact.crossGrade,
    { arm: contact.yawArm, rate: state.yawRate, inertia: yawInertia },
  );
  expect(coupledHardStopImpulses(state, mass, pitchInertia, contact, undefined, yawInertia))
    .toEqual({ front: expected, rear: 0 });
  expect(coupledHardStopImpulses(state, mass, pitchInertia, undefined, contact, yawInertia))
    .toEqual({ front: 0, rear: expected });
  expect(coupledHardStopImpulses(state, mass, pitchInertia)).toEqual({ front: 0, rear: 0 });
  expect(coupledHardStopImpulses({ horizontal: 0, vertical: 2, pitchRate: 0 }, mass, pitchInertia, front, rear))
    .toEqual({ front: 0, rear: 0 });
  const noseUp = { horizontal: 0, vertical: 0, pitchRate: 4 };
  const one = coupledHardStopImpulses(noseUp, mass, pitchInertia, front, rear);
  expect(one.front).toBe(0);
  expect(one.rear).toBeGreaterThan(0);
  expect(closing(apply(noseUp, front, rear, one), front)).toBeLessThan(0);
});

it('allows a second stop to support the impulse when the other axle would close it again', () => {
  const state = { horizontal: 0, vertical: -2, pitchRate: 5 };
  expect(closing(state, front)).toBeLessThan(0);
  const impulses = coupledHardStopImpulses(state, mass, pitchInertia, front, rear);
  expect(impulses.front).toBeGreaterThan(0);
  expect(impulses.rear).toBeGreaterThan(0);
  const next = apply(state, front, rear, impulses);
  expect(closing(next, front)).toBeCloseTo(0, 11);
  expect(closing(next, rear)).toBeCloseTo(0, 11);
});

it('is passive, complementary and axle-order independent across pitched and banked impacts', () => {
  const pairs: [HardStopContact, HardStopContact][] = [
    [front, rear],
    [{ grade: 0.45, crossGrade: 0.7, lever: 0.95, yawArm: 0.5 },
      { grade: -0.18, crossGrade: 0.52, lever: -0.38, yawArm: -0.35 }],
    [{ grade: -0.8, crossGrade: -0.4, lever: 0.3, yawArm: -0.22 },
      { grade: -0.1, crossGrade: 0.2, lever: -0.92, yawArm: 0.15 }],
  ];
  const states: HardStopVelocity[] = [
    { horizontal: 18, lateral: -3, vertical: -8, pitchRate: 1.5, yawRate: 2 },
    { horizontal: 8, lateral: 5, vertical: -2, pitchRate: -4, yawRate: -3 },
    { horizontal: 0, lateral: 0, vertical: 3, pitchRate: 5, yawRate: 0 },
    { horizontal: 25, lateral: -7, vertical: -10, pitchRate: -2, yawRate: -1 },
  ];
  for (const [f, r] of pairs) for (const state of states) {
    const impulses = coupledHardStopImpulses(state, mass, pitchInertia, f, r, yawInertia);
    const reversed = coupledHardStopImpulses(state, mass, pitchInertia, r, f, yawInertia);
    const next = apply(state, f, r, impulses);
    expect(impulses.front).toBeGreaterThanOrEqual(0);
    expect(impulses.rear).toBeGreaterThanOrEqual(0);
    expect(impulses.front).toBeCloseTo(reversed.rear, 10);
    expect(impulses.rear).toBeCloseTo(reversed.front, 10);
    expect(closing(next, f)).toBeLessThanOrEqual(1e-10);
    expect(closing(next, r)).toBeLessThanOrEqual(1e-10);
    expect(impulses.front * closing(next, f)).toBeCloseTo(0, 7);
    expect(impulses.rear * closing(next, r)).toBeCloseTo(0, 7);
    expect(energy(next)).toBeLessThanOrEqual(energy(state) + 1e-8);
    const impactWork = 0.5 * (impulses.front * closing(state, f) + impulses.rear * closing(state, r));
    expect(energy(state) - energy(next)).toBeCloseTo(impactWork, 7);
  }
});

it('shares duplicate stops and resolves nearly coincident supports without huge or nonfinite impulses', () => {
  const state = { horizontal: 0, vertical: -6, pitchRate: 0 };
  for (const separation of [0, 1e-9, 1e-6, 1e-3]) {
    const f = { grade: 0, lever: separation }, r = { grade: 0, lever: -separation };
    const impulses = coupledHardStopImpulses(state, mass, pitchInertia, f, r);
    const next = apply(state, f, r, impulses);
    expect(impulses.front).toBeCloseTo(3 * mass, 6);
    expect(impulses.rear).toBeCloseTo(3 * mass, 6);
    expect(closing(next, f)).toBeLessThanOrEqual(1e-10);
    expect(closing(next, r)).toBeLessThanOrEqual(1e-10);
    expect(energy(next)).toBeLessThanOrEqual(energy(state));
  }
});
