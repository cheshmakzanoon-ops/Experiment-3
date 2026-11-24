import * as T from 'three';
import { motocrossForkOuter } from '../src/rendering/offroad/motocross-detail.ts';
import { MX_STANCHION_LENGTH } from '../src/rendering/offroad/mx-fork-surface.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BikeMaterials,
  BikeShells,
  staticSag,
  type BikePoseValues,
} from '../src/rendering/bike.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MxGearStroke } from '../src/simulation/offroad/mx-gear-stroke.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { MotocrossAxles } from '../src/rendering/offroad/motocross-axles.ts';
import { MxGeometryPool } from '../src/rendering/offroad/mx-geometry-pool.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { MX_GLOVE_GRIP, MX_BOOT_PEDAL, MX_BOOT_PEG, motocrossBootFrame } from '../src/rendering/offroad/motocross-rider-contact.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { H, F, R, B, O, BIKE_BASE, OFFROAD_BASE, RACE_BASE, HEADER, CAR_STRIDE, carBase, MX_FOOT, WHEEL_CONTACT_BASE, snapshotIncompatibility } from '../src/simulation/protocol.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('motocross chassis-to-rider gaze integration', () => {
  it.each(['mx250', 'mx450'])(
    '%s reduces the actual helmet pitch excursion independently of track heading and suspension stroke',
    (id) => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0),
        model = new DirtBikeModel(definition, 0, 'mid', materials, mudUniforms()),
        sag = staticSag(definition),
        helmet = model.rider.root.getObjectByName('Rider head and helmet')!,
        frame = new T.Euler(),
        orientation = new T.Quaternion(),
        direction = new T.Vector3();
      const pose: BikePoseValues = {
        fork: sag.fork,
        shock: sag.shock,
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
        riding: true,
        standing: 1,
      };
      const gaze = (pitch: number, yaw: number) => {
        // Match the production order: BikeShells assigns the chassis frame
        // before DirtBikeModel derives the rider pose from that quaternion.
        model.root.quaternion.setFromEuler(frame.set(pitch, yaw, 0, 'YXZ'));
        model.pose(pose);
        model.root.updateMatrixWorld(true);
        helmet.getWorldQuaternion(orientation);
        direction.set(0, 0, 1).applyQuaternion(orientation);
        return Math.atan2(-direction.y, Math.hypot(direction.x, direction.z));
      };
      try {
        model.root.position.set(140, 8, -230);
        const neutralGaze = gaze(0, 0);
        for (const [fork, shock] of [
          [0, 0],
          [0.08, 0.03],
        ]) {
          pose.fork = sag.fork + fork;
          pose.shock = sag.shock + shock;
          const level = gaze(0, 0);
          // Recorded stroke articulates the hubs and rider absorption while
          // the authoritative chassis frame determines the helmet's gaze.
          expect(level).toBeCloseTo(neutralGaze, 10);
          for (const pitch of [-0.5, 0.5]) {
            const excursion = gaze(pitch, 0) - level;
            // The head retains roughly 22% of the chassis pitch. Missing or
            // reversed quaternion-to-rider wiring would approach 100%/178%.
            expect(excursion / pitch).toBeGreaterThan(0.15);
            expect(excursion / pitch).toBeLessThan(0.3);
            for (const yaw of [1.1, -2.4, Math.PI]) {
              expect(gaze(0, yaw)).toBeCloseTo(level, 10);
              expect(gaze(pitch, yaw) - level).toBeCloseTo(excursion, 10);
            }
          }
        }
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );
});

it.each(['mx250', 'mx450', 'sm450'])('%s projects both displayed wheel hubs and the actual tyre envelope onto banked ground', (id) => {
  const def = VEHICLES[id], axles = MotocrossAxles.of(def), materials = new BikeMaterials(0);
  const model = new DirtBikeModel(def, 0, 'mid', materials, mudUniforms());
  const up = new T.Vector3(-0.16, 1, 0.21).normalize();
  const centre = new T.Vector3(), axis = new T.Vector3(), rendered = new T.Vector3();
  const q = new T.Quaternion(), foot = new T.Vector3(), forward = new T.Vector3();
  try {
    model.root.position.set(14, 1.3, -29);
    for (const [stroke, steer, lean] of [[0, -0.35, 0.43], [0.54, 0.28, -0.53], [1, 0, 0.2]]) {
      const fork = stroke * def.bike!.forkTravel, shock = (1 - stroke) * def.bike!.shockTravel;
      model.root.rotation.set(0.16, 0.89, lean, 'YXZ');
      model.pose({fork, shock, steer, frontRotation: 0.65, rearRotation: -0.9, chassisLean: lean,
        riderOffset: 0, tuck: 0, brake: 0, rearBrake: 0, discTemp: 0, compoundColour: 0xffffff, riding: true});
      model.root.updateMatrixWorld(true);
      for (const front of [true, false]) {
        const wheel = model.root.getObjectByName(front ? 'Motocross front spinning wheel' : 'Motocross rear suspension hub')!;
        axles.hub(front, front ? fork : shock, steer, centre, axis);
        centre.applyMatrix4(model.root.matrixWorld);
        axis.applyQuaternion(model.root.quaternion);
        expect(centre.distanceTo(wheel.getWorldPosition(rendered))).toBeLessThan(1e-8);
        rendered.set(1, 0, 0).applyQuaternion(wheel.getWorldQuaternion(q));
        expect(axis.distanceTo(rendered)).toBeLessThan(1e-8);
        axles.groundPoint(front, centre, axis, up, foot, forward);
        expect(Math.abs(forward.dot(axis)) + Math.abs(forward.dot(up))).toBeLessThan(1e-8);
        let lowest = Infinity;
        wheel.traverse((o) => {
          if (!(o instanceof T.Mesh) || !o.geometry.hasAttribute('mxTyreBind')) return;
          const pos = o.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++)
            lowest = Math.min(lowest, rendered.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).dot(up));
        });
        // The smooth contact lies within the physically modelled lug and
        // angular tessellation envelope, including a tilted and turned front.
        expect(Math.abs(lowest - foot.dot(up))).toBeLessThan(0.018);
      }
    }
  } finally { model.dispose(); materials.dispose(); }
});

describe('motocross front brake articulation', () => {
  it.each(['mx250', 'mx450'])(
    '%s pulls the real blade toward the grip, independently of the rear brake, and rewinds exactly',
    (id) => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0);
      const model = new DirtBikeModel(definition, 0, 'high', materials, mudUniforms());
      const sag = staticSag(definition);
      const pose: BikePoseValues = {
        fork: sag.fork,
        shock: sag.shock,
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
        riding: true,
        standing: 1,
      };
      try {
        const lever = model.root.getObjectByName('Motocross front brake lever pivot')!;
        const steer = model.onboardControls.parent!;
        const inspect = () => {
          model.pose(pose);
          model.root.updateMatrixWorld(true);
          const inverse = steer.matrixWorld.clone().invert();
          const point = new T.Vector3(),
            matrix = new T.Matrix4();
          const positions: number[] = [];
          let minimumRubberClearance = Infinity;
          // Inspect actual batched blade/terminal vertices after articulation,
          // including steering and suspension, rather than a duplicate marker.
          lever.traverse((object) => {
            if (!(object instanceof T.Mesh)) return;
            const p = object.geometry.getAttribute('position');
            matrix.multiplyMatrices(inverse, object.matrixWorld);
            for (let i = 0; i < p.count; i++) {
              point.fromBufferAttribute(p, i).applyMatrix4(matrix);
              positions.push(...point.toArray());
              if (point.x >= -0.42 && point.x <= -0.3)
                minimumRubberClearance = Math.min(
                  minimumRubberClearance,
                  Math.hypot(point.y - 0.29, point.z + 0.06) - 0.018,
                );
            }
          });
          const tip = new T.Vector3(-0.14, 0, 0).applyMatrix4(lever.matrix);
          return { positions, tip, minimumRubberClearance, pivot: lever.position.toArray() };
        };
        const released = inspect();
        pose.rearBrake = 1;
        expect(inspect()).toEqual(released);
        pose.rearBrake = 0;
        pose.brake = 1;
        const pulled = inspect();
        expect(pulled.tip.z).toBeLessThan(released.tip.z - 0.02);
        expect(pulled.tip.z).toBeGreaterThan(released.tip.z - 0.04);
        expect(pulled.pivot).toEqual(released.pivot);
        expect(pulled.minimumRubberClearance).toBeGreaterThan(0.001);
        expect(inspect()).toEqual(pulled);
        pose.steer = -0.35;
        pose.fork += 0.12;
        const articulated = inspect();
        expect(articulated.minimumRubberClearance).toBeGreaterThan(0.001);
        articulated.positions.forEach((value, i) =>
          expect(value).toBeCloseTo(pulled.positions[i], 8),
        );
        pose.steer = 0;
        pose.fork = sag.fork;
        pose.brake = 0;
        expect(inspect()).toEqual(released);
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );
});

it.each(['high', 'mid'] as const)(
  'the %s boot presses the rendered rear pedal and returns to its peg on a seek',
  (detail) => {
    const materials = new BikeMaterials(0),
      definition = VEHICLES.mx450;
    const model = new DirtBikeModel(definition, 0, detail, materials, mudUniforms());
    const pedal = model.root.getObjectByName('Motocross rear brake pedal')!;
    const boot = model.root.getObjectByName('Motocross right boot')!;
    const pose: BikePoseValues = {
      ...staticSag(definition),
      steer: 0.23,
      frontRotation: 0.3,
      rearRotation: 0.5,
      chassisLean: 0.3,
      riderOffset: 0,
      tuck: 0,
      brake: 0,
      rearBrake: 0,
      discTemp: 20,
      compoundColour: 0xffffff,
      riding: true,
      standing: 0.65,
    };
    const sample = (rearBrake: number) => {
      pose.rearBrake = rearBrake;
      model.pose(pose);
      model.root.updateMatrixWorld(true);
      // Shoot from shoe height through the outer rail rather than comparing two
      // assigned pivots. Both hits must be on the submitted production triangles.
      const up = new T.Vector3(0, 1, 0).transformDirection(pedal.matrixWorld);
      const toe = pedal.localToWorld(new T.Vector3(-0.035, 0, 0.128));
      const ray = new T.Raycaster(
        toe.clone().addScaledVector(up, 0.06),
        up.clone().negate(),
        0,
        0.12,
      );
      const pedalHit = ray.intersectObject(pedal, true)[0];
      expect(pedalHit).toBeDefined();
      ray.set(pedalHit.point.clone().addScaledVector(up, -0.025), up);
      const soleHit = ray.intersectObject(boot, true)[0];
      expect(soleHit).toBeDefined();
      expect(Math.abs(soleHit.distance - 0.025)).toBeLessThan(0.008);
      return { toe: pedalHit.point.clone(), boot: soleHit.point.clone() };
    };
    try {
      const neutral = sample(0);
      for (const input of [0.35, 1, 0.7]) {
        const pressed = sample(input);
        expect(neutral.toe.y - pressed.toe.y).toBeGreaterThan(input * 0.016);
        expect(neutral.boot.y - pressed.boot.y).toBeGreaterThan(input * 0.015);
      }
      pose.brake = 1;
      const frontOnly = sample(0);
      expect(frontOnly.toe).toEqual(neutral.toe);
      expect(frontOnly.boot.distanceTo(neutral.boot)).toBeLessThan(1e-9);
      pose.brake = 0;
      expect(sample(0)).toEqual(neutral);
    } finally {
      model.dispose();
      materials.dispose();
    }
  },
);

it.each(['high', 'mid'] as const)(
  'keeps both %s brake fingertips on the moving MX lever',
  (detail) => {
    const definition = VEHICLES.mx450,
      materials = new BikeMaterials(0);
    const model = new DirtBikeModel(definition, 0, detail, materials, mudUniforms());
    const fingers = model.root.getObjectByName(
      'Motocross continuous brake-finger leather',
    ) as T.SkinnedMesh;
    const sag = staticSag(definition);
    const pose: BikePoseValues = {
      fork: sag.fork,
      shock: sag.shock,
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
      riding: true,
    };
    const positions = fingers.geometry.getAttribute('position') as T.BufferAttribute,
      version = positions.version;
    try {
      for (const onboard of [false, true]) {
        model.rider.setFirstPerson(onboard, true);
        for (const steer of [-0.35, 0, 0.35])
          for (const brake of [0.12, 0.5, 1])
            for (const throttle of [0, 0.5, 1]) {
              model.pose({ ...pose, steer, brake, throttle, standing: 0.8, speed: 16 });
              model.root.updateMatrixWorld(true);
              for (let finger = 0; finger < 2; finger++) {
                const tip = fingers.skeleton.bones[finger * 5 + 4].localToWorld(
                  new T.Vector3(0, 0, finger === 0 ? 0.018 : 0.019),
                );
                const target = model.rider.root.localToWorld(
                  model.rider.brakeFingerTargets![finger].clone(),
                );
                expect(
                  tip.distanceTo(target),
                  [onboard, steer, brake, throttle, finger].join(' '),
                ).toBeLessThan(0.0025);
              }
            }
      }
      expect(positions.version).toBe(version);
    } finally {
      model.dispose();
      materials.dispose();
    }
  },
);

it.each(['high', 'mid'] as const)(
  'rolls the %s throttle and right palm together across camera cuts and seeks',
  (detail) => {
    const def = VEHICLES.mx250,
      materials = new BikeMaterials(3);
    const model = new DirtBikeModel(def, 3, detail, materials, mudUniforms());
    const sag = staticSag(def);
    const wrist = model.root.getObjectByName('Motocross right hand')!;
    const clutch = model.root.getObjectByName('Motocross left hand')!;
    const tube = model.root.getObjectByName('Motocross rotating throttle tube')!;
    function at(throttle: number) {
      model.pose({
        ...sag,
        steer: 0.27,
        frontRotation: 0,
        rearRotation: 0,
        chassisLean: 0.32,
        riderOffset: 0,
        tuck: 0,
        brake: 0,
        rearBrake: 0,
        discTemp: 28,
        compoundColour: 0xffffff,
        riding: true,
        standing: 0.65,
        speed: 17,
        throttle,
      });
      model.root.updateMatrixWorld(true);
      const palm = wrist.localToWorld(new T.Vector3(...MX_GLOVE_GRIP));
      expect(palm.distanceTo(tube.getWorldPosition(new T.Vector3()))).toBeLessThan(1e-7);
      return [wrist, tube, clutch].map((o) => o.getWorldQuaternion(new T.Quaternion()));
    }
    try {
      model.root.rotation.set(0.2, -1.1, 0.36);
      for (const onboard of [false, true, false]) {
        model.rider.setFirstPerson(onboard, true);
        const rest = at(0),
          open = at(1);
        const change = rest.map((q, i) => open[i].clone().multiply(q.clone().invert()));
        expect(rest[0].angleTo(open[0])).toBeGreaterThan(0.5);
        expect(change[0].angleTo(change[1])).toBeLessThan(1e-6);
        expect(rest[2].angleTo(open[2])).toBeLessThan(1e-6);
        const rewind = at(0);
        rewind.forEach((q, i) => expect(q.angleTo(rest[i])).toBeLessThan(1e-6));
      }
    } finally {
      model.dispose();
      materials.dispose();
    }
  },
);

it('shows heat only on the independently recorded hot steel rotor and cools on replay', () => {
  const definition = VEHICLES.mx250,
    materials = new BikeMaterials(0);
  const bike = new DirtBikeModel(definition, 0, 'mid', materials, mudUniforms());
  const sag = staticSag(definition);
  const pose: BikePoseValues = {
    ...sag,
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: 0,
    riderOffset: 0,
    tuck: 0,
    brake: 0,
    rearBrake: 0,
    discTemp: 20,
    compoundColour: 0xffffff,
    riding: true,
  };
  const surfaces = new Map<string, T.MeshPhysicalMaterial>();
  bike.root.traverse((object) => {
    if (object instanceof T.Mesh)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof T.MeshPhysicalMaterial) surfaces.set(material.name, material);
      }
  });
  const front = surfaces.get('Motocross stainless wave rotor')!,
    rear = surfaces.get('Motocross rear stainless wave rotor')!;
  try {
    for (const [frontC, rearC] of [
      [720, 39],
      [52, 805],
      [475, 510],
      [720, 39],
    ]) {
      bike.pose({ ...pose, discTemp: frontC, rearDiscTemp: rearC });
      expect(front.emissiveIntensity > 0).toBe(frontC > 530);
      expect(rear.emissiveIntensity > 0).toBe(rearC > 530);
    }
    bike.pose({ ...pose, discTemp: NaN });
    expect(front.emissiveIntensity + rear.emissiveIntensity).toBe(0);
  } finally {
    bike.dispose();
    materials.dispose();
  }
});

it('reads the visible soil for the extended MX boot only while the motorcycle is supported', () => {
  const shells = new BikeShells();
  const frame = new Float32Array(HEADER + CAR_STRIDE), o = carBase(0);
  frame[H.CARS] = 1;
  frame[o + F.QW] = 1;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('mx250');
  frame[o + OFFROAD_BASE + O.DAB] = 1;
  const reader = vi.fn((_point: T.Vector3, plane: T.Plane) => {
    plane.set(new T.Vector3(0, 1, 0), 0); return true;
  });
  shells.motocrossGround = { planeAtWorld: reader };
  const root = new T.Object3D(), camera = new T.PerspectiveCamera(55, 1.6);
  root.position.y = 0.64;
  camera.position.z = -4;
  const present = () => shells.update(frame, frame, 1, [{ root }], camera, 'high', 0);
  try {
    present();
    expect(reader).toHaveBeenCalledTimes(1);
    frame[o + OFFROAD_BASE + O.AIRBORNE] = 1;
    present();
    expect(reader).toHaveBeenCalledTimes(1);
    frame[o + OFFROAD_BASE + O.AIRBORNE] = 0;
    frame[o + OFFROAD_BASE + O.DAB] = 0;
    present();
    expect(reader).toHaveBeenCalledTimes(1);
    frame[o + OFFROAD_BASE + O.DAB] = -1;
    present();
    expect(reader).toHaveBeenCalledTimes(2);
  } finally { shells.disposeAll(); }
});

it('loads only the requested motocross rig, reuses it across camera cuts and releases dormant levels', () => {
  const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
  frame[H.CARS] = 2;
  const cars = [0, 1].map((i) => {
    const o = carBase(i);
    frame[o + F.QW] = 1;
    frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(i === 0 ? 'mx450' : 'mx250');
    return { root: new T.Object3D() };
  });
  cars[1].root.position.z = 220;
  const shells = new BikeShells(),
    camera = new T.PerspectiveCamera(60, 16 / 9),
    installed: T.Object3D[] = [],
    removed: T.Object3D[] = [];
  shells.install = (root) => {
    if (/\((high|mid|far)\)$/.test(root.name)) installed.push(root);
  };
  shells.uninstall = (root) => {
    if (!/\((high|mid|far)\)$/.test(root.name)) return;
    expect(root.getObjectByName('Rider')).toBeDefined();
    removed.push(root);
  };
  const present = () => shells.update(frame, frame, 1, cars, camera, 'medium', 0);
  try {
    present();
    expect(shells.count).toBe(2);
    expect(installed.map((m) => m.name.split(' ').at(-1))).toEqual(['(high)', '(far)']);
    const checkProbe = (id: number) => {
      const shown = shells.motocrossPresentation(id)!;
      expect(shown.root).toBe(shells.drawnRoot(id));
      const attached = new Set<T.Material>();
      shown.root.traverse((node) => {
        if (node instanceof T.Mesh) {
          for (const material of Array.isArray(node.material) ? node.material : [node.material])
            attached.add(material);
        }
      });
      expect(shown.probeSurfaces.length).toBe(4);
      expect(shown.probeSurfaces.every((material) => attached.has(material))).toBe(true);
      return shown.probeSurfaces;
    };
    const heroPaint = checkProbe(0), distantPaint = checkProbe(1);
    expect(distantPaint.some((material) => heroPaint.includes(material))).toBe(false);
    const remote = shells.drawnRoot(1);
    cars[1].root.position.z = 55;
    present();
    expect(shells.drawnRoot(1)!.name.endsWith('(mid)')).toBe(true);
    expect(checkProbe(1)).not.toBe(distantPaint);
    cars[1].root.position.z = 5;
    present();
    expect(shells.drawnRoot(1)!.name.endsWith('(high)')).toBe(true);
    shells.setFirstPerson(1);
    cars[1].root.position.z = 220;
    present();
    shells.setFirstPerson(-1);
    expect(installed.length).toBe(4);
    expect(shells.drawnRoot(1)).toBe(remote);
    expect(installed.filter((root) => root.visible)).toHaveLength(2);
    // Reproduce the separated-rider ownership encountered after a crash.
    const detached = remote!.getObjectByName('Rider')!;
    new T.Group().attach(detached);
    frame[H.CARS] = 1;
    present();
    expect(installed.filter((m) => m.parent === shells.root)).toHaveLength(1);
    expect(shells.drawnRoot(1)).toBe(null);
    expect(shells.motocrossPresentation(1)).toBeUndefined();
    expect(removed).toHaveLength(3);
    expect(detached.parent).toBe(null);
  } finally {
    shells.disposeAll();
  }
});

it('sizes race graphics by distance and puts each knee heat shield on the inboard face', () => {
  const materials = new BikeMaterials(0);
  try {
    for (const [detail, size] of [
      ['high', 512],
      ['mid', 256],
      ['far', 64],
    ] as const) {
      const bike = new DirtBikeModel(VEHICLES.mx450, 0, detail, materials, mudUniforms());
      try {
        const maps = new Map<string, number>();
        bike.root.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
            const texture = (mat as T.MeshStandardMaterial).map;
            if (texture?.name.startsWith('Motocross original'))
              maps.set(texture.name, texture.image.width);
          }
        });
        expect(maps.get('Motocross original number graphics 2')).toBe(size);
        expect(maps.get('Motocross original sleeve graphics 2')).toBe(size);
        expect(maps.get('Motocross original pants graphics 2')).toBe(size / 2);
        const left = bike.root.getObjectByName('Motocross continuous left pants') as T.SkinnedMesh;
        const right = bike.root.getObjectByName('Motocross continuous right pants') as T.SkinnedMesh;
        expect(left.material).toBe(right.material);
        expect((left.material as T.MeshStandardMaterial).map?.wrapS).toBe(T.RepeatWrapping);
        const a = left.geometry.getAttribute('uv'), b = right.geometry.getAttribute('uv');
        for (let i = 0; i < a.count; i += 7) {
          expect(a.getX(i) + b.getX(i)).toBeCloseTo(1.5, 5);
          expect(a.getY(i)).toBeCloseTo(b.getY(i), 5);
        }
      } finally {
        bike.dispose();
      }
    }
  } finally {
    materials.dispose();
  }
});

it('warms the two Low race levels, then selects an opponent by its displayed size after an upgrade', async () => {
  const shells = new BikeShells(), camera = new T.PerspectiveCamera(60, 16 / 9);
  const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
  frame[H.CARS] = 2;
  const cars = [0, 1].map(id => {
    frame[carBase(id) + F.QW] = 1;
    frame[carBase(id) + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
    return { root: new T.Object3D() };
  });
  cars[1].root.position.z = -24;
  const draw = (quality: 'high' | 'low') =>
    shells.update(frame, frame, 1, cars, camera, quality, 0, undefined, undefined, 540);
  const prepared: string[] = [];
  const warm = (quality: 'high' | 'low') => shells.prepareDirtField(
    () => false, async () => {}, (_, detail) => prepared.push(detail), quality,
  );
  try {
    draw('low');
    expect(shells.detailLevel(0)).toBe(1);
    expect(shells.detailLevel(1)).toBe(1);
    expect(await warm('low')).toBe(true);
    expect(prepared).toEqual(['far', 'far']);
    prepared.length = 0;
    expect(await warm('high')).toBe(true);
    expect(prepared).toEqual(['high', 'high']);
    draw('high');
    expect(shells.detailLevel(0)).toBe(0);
    expect(shells.detailLevel(1)).toBe(1);
    camera.fov = 18;
    camera.updateProjectionMatrix();
    draw('high');
    expect(shells.detailLevel(1)).toBe(0);
    camera.fov = 70;
    camera.updateProjectionMatrix();
    cars[1].root.position.z = -70;
    draw('high');
    expect(shells.detailLevel(1)).toBe(2);
  } finally { shells.disposeAll(); }
});

it('prepares camera cuts during loading, shares rigid vertex data and keeps suspension per rider', async () => {
  const shells = new BikeShells(),
    camera = new T.PerspectiveCamera(60, 16 / 9);
  const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
  frame[H.CARS] = 2;
  const cars = [0, 1].map((id) => {
    const o = carBase(id);
    frame[o + F.QW] = 1;
    frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
    return { root: new T.Object3D() };
  });
  const present = () => shells.update(frame, frame, 1, cars, camera, 'high', 0);
  const attached = () =>
    shells.root.children.filter((node) => /\((high|mid|far)\)$/.test(node.name));
  const attributes = (root: T.Object3D) => {
    const result: T.BufferAttribute[] = [];
    root.traverse((node) => {
      if (node instanceof T.Mesh) result.push(node.geometry.getAttribute('position'));
    });
    return result;
  };
  try {
    const installs = vi.fn(),
      uninstalls = vi.fn();
    shells.install = installs;
    shells.uninstall = uninstalls;
    shells.update(frame, frame, 1, cars, camera, 'high', 0, 1);
    expect(shells.drawnRoot(0)).toBeNull();
    expect(shells.drawnRoot(1)).toBeTruthy();
    present();
    const first = attributes(shells.drawnRoot(0)!),
      second = attributes(shells.drawnRoot(1)!);
    expect(first.filter((a, i) => a === second[i]).length).toBeGreaterThan(20);
    expect(first.some((a, i) => a !== second[i] && a.array === second[i].array)).toBe(true);
    expect(first.filter((a) => a.usage === T.DynamicDrawUsage).length).toBeGreaterThan(0);
    expect(
      first.every((a, i) => a.usage !== T.DynamicDrawUsage || a.array !== second[i].array),
    ).toBe(true);
    let yields = 0;
    const yieldFrame = async () => {
      yields++;
    };
    expect(await shells.prepareDirtField(() => yields === 2, yieldFrame)).toBe(false);
    expect(yields).toBe(2);
    expect(attached()).toHaveLength(2);
    const prepared: string[] = [];
    expect(await shells.prepareDirtField(() => false, yieldFrame, (id, level) => {
      prepared.push(`${id}/${level}`);
    })).toBe(true);
    expect(prepared.sort()).toEqual(['0/far', '0/mid', '1/far']);
    expect(yields).toBe(5);
    expect(attached().every((root) => root.visible)).toBe(true);
    expect(attached()).toHaveLength(2);
    // Two service stands and six rider models, including the four detached levels.
    expect(installs).toHaveBeenCalledTimes(8);
    // The compiler sees both drawn riders and exactly one instance of each
    // remaining detail. Even a rejected compile must put those rigs away.
    await expect(
      shells.warmFieldDetails(async () => {
        expect(attached()).toHaveLength(4);
        expect(
          attached()
            .filter((node) => !node.visible)
            .map((node) => node.name.slice(-5))
            .sort(),
        ).toEqual(['(far)', '(mid)']);
        throw new Error('interrupted');
      }),
    ).rejects.toThrow('interrupted');
    expect(attached()).toHaveLength(2);
    const building = vi.spyOn(T.BufferGeometry.prototype, 'setAttribute');
    try {
      cars[1].root.position.z = 65;
      present();
      const hidden = shells.drawnRoot(1)!;
      for (const distance of [250, 0]) {
        cars[1].root.position.z = distance;
        present();
      }
      expect(building).not.toHaveBeenCalled();
      expect(installs).toHaveBeenCalledTimes(8);
      expect(attached()).toHaveLength(2);
      expect(attached().every((node) => node.visible)).toBe(true);
      expect(hidden.parent).toBeNull();
      const visit = vi.spyOn(hidden.children[0], 'updateMatrixWorld');
      shells.root.updateMatrixWorld(true);
      expect(visit).not.toHaveBeenCalled();
      cars[1].root.position.z = 65;
      present();
      shells.root.updateMatrixWorld(true);
      expect(shells.drawnRoot(1)).toBe(hidden);
      expect(visit).toHaveBeenCalled();
      expect(hidden.matrixWorld.elements[14]).toBe(65);
      // A fallen rider belongs to world space. A cut must replace both the
      // rig and its separated rider, and a rewind must reseat the same person.
      const bike = carBase(1) + BIKE_BASE;
      const seated = hidden.getObjectByName('Rider')!;
      const seatedParent = seated.parent;
      frame[bike + B.STATE] = 3;
      frame[bike + B.RIDER_X] = 7;
      frame[bike + B.RIDER_Y] = 2;
      present();
      expect(seated.parent).toBe(shells.root);
      expect(seated.position.x).toBe(7);
      cars[1].root.position.z = 250;
      present();
      expect(seated.parent).toBe(hidden);
      expect(seated.visible).toBe(false);
      const fallen = shells.root.children.filter((node) => node.name === 'Rider');
      expect(fallen).toHaveLength(1);
      expect(fallen[0].visible).toBe(true);
      cars[1].root.position.z = 65;
      frame[bike + B.STATE] = 0;
      present();
      expect(seated.parent).toBe(seatedParent);
      expect(seated.visible).toBe(true);
      expect(shells.root.children.some((node) => node.name === 'Rider')).toBe(false);
    } finally {
      building.mockRestore();
    }
    shells.disposeAll();
    expect(uninstalls).toHaveBeenCalledTimes(8);
  } finally {
    shells.disposeAll();
  }
  expect(shells.root.children).toHaveLength(0);
});

it('only shares byte-identical immutable mesh attributes across matching designs', () => {
  const pool = new MxGeometryPool();
  const mesh = (x: number) => {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute([x, 0, 0], 3));
    g.setAttribute('uv', new T.Float32BufferAttribute([1, 0], 2));
    g.setAttribute('variant', new T.InstancedBufferAttribute(new Float32Array([1]), 1));
    const different = Object.is(x, -0);
    // Exclude the different padding byte preceding this three-byte attribute.
    const padded = new Uint8Array([different ? 91 : 37, 21, 34, 55]);
    g.setAttribute('thread', new T.BufferAttribute(padded.subarray(1), 1));
    const edge = new Uint8Array([11, 23, 35, 47, different ? 9 : 7]);
    g.setAttribute('edge', new T.BufferAttribute(edge, 1));
    return new T.Mesh(g, new T.MeshBasicMaterial());
  };
  const first = mesh(0),
    other = mesh(-0),
    separate = mesh(0);
  try {
    pool.share('mx450/mid', first);
    pool.share('mx450/mid', other);
    pool.share('mx250/mid', separate);
    const array = (m: T.Mesh, name: string) => m.geometry.getAttribute(name).array;
    expect(array(first, 'uv') === array(other, 'uv')).toBe(true);
    expect(array(first, 'position') === array(other, 'position')).toBe(false);
    expect(Object.is(array(other, 'position')[0], -0)).toBe(true);
    expect(array(first, 'thread') === array(other, 'thread')).toBe(true);
    expect(array(first, 'edge') === array(other, 'edge')).toBe(false);
    expect(array(first, 'variant') === array(other, 'variant')).toBe(false);
    expect(array(first, 'uv') === array(separate, 'uv')).toBe(false);
  } finally {
    for (const m of [first, other, separate]) {
      m.geometry.dispose();
      m.material.dispose();
    }
    pool.clear();
  }
});

it('builds a merged race mesh from immutable storage without duplicating its vertex arrays', () => {
  const pool = new MxGeometryPool(), geometry = new T.BufferGeometry();
  const positions = new T.BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,2,0]), 3);
  const index = new T.BufferAttribute(new Uint16Array([0,1,2]), 1);
  const colour = new T.BufferAttribute(new Uint8Array([255,0,0, 0,255,0, 0,0,255]), 3, true);
  colour.name = 'Race colours';
  const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
  geometry.setAttribute('position', positions).setAttribute('color', colour).setIndex(index);
  geometry.name = 'Merged wheel';
  geometry.addGroup(0, 3, 0);
  geometry.setDrawRange(0, 3);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const clones = [positions, index, colour].map(attribute => vi.spyOn(attribute, 'clone'));
  try {
    pool.share('mx450/high', mesh);
    const rendered = mesh.geometry;
    for (const clone of clones) expect(clone).not.toHaveBeenCalled();
    expect(rendered).not.toBe(geometry);
    expect(rendered.index).not.toBe(index);
    expect(rendered.index!.array).toBe(index.array);
    const mapped = rendered.getAttribute('color');
    expect(mapped).not.toBe(colour);
    expect(mapped.array).toBe(colour.array);
    expect([mapped.name, mapped.normalized, mapped.count]).toEqual(['Race colours', true, 3]);
    expect(rendered.groups).toEqual(geometry.groups);
    expect(rendered.drawRange).toEqual(geometry.drawRange);
    expect(rendered.boundingBox!.equals(geometry.boundingBox!)).toBe(true);
    expect(rendered.boundingSphere!.equals(geometry.boundingSphere!)).toBe(true);
    expect(rendered.boundingSphere).not.toBe(geometry.boundingSphere);
  } finally {
    clones.forEach(clone => clone.mockRestore());
    pool.clear();
    geometry.dispose();
    mesh.material.dispose();
  }
});

it('keeps shared rigid GPU buffers alive until their last bike leaves the field', () => {
  const pool = new MxGeometryPool(),
    a = new T.BoxGeometry(),
    b = new T.BoxGeometry();
  const mat = new T.MeshStandardMaterial(),
    first = new T.Mesh(a, mat),
    second = new T.Mesh(b, mat);
  try {
    pool.share('mx450/high', first);
    pool.share('mx450/high', second);
    const rendered = first.geometry;
    expect(rendered).toBe(second.geometry);
    expect(rendered === a || rendered === b).toBe(false);
    const disposed = vi.fn();
    rendered.addEventListener('dispose', disposed);
    pool.release(first);
    expect(first.geometry).toBe(a);
    a.dispose();
    expect(disposed).not.toHaveBeenCalled();
    expect(second.geometry).toBe(rendered);
    pool.release(second);
    expect(second.geometry).toBe(b);
    expect(disposed).toHaveBeenCalledTimes(1);
    pool.clear();
    expect(disposed).toHaveBeenCalledTimes(1);
  } finally {
    pool.clear();
    a.dispose();
    b.dispose();
    mat.dispose();
  }
});


it.each(['mx250', 'mx450'])('%s records only accepted gear strokes and replays the same boot and lever', (id) => {
  const sim = new Simulation({...DEFAULT_OPTIONS, mode: 'practice', circuit: 'valley-ridge-mx',
    opponents: 0, ruleset: 'motocross-moto', vehicles: [id]});
  const bike = sim.cars[0] as DirtBikeVehicle, o = carBase(0);
  const record = (dt: number) => {
    bike.clock += dt;
    const frame = sim.makeFrame();
    frame[H.TIME] = bike.clock;
    expect(frame[o + WHEEL_CONTACT_BASE]).toBe(0);
    expect(snapshotIncompatibility(frame)).toBeNull();
    return frame;
  };
  bike.autoShift = false;
  bike.gear = 1;
  bike.shift(-1);
  const neutral = record(.04);
  expect(neutral[o + MX_FOOT.ANGLE]).toBe(0);
  bike.shift(1);
  const up = record(.046);
  expect(up[o + MX_FOOT.ANGLE]).toBeCloseTo(-.24);
  bike.shift(-1); // inside the gearbox cut
  expect(bike.gear).toBe(2);
  bike.shiftClock = 0;
  bike.shift(-1);
  expect(record(0)[o + MX_FOOT.ANGLE]).toBe(up[o + MX_FOOT.ANGLE]);
  const clearance = record(.030), down = record(.086);
  expect(clearance[o + MX_FOOT.CLEAR]).toBeGreaterThan(.99);
  expect(down[o + MX_FOOT.ANGLE]).toBeCloseTo(.22);
  expect(down[o + MX_FOOT.COVER]).toBe(1);
  const settled = record(.16);
  expect(Array.from(settled.subarray(o + MX_FOOT.ANGLE, o + MX_FOOT.CLEAR + 1))).toEqual([0,0,0]);

  const store = new ReplayRecorder(1, 2);
  store.append(up);
  store.append(down);
  const a = store.makeFrame(), b = store.makeFrame();
  store.sample(store.duration / 2, a, b);
  const shells = new BikeShells(), car = {root: new T.Object3D()}, camera = new T.PerspectiveCamera(55, 1.6);
  camera.position.z = -3;
  const at = (left: Float32Array, right = left, t = 1) => {
    shells.update(left, right, t, [car], camera, 'high', 0);
    const root = shells.drawnRoot(0)!;
    root.updateMatrixWorld(true);
    const point = (name: string) => root.getObjectByName(name)!.localToWorld(new T.Vector3(0, .033, .137));
    return {angle: root.getObjectByName('Motocross gear selector')!.rotation.x,
      left: point('Motocross left boot'), right: point('Motocross right boot')};
  };
  try {
    const rest = at(neutral), lift = at(a), press = at(b);
    expect(lift.angle).toBeCloseTo(-.24);
    expect(press.angle).toBeCloseTo(.22);
    expect(lift.left.y - rest.left.y).toBeGreaterThan(.02);
    expect(at(clearance).left.x - rest.left.x).toBeGreaterThan(.055);
    expect(lift.right.distanceTo(press.right)).toBeLessThan(1e-8);
    expect(at(a,b,.5).angle).toBeCloseTo(-.01);
    expect(at(a)).toEqual(lift);
    expect(at(settled)).toEqual(rest);
    bike.shiftClock = 0;
    bike.shift(1);
    bike.place(sim.track, 8);
    expect(record(.04)[o + MX_FOOT.ANGLE]).toBe(0);
  } finally { shells.disposeAll(); }
});

it('clears the selector sleeve before covering it and returns continuously after rapid requests', () => {
  const stroke = new MxGearStroke();
  stroke.engage(-1, 1);
  for (let tick = 0; tick <= 260; tick++) {
    const a = stroke.sample(1 + tick / 1000);
    expect(Math.abs(a.angle)).toBeLessThanOrEqual(.22);
    if (a.angle > .08) expect(a.cover).toBe(1);
    if (a.cover > .12 && a.cover < .88) expect(a.clear).toBeGreaterThan(.94);
  }
  stroke.engage(1, 2);
  const angle = stroke.sample(2.063).angle;
  stroke.engage(-1, 2.063);
  expect(stroke.sample(2.063).angle).toBeCloseTo(angle, 12);
  stroke.reset();
  expect(stroke.sample(2.115).angle).toBe(0);
});


it.each(['mid', 'high'] as const)('the %s shift sleeve bears on the top and sole of the actual boot', detail => {
  const materials = new BikeMaterials(0), def = VEHICLES.mx250;
  const bike = new DirtBikeModel(def,0,detail,materials,mudUniforms());
  const selector = bike.root.getObjectByName('Motocross gear selector')!;
  const boot = bike.root.getObjectByName('Motocross left boot')!;
  const toe = new T.Vector3(...MX_BOOT_PEDAL).sub(new T.Vector3(...MX_BOOT_PEG))
    .applyQuaternion(motocrossBootFrame(new T.Quaternion()));
  const ray = new T.Raycaster(), stroke = new MxGearStroke();
  try {
    for (const [direction, time] of [[0,0],[1,.045],[-1,.078],[-1,.115]]) {
      stroke.reset(); stroke.engage(direction,0); stroke.sample(time);
      bike.pose({...staticSag(def), steer:0, frontRotation:0, rearRotation:0, chassisLean:0,
        riderOffset:0, tuck:0, brake:0, rearBrake:.75, discTemp:0, compoundColour:0xffffff,
        riding:true, standing:.24, shiftAngle:stroke.angle, shiftCover:stroke.cover, shiftClear:stroke.clear});
      bike.root.updateMatrixWorld(true);
      const sleeve = selector.localToWorld(new T.Vector3(.031, toe.y + .072, toe.z + .016));
      const surface = (object: T.Object3D, up: number) => {
        ray.set(sleeve.clone().add(new T.Vector3(0,-up*.14,0)),new T.Vector3(0,up,0));
        const hit = ray.intersectObject(object, true)[0];
        expect(hit).toBeDefined(); return hit.point.y;
      };
      const clearance = direction < 0 ? surface(boot,1) - surface(selector,-1)
        : surface(selector,1) - surface(boot,-1);
      expect(clearance).toBeGreaterThan(-.003);
      expect(clearance).toBeLessThan(.006);
    }
  } finally {bike.dispose();materials.dispose();}
});

it.each(['mx250', 'mx450'] as const)('keeps the %s oil collar at the actual seal across suspension and detail changes', (id) => {
  const definition = VEHICLES[id], materials = new BikeMaterials(0, 'dirt');
  const coat = mudUniforms(), axles = MotocrossAxles.of(definition), sag = staticSag(definition);
  const rigs = (['high', 'mid', 'far'] as const).map((detail) =>
    new DirtBikeModel(definition, 0, detail, materials, coat));
  const { wiper, tube } = motocrossForkOuter('high');
  wiper.computeBoundingBox();
  const hem = wiper.boundingBox!.min.y;
  const proto = T.ShaderLib.physical;
  const shader = {
    uniforms: T.UniformsUtils.clone(proto.uniforms),
    vertexShader: proto.vertexShader, fragmentShader: proto.fragmentShader,
  } as StudioShader;
  const pose: BikePoseValues = {
    ...sag, steer: 0.25, frontRotation: 0, rearRotation: 0, chassisLean: 0.2, riderOffset: 0,
    tuck: 0, brake: 0, rearBrake: 0, discTemp: 30, compoundColour: 0xffffff, riding: true,
  };
  try {
    materials.forkLower.onBeforeCompile(shader, {} as T.WebGLRenderer);
    const read = () => shader.uniforms.mxForkSeal.value as Float32Array;
    expect(shader.uniforms.offroadMud).toBe(coat.offroadMud);
    expect(shader.fragmentShader).toContain('deposit *= MX_MUD_RETENTION');
    expect(read()[0] + axles.lowerY(definition.bike!.forkTravel)).toBeCloseTo(hem, 6);
    for (const rig of rigs) {
      for (const fork of [0, sag.fork, definition.bike!.forkTravel, sag.fork, 0]) {
        rig.pose({ ...pose, fork });
        const lower = rig.root.getObjectByName('Motocross sliding fork lowers')!;
        expect(read()[1] + lower.position.y).toBeCloseTo(hem, 6);
        expect(read()[1]).toBeGreaterThanOrEqual(read()[0]);
        expect(read()[1]).toBeLessThan(MX_STANCHION_LENGTH);
      }
    }
    expect(read()[1] + axles.lowerY(0)).toBeCloseTo(hem, 6);
  } finally {
    wiper.dispose();
    tube.dispose();
    for (const rig of rigs) rig.dispose();
    materials.dispose();
  }
});
