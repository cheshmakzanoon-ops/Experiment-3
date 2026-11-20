import { H } from '../src/simulation/protocol.ts';
import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BikeMaterials,
  BikeModel,
  BikeShells,
  bikeOnboardFov,
  staticSag,
} from '../src/rendering/bike.ts';
import { bikeFirstPersonView, bikeInstrumentReadout } from '../src/rendering/bike-cockpit.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { tcamFov } from '../src/rendering/cockpit-framing.ts';
import { inspectBikeCockpit } from '../e2e/fixtures/bike-cockpit-contract.ts';

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('GP cockpit real-camera contract', () => {
  it('preserves every other bike and tail camera when improving GP control visibility', () => {
    const shells = new BikeShells(),
      root = new T.Object3D(),
      eye = new T.Vector3(),
      direction = new T.Vector3();
    for (const definition of [undefined, ...Object.values(VEHICLES).filter((d) => d.bike)]) {
      const gp = definition?.classId === 'gp-bike',
        offroad = !!definition?.bike?.offroad;
      shells.onboard(root, eye, direction, false, definition);
      expect(eye.toArray()).toEqual(
        offroad ? [0, 1.05, -0.4] : gp ? [0, 0.48, 0.24] : [0, 0.435, 0.34],
      );
      const pitch = offroad ? -0.4 : -0.14;
      expect(direction.toArray()).toEqual([0, Math.sin(pitch), Math.cos(pitch)]);
      for (const speed of [0, 42, 90]) {
        expect(bikeOnboardFov(speed, definition)).toBe(
          tcamFov(speed) + (offroad ? 10 : gp ? 2 : 0),
        );
        expect(bikeOnboardFov(speed, definition, true)).toBe(tcamFov(speed));
      }
      shells.onboard(root, eye, direction, true, definition);
      expect(eye.toArray()).toEqual([0, 0.78, -0.95]);
      expect(direction.toArray()).toEqual([0, Math.sin(-0.12), Math.cos(-0.12)]);
    }
  });
  it('does not mislabel corrupt gear samples as reverse', () => {
    for (const gear of [undefined, NaN, Infinity, -Infinity])
      expect(bikeInstrumentReadout({ gear }, 16000).gear).toBe('N');
  });
  it('restores the helmet for menu, tail, broadcast and orbit views', () => {
    expect(bikeFirstPersonView('cockpit', false, false)).toBe(true);
    expect(bikeFirstPersonView('cockpit', true, false, 'cockpit')).toBe(true);
    for (const mode of ['chase', 'pod', 'trackside'])
      expect(bikeFirstPersonView(mode, false, false)).toBe(false);
    expect(bikeFirstPersonView('cockpit', true, false)).toBe(false);
    expect(bikeFirstPersonView('cockpit', false, true)).toBe(false);
    expect(bikeFirstPersonView('cockpit', false, false, 'orbit')).toBe(false);
  });
  it('switches only the followed helmet, including all LODs, and restores the rest', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 1,
      vehicles: ['gpr1', 'gpr2'],
    });
    const frame = sim.makeFrame(),
      shells = new BikeShells();
    const cars = [0, 1].map(() => ({ root: new T.Object3D() }));
    cars[1].root.position.x = 4;
    const camera = new T.PerspectiveCamera(60, 16 / 9, 0.03, 1000);
    try {
      const heads: T.Object3D[] = [];
      shells.install = (root) =>
        root.traverse((o) => {
          if (o.name === 'Rider head and helmet') heads.push(o);
        });
      shells.update(frame, frame, 1, cars, camera, 'high', 0);
      expect(heads).toHaveLength(6);
      shells.setFirstPerson(0);
      expect(heads.slice(0, 3).every((h) => !h.visible)).toBe(true);
      expect(heads.slice(3).every((h) => h.visible)).toBe(true);
      shells.setFirstPerson(1);
      expect(heads.slice(0, 3).every((h) => h.visible)).toBe(true);
      expect(heads.slice(3).every((h) => !h.visible)).toBe(true);
      shells.setFirstPerson(-1);
      expect(heads.every((h) => h.visible)).toBe(true);
      expect(frame).toEqual(sim.makeFrame());
    } finally {
      shells.disposeAll();
    }
  });
  it('tracks the drawn GP head, instruments and front axle and leaves the first camera pose intact', () => {
    const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        opponents: 1,
        vehicles: ['gpr1', 'gpr2'],
      }),
      frame = sim.makeFrame(),
      shells = new BikeShells(),
      camera = new T.PerspectiveCamera(55, 1.6, 0.03, 1000),
      cars = [0, 1].map(() => ({ root: new T.Group() }));
    try {
      cars[0].root.position.set(5, 4, -2);
      cars[0].root.rotation.set(-0.1, 0.9, 0.4);
      shells.update(frame, frame, 1, cars, camera, 'high', 0, 0);
      const bike = shells.gpPresentation(0)!;
      const sample = () => [0, 1, 2, 3, 4, 5, 6].map((s) => bike.photoAnchor(s, new T.Vector3()));
      const [whole, head, screen, hub, front, tail] = sample();
      expect(head.distanceTo(bike.rider.helmetCentre(new T.Vector3()))).toBeLessThan(1e-7);
      expect(
        hub.distanceTo(
          bike.root.getObjectByName('GP front wheel spin')!.getWorldPosition(new T.Vector3()),
        ),
      ).toBeLessThan(1e-7);
      expect(
        screen.distanceTo(
          bike.root.getObjectByName('GP instrument display')!.getWorldPosition(new T.Vector3()),
        ),
      ).toBeLessThan(1e-6);
      expect(front.distanceTo(tail)).toBeGreaterThan(1.4);
      expect(whole.distanceTo(head)).toBeGreaterThan(0.3);
      const paint = shells.gpProbePaint(0)!;
      expect(paint.length).toBe(3);
      const materials = new Set<T.Material>();
      bike.root.traverse((part) => {
        if (part instanceof T.Mesh)
          for (const m of Array.isArray(part.material) ? part.material : [part.material])
            materials.add(m);
      });
      for (const recipient of paint) expect(materials.has(recipient)).toBe(true);
      const pose = vi.spyOn(bike, 'pose');
      cars[0].root.visible = true;
      shells.update(frame, frame, 1, cars, camera, 'high', 0, undefined, 0);
      expect(pose).not.toHaveBeenCalled();
      expect(cars[0].root.visible).toBe(false);
      expect(shells.gpPresentation(0)).toBe(bike);
      expect(sample().slice(0, 6)).toEqual([whole, head, screen, hub, front, tail]);
      expect(shells.gpProbePaint(1)).not.toBe(paint);
    } finally {
      shells.disposeAll();
    }
  });
  it('pools immutable field geometry, warms missing camera detail and keeps live rigs independent', async () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 2,
      vehicles: ['gpr1', 'gpr1', 'gpr2'],
    });
    const frame = sim.makeFrame(),
      shells = new BikeShells();
    const cars = Array.from({ length: 3 }, () => ({ root: new T.Group() }));
    const camera = new T.PerspectiveCamera(60, 16 / 9, 0.03, 1000);
    const built: T.Object3D[] = [];
    shells.install = (root) => {
      if (/\((high|mid|far)\)$/.test(root.name)) built.push(root);
    };
    try {
      shells.update(frame, frame, 1, cars, camera, 'high', 0);
      expect(built).toHaveLength(9);
      const mounted = () => built.filter((root) => root.parent === shells.root).length;
      expect(mounted()).toBe(3);
      const mesh = (root: T.Object3D, name: string) => root.getObjectByName(name) as T.Mesh;
      const flanks = [built[0], built[3], built[6]].map((root) =>
        mesh(root, 'GP race shell / flank and nose'),
      );
      expect(flanks[0].geometry).toBe(flanks[1].geometry);
      expect(flanks[0].geometry).not.toBe(flanks[2].geometry);
      expect(flanks[0].material).not.toBe(flanks[1].material);
      const helmets = [built[0], built[1], built[3]].map((root) => {
        const material = mesh(root, 'GP elongated race helmet shell')?.material as
          | T.MeshStandardMaterial
          | undefined;
        if (material?.map) return material.map;
        let print: T.Texture | null = null;
        root.traverse((o) => {
          if (o instanceof T.Mesh)
            for (const m of [o.material].flat()) if (m.name === 'Rider helmet shell') print = m.map;
        });
        return print;
      });
      expect(helmets[0]).toBeTruthy();
      expect(helmets[0]).toBe(helmets[1]);
      expect(helmets[0]).not.toBe(helmets[2]);
      const fingers = [built[0], built[3]].map(
        (root) => mesh(root, 'GP continuous brake-finger leather') as T.SkinnedMesh,
      );
      expect(fingers[0].skeleton).not.toBe(fingers[1].skeleton);
      await expect(
        shells.warmFieldDetails(async () => {
          expect(mounted()).toBe(7);
          throw new Error('cancelled');
        }),
      ).rejects.toThrow('cancelled');
      expect(mounted()).toBe(3);
      cars[1].root.position.z = 160;
      shells.update(frame, frame, 1, cars, camera, 'high', 0);
      expect(shells.drawnRoot(1)).toBe(built[5]);
      expect(mounted()).toBe(3);
      const releases = vi.fn();
      flanks[0].geometry.addEventListener('dispose', releases);
      const reduced = frame.slice();
      reduced[H.CARS] = 1;
      shells.update(reduced, reduced, 1, cars, camera, 'high', 0);
      expect(releases).not.toHaveBeenCalled();
      shells.disposeAll();
      expect(releases).toHaveBeenCalledOnce();
      expect(shells.root.children).toHaveLength(0);
    } finally {
      shells.disposeAll();
    }
  });
  for (const id of ['gpr1', 'gpr2', 'sbk1000', 'ss600'])
    it(`${id}: keeps the real display facing the lens, in frame and unobstructed through riding poses`, () => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0);
      const model = new BikeModel(definition, 0, 'high', materials, true);
      const sag = staticSag(definition),
        shells = new BikeShells();
      model.rider.setFirstPerson(true);
      const camera = new T.PerspectiveCamera(60, 16 / 9, 0.03, 1000);
      const direction = new T.Vector3();
      let samples = 0;
      try {
        for (const aspect of [4 / 3, 16 / 10, 16 / 9, 21 / 9])
          for (const lean of [-1, 0, 1])
            for (const load of [-1, 0, 1]) {
              model.pose({
                fork: sag.fork + load * 0.025,
                shock: sag.shock - load * 0.008,
                steer: lean * 0.18,
                frontRotation: 1,
                rearRotation: 2,
                chassisLean: lean,
                riderOffset: lean * 0.2,
                tuck: load < 0 ? 1 : 0.5,
                brake: load > 0 ? 0.9 : 0,
                rearBrake: 0,
                discTemp: 450,
                compoundColour: 0xffffff,
                riding: true,
                speed: 45,
                gear: 4,
                rpm: 12200,
              });
              model.root.position.set(17, 0.62, -11);
              model.root.rotation.set(0.06, 0.7, -lean, 'YXZ');
              shells.onboard(model.root, camera.position, direction, false, definition);
              camera.up.set(0, 1, 0).applyQuaternion(model.root.quaternion);
              camera.lookAt(camera.position.clone().add(direction));
              camera.aspect = aspect;
              camera.fov = bikeOnboardFov(load > 0 ? 0 : 90, definition);
              camera.updateProjectionMatrix();
              const result = inspectBikeCockpit(model.root, camera);
              expect(result.facing).toBeGreaterThan(0.7);
              for (const [x, y, z] of result.corners) {
                expect(Math.abs(x)).toBeLessThan(0.95);
                expect(Math.abs(y)).toBeLessThan(0.95);
                expect(z).toBeGreaterThan(-1);
                expect(z).toBeLessThan(1);
              }
              expect(
                result.visibleSamples,
                JSON.stringify({ id, aspect, lean, load, result }),
              ).toBe(9);
              samples++;
            }
        expect(samples).toBe(36);
      } finally {
        model.dispose();
        materials.dispose();
      }
    });
});
