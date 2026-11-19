import { describe, expect, it, vi } from 'vitest';
import { BIKE, Bike, NOVICE } from '../src/simulation/bike.ts';
import { MotoGPChassis, type MotoGPContactStep } from '../src/simulation/motogp-physics.ts';

const geometry = {
  frontArm: BIKE.cgToFront,
  rearArm: BIKE.cgToRear,
  yawInertia: 55,
  frontRadius: 0.3,
  rearRadius: 0.32,
  frontWheelInertia: 0.6,
  rearWheelInertia: 0.9,
};

function contact() {
  const gp = new MotoGPChassis(geometry),
    q: MotoGPContactStep = {
      dt: 1 / 240,
      speed: 20,
      mass: 250,
      lean: 0.4,
      steer: 0,
      frontLoad: 1400,
      rearLoad: 1050,
      frontMu: 1.5,
      rearMu: 1.5,
      frontFx: -300,
      rearFx: 0,
      frontContact: 1,
      frontBrakeExcess: 0,
      rearDriveExcess: 0,
      rearBrakeExcess: 0,
      inertialContacts: true,
    };
  gp.reset(q.speed);
  gp.lateralSpeed = 1.3;
  gp.yawRate = 0.45;
  gp.frontFy = 800;
  gp.rearFy = 650;
  return { gp, q };
}

describe('GP rider previews the current rear contact', () => {
  it('does not countersteer against a rear force that disappeared on unloading', () => {
    const bike = new Bike(NOVICE, { ...BIKE, drag: 0, rolling: 0 });
    bike.speed = 30;
    bike.enableMotoGPPhysics(geometry);
    bike.contactLoads = { front: 1400, rear: 0 };
    const gp = bike.motoGP!;
    // Opposed stored carcass forces have no net acceleration or yaw state.
    // The rear now unloads: its old 400 N is no longer an applied road force.
    gp.frontFy = -400;
    gp.rearFy = 400;
    const inverse = vi.spyOn(gp, 'frontSteerFor');
    bike.step({ lean: 0, rider: 0, throttle: 0, frontBrake: 0, rearBrake: 0, drive: 0 }, 1 / 240);
    expect(inverse).toHaveBeenCalled();
    expect(inverse.mock.calls.at(-1)![0]).toBeCloseTo(0, 12);
    expect(gp.rearFy).toBe(0);
    expect(bike.state).toBe('riding');
  });

  it.each([
    [0, 1.5, 0],
    [500, 1.5, 0],
    [1800, 1.5, 0],
    [1050, 0.7, -300],
    [1050, 1.5, 300],
    [1050, 1.5, -2000],
  ])('predicts the actual relaxed rear force at load %s, friction %s, Fx %s', (load, mu, fx) => {
    const { gp, q } = contact();
    q.rearLoad = load;
    q.rearMu = mu;
    q.rearFx = fx;
    const before = {
        force: gp.rearFy,
        slip: gp.rearSlipAngle,
        omega: gp.rearOmega,
        heat: gp.rearSlidingPower,
        yaw: gp.yawRate,
        side: gp.lateralSpeed,
      },
      predicted = gp.rearForceFor(load, mu, q.lean, q.speed, fx, q.dt);
    expect({
      force: gp.rearFy,
      slip: gp.rearSlipAngle,
      omega: gp.rearOmega,
      heat: gp.rearSlidingPower,
      yaw: gp.yawRate,
      side: gp.lateralSpeed,
    }).toEqual(before);
    gp.step(q);
    expect(gp.rearFy).toBeCloseTo(predicted, 12);
    if (load === 0) expect(predicted).toBe(0);
  });
});
