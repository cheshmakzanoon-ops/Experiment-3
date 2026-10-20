import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  type CornerHardware,
  damperForce,
  defaultSuspension,
  geometricLoad,
  HubSolver,
  resolveSuspension,
  springForce,
} from '../src/simulation/suspension.ts';
import { type SurfaceSample } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

const DT = 1 / 240;

/** Direct physical hardware, without ride-rate inversion. This linear fixture
 * has a closed-form two-corner solution independent of the Newton algorithm. */
function linearHub(bar = 18000, damping = 0, tyreDamping = 0) {
  const hardware: CornerHardware[] = Array.from({ length: 4 }, (_, i) => ({
    wheelRate: 50000 + (i & 2) * 5000,
    barRate: bar,
    progression: 0,
    travel: 0.2,
    stopGap: 0.2,
    stopRate: 0,
    droop: 0.1,
    bump: damping,
    rebound: damping,
    bumpKnee: 20,
    reboundKnee: 20,
    bumpHigh: damping,
    reboundHigh: damping,
    tyreRate: 240000,
    tyreDamping,
    camberGain: 0,
    bumpSteer: 0,
  }));
  const hub = new HubSolver(hardware);
  hub.tyreRate.fill(240000);
  hub.contact.fill(1);
  return hub;
}

/** Radial force reconstructed from physical displacement and velocity. */
function radialForce(hub: HubSolver, previous: ArrayLike<number>, i: number, dt: number) {
  const cosine = hub.normalCosine[i],
    deflection = cosine * (hub.compression[i] - hub.travel[i]),
    speed = cosine * (hub.rate[i] - (hub.travel[i] - previous[i]) / dt);
  return Math.max(0, hub.tyreRate[i] * deflection + hub.hardware[i].tyreDamping * speed);
}

describe('suspension-axis and road-normal virtual work', () => {
  it('matches the exact static coupled solution on asymmetric contact slopes', () => {
    const hub = linearHub();
    expect([...hub.normalCosine]).toEqual([1, 1, 1, 1]);
    hub.normalCosine.set([1, 0.65, 0.9, 0.25]);
    hub.compression.set([0.04, 0.06, 0.03, 0.055]);
    const expected = new Float64Array(4);
    for (const i of [0, 2]) {
      const bar = hub.hardware[i].barRate,
        k0 = hub.tyreRate[i] * hub.normalCosine[i] ** 2,
        k1 = hub.tyreRate[i + 1] * hub.normalCosine[i + 1] ** 2,
        a = hub.hardware[i].wheelRate + bar + k0,
        d = hub.hardware[i + 1].wheelRate + bar + k1,
        f0 = k0 * hub.compression[i],
        f1 = k1 * hub.compression[i + 1],
        determinant = a * d - bar * bar;
      expected[i] = (d * f0 + bar * f1) / determinant;
      expected[i + 1] = (bar * f0 + a * f1) / determinant;
    }
    hub.solve(DT);
    for (let i = 0; i < 4; i++) {
      const hardware = hub.hardware[i],
        normalForce = hub.tyreRate[i] * hub.normalCosine[i] * (hub.compression[i] - expected[i]),
        axisForce =
          hardware.wheelRate * expected[i] + hardware.barRate * (expected[i] - expected[i ^ 1]);
      expect(hub.travel[i]).toBeCloseTo(expected[i], 12);
      expect(hub.tyreForce[i]).toBeCloseTo(normalForce, 7);
      expect(hub.tyreForce[i] * hub.normalCosine[i]).toBeCloseTo(axisForce, 7);
    }
  });

  it('projects physical radial damping in the exact backward-Euler solution', () => {
    const damping = 2100,
      tyreDamping = 350,
      hub = linearHub(18000, damping, tyreDamping);
    hub.normalCosine.set([0.55, 1, 0.3, 0.85]);
    hub.compression.set([0.05, 0.045, 0.065, 0.04]);
    hub.rate.set([0.8, 0.2, 1.1, -0.1]);
    hub.travel.set([0.018, 0.02, 0.009, 0.022]);
    const previous = [...hub.travel],
      expected = new Float64Array(4);
    for (const i of [0, 2]) {
      const bar = hub.hardware[i].barRate,
        c0 = hub.normalCosine[i],
        c1 = hub.normalCosine[i + 1],
        k0 = hub.tyreRate[i] * c0 ** 2,
        k1 = hub.tyreRate[i + 1] * c1 ** 2,
        d0 = tyreDamping * c0 ** 2,
        d1 = tyreDamping * c1 ** 2,
        a = hub.hardware[i].wheelRate + bar + k0 + (damping + d0) / DT,
        d = hub.hardware[i + 1].wheelRate + bar + k1 + (damping + d1) / DT,
        f0 = k0 * hub.compression[i] + d0 * hub.rate[i] + ((damping + d0) * previous[i]) / DT,
        f1 =
          k1 * hub.compression[i + 1] +
          d1 * hub.rate[i + 1] +
          ((damping + d1) * previous[i + 1]) / DT,
        determinant = a * d - bar * bar;
      expected[i] = (d * f0 + bar * f1) / determinant;
      expected[i + 1] = (bar * f0 + a * f1) / determinant;
    }
    hub.solve(DT);
    for (let i = 0; i < 4; i++) {
      expect(hub.travel[i]).toBeCloseTo(expected[i], 12);
      expect(hub.tyreForce[i]).toBeCloseTo(radialForce(hub, previous, i, DT), 7);
      expect(hub.tyreForce[i]).toBeGreaterThan(0);
    }
  });

  it('dissipates stored radial and spring energy with unequal fixed contact normals', () => {
    for (const dt of [DT, 1 / 60, 1 / 30]) {
      const hub = linearHub(18000, 2100, 350);
      hub.normalCosine.set([1, 0.7, 0.35, 0.15]);
      hub.compression.fill(0.05);
      hub.travel.set([0.018, 0.025, 0.03, 0.015]);
      const energy = () => {
        let value = 0;
        for (let i = 0; i < 4; i++) {
          const x = hub.travel[i],
            radial = hub.normalCosine[i] * Math.max(0, hub.compression[i] - x);
          value += 0.5 * hub.hardware[i].wheelRate * x ** 2 + 0.5 * hub.tyreRate[i] * radial ** 2;
          if (i % 2 === 0) value += 0.5 * hub.hardware[i].barRate * (x - hub.travel[i + 1]) ** 2;
        }
        return value;
      };
      let previousEnergy = energy();
      for (let step = 0; step < 100; step++) {
        const previous = [...hub.travel];
        hub.contact.fill(1);
        hub.solve(dt);
        let loss = 0;
        for (let i = 0; i < 4; i++) {
          const speed = (hub.travel[i] - previous[i]) / dt,
            radialSpeed = -hub.normalCosine[i] * speed;
          loss +=
            dt *
            (damperForce(hub.hardware[i], speed) * speed +
              hub.hardware[i].tyreDamping * radialSpeed ** 2);
        }
        const nextEnergy = energy();
        expect(loss).toBeGreaterThanOrEqual(0);
        expect(nextEnergy + loss).toBeLessThanOrEqual(previousEnergy + 1e-8);
        previousEnergy = nextEnergy;
      }
    }
  });

  it('balances projected forces through nonlinear stops and unilateral release', () => {
    const cases = [
      { previous: [0.02, 0.02], compression: [0.15, 0.002], rate: [8, -6] },
      { previous: [0.12, 0.005], compression: [0.002, 0.1], rate: [-8, 6] },
      { previous: [-0.04, 0.12], compression: [0.04, 0.2], rate: [0, 0] },
      { previous: [0.03, 0.015], compression: [0.02, -0.02], rate: [-5, -5] },
    ];
    for (const dt of [DT, 1 / 60, 1 / 30])
      for (const input of cases) {
        const hub = new HubSolver(
          resolveSuspension(defaultSuspension(), DEFAULT_SETUP, 330000, 350, 0.17),
        );
        hub.normalCosine.set([0.35, 0.8, 1, 0.5]);
        for (let i = 0; i < 4; i++) {
          hub.tyreRate[i] = i % 2 === 0 ? 330000 * 0.25 : 330000 * 1.6;
          hub.travel[i] = input.previous[i % 2];
          hub.compression[i] = input.compression[i % 2];
          hub.rate[i] = input.rate[i % 2];
          hub.contact[i] = hub.compression[i] > 0 ? 1 : 0;
          hub.hardware[i].progression = 0.4;
        }
        const previous = [...hub.travel],
          contacts = [...hub.contact];
        hub.solve(dt);
        for (let i = 0; i < 4; i++) {
          const h = hub.hardware[i],
            normal = contacts[i] ? radialForce(hub, previous, i, dt) : 0,
            axis =
              springForce(h, hub.travel[i]) +
              damperForce(h, (hub.travel[i] - previous[i]) / dt) +
              h.barRate * (hub.travel[i] - hub.travel[i ^ 1]),
            residual = normal * hub.normalCosine[i] - axis;
          expect(hub.tyreForce[i]).toBeCloseTo(normal, 7);
          expect(hub.travel[i]).toBeGreaterThanOrEqual(-h.droop);
          if (hub.travel[i] === -h.droop) expect(residual).toBeLessThanOrEqual(1e-6);
          else expect(Math.abs(residual)).toBeLessThan(1e-6);
        }
      }
  });

  it('resets contact projection with contact state and rejects invalid cosines', () => {
    const hub = linearHub();
    hub.normalCosine.fill(0.4);
    hub.compression.fill(0.04);
    hub.rate.fill(0.2);
    hub.solve(DT);
    hub.reset();
    expect([...hub.normalCosine]).toEqual([1, 1, 1, 1]);
    expect([...hub.contact]).toEqual([0, 0, 0, 0]);
    expect([...hub.compression]).toEqual([0, 0, 0, 0]);
    expect([...hub.rate]).toEqual([0, 0, 0, 0]);
    for (const cosine of [0, -0.1, 1.01, NaN, Infinity]) {
      hub.normalCosine[0] = cosine;
      expect(() => hub.solve(DT)).toThrow('Invalid suspension contact cosine');
    }
  });
});

/** An exact plane keeps the integration oracle independent of the BVH. */
class InclinedTrack extends DynamicsTrack {
  constructor(
    readonly slope: number,
    readonly grade: number,
  ) {
    super();
  }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.height = this.slope * x + this.grade * z;
    out.normal.set(-this.slope, 1, -this.grade).normalize();
    return out;
  }
  override cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    const distance =
      (this.slope * origin.x + this.grade * origin.z - origin.y) /
      (down.y - this.slope * down.x - this.grade * down.z);
    if (distance < 0 || distance > maximum) return Infinity;
    this.sample(origin.x + distance * down.x, origin.z + distance * down.z, out);
    return distance;
  }
}

it('uses one work-consistent projection for vehicle gap rate, carcass deformation and link load', () => {
  const track = new InclinedTrack(0.24, 0.04),
    car = new Vehicle(0),
    velocity = new Vec3(2, -0.3, 7),
    normal = new Vec3(-track.slope, 1, -track.grade).normalize(),
    cosine = normal.y,
    height = 0.08,
    anti = 0.04,
    fx = -800,
    fy = 300,
    geometry = defaultSuspension({ front: { rollCentreHeight: height, antiBrake: anti } }).front;
  car.place(track, 0);
  // A prescribed one-step bank/grade pose preloads every corner so clipping
  // at loss of contact cannot obscure the load-coordinate comparison.
  car.body.position.y = 0.24;
  car.body.velocity.copy(velocity);
  const linkLoads = car.wheelPositions.map(([x, , z]) => geometricLoad(geometry, x, z, fx, fy, 0));
  car.jacking.set(linkLoads);
  car.step(DT, track);
  let moment = 0;
  for (let i = 0; i < 4; i++) {
    const hub = car.hub,
      tire = car.tires[i],
      [x, , z] = car.wheelPositions[i],
      // Link geometry is defined in the chassis frame. Its lever moment gives
      // axis load directly; normal force must have the same virtual work.
      axisLink = (-height * fy) / x - anti * fx * Math.sign(z),
      extraNormal = tire.load - hub.tyreForce[i],
      virtualRise = new Vec3(0, 0.01, 0),
      normalWork = new Vec3().copy(normal).scale(extraNormal).dot(virtualRise),
      axisDeformation = Math.max(0, hub.compression[i] - hub.travel[i]);
    expect(hub.contact[i]).toBe(1);
    expect(tire.load).toBeGreaterThan(100);
    expect(hub.normalCosine[i]).toBeCloseTo(cosine, 12);
    expect(hub.rate[i]).toBeCloseTo(
      track.slope * velocity.x + track.grade * velocity.z - velocity.y,
      12,
    );
    expect(Math.abs(hub.rate[i] + velocity.dot(normal))).toBeGreaterThan(0.02);
    expect(tire.deflection).toBeCloseTo(cosine * axisDeformation, 12);
    expect(extraNormal * cosine).toBeCloseTo(axisLink, 7);
    expect(normalWork).toBeCloseTo(axisLink * virtualRise.y, 9);
    if (i < 2) moment += x * extraNormal * cosine;
  }
  // Equal front braking forces have cancelling anti moments. The lateral
  // link couple therefore balances the known force at roll-centre height.
  expect(moment).toBeCloseTo(-height * 2 * fy, 7);
});
