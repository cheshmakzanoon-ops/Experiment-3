import { MirrorViews } from '../src/rendering/mirrors.ts';
import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag } from '../src/rendering/bike.ts';
import { GPRearSuspension } from '../src/rendering/gp-rear-chassis.ts';
import { bikeEntrantScheme } from '../src/rendering/bike-sheet.ts';
import { motorcycleWheel } from '../src/rendering/gp-forged-wheel.ts';
import { gpFrontBrakeAngle } from '../src/rendering/gp-front-brake.ts';
import { GP_GLOVE_GRIP, gpThrottleAngle } from '../src/rendering/gp-rider-contact.ts';
import {
  ROAD_SWINGARM_PIVOT,
  RoadBikeContactPose,
  RoadBikeWheelPose,
} from '../src/rendering/road-bike-pose.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { ClassicRearBrake, classicDrum } from '../src/rendering/road-bike-drum.ts';
import { installSportHeadlights, roundRoadLamp } from '../src/rendering/road-bike-optics.ts';
import { gpRaceBodywork } from '../src/rendering/gp-race-bodywork.ts';
import { roadTyreSection } from '../src/simulation/bike-tyre-profile.ts';
import { RoadBikeInstruments } from '../src/rendering/road-bike-instruments.ts';

const catalogue = [
  ['sbk1000', 'superbike'],
  ['ss600', 'supersport'],
  ['nr900', 'roadster'],
  ['cr750', 'wire'],
] as const;

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'createLinearGradient' || key === 'createRadialGradient'
          ? () => ({ addColorStop() {} })
          : key === 'measureText'
            ? () => ({ width: 8 })
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('road motorcycles in the GP selector', () => {
  it('keeps the classic rear brake rod at its assembled length as the wheel and pedal move', () => {
    const materials = new BikeMaterials(0),
      pivot = new T.Vector3(...ROAD_SWINGARM_PIVOT);
    const angle = -0.346,
      brake = new ClassicRearBrake(0.56, angle, pivot, 'high', materials);
    const frame = new T.Matrix4(),
      arm = new T.Matrix4(),
      q = new T.Quaternion();
    const x = new T.Vector3(1, 0, 0),
      scale = new T.Vector3(1, 1, 1);
    const pose = (travel: number, input: number) => {
      arm.compose(pivot, q.setFromAxisAngle(x, angle + travel), scale);
      brake.update(frame, arm, input);
      expect(brake.front.distanceTo(brake.back)).toBeCloseTo(brake.rodLength, 9);
      const cam = brake.lever.localToWorld(new T.Vector3(-0.04, -0.064, 0));
      expect(cam.distanceTo(brake.back)).toBeLessThan(1e-8);
      return brake.lever.rotation.x;
    };
    const mesh = classicDrum('mid');
    try {
      mesh.computeBoundingBox();
      expect(mesh.boundingBox!.max.y).toBeCloseTo(0.095, 4);
      const neutral = pose(0, 0),
        pressed = pose(0, 1);
      expect(Math.abs(pressed - neutral)).toBeGreaterThan(0.035);
      for (const t of [-0.12, -0.035, 0, 0.07, 0.18])
        for (const input of [1, 0.3, 0]) pose(t, input);
      expect(pose(0, 1)).toBe(pressed);
    } finally {
      mesh.dispose();
      brake.root.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      materials.dispose();
    }
  });
  it.each(['high', 'mid', 'far'] as const)(
    'seats the %s blade optics on the moulding and puts the reflector behind forward-facing glass',
    (detail) => {
      const m = new BikeMaterials(0),
        lamp = roundRoadLamp(m, detail, true),
        body = gpRaceBodywork(m, detail, 'sport', 0);
      const blades = new T.Group();
      try {
        installSportHeadlights(blades, body.body, m, detail);
        const strips = blades.children.filter(
          (o) => o instanceof T.Mesh && o.material === m.roadLampEmitter(),
        ) as T.Mesh[];
        expect(strips).toHaveLength(2);
        for (const strip of strips) {
          const p = strip.geometry.getAttribute('position');
          expect(p.count).toBeGreaterThanOrEqual(8);
          for (let i = 0; i < p.count; i++) {
            const ray = new T.Raycaster(
              new T.Vector3(p.getX(i), p.getY(i), 1.4),
              new T.Vector3(0, 0, -1),
            );
            const hit = ray.intersectObject(body.body, false)[0];
            expect(hit).toBeDefined();
            expect(p.getZ(i) - hit.point.z).toBeGreaterThan(0);
            expect(p.getZ(i) - hit.point.z).toBeLessThan(0.016);
          }
        }
        lamp.updateMatrixWorld(true);
        const hits = new T.Raycaster(
          new T.Vector3(0.037, 0, 0.2),
          new T.Vector3(0, 0, -1),
        ).intersectObject(lamp, true);
        expect((hits[0].object as T.Mesh).material).toBe(m.screenLight);
        expect(hits.some((h) => (h.object as T.Mesh).material === m.steel)).toBe(true);
      } finally {
        for (const root of [body.root, blades, lamp])
          root.traverse((o) => {
            if (o instanceof T.Mesh) o.geometry.dispose();
          });
        m.dispose();
      }
    },
  );
  it.each(['road-mono', 'road-twin'] as const)(
    '%s shock eyes follow their separate chassis and arm mounts',
    (layout) => {
      const m = new BikeMaterials(0);
      const shock = new GPRearSuspension(0.54, 'high', m, layout);
      const xs = layout === 'road-twin' ? [-0.153, 0.153] : [0];
      const sprung = new T.Matrix4().makeRotationX(-0.065).setPosition(0, -0.028, 0.012);
      const lengths: number[] = [];
      try {
        for (const angle of [-0.35, -0.12, 0.08, -0.35]) {
          const arm = new T.Matrix4().makeRotationX(angle).setPosition(0, -0.13, -0.2);
          shock.update(sprung, arm);
          for (const x of xs) {
            const upper = shock.upperEye.localToWorld(new T.Vector3(x, 0, 0));
            const lower = shock.lowerEye.localToWorld(new T.Vector3(x, 0, 0));
            const a = shock.upperMount.clone(),
              b = shock.lowerMount.clone();
            a.x = b.x = x;
            expect(upper.distanceTo(a.applyMatrix4(sprung))).toBeLessThan(1e-9);
            expect(lower.distanceTo(b.applyMatrix4(arm))).toBeLessThan(1e-9);
            if (x === xs[0]) lengths.push(upper.distanceTo(lower));
          }
        }
        expect(lengths[0]).toBe(lengths.at(-1));
        expect(Math.abs(lengths[0] - lengths[2])).toBeGreaterThan(0.015);
      } finally {
        shock.root.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
        m.dispose();
      }
    },
  );

  it('keeps printed dial artwork alive while a second instrument cluster is using it', () => {
    const trim = new T.MeshStandardMaterial(),
      a = new RoadBikeInstruments(true, 10000, trim, trim),
      b = new RoadBikeInstruments(true, 10000, trim, trim);
    const faces = (clocks: RoadBikeInstruments) => {
      const found: T.MeshStandardMaterial[] = [];
      clocks.root.traverse((o) => {
        if (o instanceof T.Mesh && o.material.name === 'Printed road rpm dial')
          found.push(o.material);
      });
      return found;
    };
    try {
      const [face] = faces(a);
      expect(face).toBeDefined();
      expect(faces(b)[0]).toBe(face);
      const onDispose = vi.fn();
      face.map!.addEventListener('dispose', onDispose);
      a.dispose();
      a.dispose();
      expect(onDispose).not.toHaveBeenCalled();
      b.dispose();
      expect(onDispose).toHaveBeenCalledTimes(1);
    } finally {
      for (const clocks of [a, b]) {
        clocks.dispose();
        clocks.root.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
      }
      trim.dispose();
    }
  });

  it.each(['high', 'mid', 'far'] as const)(
    '%s preserves a hollow axle and four distinct pierced wheel silhouettes',
    (detail) => {
      const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
      const patterns = new Set<string>();
      try {
        for (const [, design] of catalogue) {
          const geometry = motorcycleWheel(0.2159, 0.1, detail, design);
          try {
            const wheel = new T.Mesh(geometry, material),
              ray = new T.Raycaster();
            const hit = (radius: number, angle: number) => {
              ray.ray.origin.set(0.5, radius * Math.cos(angle), radius * Math.sin(angle));
              ray.ray.direction.set(-1, 0, 0);
              return ray.intersectObject(wheel).length > 0;
            };
            expect(hit(0, 0)).toBe(false);
            const samples = Array.from({ length: 240 }, (_, i) =>
              hit(0.15, (2 * Math.PI * (i + 0.2)) / 240),
            );
            expect(samples.filter(Boolean).length, design).toBeGreaterThan(8);
            expect(samples.filter(Boolean).length, design).toBeLessThan(180);
            for (let angle = 0; angle < 12; angle++)
              expect(hit(0.205, (angle / 12) * Math.PI * 2)).toBe(true);
            patterns.add(samples.map(Number).join(''));
            expect(geometry.groups).toHaveLength(0);
          } finally {
            geometry.dispose();
          }
        }
        expect(patterns.size).toBe(catalogue.length);
      } finally {
        material.dispose();
      }
    },
  );

  it.each(['nr900', 'ss600'] as const)(
    '%s gives the onboard feeds real left and right glass on its own mounting frame',
    (id) => {
      const def = VEHICLES[id],
        materials = new BikeMaterials(0),
        views = new MirrorViews();
      const model = new BikeModel(def, 0, 'high', materials, true);
      try {
        expect(model.rearViews).toHaveLength(2);
        const pose = {
          ...staticSag(def),
          steer: 0,
          frontRotation: 0,
          rearRotation: 0,
          chassisLean: 0,
          riderOffset: 0,
          tuck: 0.4,
          brake: 0,
          rearBrake: 0,
          discTemp: 180,
          compoundColour: 0xffffff,
          riding: true,
          speed: 24,
        };
        const coordinates = () =>
          model.rearViews.map((face) => face.getWorldPosition(new T.Vector3()));
        model.pose(pose);
        const straight = coordinates();
        expect(straight[0].x).toBeLessThan(-0.3);
        expect(straight[1].x).toBeGreaterThan(0.3);
        expect(straight[0].y).toBeCloseTo(straight[1].y, 6);
        for (const face of model.rearViews) {
          expect(face.geometry.getAttribute('uv').count).toBeGreaterThan(20);
          expect(face.visible).toBe(false);
        }
        model.pose({ ...pose, steer: 0.26 });
        const turned = coordinates();
        for (let i = 0; i < 2; i++) {
          const difference = turned[i].distanceTo(straight[i]);
          if (id === 'nr900') expect(difference).toBeGreaterThan(0.05);
          else expect(difference).toBeLessThan(1e-7);
        }
        const original = model.rearViews[0].material;
        views.bind(model.rearViews);
        views.orient(model.root);
        for (let i = 0; i < 2; i++) {
          const camera = views.cameras[i],
            direction = camera.getWorldDirection(new T.Vector3());
          expect(camera.position.distanceTo(turned[i])).toBeLessThan(1e-6);
          expect(direction.z).toBeLessThan(-0.9);
          expect(Math.sign(direction.x)).toBe(i === 0 ? -1 : 1);
        }
        views.unbind();
        expect(model.rearViews[0].material).toBe(original);
        model.pose(pose);
        expect(coordinates()).toEqual(straight);
      } finally {
        views.dispose();
        model.dispose();
        materials.dispose();
      }
    },
  );
  it.each(catalogue)(
    '%s restores its lever and throttle independently and preserves its rear arm length',
    (id) => {
      const def = VEHICLES[id],
        b = def.bike!,
        scheme = bikeEntrantScheme(id, 0);
      const materials = new BikeMaterials(scheme),
        model = new BikeModel(def, scheme, 'high', materials, true);
      const pose = {
        ...staticSag(def),
        steer: 0.14,
        frontRotation: 0,
        rearRotation: 0,
        chassisLean: 0.24,
        riderOffset: 0.05,
        tuck: 0.4,
        brake: 0,
        rearBrake: 0,
        discTemp: 220,
        compoundColour: 0xffffff,
        riding: true,
        speed: 30,
      };
      try {
        const section = roadTyreSection(def.classId),
          widths = new Set<number>();
        model.root.traverse((object) => {
          if (!(object instanceof T.Mesh)) return;
          const bind = object.geometry.getAttribute('gpTyreBind');
          if (bind) widths.add(Number(bind.getW(0).toFixed(4)));
        });
        expect([...widths].sort()).toEqual([section.frontHalfWidth, section.rearHalfWidth]);
        const lever = model.root.getObjectByName('Road front-brake lever pivot')!,
          sleeve = model.root.getObjectByName('Road right throttle sleeve')!;
        for (const [brake, throttle] of [
          [0, 0],
          [1, 0],
          [0.3, 0.75],
          [0.3, 0.75],
          [0, 0],
          [1, 0],
        ]) {
          model.pose({ ...pose, brake, throttle, rearBrake: 1 });
          expect(lever.rotation.y).toBeCloseTo(gpFrontBrakeAngle(brake), 12);
          expect(sleeve.rotation.y).toBeCloseTo(-gpThrottleAngle(throttle), 12);
          model.root.updateMatrixWorld(true);
          const hand = model.root.getObjectByName('Road right hand')!;
          expect(
            hand
              .localToWorld(new T.Vector3(...GP_GLOVE_GRIP))
              .distanceTo(sleeve.getWorldPosition(new T.Vector3())),
          ).toBeLessThan(0.001);
          const fingers = model.root.getObjectByName(
            'GP continuous brake-finger leather',
          ) as T.SkinnedMesh;
          if (brake > 0)
            for (const finger of [0, 1]) {
              const tip = fingers.skeleton.bones[finger * 5 + 4].localToWorld(
                new T.Vector3(0, 0, finger ? 0.019 : 0.018),
              );
              const target = model.rider.root.localToWorld(
                model.rider.brakeFingerTargets![finger].clone(),
              );
              expect(tip.distanceTo(target)).toBeLessThan(0.001);
            }
        }
        if (id === 'nr900' || id === 'cr750') {
          const tach = model.root.getObjectByName('Road tachometer needle')!,
            speedometer = model.root.getObjectByName('Road speedometer needle')!,
            instruments = model.root.getObjectByName('Steering-mounted road instruments')!;
          for (const [rpm, speed] of [
            [0, 0],
            [def.spec.limiterRPM / 2, 120 / 3.6],
            [def.spec.limiterRPM * 1.2, 240 / 3.6],
            [0, 0],
          ]) {
            model.pose({ ...pose, rpm, speed });
            expect(tach.rotation.z).toBeCloseTo(
              -T.MathUtils.degToRad(135 + 270 * Math.min(1, rpm / def.spec.limiterRPM)),
              10,
            );
            expect(speedometer.rotation.z).toBeCloseTo(
              -T.MathUtils.degToRad(135 + (270 * speed * 3.6) / 240),
              10,
            );
          }
          const centre = model.photoAnchor(2, new T.Vector3());
          expect(
            centre.distanceTo(instruments.localToWorld(new T.Vector3(0, 0, 0.005))),
          ).toBeLessThan(1e-6);
        }
        const road = new RoadBikeContactPose(),
          wheels = new RoadBikeWheelPose(),
          pivot = new T.Vector3(...ROAD_SWINGARM_PIVOT);
        const length = new T.Vector3(0, b.rearWheelRadius - b.cgHeight, -b.cgToRear).distanceTo(
          pivot,
        );
        const attitude = new T.Quaternion().setFromEuler(new T.Euler(0.08, 0.09, -0.19));
        road.valid = true;
        road.normals.forEach((normal) => normal.set(0.03, 1, -0.04).normalize());
        for (const height of [-0.045, 0, 0.065, -0.045]) {
          const position = new T.Vector3(0, b.cgHeight + height, 0);
          wheels.solve(def, pose.steer, position, attitude, road);
          expect(Math.hypot(wheels.rearY - pivot.y, wheels.rearZ - pivot.z)).toBeCloseTo(
            length,
            10,
          );
          expect(road.normals[1].dot(wheels.patches[1])).toBeCloseTo(0, 9);
        }
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );
});
