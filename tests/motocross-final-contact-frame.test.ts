import { afterEach, describe, expect, it, vi } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { circuitDefinition, type CircuitId } from '../src/simulation/circuits.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { motocrossYawInertia } from '../src/simulation/offroad/mx-ground-physics.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import type { SurfaceSample } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

type Boundary = { front: boolean; rear: boolean; time: number };
type Internals = {
  vertical(dt: number, boundary?: Boundary): void;
  firstFlightContact(...args: unknown[]): boolean;
  boundFinalContactForward(forward: number): number;
  flightSpeed: number;
  mxYawRate: number;
  projectedContact: boolean;
};
const internal = (bike: DirtBikeVehicle) => bike as unknown as Internals;

/** A coherent analytic test plane; authored terrain and normals are untouched. */
class Plane extends DynamicsTrack {
  override readonly circuit;
  constructor(readonly gx: number, readonly gz: number, venue: CircuitId = 'valley-ridge-mx') {
    super();
    this.circuit = circuitDefinition(venue);
  }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.height = this.gx * x + this.gz * z;
    out.normal.set(-this.gx, 1, -this.gz).normalize();
    return out;
  }
}

function motion(bike: DirtBikeVehicle) {
  const s = internal(bike), heading = bike.dynamics.heading,
    forward = bike.airborne ? s.flightSpeed : bike.dynamics.speed * Math.cos(bike.groundPitch);
  return {
    forward, lateral: bike.slide, heading,
    x: Math.sin(heading) * forward + Math.cos(heading) * bike.slide,
    z: Math.cos(heading) * forward - Math.sin(heading) * bike.slide,
    vertical: bike.vy, pitch: bike.pitchRate,
    yaw: bike.airborne ? bike.airYawRate : s.mxYawRate,
  };
}
type Motion = ReturnType<typeof motion>;

function energy(bike: DirtBikeVehicle, v: Motion, m = bike.dynamics.mass) {
  const b = bike.bikeSpec;
  return 0.5 * (m * (v.x ** 2 + v.z ** 2 + v.vertical ** 2) +
    bike.air.pitchInertia * v.pitch ** 2 + motocrossYawInertia(m, b.cgToFront, b.cgToRear) * v.yaw ** 2);
}

/** Differentiate the actual final tyre-height geometry in world coordinates. */
function contacts(bike: DirtBikeVehicle, track: Plane) {
  const b = bike.bikeSpec, sag = factoryBikeSag(bike.definition), h = bike.dynamics.heading;
  return [true, false].map(front => {
    const arm = front ? b.cgToFront : -b.cgToRear,
      height = b.cgHeight + (front ? sag.fork : sag.shock),
      travel = front ? b.forkTravel : b.shockTravel,
      free = (pitch: number) => arm * Math.sin(pitch) - height * Math.cos(pitch),
      epsilon = 1e-6,
      lever = (free(bike.pitch + epsilon) - free(bike.pitch - epsilon)) / (2 * epsilon),
      yaw = arm * (track.gx * Math.cos(h) - track.gz * Math.sin(h)),
      compression = bike.contacts[front ? 0 : 2].height - bike.cgY - free(bike.pitch);
    return { compression, travel,
      closing: (v: Motion) => track.gx * v.x + track.gz * v.z -
        v.vertical - lever * v.pitch + yaw * v.yaw };
  });
}

type Scene = { grade: number; cross: number; yaw: number; yawRate: number;
  speed: number; slide: number; vy: number; pitchRate: number };
const collisions: { definition: VehicleDefinition; scene: Scene }[] = [
  { definition: MX_250, scene: { grade: 0.7023695793701336, cross: -0.4213026948273182,
    yaw: -0.27479485091753303, yawRate: -5.725301583297551, speed: 1.5358128864318132,
    slide: 4.169238596223295, vy: -8.638295214623213, pitchRate: -0.6635008177254349 } },
  { definition: MX_450, scene: { grade: 0.6027468047570437, cross: 0.5808715983759611,
    yaw: 0.20609767485875635, yawRate: 5.099860327318311, speed: 0.9740241975523531,
    slide: -9.00433223694563, vy: -9.44186301343143, pitchRate: -1.154634099919349 } },
];

function fixture(definition: VehicleDefinition, scene: Scene, heading: number,
  { dt = 1 / 240, depth = 0.16, frontDepth = -0.05, ai = false,
    venue = 'valley-ridge-mx' as CircuitId, observe = true } = {}) {
  const track = new Plane(scene.grade * Math.sin(heading) + scene.cross * Math.cos(heading),
      scene.grade * Math.cos(heading) - scene.cross * Math.sin(heading), venue),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition),
    b = definition.bike!, sag = factoryBikeSag(definition), s = internal(bike);
  bike.placeFree(track, 0, 0, heading, 0);
  if (ai) bike.aiControlled(1e6);
  bike.step(dt, track);
  bike.airborne = true;
  bike.airTime = 0.3;
  bike.airYaw = scene.yaw;
  bike.airYawRate = scene.yawRate;
  s.flightSpeed = bike.dynamics.speed = scene.speed;
  bike.slide = scene.slide;
  bike.vy = scene.vy;
  bike.pitchRate = scene.pitchRate;
  const chassis = heading + scene.yaw, HF = b.cgHeight + sag.fork, HR = b.cgHeight + sag.shock,
    front = track.sample(bike.dynamics.x + Math.sin(chassis) * b.cgToFront,
      bike.dynamics.z + Math.cos(chassis) * b.cgToFront, bike.contacts[0]).height,
    rear = track.sample(bike.dynamics.x - Math.sin(chassis) * b.cgToRear,
      bike.dynamics.z - Math.cos(chassis) * b.cgToRear, bike.contacts[2]).height,
    cF = b.forkTravel + frontDepth, cR = b.shockTravel + depth,
    length = b.cgToFront + b.cgToRear;
  // Prescribed initial conditions represent a rear-first terrain collision.
  // All forces, stop activation and partial-step evolution are production code.
  bike.pitch = Math.asin((front - rear - cF + cR) / Math.hypot(length, HF - HR)) + Math.atan2(HF - HR, length);
  bike.cgY = rear + b.cgToRear * Math.sin(bike.pitch) + HR * Math.cos(bike.pitch) - cR;
  const supported: { dt: number; state: Motion }[] = [],
    completed: { state: Motion; contacts: ReturnType<typeof contacts>; mass: number }[] = [];
  if (observe) {
    const vertical = s.vertical.bind(bike), first = s.firstFlightContact.bind(bike);
    vi.spyOn(s, 'vertical').mockImplementation((time, boundary) => {
      vertical(time, boundary);
      if (boundary) supported.push({ dt: time, state: motion(bike) });
    });
    vi.spyOn(s, 'firstFlightContact').mockImplementation((...args) => {
      const resolved = first(...args);
      // A public update may continue with tyre forces after this event.
      // The frame conversion's own momentum/constraint boundary is here.
      if (resolved) completed.push({ state: motion(bike), contacts: contacts(bike, track), mass: bike.dynamics.mass });
      return resolved;
    });
  }
  return { bike, track, s, dt, supported, completed };
}

/** Relevant unrounded physical, control, presentation and thermal state.
 * Comparing the next updates too detects changes hidden from this endpoint. */
function state(bike: DirtBikeVehicle) {
  const s = internal(bike), d = bike.dynamics;
  return {
    clock: bike.clock, fuel: bike.fuel, gear: bike.gear, rpm: bike.rpm,
    motion: motion(bike), pose: [d.x, d.z, bike.cgY, bike.pitch],
    body: [Object.values(bike.body.position), Object.values(bike.body.velocity),
      Object.values(bike.body.orientation), Object.values(bike.body.omega)],
    support: [bike.forceFront, bike.forceRear, bike.compressionFront, bike.compressionRear,
      bike.fork, bike.shock, s.projectedContact],
    rider: [bike.riderBody, bike.riderBodyRate, bike.standing, bike.dab],
    machine: structuredClone(bike.machineMotion),
    tyres: bike.tires.map(tire => ({ ...tire })),
    status: [bike.airborne, bike.airTime, bike.riding, bike.landings, d.crashes],
    landing: bike.lastLanding && { ...bike.lastLanding },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('motocross final touchdown contact frame', () => {
  it.each(collisions)('$definition.id keeps a bottomed contact feasible when continuing yaw activates the final speed bound',
    ({ definition, scene }) => {
      for (const sign of [-1, 1]) for (const heading of [-1.4, 0, 2.2]) {
        const reflected = { ...scene, cross: sign * scene.cross, yaw: sign * scene.yaw,
          yawRate: sign * scene.yawRate, slide: sign * scene.slide },
          { bike, track, dt, supported, completed } = fixture(definition, reflected, heading);
        bike.step(dt, track);
        expect(bike.riding && !bike.airborne).toBe(true);
        expect(supported).toHaveLength(1);
        expect(completed).toHaveLength(1);
        const before = supported[0].state, after = completed[0].state,
          turn = before.yaw * supported[0].dt,
          signedForward = before.forward * Math.cos(turn) + before.lateral * Math.sin(turn),
          lateral = before.lateral * Math.cos(turn) - before.forward * Math.sin(turn),
          active = completed[0].contacts.filter(c => c.compression >= c.travel),
          clamped: Motion = { ...before, heading: after.heading, forward: 0, lateral,
            x: Math.cos(after.heading) * lateral, z: -Math.sin(after.heading) * lateral };
        expect(signedForward).toBeLessThan(0);
        expect(active).toHaveLength(1);
        // The supported solve had already separated this rear contact. The
        // former independent forward clamp alone made it close again.
        for (const contact of active) {
          expect(contact.closing(before)).toBeLessThan(0);
          // Retain a causal regression at the shorter physical interval:
          // the old bare forward clamp still violates this exact contact.
          expect(contact.closing(clamped)).toBeGreaterThan(1e-5);
          expect(contact.closing(after)).toBeLessThanOrEqual(2e-9);
        }
        expect(after.forward).toBeGreaterThanOrEqual(0);
        expect(energy(bike, after, completed[0].mass)).toBeLessThanOrEqual(energy(bike, before, completed[0].mass) + 1e-8);
      }
    });

  it.each([MX_250, MX_450])('$id leaves separated stops free of a new normal impulse at the final bound', definition => {
    for (const sign of [-1, 1]) {
      const scene = { grade: 0.55, cross: sign * 0.25, yaw: sign * 0.2,
        yawRate: sign * 1.5, speed: 0.5, slide: sign * -2, vy: -6, pitchRate: 0.3 },
        { bike, track, s, dt, supported, completed } = fixture(definition, scene, 0.7, { frontDepth: 0.16 }),
        bound = vi.spyOn(s, 'boundFinalContactForward');
      bike.step(dt, track);
      expect(supported).toHaveLength(1);
      expect(bound).toHaveBeenCalledOnce();
      expect(completed).toHaveLength(1);
      const before = supported[0].state, after = completed[0].state,
        turn = before.yaw * supported[0].dt,
        forward = before.forward * Math.cos(turn) + before.lateral * Math.sin(turn),
        lateral = before.lateral * Math.cos(turn) - before.forward * Math.sin(turn);
      expect(forward).toBeLessThan(0);
      const active = completed[0].contacts.filter(c => c.compression >= c.travel);
      expect(active.length).toBeGreaterThan(0);
      for (const contact of active) expect(contact.closing(after)).toBeLessThan(0);
      expect(after.forward).toBe(0);
      expect(after.lateral).toBe(lateral);
      expect(after.vertical).toBe(before.vertical);
      expect(after.pitch).toBe(before.pitch);
      expect(after.yaw).toBe(before.yaw);
      expect(energy(bike, before, completed[0].mass) - energy(bike, after, completed[0].mass))
        .toBeCloseTo(0.5 * completed[0].mass * forward * forward, 9);
    }
  });

  it.each([MX_250, MX_450])('$id preserves world momentum across a genuine partial touchdown and continuing yaw', definition => {
    for (const dt of [1 / 120, 1 / 240, 1 / 480])
      for (const grade of [-0.15, 0.15]) for (const sign of [-1, 1]) {
        const scene = { grade, cross: sign * 0.2, yaw: sign * 0.18,
          yawRate: sign * 1.2, speed: 8, slide: sign * 1.3, vy: -5, pitchRate: 0.1 },
          { bike, track, s, supported, completed } = fixture(definition, scene, -0.9, {
            dt, depth: -definition.bike!.shockTravel - dt,
            frontDepth: -definition.bike!.forkTravel - dt,
          }), bound = vi.spyOn(s, 'boundFinalContactForward'), startClock = bike.clock;
        bike.step(dt, track);
        expect(bike.riding && !bike.airborne).toBe(true);
        expect(supported).toHaveLength(1);
        expect(supported[0].dt).toBeGreaterThan(0);
        expect(supported[0].dt).toBeLessThan(dt);
        expect(bike.lastLanding!.time).toBeGreaterThan(startClock);
        expect(bike.lastLanding!.time).toBeLessThan(bike.clock);
        expect(completed).toHaveLength(1);
        const before = supported[0].state, after = completed[0].state;
        expect(after.heading - before.heading).toBeCloseTo(before.yaw * supported[0].dt, 12);
        expect(Math.abs(after.heading - before.heading)).toBeGreaterThan(1e-5);
        expect(bound).not.toHaveBeenCalled();
        for (const field of ['x', 'z', 'vertical', 'pitch', 'yaw'] as const)
          expect(after[field]).toBeCloseTo(before[field], 11);
        expect(energy(bike, after, completed[0].mass)).toBeCloseTo(energy(bike, before, completed[0].mass), 8);
      }
  });

  it.each(collisions)('$definition.id event observers leave subsequent physical state unchanged', ({ definition, scene }) => {
    const observed = fixture(definition, scene, 0.7),
      plain = fixture(definition, scene, 0.7, { observe: false });
    for (let tick = 0; tick < 24; tick++) {
      observed.bike.step(observed.dt, observed.track);
      plain.bike.step(plain.dt, plain.track);
      expect(state(observed.bike)).toEqual(state(plain.bike));
    }
    expect(observed.completed).toHaveLength(1);
  });

  it('keeps the player endpoint projection out of AI, supermoto and road-course dirt bikes', () => {
    const scene = { grade: 0.2, cross: 0.1, yaw: 0.2,
      yawRate: 1, speed: 8, slide: 1.2, vy: -6, pitchRate: 0.3 };
    for (const { definition, ai, venue } of [
      { definition: MX_250, ai: true, venue: 'valley-ridge-mx' as const },
      { definition: MX_450, ai: true, venue: 'arena-nord-sx' as const },
      { definition: SM_450, ai: false, venue: 'valley-ridge-mx' as const },
      { definition: MX_250, ai: false, venue: 'aurel' as const },
    ]) {
      const { bike, track, s, dt, supported } = fixture(definition, scene, 0.3, { ai, venue }),
        boundary = vi.spyOn(s, 'firstFlightContact'), bound = vi.spyOn(s, 'boundFinalContactForward');
      bike.step(dt, track);
      expect(boundary).not.toHaveBeenCalled();
      expect(bound).not.toHaveBeenCalled();
      expect(supported).toHaveLength(0);
      expect(bike.body.position.finite()).toBe(true);
      expect(bike.body.velocity.finite()).toBe(true);
    }
  });
});
