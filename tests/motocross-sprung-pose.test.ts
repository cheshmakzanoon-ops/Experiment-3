import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BikeMaterials,
  BikeShells,
  staticSag,
  type BikePoseValues,
} from '../src/rendering/bike.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { AUREL } from '../src/simulation/circuits.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { B, BIKE_BASE, F, carBase } from '../src/simulation/protocol.ts';
import type { SurfaceSample, Track, TrackPoint } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import { motocrossInspectionChassis } from '../e2e/fixtures/motocross-bike-review.ts';

beforeAll(() => {
  const noop = () => undefined;
  class Canvas {
    width = 256;
    height = 256;
    getContext() {
      return new Proxy(
        {
          canvas: this,
          measureText: () => ({ width: 30 }),
          createLinearGradient: () => ({ addColorStop: noop }),
          createRadialGradient: () => ({ addColorStop: noop }),
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        },
        { get: (target, key) => Reflect.get(target, key) ?? noop },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pose(fork: number, shock: number, extra: Partial<BikePoseValues> = {}): BikePoseValues {
  return {
    fork,
    shock,
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: 0,
    riderOffset: 0,
    tuck: 0,
    brake: 0,
    rearBrake: 0,
    discTemp: 0,
    compoundColour: 0xffffff,
    riding: false,
    ...extra,
  };
}

/** Independent level surface: preload and mass move the sprung equilibrium,
 * while both tyre contacts remain at world Y=0. No terrain/renderer height
 * query is used to reposition the visible hubs. */
const flatTrack = {
  circuit: AUREL,
  length: 10000,
  sample(x: number, z: number, out: SurfaceSample) {
    out.height = 0;
    out.normal.set(0, 1, 0);
    out.s = z;
    out.lateral = x;
    return out;
  },
  nearest(x: number, z: number, out: TrackPoint) {
    out.s = out.z = z;
    out.x = out.y = 0;
    return x;
  },
  boundaryAt: () => 8,
} as unknown as Track;

describe('motocross authoritative sprung-chassis presentation', () => {
  it.each(['mx250', 'mx450'])(
    '%s GPU inspection offsets prescribe supported chassis heave and pitch',
    (id) => {
      const definition = VEHICLES[id],
        b = definition.bike!,
        sag = staticSag(definition),
        materials = new BikeMaterials(0),
        model = new DirtBikeModel(definition, 0, 'mid', materials, mudUniforms()),
        front = model.root.getObjectByName('Motocross front spinning wheel')!,
        rear = model.root.getObjectByName('Motocross rear suspension hub')!,
        point = new T.Vector3();
      try {
        // Preserve the GPU drivetrain's actual asymmetric travel sample.
        // Its old nominal root drove the rear wheel 10 mm through the floor.
        const fork = sag.fork + 0.04,
          shock = sag.shock - 0.01,
          chassis = motocrossInspectionChassis(definition, fork, shock),
          sin = Math.sin(chassis.pitch),
          cos = Math.cos(chassis.pitch);
        // Independent forward gap equations: both prescribed compressions
        // must terminate at the support plane, using fixed free-wheel mounts.
        expect(
          chassis.height + b.cgToFront * sin - (b.cgHeight + sag.fork) * cos + fork,
        ).toBeCloseTo(0, 12);
        expect(
          chassis.height - b.cgToRear * sin - (b.cgHeight + sag.shock) * cos + shock,
        ).toBeCloseTo(0, 12);
        expect(chassis.pitch).toBeLessThan(-0.03);
        model.root.position.y = chassis.height;
        model.root.rotation.set(-chassis.pitch, 0, 0);
        for (const rearRotation of [0.2, 1.1, 1.1, 0.2]) {
          model.pose(pose(fork, shock, { rearRotation }));
          model.root.updateMatrixWorld(true);
          // The drawing's raked fork/circular arm differs slightly from the
          // reduced vertical contact equations at nonzero pitch; it must not
          // inherit the full 10 mm error of an incoherent synthetic root.
          expect(Math.abs(front.getWorldPosition(point).y - b.frontWheelRadius)).toBeLessThan(
            0.001,
          );
          expect(Math.abs(rear.getWorldPosition(point).y - b.rearWheelRadius)).toBeLessThan(0.001);
        }
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );

  it.each(['mx250', 'mx450', 'sm450'])(
    '%s factory presentation sag matches the production rising-rate suspension',
    (id) => {
      const definition = VEHICLES[id],
        bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition),
        track = rigTrack('valley-ridge-mx');
      bike.place(track, 120);
      const sag = staticSag(definition),
        b = definition.bike!,
        mass = definition.spec.dryMass + b.fuel,
        linearFront = (mass * 9.81 * b.cgToRear) / definition.spec.wheelbase / b.forkRate;
      expect(sag.fork).toBeCloseTo(bike.compressionFront, 12);
      expect(sag.shock).toBeCloseTo(bike.compressionRear, 12);
      expect(linearFront - sag.fork).toBeGreaterThan(0.007);
    },
  );

  it.each(['mx250', 'mx450', 'sm450'])(
    '%s keeps both hubs supported when setup preload and fuel mass change the sprung equilibrium',
    (id) => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0),
        model = new DirtBikeModel(definition, 0, 'mid', materials, mudUniforms()),
        b = definition.bike!,
        front = model.root.getObjectByName('Motocross front spinning wheel')!,
        rear = model.root.getObjectByName('Motocross rear suspension hub')!,
        point = new T.Vector3(),
        positions: number[] = [];
      try {
        for (const rearPreload of [-0.005, 0, 0.01])
          for (const fuelFraction of [1, 0.1]) {
            const bike = new DirtBikeVehicle(
              0,
              'medium',
              { ...DEFAULT_SETUP, rearPreload },
              'sport',
              definition,
            );
            bike.fuel = b.fuel * fuelFraction;
            bike.placeFree(flatTrack, 0, 0, 0, 0);
            model.root.position.set(
              bike.body.position.x,
              bike.body.position.y,
              bike.body.position.z,
            );
            const q = bike.body.orientation;
            model.root.quaternion.set(q.x, q.y, q.z, q.w);
            model.pose(pose(bike.fork, bike.shock));
            model.root.updateMatrixWorld(true);
            const context = JSON.stringify({ id, rearPreload, fuelFraction });
            expect(model.sprung.matrixWorld.equals(model.root.matrixWorld), context).toBe(true);
            // The core retains a reduced vertical spring, while the drawing
            // uses a raked fork and a circular arm. At these setup changes
            // their small-angle support difference must remain below 0.15 mm,
            // rather than inheriting the full 5–10 mm preload change.
            expect(
              Math.abs(front.getWorldPosition(point).y - b.frontWheelRadius),
              context,
            ).toBeLessThan(0.00015);
            expect(
              Math.abs(rear.getWorldPosition(point).y - b.rearWheelRadius),
              context,
            ).toBeLessThan(0.00015);
            positions.push(bike.body.position.y);
          }
        expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(0.006);
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );

  for (const id of ['mx250', 'mx450', 'sm450'])
    it.each(['high', 'mid', 'far'] as const)(
      `${id} %s moves its chassis once and leaves both hubs supported during 80 mm of heave`,
      (detail) => {
        const definition = VEHICLES[id],
          materials = new BikeMaterials(0),
          model = new DirtBikeModel(definition, 0, detail, materials, mudUniforms()),
          b = definition.bike!,
          sag = staticSag(definition),
          front = model.root.getObjectByName('Motocross front spinning wheel')!,
          rear = model.root.getObjectByName('Motocross rear suspension hub')!,
          point = new T.Vector3();
        try {
          // Independent kinematic fixture: vertical compression cancels an
          // equal recorded chassis drop. Neither contact may follow the CG.
          for (const drop of [0, 0.02, 0.08, -0.035, 0.08, 0]) {
            model.root.position.set(0, b.cgHeight - drop, 0);
            model.pose(pose(sag.fork + drop, sag.shock + drop));
            model.root.updateMatrixWorld(true);
            expect(model.sprung.matrixWorld.elements).toEqual(model.root.matrixWorld.elements);
            expect(front.getWorldPosition(point).y).toBeCloseTo(b.frontWheelRadius, 10);
            expect(rear.getWorldPosition(point).y).toBeCloseTo(b.rearWheelRadius, 10);
          }
          // Before this change the fixed rear hub was 80 mm below the road
          // and the body applied an additional ~76 mm spring-derived drop.
          model.root.position.y = b.cgHeight - 0.08;
          model.pose(pose(sag.fork + 0.08, sag.shock + 0.08));
          model.root.updateMatrixWorld(true);
          expect(model.sprung.getWorldPosition(point).y).toBeCloseTo(b.cgHeight - 0.08, 12);
        } finally {
          model.dispose();
          materials.dispose();
        }
      },
    );

  it.each(['mx250', 'mx450', 'sm450'])(
    '%s keeps a rigid swingarm, axle, rear caliper and fork travel across its complete stroke',
    (id) => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0),
        model = new DirtBikeModel(definition, 0, 'mid', materials, mudUniforms()),
        b = definition.bike!,
        sag = staticSag(definition),
        rear = model.root.getObjectByName('Motocross rear suspension hub')!,
        brake = model.root.getObjectByName('Motocross axle-mounted non-spinning rear brake')!,
        arm = model.root.getObjectByName('Motocross articulated swingarm')!,
        front = model.root.getObjectByName('Motocross front spinning wheel')!,
        point = new T.Vector3(),
        pivot = new T.Vector3(),
        end = new T.Vector3(),
        armLength = Math.hypot(b.rearWheelRadius - b.cgHeight + 0.36, b.cgToRear - 0.15);
      try {
        model.root.position.set(20, 3, -8);
        model.root.rotation.set(0.27, 0.68, -0.44);
        for (const fraction of [0, 0.2, 0.5, 0.8, 1])
          for (const steer of [-0.42, 0, 0.42]) {
            const fork = b.forkTravel * fraction,
              shock = b.shockTravel * (1 - fraction);
            model.pose(pose(fork, shock, { steer, rearRotation: 17 * fraction }));
            model.root.updateMatrixWorld(true);
            arm.getWorldPosition(pivot);
            rear.getWorldPosition(point);
            end.set(0, 0, -armLength).applyMatrix4(arm.matrixWorld);
            expect(end.distanceTo(point)).toBeLessThan(1e-10);
            expect(pivot.distanceTo(point)).toBeCloseTo(armLength, 12);
            expect(arm.scale.toArray()).toEqual([1, 1, 1]);
            expect(brake.getWorldPosition(end).distanceTo(point)).toBeLessThan(1e-10);
            front.getWorldPosition(point);
            model.root.worldToLocal(point);
            const neutralY = point.y;
            model.pose(pose(sag.fork, shock, { steer }));
            model.root.updateMatrixWorld(true);
            front.getWorldPosition(point);
            model.root.worldToLocal(point);
            expect(neutralY - point.y).toBeCloseTo(fork - sag.fork, 10);
          }
        model.pose(pose(sag.fork, sag.shock));
        model.root.updateMatrixWorld(true);
        const mountedBrake = brake.matrixWorld.toArray();
        model.pose(
          pose(sag.fork, sag.shock, { rearWheelOut: 0.4, frontWheelDrop: 0.3, rearRotation: 12 }),
        );
        model.root.updateMatrixWorld(true);
        expect(brake.matrixWorld.toArray()).toEqual(mountedBrake);
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );

  it('keeps actual landing/rebound snapshots aligned to the presented chassis through seeks and LOD changes', () => {
    const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        circuit: 'valley-ridge-mx',
        ruleset: 'motocross-moto',
        mode: 'practice',
        opponents: 0,
        vehicles: ['mx450'],
      }),
      bike = sim.cars[0] as DirtBikeVehicle,
      frames = [sim.makeFrame()],
      offset = carBase(0),
      sample = new PresentedFrame(),
      shells = new BikeShells(),
      host = { root: new T.Object3D() },
      camera = new T.PerspectiveCamera(58, 16 / 9),
      calls = vi.spyOn(DirtBikeModel.prototype, 'pose');
    // A controlled drop uses the production heave/pitch/contact solver. The
    // renderer receives only ordinary makeFrame snapshots at 30 Hz.
    bike.cgY += 0.12;
    bike.vy = -1;
    sim.setInput({ ...bike.input, brake: 1 });
    for (let i = 0; i < 180; i++) {
      sim.step(1 / 240);
      if (i % 8 === 7) frames.push(sim.makeFrame());
    }
    const original = frames.map((frame) => frame.slice());
    let oldOffset = 0;
    try {
      for (const pair of [1, 4, 8, 12, 18, 8, 4, 1])
        for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
          const a = frames[pair - 1],
            b = frames[pair],
            shown = sample.sample(a, b, alpha);
          host.root.position.fromArray(shown, offset + F.X);
          host.root.quaternion.fromArray(shown, offset + F.QX);
          camera.position.copy(host.root.position).addScalar(pair % 2 ? 500 : 0);
          shells.update(a, b, alpha, [host], camera, 'high', -1);
          const model = calls.mock.contexts.at(-1) as unknown as DirtBikeModel;
          model.root.updateMatrixWorld(true);
          expect(model.root.position.toArray()).toEqual(host.root.position.toArray());
          expect(model.root.quaternion.toArray()).toEqual(host.root.quaternion.toArray());
          expect(model.sprung.matrixWorld.elements).toEqual(model.root.matrixWorld.elements);
          const sag = staticSag(VEHICLES.mx450),
            df = (shown[offset + BIKE_BASE + B.FORK] - sag.fork) * Math.cos(0.47),
            dr = shown[offset + BIKE_BASE + B.SHOCK] - sag.shock;
          oldOffset = Math.max(
            oldOffset,
            Math.abs(dr + ((df - dr) * bike.bikeSpec.cgToRear) / bike.spec.wheelbase),
          );
        }
      // This trajectory actually exercises meaningful suspension motion;
      // an all-static record could not expose the duplicate body transform.
      expect(oldOffset).toBeGreaterThan(0.035);
      expect(frames).toEqual(original);
    } finally {
      calls.mockRestore();
      shells.disposeAll();
    }
  });
});
