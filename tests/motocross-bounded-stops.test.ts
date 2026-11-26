import { describe, expect, it } from 'vitest';
import {
  boundedHardStopImpulses, coupledHardStopImpulses,
  type BoundedHardStopImpulses, type HardStopContact, type HardStopForwardAxis,
  type HardStopVelocity,
} from '../src/simulation/offroad/contact-impulse.ts';

interface Inertia { mass: number; pitchInertia: number; yawInertia: number }
const body: Inertia = { mass: 184, pitchInertia: 43, yawInertia: 86 };
const front: HardStopContact = { grade: 0.5, lever: 0.82 };
const rear: HardStopContact = { grade: 0.5, lever: -0.66 };

function unit(axis?: HardStopForwardAxis) {
  const x = axis?.horizontal ?? 1, z = axis?.lateral ?? 0, length = Math.hypot(x, z);
  return { x: x / length, z: z / length };
}

function forward(v: HardStopVelocity, axis?: HardStopForwardAxis) {
  const b = unit(axis);
  return b.x * v.horizontal + b.z * (v.lateral ?? 0);
}

function closing(v: HardStopVelocity, c: HardStopContact) {
  return c.grade * v.horizontal + (c.crossGrade ?? 0) * (v.lateral ?? 0) - v.vertical -
    c.lever * v.pitchRate + (c.yawArm ?? 0) * (v.yawRate ?? 0);
}

/** Independent generalized momentum balance, including the speed-bound reaction. */
function apply(
  v: HardStopVelocity, p: Inertia, f: HardStopContact | undefined,
  r: HardStopContact | undefined, q: BoundedHardStopImpulses, axis?: HardStopForwardAxis,
) {
  const b = unit(axis);
  return {
    horizontal: v.horizontal + (b.x * q.forward -
      (f?.grade ?? 0) * q.front - (r?.grade ?? 0) * q.rear) / p.mass,
    lateral: (v.lateral ?? 0) + (b.z * q.forward -
      (f?.crossGrade ?? 0) * q.front - (r?.crossGrade ?? 0) * q.rear) / p.mass,
    vertical: v.vertical + (q.front + q.rear) / p.mass,
    pitchRate: v.pitchRate + ((f?.lever ?? 0) * q.front + (r?.lever ?? 0) * q.rear) / p.pitchInertia,
    yawRate: (v.yawRate ?? 0) - ((f?.yawArm ?? 0) * q.front + (r?.yawArm ?? 0) * q.rear) / p.yawInertia,
  };
}

function energy(v: HardStopVelocity, p: Inertia) {
  // Infinity represents the default fixed yaw coordinate; these cases have
  // zero yaw speed, so no infinite kinetic-energy term is needed.
  const yawEnergy = Number.isFinite(p.yawInertia) ? p.yawInertia * (v.yawRate ?? 0) ** 2 : 0;
  return 0.5 * (p.mass * (v.horizontal ** 2 + (v.lateral ?? 0) ** 2 + v.vertical ** 2) +
    p.pitchInertia * v.pitchRate ** 2 + yawEnergy);
}

function verify(
  v: HardStopVelocity, p: Inertia, f?: HardStopContact, r?: HardStopContact,
  axis?: HardStopForwardAxis,
) {
  const q = boundedHardStopImpulses(v, p.mass, p.pitchInertia, f, r, p.yawInertia, axis);
  const next = apply(v, p, f, r, q, axis), before = energy(v, p);
  const energyTolerance = 2e-9 * Math.max(1, before);
  let work = -q.forward * forward(v, axis);
  for (const [contact, impulse] of [[f, q.front], [r, q.rear]] as const) {
    expect(Number.isFinite(impulse)).toBe(true);
    expect(impulse).toBeGreaterThanOrEqual(0);
    if (!contact) {
      expect(impulse).toBe(0);
      continue;
    }
    const speedScale = Math.max(1, Math.abs(v.vertical), Math.abs(contact.grade * v.horizontal),
      Math.abs((contact.crossGrade ?? 0) * (v.lateral ?? 0)), Math.abs(contact.lever * v.pitchRate),
      Math.abs((contact.yawArm ?? 0) * (v.yawRate ?? 0)));
    const residual = closing(next, contact);
    expect(residual).toBeLessThanOrEqual(2e-10 * speedScale);
    expect(Math.abs(impulse * residual)).toBeLessThanOrEqual(energyTolerance);
    work += impulse * closing(v, contact);
  }
  expect(Number.isFinite(q.forward)).toBe(true);
  expect(q.forward).toBeGreaterThanOrEqual(0);
  const speedTolerance = 2e-10 * Math.max(1, Math.abs(v.horizontal), Math.abs(v.lateral ?? 0));
  expect(forward(next, axis)).toBeGreaterThanOrEqual(-speedTolerance);
  expect(Math.abs(q.forward * forward(next, axis))).toBeLessThanOrEqual(energyTolerance);
  expect(energy(next, p)).toBeLessThanOrEqual(before + energyTolerance);
  expect(Math.abs(before - energy(next, p) - 0.5 * work)).toBeLessThanOrEqual(energyTolerance);
  const swapped = boundedHardStopImpulses(v, p.mass, p.pitchInertia, r, f, p.yawInertia, axis);
  expect(swapped.front).toBeCloseTo(q.rear, 9);
  expect(swapped.rear).toBeCloseTo(q.front, 9);
  expect(swapped.forward).toBeCloseTo(q.forward, 9);
  return { q, next };
}

describe('motocross hard stops with the actual stored forward-speed bound', () => {
  it('removes the uphill reclosure caused by clamping only the normal response', () => {
    const v = { horizontal: 0.1, vertical: -10, pitchRate: 0 };
    const unbounded = coupledHardStopImpulses(v, body.mass, body.pitchInertia, front, rear);
    const projected = apply(v, body, front, rear, { ...unbounded, forward: 0 });
    expect(projected.horizontal).toBeCloseTo(-3.92, 12);
    expect(projected.vertical).toBeCloseTo(-1.96, 12);
    const clamped = { ...projected, horizontal: 0 };
    expect(closing(clamped, front)).toBeCloseTo(1.96, 12);
    expect(closing(clamped, rear)).toBeCloseTo(1.96, 12);

    const { q, next } = verify(v, body, front, rear);
    expect(q.front).toBeGreaterThan(0);
    expect(q.rear).toBeGreaterThan(0);
    expect(q.front + q.rear).toBeCloseTo(10 * body.mass, 10);
    expect(q.forward).toBeCloseTo(4.9 * body.mass, 10);
    expect(next.horizontal).toBeCloseTo(0, 12);
    expect(next.vertical).toBeCloseTo(0, 12);
    expect(next.pitchRate).toBeCloseTo(0, 12);
  });

  it('preserves the normal-only result exactly whenever the bound is inactive', () => {
    for (const grade of [-0.5, 0, 0.5]) {
      const v = { horizontal: 16, lateral: 2, vertical: -6, pitchRate: 0.2, yawRate: -0.3 };
      const f = { ...front, grade }, r = { ...rear, grade };
      const expected = coupledHardStopImpulses(v, body.mass, body.pitchInertia, f, r, body.yawInertia);
      const { q } = verify(v, body, f, r);
      expect(q).toEqual({ ...expected, forward: 0 });
    }
    const downhill = verify({ horizontal: 0.1, vertical: -10, pitchRate: 0 }, body,
      { ...front, grade: -0.5 }, { ...rear, grade: -0.5 });
    expect(downhill.q.forward).toBe(0);
    expect(downhill.next.horizontal).toBeCloseTo(4.08, 12);
  });

  it('handles no contacts, separating contacts and an isolated speed bound', () => {
    const v = { horizontal: -3, lateral: 2, vertical: 4, pitchRate: 0 };
    for (const pair of [[undefined, undefined], [front, rear]] as const) {
      const { q, next } = verify(v, body, ...pair);
      expect(q).toEqual({ front: 0, rear: 0, forward: 3 * body.mass });
      expect(next.horizontal).toBe(0);
      expect(next.lateral).toBe(2);
      expect(next.vertical).toBe(4);
    }
    expect(verify({ horizontal: 3, vertical: 4, pitchRate: 0 }, body).q)
      .toEqual({ front: 0, rear: 0, forward: 0 });
    expect(verify({ horizontal: 0, vertical: 0, pitchRate: 0 }, body, front, rear).q)
      .toEqual({ front: 0, rear: 0, forward: 0 });
  });

  it('resolves either isolated bottomed axle together with its bound reaction', () => {
    const v = { horizontal: 0.1, vertical: -10, pitchRate: 0 };
    for (const pair of [[front, undefined], [undefined, rear]] as const) {
      const { q, next } = verify(v, body, ...pair);
      expect(q.forward).toBeGreaterThan(0);
      expect(q.front + q.rear).toBeGreaterThan(0);
      expect(next.horizontal).toBeCloseTo(0, 12);
    }
  });

  it('activates an initially separating stop through the other stop and forward bound', () => {
    const v = { horizontal: 0.1, vertical: -1, pitchRate: 2 };
    expect(closing(v, front)).toBeLessThan(0);
    expect(closing(v, rear)).toBeGreaterThan(0);
    const { q, next } = verify(v, body, front, rear);
    expect(q.front).toBeGreaterThan(0);
    expect(q.rear).toBeGreaterThan(0);
    expect(q.forward).toBeGreaterThan(0);
    expect(energy(next, body)).toBeLessThan(1e-20);
  });

  it('leaves an initially closing stop unloaded when the other active constraints separate it', () => {
    const f = { grade: 1, crossGrade: 1, lever: 0 }, r = { grade: 0, lever: 0 };
    const v = { horizontal: 0.1, lateral: 10, vertical: -1, pitchRate: 0 };
    expect(closing(v, f)).toBeGreaterThan(0);
    expect(closing(v, r)).toBeGreaterThan(0);
    const { q, next } = verify(v, body, f, r);
    expect(q.front).toBeGreaterThan(0);
    expect(q.rear).toBe(0);
    expect(q.forward).toBeGreaterThan(0);
    expect(closing(next, r)).toBeLessThan(-4);
  });

  it('constrains the final yawed tyre frame while preserving contact and yaw momentum', () => {
    const v = { horizontal: 0.1, lateral: -8, vertical: -4, pitchRate: 1, yawRate: 2 };
    const f = { grade: 0.4, crossGrade: 0.6, lever: 0.82, yawArm: 0.31 };
    const r = { grade: 0.2, crossGrade: 0.4, lever: -0.66, yawArm: -0.25 };
    const yaw = 0.7, axis = { horizontal: Math.cos(yaw), lateral: Math.sin(yaw) };
    const oldFrame = verify(v, body, f, r);
    expect(forward(oldFrame.next, axis)).toBeLessThan(-1);
    const { q, next } = verify(v, body, f, r, axis);
    expect(q.forward).toBeGreaterThan(0);
    const finalForward = next.horizontal * Math.cos(yaw) + next.lateral * Math.sin(yaw);
    expect(finalForward).toBeCloseTo(0, 12);
    expect(next.yawRate).toBeCloseTo(v.yawRate -
      (f.yawArm * q.front + r.yawArm * q.rear) / body.yawInertia, 12);
  });

  it('is invariant under a rotated travel basis and rescaling of the bound axis', () => {
    const v = { horizontal: 0.1, lateral: -3, vertical: -8, pitchRate: 2, yawRate: -1 };
    const f = { grade: 0.6, crossGrade: 0.4, lever: 0.8, yawArm: 0.31 };
    const r = { grade: 0.2, crossGrade: -0.2, lever: -0.6, yawArm: -0.25 };
    const base = verify(v, body, f, r);
    expect(base.q.forward).toBeGreaterThan(0);
    for (const angle of [-2.8, -0.7, 0.3, 1.8]) {
      const c = Math.cos(angle), s = Math.sin(angle);
      const rotated = { ...v, horizontal: c * v.horizontal + s * v.lateral,
        lateral: -s * v.horizontal + c * v.lateral };
      const rotate = (contact: typeof f) => ({ ...contact,
        grade: c * contact.grade + s * contact.crossGrade,
        crossGrade: -s * contact.grade + c * contact.crossGrade });
      for (const scale of [0.25, 1, 17]) {
        const result = verify(rotated, body, rotate(f), rotate(r),
          { horizontal: scale * c, lateral: -scale * s });
        expect(result.q.front).toBeCloseTo(base.q.front, 9);
        expect(result.q.rear).toBeCloseTo(base.q.rear, 9);
        expect(result.q.forward).toBeCloseTo(base.q.forward, 9);
        expect(energy(result.next, body)).toBeCloseTo(energy(base.next, body), 9);
      }
    }
  });

  it('remains passive and complementary when active contacts are almost redundant', () => {
    const f = { grade: 0.2, crossGrade: -0.4, lever: 0.7, yawArm: -0.3 };
    for (const difference of [0, 1e-3, 1e-6, 1e-9, 1e-12]) {
      const r = { grade: f.grade + difference, crossGrade: f.crossGrade - 2 * difference,
        lever: f.lever - difference, yawArm: f.yawArm + 3 * difference };
      for (const angle of [0, 0.73, -1.2]) {
        const axis = { horizontal: Math.cos(angle), lateral: Math.sin(angle) };
        // Reverse a positive normal+bound momentum combination. Its unique
        // energy-minimizing resolved velocity is zero even when axle impulse
        // allocation becomes ill-conditioned or nonunique.
        const incoming = apply({ horizontal: 0, vertical: 0, pitchRate: 0 }, body, f, r,
          { front: -120, rear: -230, forward: -50 }, axis);
        const { q, next } = verify(incoming, body, f, r, axis);
        expect(q.forward).toBeGreaterThan(0);
        expect(energy(next, body)).toBeLessThan(1e-12 * energy(incoming, body));
      }
    }
  });

  it('handles contact rows that become duplicates only when the forward bound is active', () => {
    const f = { grade: 0.5, crossGrade: -0.4, lever: 0.7, yawArm: -0.3 };
    const r = { ...f, grade: 0.7 };
    for (const reaction of [0, 1, 2, 10, 40, 50, 100, 400]) {
      const incoming = apply({ horizontal: 0, vertical: 0, pitchRate: 0 }, body, f, r,
        { front: -120, rear: -230, forward: -reaction });
      const { next } = verify(incoming, body, f, r);
      expect(energy(next, body)).toBeLessThan(1e-12 * energy(incoming, body));
    }
  });

  it('accepts fixed yaw and omitted components and clears reusable output on every path', () => {
    const p = { ...body, yawInertia: Infinity };
    const v = Object.freeze({ horizontal: 0.1, vertical: -10, pitchRate: 0 });
    const f = Object.freeze({ ...front }), r = Object.freeze({ ...rear });
    const axis = Object.freeze({ horizontal: 1 });
    const out = { front: 7, rear: 9, forward: 11 };
    const expected = verify(v, p, f, r, axis).q;
    expect(boundedHardStopImpulses(v, p.mass, p.pitchInertia, f, r, undefined, axis, out)).toBe(out);
    expect(out).toEqual(expected);
    expect(boundedHardStopImpulses({ ...v, vertical: 3 }, p.mass, p.pitchInertia,
      f, r, undefined, axis, out)).toBe(out);
    expect(out).toEqual({ front: 0, rear: 0, forward: 0 });
    expect(boundedHardStopImpulses(v, p.mass, p.pitchInertia,
      undefined, undefined, undefined, undefined, out)).toBe(out);
    expect(out).toEqual({ front: 0, rear: 0, forward: 0 });
  });

  it('rejects an invalid bound direction', () => {
    const v = { horizontal: 0, vertical: 0, pitchRate: 0 };
    for (const axis of [{ horizontal: 0 }, { horizontal: NaN },
      { horizontal: 1, lateral: Infinity }]) {
      expect(() => boundedHardStopImpulses(v, body.mass, body.pitchInertia,
        front, rear, body.yawInertia, axis)).toThrow(RangeError);
    }
  });

  it('satisfies the complete three-constraint laws across mixed, banked and yawed impacts', () => {
    let seed = 583921;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const signed = (range: number) => range * (2 * random() - 1);
    for (let i = 0; i < 1600; i++) {
      const pitch = signed(0.9), yaw = signed(1.1), angle = signed(Math.PI);
      const p = { mass: 90 + random() * 220, pitchInertia: 15 + random() * 120,
        yawInertia: 20 + random() * 180 };
      const v = { horizontal: signed(35), lateral: signed(12), vertical: signed(15),
        pitchRate: signed(7), yawRate: signed(5) };
      const contact = (reach: number, height: number) => {
        const grade = signed(2), crossGrade = signed(1.2);
        return { grade, crossGrade, lever: reach * Math.cos(pitch) + height * Math.sin(pitch),
          yawArm: reach * (crossGrade * Math.cos(yaw) - grade * Math.sin(yaw)) };
      };
      const f = i % 4 === 0 ? undefined : contact(0.82, 0.67);
      const r = i % 4 === 1 ? undefined : contact(-0.66, 0.65);
      verify(v, p, f, r, { horizontal: Math.cos(angle), lateral: Math.sin(angle) });
    }
  });
});
