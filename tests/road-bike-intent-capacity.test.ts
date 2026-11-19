import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { BIKE, Bike, NOVICE } from '../src/simulation/bike.ts';

const DT = 1 / 240;
const input = { lean: 1, throttle: 0, frontBrake: 0, rearBrake: 0, rider: 1, drive: 0 };

function roadBike(frontShare = 1, rearShare = 1, frontGrip = 1, rearGrip = 1) {
  const bike = new Bike(NOVICE, {
    ...BIKE,
    mu: 1.3,
    cgHeight: 0.66,
    cgToFront: 0.68,
    cgToRear: 0.75,
    wheelbase: 1.43,
    riderOffsetMax: 0.2,
    drag: 0,
  });
  bike.speed = 30;
  bike.frontGrip = frontGrip;
  bike.rearGrip = rearGrip;
  bike.frontLoad *= frontShare;
  bike.rearLoad *= rearShare;
  bike.contactLoads = { front: bike.frontLoad, rear: bike.rearLoad };
  bike.riderOffset = bike.p.riderOffsetMax;
  return bike;
}

describe('road-bike nominal intent and supported recovery capacity', () => {
  it('keeps the authored nominal lean when modest axle transfer leaves it arrestable', () => {
    const bike = roadBike(0.95, 1.05),
      nominal = bike.leanLimit,
      reaction = (bike.frontLoad + bike.rearLoad) / bike.mass;
    bike.lean = nominal;
    const balancedLateral = reaction * (Math.tan(nominal) + bike.riderGain());
    bike.steer = Math.atan(
      (balancedLateral * bike.p.wheelbase) / (bike.speed ** 2 * Math.cos(nominal)),
    );
    for (let i = 0; i < 240; i++) {
      bike.step(input, DT);
      expect(bike.state).toBe('riding');
      expect(bike.leanLimit).toBe(nominal);
      expect(bike.lean).toBeCloseTo(nominal, 10);
      expect(bike.leanRate).toBeCloseTo(0, 10);
      expect(bike.frontUse).toBeLessThan(0.864);
      expect(bike.rearUse).toBeLessThan(0.864);
    }
  });

  it.each(
    [
      { label: 'front unload', front: 0.18, rear: 1, frontGrip: 1, rearGrip: 1 },
      { label: 'rear unload', front: 1, rear: 0.18, frontGrip: 1, rearGrip: 1 },
      { label: 'front low grip', front: 1, rear: 1, frontGrip: 0.25, rearGrip: 1 },
      { label: 'rear low grip', front: 1, rear: 1, frontGrip: 1, rearGrip: 0.25 },
    ].flatMap((contact) =>
      [1 / 240, 1 / 120].flatMap((dt) =>
        // Default and softest authored damping, plus a zero-damping stress
        // case: roll stopping must not rely on extra dissipative tuning.
        [0, 0.6, 1.2].map((damping) => ({ ...contact, dt, damping })),
      ),
    ),
  )(
    'clips full intent with $label at dt=$dt and damping=$damping',
    ({ front, rear, frontGrip, rearGrip, dt, damping }) => {
      const bike = roadBike(front, rear, frontGrip, rearGrip),
        nominal = bike.leanLimit;
      bike.p.rollDamping = damping;
      for (let i = 0; i < 8 / dt; i++) {
        bike.step(input, dt);
        expect(bike.state).toBe('riding');
        expect(bike.leanLimit).toBe(nominal);
        // The recovery request is bounded before the existing finite-rate
        // steering response; realised forces must obey the actual circles.
        expect(bike.frontUse).toBeLessThanOrEqual(1);
        expect(bike.rearUse).toBeLessThanOrEqual(1);
      }
      expect(bike.lean).toBeGreaterThan(0);
      expect(bike.lean).toBeLessThan(nominal - 0.2);
      expect(Math.abs(bike.leanRate)).toBeLessThan(1e-6);
      // The limiting tyre keeps 10% headroom inside the existing 96% recovery
      // budget, even with a held full-stick request and asymmetric contacts.
      expect(Math.max(bike.frontUse, bike.rearUse)).toBeCloseTo(0.9 * 0.96, 5);
    },
  );

  it('keeps the nominal scale independent of contact changes and applies no force in flight', () => {
    const bike = roadBike(),
      nominal = bike.leanLimit;
    bike.lean = 0.3;
    bike.leanRate = 0.2;
    bike.contactLoads = { front: 0, rear: 0 };
    bike.step({ ...input, throttle: 1, drive: 2000, frontBrake: 1, rearBrake: 1 }, DT);
    expect(bike.leanLimit).toBe(nominal);
    expect(bike.lean).toBeCloseTo(0.3 + 0.2 * DT, 12);
    expect(bike.leanRate).toBe(0.2);
    expect(bike.curvature).toBe(0);
    expect(bike.driveForce + bike.frontBrakeForce + bike.rearBrakeForce).toBe(0);
  });

  it('retains the authored 72% standalone intent and its original no-contact-input path', () => {
    const bike = new Bike(NOVICE),
      gain = (bike.p.riderOffsetMax * 0.25) / bike.p.cgHeight;
    bike.speed = 30;
    bike.grip = 0.8;
    const expected = Math.min(bike.p.maxLean, Math.atan(0.72 * bike.p.mu * bike.grip - gain));
    for (let i = 0; i < 600; i++) {
      bike.step({ ...input, lean: 0.6 }, DT);
      expect(bike.leanLimit).toBe(expected);
      expect(bike.contactLoads).toBeUndefined();
      expect(bike.state).toBe('riding');
    }
    expect(bike.frontLoad + bike.rearLoad).toBeCloseTo(bike.mass * G, 8);
  });
});
