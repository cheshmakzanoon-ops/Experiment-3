import { describe, expect, it } from 'vitest';
import {
  coupledHardStopImpulses,
  hardStopImpulse,
  type HardStopContact,
  type HardStopImpulses,
  type HardStopVelocity,
} from '../src/simulation/offroad/contact-impulse.ts';

interface HardStopInertia { mass: number; pitchInertia: number; yawInertia: number }

const body: HardStopInertia = { mass: 184, pitchInertia: 43, yawInertia: 86 };
const front: HardStopContact = { grade: 0, crossGrade: 0, lever: 0.82, yawArm: 0 };
const rear: HardStopContact = { grade: 0, crossGrade: 0, lever: -0.66, yawArm: 0 };
const falling: Required<HardStopVelocity> = {
  horizontal: 16, lateral: -2.7, vertical: -6, pitchRate: 2, yawRate: 0.7,
};

function closing(v: HardStopVelocity, c: HardStopContact) {
  return c.grade * v.horizontal + (c.crossGrade ?? 0) * (v.lateral ?? 0) - v.vertical -
    c.lever * v.pitchRate + (c.yawArm ?? 0) * (v.yawRate ?? 0);
}

/** Independently apply the returned physical linear/angular momenta. */
function apply(
  v: HardStopVelocity, p: HardStopInertia,
  f: HardStopContact | undefined, r: HardStopContact | undefined, q: HardStopImpulses,
) {
  const next = { lateral: 0, yawRate: 0, ...v };
  for (const [contact, impulse] of [[f, q.front], [r, q.rear]] as const) {
    if (!contact) continue;
    next.horizontal -= contact.grade * impulse / p.mass;
    next.lateral -= (contact.crossGrade ?? 0) * impulse / p.mass;
    next.vertical += impulse / p.mass;
    next.pitchRate += contact.lever * impulse / p.pitchInertia;
    next.yawRate -= (contact.yawArm ?? 0) * impulse / p.yawInertia;
  }
  return next;
}

function energy(v: HardStopVelocity, p: HardStopInertia) {
  return 0.5 * (p.mass * (v.horizontal ** 2 + (v.lateral ?? 0) ** 2 + v.vertical ** 2) +
    p.pitchInertia * v.pitchRate ** 2 + p.yawInertia * (v.yawRate ?? 0) ** 2);
}

function verify(
  v: HardStopVelocity, p: HardStopInertia,
  f: HardStopContact | undefined, r: HardStopContact | undefined,
) {
  const q = coupledHardStopImpulses(v, p.mass, p.pitchInertia, f, r, p.yawInertia), next = apply(v, p, f, r, q),
    beforeEnergy = energy(v, p), energyTolerance = 2e-9 * Math.max(1, beforeEnergy);
  let impulseWork = 0;
  for (const [contact, impulse] of [[f, q.front], [r, q.rear]] as const) {
    expect(Number.isFinite(impulse)).toBe(true);
    expect(impulse).toBeGreaterThanOrEqual(0);
    if (!contact) {
      expect(impulse).toBe(0);
      continue;
    }
    const residual = closing(next, contact),
      speedScale = Math.max(1, Math.abs(v.vertical),
        Math.abs(contact.grade * v.horizontal), Math.abs((contact.crossGrade ?? 0) * (v.lateral ?? 0)),
        Math.abs(contact.lever * v.pitchRate), Math.abs((contact.yawArm ?? 0) * (v.yawRate ?? 0)));
    expect(residual).toBeLessThanOrEqual(2e-10 * speedScale);
    expect(Math.abs(impulse * residual)).toBeLessThanOrEqual(energyTolerance);
    impulseWork += impulse * closing(v, contact);
  }
  expect(energy(next, p)).toBeLessThanOrEqual(beforeEnergy + energyTolerance);
  expect(Math.abs(beforeEnergy - energy(next, p) - 0.5 * impulseWork))
    .toBeLessThanOrEqual(energyTolerance);
  const swapped = coupledHardStopImpulses(v, p.mass, p.pitchInertia, r, f, p.yawInertia);
  expect(swapped.front).toBeCloseTo(q.rear, 9);
  expect(swapped.rear).toBeCloseTo(q.front, 9);
  return { q, next };
}

describe('simultaneous unilateral motocross hard stops', () => {
  it('stops flat-ground heave and pitch while retaining tangential and yaw motion', () => {
    const { q, next } = verify(falling, body, front, rear);
    expect(q.front).toBeGreaterThan(0);
    expect(q.rear).toBeGreaterThan(0);
    expect(next.vertical).toBeCloseTo(0, 12);
    expect(next.pitchRate).toBeCloseTo(0, 12);
    expect(next.horizontal).toBe(falling.horizontal);
    expect(next.lateral).toBe(falling.lateral);
    expect(next.yawRate).toBe(falling.yawRate);
    expect(q.front + q.rear).toBeCloseTo(-body.mass * falling.vertical, 10);
    expect(front.lever * q.front + rear.lever * q.rear)
      .toBeCloseTo(-body.pitchInertia * falling.pitchRate, 10);
  });

  it('includes an initially separating stop when the other impact would close it', () => {
    const v = { ...falling, vertical: -1 };
    expect(closing(v, front)).toBeLessThan(0);
    expect(closing(v, rear)).toBeGreaterThan(0);
    const { q, next } = verify(v, body, front, rear);
    expect(q.front).toBeGreaterThan(0);
    expect(q.rear).toBeGreaterThan(0);
    expect(next.vertical).toBeCloseTo(0, 12);
    expect(next.pitchRate).toBeCloseTo(0, 12);
  });

  it('removes the first-stop reclosure left by one sequential front/rear pass', () => {
    const f = hardStopImpulse(falling.horizontal, falling.vertical, falling.pitchRate,
      front.grade, front.lever, body.mass, body.pitchInertia),
      intermediate = apply(falling, body, front, undefined, { front: f, rear: 0 }),
      r = hardStopImpulse(intermediate.horizontal, intermediate.vertical, intermediate.pitchRate,
        rear.grade, rear.lever, body.mass, body.pitchInertia),
      sequential = apply(intermediate, body, undefined, rear, { front: 0, rear: r });
    expect(closing(sequential, front)).toBeGreaterThan(1);
    const { next } = verify(falling, body, front, rear);
    expect(closing(next, front)).toBeCloseTo(0, 12);
    expect(closing(next, rear)).toBeCloseTo(0, 12);
  });

  it('leaves a redundant closing tyre unloaded when the other stop separates it', () => {
    const f = { ...front, grade: 1, lever: 0 }, r = { ...rear, lever: 0 },
      v = { ...falling, horizontal: 10, vertical: -1 };
    expect(closing(v, f)).toBeGreaterThan(0);
    expect(closing(v, r)).toBeGreaterThan(0);
    const { q, next } = verify(v, body, f, r);
    expect(q.front).toBeGreaterThan(0);
    expect(q.rear).toBe(0);
    expect(closing(next, r)).toBeLessThan(-4);
  });

  it('matches the legacy single-stop impulse with all five velocity components', () => {
    for (const vertical of [-12, -1, 12]) {
      const c = { grade: -0.2, crossGrade: 0.6, lever: -0.71, yawArm: -0.34 },
        v = { ...falling, vertical },
        expected = hardStopImpulse(v.horizontal, v.vertical, v.pitchRate, c.grade, c.lever,
          body.mass, body.pitchInertia, v.lateral, c.crossGrade,
          { arm: c.yawArm, rate: v.yawRate, inertia: body.yawInertia });
      expect(verify(v, body, c, undefined).q.front).toBeCloseTo(expected, 12);
      expect(verify(v, body, undefined, c).q.rear).toBeCloseTo(expected, 12);
    }
    const out = { front: 7, rear: 9 };
    expect(coupledHardStopImpulses(falling, body.mass, body.pitchInertia, undefined, undefined, body.yawInertia, out)).toBe(out);
    expect(out).toEqual({ front: 0, rear: 0 });
  });

  it('shares duplicate constraints symmetrically and does not double their impulse', () => {
    for (const vertical of [-8, 8]) {
      const c = { grade: 0.1, crossGrade: -0.5, lever: 0.43, yawArm: -0.29 },
        v = { ...falling, vertical },
        single = coupledHardStopImpulses(v, body.mass, body.pitchInertia, c, undefined, body.yawInertia),
        { q, next } = verify(v, body, c, { ...c });
      expect(q.front).toBe(q.rear);
      expect(q.front + q.rear).toBeCloseTo(single.front, 12);
      const singleNext = apply(v, body, c, undefined, single);
      for (const component of Object.keys(v) as (keyof HardStopVelocity)[])
        expect(next[component]).toBeCloseTo(singleNext[component], 12);
    }
  });

  it('handles almost-redundant contacts without singular impulses or extra impact energy', () => {
    const c = { grade: 0.2, crossGrade: -0.4, lever: 0.7, yawArm: -0.3 };
    for (const difference of [1e-3, 1e-6, 1e-9, 1e-12]) {
      const other = { grade: c.grade + difference, crossGrade: c.crossGrade - 2 * difference,
        lever: c.lever - difference, yawArm: c.yawArm + 3 * difference };
      verify(falling, body, c, other);
      // An incoming velocity opposite a positive combination of the two
      // normals projects to rest. This exercises both active constraints
      // even as their individual impulse allocation becomes ill-conditioned.
      const incoming = apply({ horizontal: 0, lateral: 0, vertical: 0, pitchRate: 0, yawRate: 0 },
        body, c, other, { front: -120, rear: -230 }),
        { next } = verify(incoming, body, c, other);
      expect(energy(next, body)).toBeLessThan(1e-12 * energy(incoming, body));
    }
  });

  it('does not touch separating velocities or mutate its reusable inputs', () => {
    const v = Object.freeze({ ...falling, vertical: 20 }), f = Object.freeze({ ...front }),
      r = Object.freeze({ ...rear }), p = Object.freeze({ ...body }), out = { front: 7, rear: 9 };
    expect(coupledHardStopImpulses(v, p.mass, p.pitchInertia, f, r, p.yawInertia, out)).toBe(out);
    expect(out).toEqual({ front: 0, rear: 0 });
    expect(verify(v, p, f, r).next).toEqual(v);
  });

  it('is invariant under rotation of the horizontal travel basis', () => {
    const f = { grade: 0.37, crossGrade: 0.6, lever: 0.73, yawArm: 0.31 },
      r = { grade: -0.24, crossGrade: 0.42, lever: -0.61, yawArm: -0.25 },
      baseline = verify(falling, body, f, r);
    for (const angle of [-2.8, -1.2, 0.3, 2.1]) {
      const c = Math.cos(angle), s = Math.sin(angle),
        rotatedVelocity = { ...falling, horizontal: c * falling.horizontal + s * falling.lateral,
          lateral: -s * falling.horizontal + c * falling.lateral },
        rotate = (contact: HardStopContact) => ({ ...contact,
          grade: c * contact.grade + s * (contact.crossGrade ?? 0),
          crossGrade: -s * contact.grade + c * (contact.crossGrade ?? 0) }),
        result = verify(rotatedVelocity, body, rotate(f), rotate(r));
      expect(result.q.front).toBeCloseTo(baseline.q.front, 9);
      expect(result.q.rear).toBeCloseTo(baseline.q.rear, 9);
      expect(energy(result.next, body)).toBeCloseTo(energy(baseline.next, body), 8);
    }
  });

  it('satisfies unilateral contact and energy laws across banked, pitched, yawed impacts', () => {
    let seed = 834197;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const signed = (range: number) => range * (2 * random() - 1);
    for (let i = 0; i < 1200; i++) {
      const pitch = signed(0.9), yaw = signed(1.1),
        p = { mass: 90 + random() * 220, pitchInertia: 15 + random() * 120,
          yawInertia: 20 + random() * 180 },
        v = { horizontal: signed(35), lateral: signed(12), vertical: signed(15),
          pitchRate: signed(7), yawRate: signed(5) },
        contact = (reach: number, height: number) => {
          const grade = signed(2), crossGrade = signed(1.2);
          return { grade, crossGrade, lever: reach * Math.cos(pitch) + height * Math.sin(pitch),
            yawArm: reach * (crossGrade * Math.cos(yaw) - grade * Math.sin(yaw)) };
        },
        f = contact(0.82, 0.67), r = contact(-0.66, 0.65);
      verify(v, p, f, r);
    }
  });
});
