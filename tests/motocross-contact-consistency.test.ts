import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { sampleBikeField } from '../src/rendering/snapshot-interpolation.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { hardStopImpulse } from '../src/simulation/offroad/contact-impulse.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { motocrossYawInertia } from '../src/simulation/offroad/mx-ground-physics.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import type { Track } from '../src/simulation/track.ts';
import { B, BIKE_BASE, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

interface ContactState {
  playerMotocross: boolean;
  motocrossCourse: boolean;
  updateSuspensionAndTyres(dt: number, track: Track): void;
  roadPitch: number;
  flightSpeed: number;
  mxYawRate: number;
  projectedContact: boolean;
  vertical(dt: number): void;
}
const state = (bike: DirtBikeVehicle) => bike as unknown as ContactState;

interface Velocity {
  forward: number;
  lateral: number;
  vertical: number;
  pitch: number;
  yaw: number;
}
interface Scene {
  pitch: number;
  depth: readonly [number, number];
  grade: readonly [number, number];
  cross: readonly [number, number];
  velocity: Velocity;
}

const impact: Scene = {
  pitch: 0,
  depth: [0.4, 0.4],
  grade: [0, 0],
  cross: [0, 0],
  velocity: { forward: 18, lateral: 0.8, vertical: -6, pitch: 2, yaw: 0.4 },
};

/** Exercise the actual adapter's contact integration with independent local
 * terrain patches. Heights prescribe penetration; normals prescribe their
 * derivatives. Neither the impulse helper nor a duplicate solver is used. */
function contactBike(definition: VehicleDefinition, scene: Scene) {
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition),
    b = definition.bike!, sag = factoryBikeSag(definition), v = scene.velocity;
  bike.dynamics.mass = definition.spec.dryMass + b.fuel;
  bike.dynamics.speed = v.forward;
  bike.dynamics.heading = 0;
  bike.cgY = 1;
  bike.pitch = scene.pitch;
  bike.vy = v.vertical;
  bike.pitchRate = v.pitch;
  bike.slide = v.lateral;
  state(bike).mxYawRate = v.yaw;
  state(bike).playerMotocross = true;
  state(bike).motocrossCourse = true;
  state(bike).roadPitch = 0;
  const sin = Math.sin(scene.pitch), cos = Math.cos(scene.pitch);
  bike.contacts[0].height = bike.cgY + b.cgToFront * sin - (b.cgHeight + sag.fork) * cos +
    b.forkTravel + scene.depth[0];
  bike.contacts[2].height = bike.cgY - b.cgToRear * sin - (b.cgHeight + sag.shock) * cos +
    b.shockTravel + scene.depth[1];
  bike.contacts[0].normal.set(-scene.cross[0], 1, -scene.grade[0]).normalize();
  bike.contacts[2].normal.set(-scene.cross[1], 1, -scene.grade[1]).normalize();
  return bike;
}

function rows(bike: DirtBikeVehicle, pitch: number) {
  const b = bike.bikeSpec, sag = factoryBikeSag(bike.definition),
    sin = Math.sin(pitch), cos = Math.cos(pitch);
  return [
    { lever: b.cgToFront * cos + (b.cgHeight + sag.fork) * sin,
      yawArm: -bike.contacts[0].normal.x / bike.contacts[0].normal.y * b.cgToFront },
    { lever: -b.cgToRear * cos + (b.cgHeight + sag.shock) * sin,
      yawArm: bike.contacts[2].normal.x / bike.contacts[2].normal.y * b.cgToRear },
  ];
}

function energy(bike: DirtBikeVehicle, v: Velocity) {
  const b = bike.bikeSpec, m = bike.dynamics.mass;
  return 0.5 * (m * (v.forward ** 2 + v.lateral ** 2 + v.vertical ** 2) +
    bike.air.pitchInertia * v.pitch ** 2 + motocrossYawInertia(m, b.cgToFront, b.cgToRear) * v.yaw ** 2);
}

/** Remove the measured force/gravity increment and known pitch damping from
 * a finite adapter step. The remaining change is the instantaneous impact;
 * stored spring energy is allowed to do work during the rest of the tick. */
function impactVelocity(bike: DirtBikeVehicle, incomingPitch: number, dt: number): Velocity {
  const b = bike.bikeSpec, torque =
    (bike.forceFront * b.cgToFront - bike.forceRear * b.cgToRear) * Math.cos(incomingPitch);
  return {
    forward: bike.dynamics.speed * Math.cos(bike.groundPitch),
    lateral: bike.slide,
    vertical: bike.vy - ((bike.forceFront + bike.forceRear) / bike.dynamics.mass - G) * dt,
    pitch: bike.pitchRate * Math.exp(1.5 * dt) - torque / bike.air.pitchInertia * dt,
    yaw: state(bike).mxYawRate,
  };
}

function rawCompression(bike: DirtBikeVehicle) {
  const b = bike.bikeSpec, sag = factoryBikeSag(bike.definition),
    sin = Math.sin(bike.pitch), cos = Math.cos(bike.pitch);
  return [
    bike.contacts[0].height - (bike.cgY + b.cgToFront * sin - (b.cgHeight + sag.fork) * cos),
    bike.contacts[2].height - (bike.cgY - b.cgToRear * sin - (b.cgHeight + sag.shock) * cos),
  ];
}

const publicationTrack = rigTrack('valley-ridge-mx');
function expectEndpoint(bike: DirtBikeVehicle, publish = false) {
  // Incoming compression belongs to the force solve. Fork/shock belong to
  // final-pose publication, which runs after the contact-time terrain resample.
  if (publish) state(bike).updateSuspensionAndTyres(1 / 120, publicationTrack);
  const raw = rawCompression(bike), travel = [bike.bikeSpec.forkTravel, bike.bikeSpec.shockTravel],
    reported = [bike.fork, bike.shock];
  for (let i = 0; i < 2; i++) {
    expect(reported[i]).toBeCloseTo(Math.max(0, Math.min(travel[i], raw[i])), 12);
    expect(reported[i]).toBeGreaterThanOrEqual(0);
    expect(reported[i]).toBeLessThanOrEqual(travel[i]);
    // An in-travel tyre ends exactly on its sampled support; fully extended
    // tyres may be clear, and bottomed tyres retain only real overtravel.
    if (raw[i] > 0 && raw[i] < travel[i]) expect(reported[i] - raw[i]).toBeCloseTo(0, 12);
  }
}

function verifyImpact(bike: DirtBikeVehicle, scene: Scene, active: readonly [boolean, boolean], dt: number) {
  const initialY = bike.cgY, before = scene.velocity, contact = rows(bike, scene.pitch),
    m = bike.dynamics.mass, ip = bike.air.pitchInertia,
    iy = motocrossYawInertia(m, bike.bikeSpec.cgToFront, bike.bikeSpec.cgToRear);
  state(bike).vertical(dt);
  const after = impactVelocity(bike, scene.pitch, dt),
    total = m * (after.vertical - before.vertical),
    qf = (ip * (after.pitch - before.pitch) - contact[1].lever * total) /
      (contact[0].lever - contact[1].lever), qr = total - qf,
    q = [qf, qr];
  const closing = (v: Velocity, i: number) => scene.grade[i] * v.forward + scene.cross[i] * v.lateral -
    v.vertical - contact[i].lever * v.pitch + contact[i].yawArm * v.yaw;
  for (let i = 0; i < 2; i++) {
    expect(q[i]).toBeGreaterThanOrEqual(-1e-8);
    if (active[i]) {
      expect(closing(after, i)).toBeLessThan(1e-9);
      expect(Math.abs(q[i] * closing(after, i))).toBeLessThan(1e-7);
    } else expect(q[i]).toBeCloseTo(0, 8);
  }
  expect(m * (after.forward - before.forward)).toBeCloseTo(-scene.grade[0] * qf - scene.grade[1] * qr, 8);
  expect(m * (after.lateral - before.lateral)).toBeCloseTo(-scene.cross[0] * qf - scene.cross[1] * qr, 8);
  expect(iy * (after.yaw - before.yaw)).toBeCloseTo(-contact[0].yawArm * qf - contact[1].yawArm * qr, 8);
  expect(energy(bike, after)).toBeLessThanOrEqual(energy(bike, before) + 1e-7);
  expect(energy(bike, after) - energy(bike, before)).toBeCloseTo(
    -0.5 * (qf * closing(before, 0) + qr * closing(before, 1)), 7,
  );
  // The 15 mm deep-contact position correction and a single force step
  // account for the full final height. No impulse is applied again as force.
  expect(bike.cgY).toBeCloseTo(initialY + Math.max(...scene.depth) - 0.015 + bike.vy * dt, 12);
  expectEndpoint(bike, true);
  return { after, q };
}

/** A reflected fixture swaps the physical axles, including their springs and
 * free lengths. A symmetric impact law cannot depend on the front-first
 * storage/processing order, even with unequal axles and terrain normals. */
function reflectedDefinition(definition: VehicleDefinition): VehicleDefinition {
  const b = definition.bike!, a = b.offroad!;
  return { ...definition, bike: { ...b,
    cgToFront: b.cgToRear, cgToRear: b.cgToFront,
    forkTravel: b.shockTravel, shockTravel: b.forkTravel,
    forkRate: b.shockRate, shockRate: b.forkRate,
    offroad: { ...a, forkDamping: a.shockDamping, shockDamping: a.forkDamping },
  } };
}

describe('player MX contact integration', () => {
  it.each([MX_250, MX_450])('$id solves uphill stops together with the stored forward-speed bound', (definition) => {
    const scene: Scene = { ...impact, grade: [0.5, 0.5],
      velocity: { forward: 0.1, lateral: 0, vertical: -10, pitch: 0, yaw: 0 } },
      bike = contactBike(definition, scene);
    state(bike).vertical(0);
    // A normal-only projection yields (-3.92, -1.96) m/s, and clamping
    // only its first component leaves 1.96 m/s of penetration velocity.
    // The simultaneous unilateral solution is a supported zero-velocity state.
    expect(bike.dynamics.speed).toBeCloseTo(0, 12);
    expect(bike.vy).toBeCloseTo(0, 12);
    expect(bike.pitchRate).toBeCloseTo(0, 12);
    const contact = rows(bike, 0);
    for (const row of contact)
      expect(0.5 * bike.dynamics.speed - bike.vy - row.lever * bike.pitchRate)
        .toBeLessThan(1e-11);
  });

  it.each([MX_250, MX_450])('$id enforces the bound in the final yawed landing frame', (definition) => {
    for (const yaw of [-0.55, 0.55]) {
      const scene: Scene = { ...impact, grade: [0.5, 0.5], cross: [0.2, 0.2],
        velocity: { forward: 0.1, lateral: -Math.sign(yaw) * 4, vertical: -10, pitch: 0, yaw: 0 } },
        bike = contactBike(definition, scene),
        before = energy(bike, scene.velocity);
      bike.airborne = true;
      bike.airYaw = yaw;
      state(bike).flightSpeed = scene.velocity.forward;
      state(bike).vertical(0);
      expect(bike.airborne).toBe(false);
      expect(bike.dynamics.heading).toBe(yaw);
      expect(bike.dynamics.speed).toBeGreaterThanOrEqual(0);
      const forward = bike.dynamics.speed * Math.cos(bike.groundPitch),
        lateral = bike.slide, grade = 0.5 * Math.cos(yaw) + 0.2 * Math.sin(yaw),
        cross = 0.2 * Math.cos(yaw) - 0.5 * Math.sin(yaw),
        yawRate = state(bike).mxYawRate;
      for (const reach of [bike.bikeSpec.cgToFront, -bike.bikeSpec.cgToRear]) {
        const closing = grade * forward + cross * lateral - bike.vy - reach * bike.pitchRate +
          cross * reach * yawRate;
        expect(closing).toBeLessThan(1e-10);
      }
      expect(energy(bike, { forward, lateral, vertical: bike.vy,
        pitch: bike.pitchRate, yaw: yawRate })).toBeLessThanOrEqual(before + 1e-8);
    }
  });

  it.each([MX_250, MX_450])('$id resolves both bottomed stops without adding impact energy', (definition) => {
    for (const pitch of [-0.6, 0, 0.6])
      for (const grade of [[0, 0], [-0.35, 0.4], [0.45, -0.2]] as const)
        for (const cross of [[0, 0], [-0.3, 0.35], [0.2, 0.2]] as const)
          for (const dt of [1 / 120, 1 / 240, 1 / 480]) {
            const scene = { ...impact, pitch, grade, cross }, bike = contactBike(definition, scene);
            verifyImpact(bike, scene, [true, true], dt);
            expect(state(bike).projectedContact).toBe(true);
          }
  });

  it.each([MX_250, MX_450])('$id includes an initially separating but bottomed front stop', (definition) => {
    const scene: Scene = { ...impact, grade: [-0.5, 0.5],
      velocity: { ...impact.velocity, forward: 2, vertical: -1.25, pitch: 0.4 } },
      bike = contactBike(definition, scene), contact = rows(bike, 0);
    expect(scene.velocity.vertical + contact[0].lever * scene.velocity.pitch -
      scene.grade[0] * scene.velocity.forward).toBeGreaterThan(0);
    const { q } = verifyImpact(bike, scene, [true, true], 1 / 240);
    expect(q[0]).toBeGreaterThan(0);
    expect(q[1]).toBeGreaterThan(0);
  });

  it.each([MX_250, MX_450])('$id handles either single bottomed axle and releases a projected stroke', (definition) => {
    for (const front of [true, false]) {
      const scene: Scene = { ...impact, pitch: 0.35, grade: [-0.3, 0.35], cross: [0.2, -0.3],
        depth: front ? [0.4, -0.2] : [-0.2, 0.4],
        velocity: { ...impact.velocity, vertical: -12 } }, bike = contactBike(definition, scene);
      const { q } = verifyImpact(bike, scene, [front, !front], 1e-8);
      expect(q[front ? 0 : 1]).toBeGreaterThan(0);
      expect(Math.max(rawCompression(bike)[0] - bike.bikeSpec.forkTravel,
        rawCompression(bike)[1] - bike.bikeSpec.shockTravel)).toBeLessThan(0.015001);
      bike.cgY += 0.05;
      bike.vy = bike.pitchRate = 0;
      state(bike).vertical(1e-8);
      expect(state(bike).projectedContact).toBe(false);
      expectEndpoint(bike, true);
    }
  });

  it.each([MX_250, MX_450])('$id is invariant to exchanging physical front and rear contacts', (definition) => {
    const scene: Scene = { ...impact, pitch: 0.24, depth: [0.4, 0.395],
      grade: [-0.25, 0.4], cross: [-0.35, 0.2] },
      reflected: Scene = { ...scene, pitch: -scene.pitch,
        depth: [scene.depth[1], scene.depth[0]], grade: [scene.grade[1], scene.grade[0]],
        cross: [scene.cross[1], scene.cross[0]],
        velocity: { ...scene.velocity, pitch: -scene.velocity.pitch, yaw: -scene.velocity.yaw } },
      a = verifyImpact(contactBike(definition, scene), scene, [true, true], 1 / 240),
      b = verifyImpact(contactBike(reflectedDefinition(definition), reflected), reflected, [true, true], 1 / 240);
    expect(a.q[0]).toBeCloseTo(b.q[1], 9);
    expect(a.q[1]).toBeCloseTo(b.q[0], 9);
    for (const key of ['forward', 'lateral', 'vertical'] as const)
      expect(a.after[key]).toBeCloseTo(b.after[key], 11);
    expect(a.after.pitch).toBeCloseTo(-b.after.pitch, 11);
    expect(a.after.yaw).toBeCloseTo(-b.after.yaw, 11);
  });

  it.each([MX_250, MX_450])('$id reports the final pose at extension, compression and the actual pitch bounds', (definition) => {
    for (const pitch of [-1.199, 0, 1.199])
      for (const vertical of [-5, 5]) {
        const scene: Scene = { ...impact, pitch, depth: [-0.16, -0.13],
          velocity: { ...impact.velocity, vertical, pitch: pitch === 0 ? 1 : Math.sign(pitch) * 12 } },
          bike = contactBike(definition, scene);
        state(bike).vertical(1 / 120);
        expect(bike.pitch).toBeGreaterThanOrEqual(-1.2);
        expect(bike.pitch).toBeLessThanOrEqual(1.2);
        expectEndpoint(bike, true);
        if (pitch !== 0) expect(Math.abs(bike.pitch)).toBe(1.2);
      }
  });

  it.each([MX_250, MX_450, SM_450])('$id retains the scalar stop response outside motocross courses', (definition) => {
    const bike = contactBike(definition, impact), contact = rows(bike, 0),
      m = bike.dynamics.mass, ip = bike.air.pitchInertia, before = impact.velocity,
      qf = hardStopImpulse(before.forward, before.vertical, before.pitch, 0, contact[0].lever, m, ip),
      vy = before.vertical + qf / m, rate = before.pitch + contact[0].lever * qf / ip,
      qr = hardStopImpulse(before.forward, vy, rate, 0, contact[1].lever, m, ip);
    state(bike).playerMotocross = false;
    state(bike).motocrossCourse = false;
    state(bike).vertical(0);
    // Explicitly preserve the existing scalar helper composition for the
    // surveyed legacy path, including its unequal axle residuals.
    expect(bike.vy).toBeCloseTo(vy + qr / m, 12);
    expect(bike.pitchRate).toBeCloseTo(rate + contact[1].lever * qr / ip, 12);
    expect(Math.abs(bike.vy + contact[0].lever * bike.pitchRate)).toBeGreaterThan(0.01);
    expect(state(bike).mxYawRate).toBe(impact.velocity.yaw);
  });
});

describe('player MX suspension endpoint publication', () => {
  it.each(['mx250', 'mx450'])('%s publishes mechanical travel without the extra 20 ms phase lag', (id) => {
    for (const dt of [1 / 120, 1 / 240, 1 / 480]) {
      const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit: 'valley-ridge-mx',
        ruleset: 'motocross-moto', mode: 'practice', opponents: 0, vehicles: [id] }),
        bike = sim.cars[0] as DirtBikeVehicle, o = carBase(0);
      bike.cgY += 0.12;
      bike.vy = -1;
      bike.pitchRate = 0.4;
      let compressionChange = 0, previous = bike.fork;
      for (let tick = 0; tick < 180; tick++) {
        sim.step(dt);
        expect(bike.riding).toBe(true);
        expectEndpoint(bike);
        for (const [i, stroke] of [[0, bike.fork], [2, bike.shock]]) {
          expect(bike.tires[i].compression).toBe(stroke);
          expect(bike.tires[i].load).toBe(i === 0 ? bike.forceFront : bike.forceRear);
        }
        compressionChange = Math.max(compressionChange, Math.abs(bike.fork - previous));
        previous = bike.fork;
        if (tick % 8 === 0) {
          const frame = sim.makeFrame();
          expect(frame[o + BIKE_BASE + B.FORK]).toBe(Math.fround(bike.fork));
          expect(frame[o + BIKE_BASE + B.SHOCK]).toBe(Math.fround(bike.shock));
        }
      }
      expect(compressionChange).toBeGreaterThan(0.005);
    }
  });

  it('keeps continuous bounded snapshot interpolation between the corrected physical endpoints', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit: 'valley-ridge-mx',
      ruleset: 'motocross-moto', mode: 'practice', opponents: 0, vehicles: ['mx450'] }),
      bike = sim.cars[0] as DirtBikeVehicle, o = carBase(0), display = new PresentedFrame();
    bike.cgY += 0.1;
    bike.vy = -1;
    const frames: Float32Array[] = [];
    for (let tick = 0; tick < 24; tick++) {
      sim.step(1 / 240);
      if (tick % 8 === 7) frames.push(sim.makeFrame());
    }
    const [a, b] = frames, original = [a.slice(), b.slice()];
    for (const [field, wheel] of [[B.FORK, 0], [B.SHOCK, 2]] as const) {
      const p = o + BIKE_BASE + field, hub = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
      expect(sampleBikeField(a, b, o, field, 0)).toBe(a[p]);
      expect(sampleBikeField(a, b, o, field, 1)).toBe(b[p]);
      let previous = a[p];
      for (let sample = 1; sample <= 100; sample++) {
        const alpha = sample / 100, value = sampleBikeField(a, b, o, field, alpha),
          shown = display.sample(a, b, alpha);
        expect(value).toBeGreaterThanOrEqual(Math.min(a[p], b[p]) - 1e-8);
        expect(value).toBeLessThanOrEqual(Math.max(a[p], b[p]) + 1e-8);
        expect(Math.abs(value - previous)).toBeLessThan(0.05 * Math.abs(b[p] - a[p]) + 1e-8);
        expect(shown[p]).toBe(shown[hub + W.COMPRESSION]);
        expect(shown[p] + shown[hub + W.LENGTH]).toBeCloseTo(a[p] + a[hub + W.LENGTH], 6);
        previous = value;
      }
    }
    expect([a, b]).toEqual(original);
  });
});
