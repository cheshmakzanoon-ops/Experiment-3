import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import {
  motocrossYawInertia, stepMotocrossGround,
  type MxGroundParameters, type MxGroundState,
} from '../src/simulation/offroad/mx-ground-physics.ts';

const H = 1 / 720;
const parameters = (): MxGroundParameters => ({
  mass: 184.4, frontArm: 0.75, rearArm: 0.73,
  frontRadius: 0.355, rearRadius: 0.345, frontInertia: 0.7, rearInertia: 0.62,
  frontLoad: 2400, rearLoad: 4900, frontMu: 0.95, rearMu: 0.35,
  steer: 0, lean: 0, driveTorque: 0, frontBrakeTorque: 0, rearBrakeTorque: 0,
  drag: 20, slope: -2.4, lateralGravity: 0.3, tractionControl: false, abs: false,
});
const stationary = (): MxGroundState => ({
  speed: 0, lateralSpeed: 0, yawRate: 0, heading: 0, frontOmega: 0, rearOmega: 0,
});
const energy = (s: MxGroundState, p: MxGroundParameters) => 0.5 * (
  p.mass * (s.speed * s.speed + s.lateralSpeed * s.lateralSpeed) +
  motocrossYawInertia(p.mass, p.frontArm, p.rearArm) * s.yawRate * s.yawRate +
  p.frontInertia * s.frontOmega * s.frontOmega + p.rearInertia * s.rearOmega * s.rearOmega
);
/** Independent integral of a nonnegative rotor under a constant torque. */
function angularTravel(omega: number, torque: number, inertia: number, dt: number) {
  const acceleration = torque / inertia;
  const moving = acceleration < 0 ? Math.min(dt, -omega / acceleration) : dt;
  return omega * moving + 0.5 * acceleration * moving * moving;
}

describe('independent motocross contact work', () => {
  it.each(['front', 'rear'] as const)(
    'does not sacrifice a dissipative locked %s to the other nearly rolling contact', (locked) => {
      const p = parameters();
      if (locked === 'rear') {
        [p.frontLoad, p.rearLoad] = [p.rearLoad, p.frontLoad];
        [p.frontMu, p.rearMu] = [p.rearMu, p.frontMu];
      }
      const s = { ...stationary(), speed: 5,
        frontOmega: locked === 'front' ? 0 : (5 - 0.003) / p.frontRadius,
        rearOmega: locked === 'rear' ? 0 : (5 - 0.003) / p.rearRadius };
      const unbanked = stepMotocrossGround(s, { ...p, lateralGravity: 0 }, H);
      const banked = stepMotocrossGround(s, p, H);
      // The opposing patch alone crosses rolling equality during the shared
      // chassis impulse. Its work limit must not divide this force budget.
      expect(banked[locked].fx).toBeCloseTo(unbanked[locked].fx, 9);
      expect(-banked[locked].fx).toBeGreaterThan(2000);
      const wet = stepMotocrossGround(s, {
        ...p, [locked === 'front' ? 'frontMu' : 'rearMu']: 0.35,
      }, H);
      expect(-banked[locked].fx).toBeGreaterThan(-wet[locked].fx * 2);
      expect(banked.front.use).toBeLessThanOrEqual(1 + 1e-12);
      expect(banked.rear.use).toBeLessThanOrEqual(1 + 1e-12);
    },
  );

  it('keeps a held bank exactly stationary across supported load and heading scales', () => {
    for (const mass of [120, 184.4, 300]) for (const frontArm of [0.55, 0.75, 0.95]) {
      for (const gravity of [-3, -0.01, 0.000001, 2.699082568807339]) {
        const rearArm = 0.73, wheelbase = frontArm + rearArm;
        const p = { ...parameters(), mass, frontArm, rearArm,
          frontLoad: mass * G * rearArm / wheelbase,
          rearLoad: mass * G * frontArm / wheelbase,
          frontMu: 2, rearMu: 2, drag: 0, slope: 0, lateralGravity: gravity };
        for (const heading of [-2.1, 0, 1.7]) {
          let s = { ...stationary(), heading };
          for (let tick = 0; tick < 12; tick++) {
            const next = stepMotocrossGround(s, p, 1 / 120);
            expect([next.speed, next.lateralSpeed, next.yawRate, next.dx, next.dz]).toEqual([0, 0, 0, 0, 0]);
            expect(next.heading).toBe(heading);
            expect(next.front.slipPower + next.rear.slipPower).toBe(0);
            s = next;
          }
        }
      }
    }
  });

  it('retains genuinely tiny downhill impulses rather than applying a speed dead band', () => {
    const p = { ...parameters(), frontMu: 0, rearMu: 0, drag: 0, slope: 0,
      lateralGravity: 1e-18 };
    const next = stepMotocrossGround(stationary(), p, H);
    expect(next.lateralSpeed).toBe(p.lateralGravity * H);
    expect(next.lateralSpeed).toBeGreaterThan(0);
    expect(next.dx).toBeGreaterThan(0);
  });

  it('retains feasible static bank support after brake-limited rotor pickup', () => {
    const p = { ...parameters(), frontLoad: 900, rearLoad: 900,
      frontMu: 1, rearMu: 1, drag: 0, slope: -0.0383, lateralGravity: -0.098,
      frontBrakeTorque: 600, rearBrakeTorque: 300 };
    const s = { ...stationary(), frontOmega: 0.001, rearOmega: 0.002 };
    const next = stepMotocrossGround(s, p, H);
    // The pads stop these tiny spinning rotors before the end of the
    // interval. Correcting their longitudinal contact work cannot erase
    // a separately feasible, zero-work lateral support reaction.
    expect(next.frontOmega).toBe(0);
    expect(next.rearOmega).toBe(0);
    expect(next.lateralSpeed).toBe(0);
    expect(next.yawRate).toBe(0);
    expect(next.speed).toBeGreaterThan(0);
    expect(next.front.fy + next.rear.fy).toBeCloseTo(-p.mass * p.lateralGravity, 10);
  });

  it('keeps independently limited contacts inside finite body/rotor work and their own circles', () => {
    let seed = 0x32c07ac;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let sample = 0; sample < 1200; sample++) {
      const p = { ...parameters(),
        steer: sample < 600 ? 0 : (random() - 0.5) * 1.3,
        lean: sample < 600 ? 0 : sample % 2 ? undefined : (random() - 0.5) * 0.8,
        frontLoad: random() * 6000, rearLoad: random() * 6000,
        frontMu: random() * 1.2, rearMu: random() * 1.2,
        drag: 0, slope: 0, lateralGravity: (random() - 0.5) * 8,
        driveTorque: random() * 500,
        frontBrakeTorque: random() * 600, rearBrakeTorque: random() * 500 };
      const s = { ...stationary(), speed: random() * 30,
        lateralSpeed: (random() - 0.5) * 5, yawRate: (random() - 0.5) * 5,
        heading: (random() - 0.5) * 6, frontOmega: random() * 100, rearOmega: random() * 100 };
      const next = stepMotocrossGround(s, p, H);
      const rearTravel = angularTravel(s.rearOmega,
        p.driveTorque - p.rearBrakeTorque - next.rear.fx * p.rearRadius, p.rearInertia, H);
      // Keep the existing explicit yaw-damper port separate from contact
      // work. Its constant incoming-rate torque can have positive finite
      // work when another impulse reverses yaw inside this interval.
      const yawDamperWork = -0.18 * motocrossYawInertia(p.mass, p.frontArm, p.rearArm) *
        s.yawRate * 0.5 * (s.yawRate + next.yawRate) * H;
      const source = p.driveTorque * rearTravel + (next.lateralGravityPower ?? 0) * H + yawDamperWork;
      const dissipated = H * (next.frontBrakePower + next.rearBrakePower +
        next.front.slipPower + next.rear.slipPower);
      expect(energy(next, p) + dissipated, `finite work case ${sample}`)
        .toBeLessThanOrEqual(energy(s, p) + source + 2e-8);
      for (const [contact, capacity] of [[next.front, p.frontLoad * p.frontMu],
        [next.rear, p.rearLoad * p.rearMu]] as const) {
        expect(Math.hypot(contact.fx, contact.fy)).toBeLessThanOrEqual(capacity + 1e-9);
        expect(contact.slipPower).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
