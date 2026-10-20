import { describe, expect, it } from 'vitest';
import {
  CLUTCH_LSD,
  differential,
  differentialOutput,
  differentialTorques,
  distributeDrive,
  LOCKED,
  OPEN,
  SPOOL,
  TORSEN,
  type DifferentialDefinition,
} from '../src/simulation/differential.ts';

/** Test the coupling against the free state AFTER the specified drive/road
 * impulses. External torque is allowed to add energy; internal locking is not.
 * Kinetic energy and angular momentum are computed independently of the
 * differential's constitutive law. */
function step(
  def: DifferentialDefinition,
  a: number,
  b: number,
  ia: number,
  ib: number,
  dt: number,
  input = 0,
  ra = 0,
  rb = 0,
) {
  const out = differentialOutput();
  differentialTorques(def, input, true, a, b, ia, ib, dt, out, ra, rb);
  const freeA = a + ((def.split * input + ra) * dt) / ia,
    freeB = b + (((1 - def.split) * input + rb) * dt) / ib,
    nextA = a + ((out.first + ra) * dt) / ia,
    nextB = b + ((out.second + rb) * dt) / ib,
    before = (ia * freeA ** 2 + ib * freeB ** 2) * 0.5,
    after = (ia * nextA ** 2 + ib * nextB ** 2) * 0.5;
  expect(out.first + out.second).toBeCloseTo(input, 9);
  expect(ia * nextA + ib * nextB).toBeCloseTo(ia * freeA + ib * freeB, 9);
  expect(after).toBeLessThanOrEqual(before + Math.max(1, before) * 1e-12);
  expect(Math.abs(nextB - nextA)).toBeLessThanOrEqual(Math.abs(freeB - freeA) + 1e-10);
  expect((nextB - nextA) * (freeB - freeA)).toBeGreaterThanOrEqual(-1e-10);
  return { nextA, nextB, freeA, freeB, before, after, out };
}

describe('differential impulse passivity', () => {
  it('a stiff viscous coupling cannot reverse slip or energize a light axle', () => {
    const def = differential({ kind: 'viscous', viscousPower: 2000 });
    for (const dt of [1 / 480, 1 / 240, 1 / 60, 0.2])
      for (const sign of [-1, 1])
        for (const [ia, ib] of [
          [0.2, 0.2],
          [0.15, 1.8],
        ]) {
          const result = step(def, sign * 40, sign * 41, ia, ib, dt);
          expect(result.after).toBeLessThan(result.before);
          // The old explicit 2000 N m impulse changed a 1 rad/s difference
          // into -332.333 rad/s and added 5522.222 J at 60 Hz (I = 0.2 each).
          expect(Math.abs(result.nextB - result.nextA)).toBeLessThan(0.2);
        }
  });

  it('converges toward the analytic decay of an isolated viscous axle', () => {
    const viscosity = 12,
      ia = 1.2,
      ib = 2.4,
      duration = 0.1,
      def = differential({ kind: 'viscous', viscousPower: viscosity }),
      exact = 8 * Math.exp(-viscosity * (1 / ia + 1 / ib) * duration);
    let previousError = Infinity;
    for (const count of [10, 20, 40, 80]) {
      let a = 30,
        b = 38;
      for (let i = 0; i < count; i++) {
        const result = step(def, a, b, ia, ib, duration / count);
        a = result.nextA;
        b = result.nextB;
      }
      const error = Math.abs(b - a - exact);
      expect(error).toBeLessThan(previousError);
      previousError = error;
    }
    expect(previousError).toBeLessThan(0.03);
  });

  it('uses the newly forced slip when drive and road torques reverse its direction', () => {
    for (const source of [SPOOL, CLUTCH_LSD, TORSEN])
      for (const split of [0.35, 0.5, 0.65])
        for (const sign of [-1, 1]) {
          const def = differential({ ...source, split }),
            dt = 0.1,
            ia = 0.8,
            ib = 1.6,
            input = sign * 200,
            // Isolate the coupling's reaction to a +1 -> -0.1 rad/s free
            // slip reversal, including asymmetric drive and unequal inertia.
            ra = -split * input,
            rb = -(1 - split) * input - (sign * 1.1 * ib) / dt;
          const result = step(def, sign * 40, sign * 41, ia, ib, dt, input, ra, rb);
          expect(result.freeB - result.freeA).toBeCloseTo(-sign * 0.1, 9);
          expect(Math.abs(result.out.locking)).toBeGreaterThan(0);
        }
  });

  it('does not create slip when known external impulses already synchronize the outputs', () => {
    const result = step(SPOOL, 40, 41, 1, 1, 0.1, 0, 0, -10);
    expect(result.out.locking).toBe(0);
    expect(result.nextA).toBeCloseTo(result.nextB, 12);
  });

  it('rejects invalid output inertia before it can contaminate wheel torques', () => {
    const out = differentialOutput();
    for (const inertia of [0, -1, NaN, Infinity])
      expect(() => differentialTorques(SPOOL, 0, true, 10, 11, inertia, 1, 1 / 240, out)).toThrow(
        'Invalid differential state',
      );
  });
});

describe('asymmetric catalogue centre differential', () => {
  it('a locked centre resists unequal planetary drive in the same substep', () => {
    const out = new Float64Array(4),
      inertia = 1.4,
      dt = 1 / 240;
    for (const frontShare of [0.15, 0.35, 0.65, 0.85])
      for (const drive of [-1000, 1000]) {
        distributeDrive(
          out,
          { centre: { ...LOCKED, frontShare }, front: OPEN, rear: OPEN },
          'awd',
          drive,
          [50, 50, 50, 50],
          inertia,
          dt,
          0.5,
          0.25,
        );
        const frontAfter = 50 + ((out[0] + out[1]) * dt) / (2 * inertia),
          rearAfter = 50 + ((out[2] + out[3]) * dt) / (2 * inertia);
        expect(frontAfter).toBeCloseTo(rearAfter, 11);
        expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(drive, 9);
      }
  });

  it('locking removes energy from the driven free state in forward and reverse', () => {
    const out = new Float64Array(4),
      inertia = 1.4,
      frontShare = 0.35,
      drive = 1000,
      dt = 1 / 60;
    for (const sign of [-1, 1]) {
      const omega = [sign * 40, sign * 42, sign * 60, sign * 65];
      distributeDrive(
        out,
        { centre: { ...LOCKED, frontShare }, front: LOCKED, rear: LOCKED },
        'awd',
        sign * drive,
        omega,
        inertia,
        dt,
        0.5,
        0.25,
      );
      const free = omega.map(
          (w, i) => w + (sign * drive * (i < 2 ? frontShare : 1 - frontShare) * dt) / (2 * inertia),
        ),
        solved = omega.map((w, i) => w + (out[i] * dt) / inertia),
        energy = (values: number[]) => values.reduce((sum, w) => sum + 0.5 * inertia * w ** 2, 0);
      expect(energy(solved)).toBeLessThan(energy(free));
      expect(solved.reduce((a, b) => a + b, 0)).toBeCloseTo(
        free.reduce((a, b) => a + b, 0),
        10,
      );
      for (const speed of solved) expect(speed).toBeCloseTo(solved[0], 10);
    }
  });
});
