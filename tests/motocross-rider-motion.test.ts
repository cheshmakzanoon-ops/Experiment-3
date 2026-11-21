import * as T from 'three';
import {
  MX_BOOT_PEG,
  MX_GLOVE_GRIP,
  MX_PEG_TOP,
} from '../src/rendering/offroad/motocross-rider-contact.ts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { Rider, RIDER, type RiderPose } from '../src/rendering/rider.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { addMotocrossGarment } from '../src/rendering/offroad/motocross-gear.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { MxRecoveryPose } from '../src/rendering/offroad/motocross-recovery.ts';
import { motocrossRecoveryStep } from '../src/rendering/offroad/motocross-rider-motion.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

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

const colours = { primary: 0xc22c28, secondary: 0x202226, accent: 0xe5e1d6 };
const neutral: RiderPose = {
  lean: 0,
  offset: 0,
  tuck: 0,
  braking: 0,
  steer: 0,
  standing: 1,
  body: 0,
};
const joints = (rider: Rider) => {
  const result: T.Object3D[] = [];
  rider.root.traverse((object) => {
    if (object instanceof T.Group || object instanceof T.Bone) result.push(object);
  });
  return result
    .sort((a, b) => a.id - b.id)
    .flatMap((object) => [...object.position.toArray(), ...object.quaternion.toArray()]);
};

describe('motocross suspension-driven rider motion', () => {
  it('reconstructs landing load at each mudguard and at the standing rider before full travel', () => {
    const definition = VEHICLES.mx450, materials = new BikeMaterials(0);
    const model = new DirtBikeModel(definition, 0, 'mid', materials, mudUniforms());
    const sag = staticSag(definition);
    const base: BikePoseValues = {
      ...sag, steer: 0, frontRotation: 0, rearRotation: 0, chassisLean: 0,
      riderOffset: 0, tuck: 0, brake: 0, rearBrake: 0, discTemp: 0,
      compoundColour: 0xffffff, riding: true, standing: 1, speed: 12,
    };
    const front = model.root.getObjectByName('Motocross front mudguard') as T.Mesh;
    const rear = model.root.getObjectByName('Motocross rear mudguard') as T.Mesh;
    const torso = model.rider.root.getObjectByName('Rider torso')!;
    const sample = (g: number, fork = sag.fork) => {
      model.pose({ ...base, dirtSupportG: g, fork });
      return [front.morphTargetInfluences![0], rear.morphTargetInfluences![0], torso.position.y];
    };
    try {
      const unloaded = sample(0), neutral = sample(1), contact = sample(3.8);
      expect(unloaded[0]).toBeLessThan(0);
      expect(neutral[0]).toBe(0);
      expect(contact[0]).toBeGreaterThan(0.5);
      expect(contact[2]).toBeLessThan(neutral[2] - 0.015);
      const noseFirst = sample(3.8, definition.bike!.forkTravel);
      expect(noseFirst[0]).toBeGreaterThan(noseFirst[1] + 0.25);
      expect(sample(0)).toEqual(unloaded);
      expect(sample(1)).toEqual(neutral);
    } finally {
      model.dispose();
      materials.dispose();
    }
  });
  it('braces against measured traction and keeps a replayed direction change identical across bike LODs', () => {
    const definition = VEHICLES.mx450, materials = new BikeMaterials(0);
    const base: BikePoseValues = {
      ...staticSag(definition), steer: 0, frontRotation: 0, rearRotation: 0, chassisLean: 0,
      riderOffset: 0, tuck: 0, brake: 0, rearBrake: 0, discTemp: 0,
      compoundColour: 0xffffff, riding: true, standing: 0.8, speed: 16, dirtSupportG: 1,
    };
    const sample = (model: DirtBikeModel, values: Partial<BikePoseValues>) => {
      model.pose({ ...base, ...values });
      const pelvis = model.rider.root.getObjectByName('Rider torso')!;
      const chest = model.rider.root.getObjectByName('Motocross upper chest')!;
      return [...pelvis.position.toArray(), ...chest.quaternion.toArray()];
    };
    const mid = new DirtBikeModel(definition, 0, 'mid', materials, mudUniforms());
    const far = new DirtBikeModel(definition, 0, 'far', materials, mudUniforms());
    try {
      const coasting = sample(mid, {});
      const driving = sample(mid, { gLong: 0.85 });
      const braking = sample(mid, { gLong: -1 });
      expect(driving[2] - braking[2]).toBeGreaterThan(0.06);
      expect(sample(mid, { gLong: 0.85, leanRate: 1.8, dirtSupportG: 0 })).toEqual(coasting);
      const left = sample(mid, { leanRate: 1.8 });
      expect(sample(mid, { leanRate: -1.8 })[0] - left[0]).toBeGreaterThan(0.035);
      expect(sample(mid, { leanRate: 1.8 })).toEqual(left);
      expect(sample(far, { leanRate: 1.8 })).toEqual(left);
    } finally {
      mid.dispose();
      far.dispose();
      materials.dispose();
    }
  });

  it('runs with the wrists beside the ribs and each hand opposing the boot on its own side', () => {
    const rider = new Rider(colours, 'mid', 'motocross');
    const point = new T.Vector3();
    const floor = new T.Plane(new T.Vector3(0, 1, 0), 0);
    try {
      for (const side of ['left', 'right']) {
        const hand = rider.root.getObjectByName(`Motocross ${side} hand`)!;
        const boot = rider.root.getObjectByName(`Motocross ${side} boot`)!;
        const steps: { wrist: number; foot: number }[] = [];
        let width = 0;
        for (let i = 0; i < 48; i++) {
          rider.separated(1, i * Math.PI / 24, 0, 1, floor);
          rider.root.updateMatrixWorld(true);
          point.fromArray(MX_GLOVE_GRIP).applyMatrix4(hand.matrixWorld);
          width = Math.max(width, Math.abs(point.x));
          const wrist = point.z;
          point.fromArray(MX_BOOT_PEG).applyMatrix4(boot.matrixWorld);
          steps.push({ wrist, foot: point.z });
        }
        const mean = steps.reduce((s, v) => s + v.wrist, 0) / steps.length;
        const meanFoot = steps.reduce((s, v) => s + v.foot, 0) / steps.length;
        let covariance = 0, wristVariance = 0, footVariance = 0;
        for (const sample of steps) {
          const h = sample.wrist - mean, f = sample.foot - meanFoot;
          covariance += h * f;
          wristVariance += h * h;
          footVariance += f * f;
        }
        expect(width).toBeLessThan(0.39);
        expect(Math.sqrt(wristVariance / steps.length)).toBeGreaterThan(0.13);
        expect(covariance / Math.sqrt(wristVariance * footVariance)).toBeLessThan(-0.85);
      }
    } finally {
      rider.dispose();
    }
  });

  it('keeps the running sole planted, then articulates the boot through the free swing', () => {
    const rider = new Rider(colours, 'mid', 'motocross');
    const floor = new T.Plane(new T.Vector3(-0.12, 1, 0.04).normalize(), 0);
    const direction = new T.Vector3(), foot = new T.Vector3(), frame = new T.Quaternion();
    const step = { y: 0, z: 0 };
    try {
      for (const side of ['left', 'right']) {
        const boot = rider.root.getObjectByName(`Motocross ${side} boot`)!;
        let lowest = Infinity, highest = -Infinity;
        for (let i = 0; i < 120; i++) {
          const phase = i * Math.PI / 60;
          motocrossRecoveryStep(phase, side === 'right', step);
          rider.separated(1, phase, 0, 1, floor);
          rider.root.updateMatrixWorld(true);
          const slope = direction.set(0, 0, 1).applyQuaternion(boot.getWorldQuaternion(frame)).dot(floor.normal);
          foot.fromArray(MX_BOOT_PEG).applyMatrix4(boot.matrixWorld);
          expect(floor.distanceToPoint(foot)).toBeGreaterThan(-0.001);
          if (step.y === 0) expect(slope).toBeCloseTo(-Math.sin(0.06), 6);
          lowest = Math.min(lowest, slope);
          highest = Math.max(highest, slope);
        }
        expect(lowest).toBeLessThan(-0.20);
        expect(highest).toBeGreaterThan(0.10);
      }
    } finally {
      rider.dispose();
    }
  });

  it('plants each recovering boot on its own side of a rut', () => {
    const rider = new Rider(colours, 'mid', 'motocross');
    const recovery = new MxRecoveryPose();
    const point = new T.Vector3();
    const surface = {
      planeAtWorld(p: T.Vector3, out: T.Plane) {
        const height = p.x > 0.05 ? 0.045 : p.x < -0.05 ? -0.035 : 0;
        out.setComponents(0, 1, 0, -height);
        return true;
      },
    };
    try {
      const footfalls = [
        ['left', 0.5, 0.045],
        ['right', Math.PI + 0.5, -0.035],
      ] as const;
      for (const [side, angle, height] of footfalls) {
        recovery.place(rider, point.set(0, 0.95, 0), 0, 'separated', 2.4, 1, angle, 4, surface);
        rider.root.updateMatrixWorld(true);
        const boot = rider.root.getObjectByName(`Motocross ${side} boot`)!;
        point.fromArray(MX_BOOT_PEG).applyMatrix4(boot.matrixWorld);
        expect(point.y).toBeCloseTo(height, 5);
      }
    } finally {
      rider.dispose();
    }
  });

  it('braces on the rider’s own berm and reproduces the same stride through a replay seek', () => {
    const rider = new Rider(colours, 'mid', 'motocross');
    const recovery = new MxRecoveryPose();
    const ground = new T.Plane(new T.Vector3(-0.18, 1, 0.12).normalize(), -2);
    const point = new T.Vector3(-6, 0, 12);
    const surface = { planeAtWorld: (_p: T.Vector3, dst: T.Plane) => { dst.copy(ground); return true; } };
    const level = -(ground.normal.x * point.x + ground.normal.z * point.z + ground.constant) / ground.normal.y;
    const torso = rider.root.getObjectByName('Rider torso')!;
    const place = (rise: number, angle = 1.1, time = 8) => {
      point.y = level + 0.14 + 0.81 * rise;
      recovery.place(rider, point, 0.52, 'separated', 2.4, rise, angle, time, surface);
      rider.root.updateMatrixWorld(true);
    };
    try {
      place(0);
      expect(new T.Vector3(0, 1, 0).applyQuaternion(rider.root.quaternion).angleTo(ground.normal)).toBeLessThan(1e-6);
      const previous = torso.getWorldQuaternion(new T.Quaternion());
      for (let i = 1; i <= 100; i++) {
        place(i / 100);
        const pose = torso.getWorldQuaternion(new T.Quaternion());
        expect(pose.angleTo(previous)).toBeLessThan(0.07);
        previous.copy(pose);
      }
      place(1, 0.3);
      const held = joints(rider);
      place(0.25, 1.1);
      place(1, 0.3, 400);
      expect(joints(rider)).toEqual(held);
      // A highside above the crest remains a tumble even with an old frame's
      // preceding standing-on-the-pegs value. The height of the bike is irrelevant.
      point.y = level + 2.7;
      recovery.place(rider, point, 0.52, 'highside', 0.25, 1, 1.3, 5, surface);
      expect(torso.position.y).toBe(0);
      expect(rider.root.position.toArray()).toEqual(point.toArray());
    } finally {
      rider.dispose();
    }
  });

  it('plants each recovery boot for a measured interval of travel and clears the soil during swing', () => {
    const p = { y: 0, z: 0 }, q = { y: 0, z: 0 };
    for (const right of [false, true]) {
      const shift = right ? Math.PI : 0;
      motocrossRecoveryStep(0.4 + shift, right, p);
      motocrossRecoveryStep(0.95 + shift, right, q);
      expect(p.y).toBe(0);
      expect(q.y).toBe(0);
      expect(q.z - p.z).toBeCloseTo(-0.55 * 1.8 / (2 * Math.PI), 10);
      motocrossRecoveryStep(4.3 + shift, right, q);
      expect(q.y).toBeGreaterThan(0.13);
      motocrossRecoveryStep(4.3 + shift - 2 * Math.PI, right, p);
      expect(p.z).toBeCloseTo(q.z, 12);
    }
  });
  it('crosses neutral lean continuously and folds the elbows behind the shoulders when rising', () => {
    const definition = VEHICLES.mx450,
      materials = new BikeMaterials(0);
    const model = new DirtBikeModel(definition, 0, 'mid', materials, mudUniforms());
    const sag = staticSag(definition);
    const pose = (standing: number, lean: number, body: number) => {
      model.pose({
        fork: sag.fork,
        shock: sag.shock,
        steer: 0,
        frontRotation: 0,
        rearRotation: 0,
        chassisLean: lean,
        riderOffset: 0,
        tuck: 0,
        brake: 0,
        rearBrake: 0,
        discTemp: 20,
        compoundColour: 0xffffff,
        riding: true,
        standing,
        body,
        speed: 12,
      });
      model.root.updateMatrixWorld(true);
    };
    const joint = (side: string, name: string) =>
      model.rider.root
        .getObjectByName(`Motocross ${side} ${name}`)!
        .getWorldPosition(new T.Vector3());
    try {
      for (const side of ['left', 'right']) {
        pose(0.1, -0.00001, 0);
        const knee = joint(side, 'shin');
        pose(0.1, 0.00001, 0);
        expect(knee.distanceTo(joint(side, 'shin'))).toBeLessThan(0.00001);
        pose(0.5, 0, 0.2);
        const elbow = joint(side, 'forearm').sub(joint(side, 'upper arm'));
        expect(elbow.y).toBeLessThan(-0.025);
        expect(elbow.z).toBeLessThan(-0.1);
      }
    } finally {
      model.dispose();
      materials.dispose();
    }
  });

  it('holds a distinct start posture per entrant through every camera detail and replay', () => {
    const riders = [
      new Rider(colours, 'high', 'motocross', 2),
      new Rider(colours, 'mid', 'motocross', 2),
      new Rider(colours, 'far', 'motocross', 2),
      new Rider(colours, 'high', 'motocross', 4),
    ];
    const chest = (rider: Rider, startBrace: number, time: number) => {
      rider.ride({ ...neutral, standing: 0, startBrace, time });
      return rider.root.getObjectByName('Motocross upper chest')!.quaternion.clone();
    };
    try {
      const [near, middle, distant, rival] = riders;
      const held = chest(near, 1, 0);
      expect(chest(middle, 1, 0).toArray()).toEqual(held.toArray());
      expect(chest(distant, 1, 0).toArray()).toEqual(held.toArray());
      expect(held.angleTo(chest(rival, 1, 0))).toBeGreaterThan(0.03);
      const breath = held.angleTo(chest(near, 1, 1.7));
      expect(breath).toBeGreaterThan(0.01);
      expect(breath).toBeLessThan(0.025);
      const released = chest(near, 0, 4);
      expect(chest(near, 0, 80).toArray()).toEqual(released.toArray());
      expect(chest(rival, 0, 8).toArray()).toEqual(released.toArray());
      expect(held.angleTo(chest(near, 0.5, 0))).toBeCloseTo(held.angleTo(released) / 2, 6);
      expect(chest(near, 1, 0).toArray()).toEqual(held.toArray());
    } finally {
      for (const rider of riders) rider.dispose();
    }
  });

  it('gathers cloth inside a bent elbow without deforming its cuff or uploading new vertices', () => {
    const root = new T.Group(),
      upper = new T.Group(),
      lower = new T.Group(),
      shoulder = new T.Bone(),
      material = new T.MeshBasicMaterial();
    root.add(upper, lower, shoulder);
    lower.position.y = RIDER.upperArm;
    const sleeve = addMotocrossGarment(
        root,
        upper,
        lower,
        RIDER.upperArm,
        RIDER.forearm,
        'sleeve',
        'high',
        material,
        shoulder,
      ),
      positions = sleeve.geometry.getAttribute('position') as T.BufferAttribute,
      version = positions.version,
      withCrease = new T.Vector3(),
      withoutCrease = new T.Vector3();
    const shape = (angle: number) => {
      lower.rotation.z = angle;
      sleeve.updatePose();
      root.updateMatrixWorld(true);
      return sleeve.morphTargetInfluences![0];
    };
    try {
      expect(shape(0)).toBe(0);
      const influence = shape(Math.PI / 2);
      let insideMovement = 0,
        outsideMovement = 0,
        cuffMovement = 0;
      for (let i = 0; i < positions.count; i++) {
        sleeve.morphTargetInfluences![0] = influence;
        sleeve.getVertexPosition(i, withCrease);
        sleeve.morphTargetInfluences![0] = 0;
        sleeve.getVertexPosition(i, withoutCrease);
        const movement = withCrease.distanceTo(withoutCrease);
        if (positions.getY(i) > RIDER.upperArm + RIDER.forearm * 0.8)
          cuffMovement = Math.max(cuffMovement, movement);
        else if (positions.getZ(i) < -0.02) insideMovement = Math.max(insideMovement, movement);
        else if (positions.getZ(i) > 0.02) outsideMovement = Math.max(outsideMovement, movement);
      }
      expect(insideMovement).toBeGreaterThan(0.0015);
      expect(insideMovement).toBeLessThan(0.005);
      expect(outsideMovement).toBeLessThan(1e-9);
      expect(cuffMovement).toBeLessThan(1e-9);
      expect(shape(0)).toBe(0);
      expect(shape(Math.PI / 2)).toBe(influence);
      expect(positions.version).toBe(version);
    } finally {
      sleeve.skeleton.dispose();
      sleeve.geometry.dispose();
      material.dispose();
    }
  });

  it('uses knee reserve under compression while seated hips stay on the saddle', () => {
    const rider = new Rider(colours, 'high', 'motocross'),
      torso = rider.root.getObjectByName('Rider torso')!,
      knee = rider.root.getObjectByName('Motocross left shin')!;
    rider.seat.set(0, 0.2, -0.24);
    rider.pegs[0].set(0.17, -0.44, -0.1);
    rider.pegs[1].set(-0.17, -0.44, -0.1);
    try {
      rider.ride({ ...neutral, compression: 0 });
      const raised = torso.position.y,
        extendedKnee = knee.position.clone();
      let previous = raised;
      for (let compression = 0.1; compression <= 1; compression += 0.1) {
        rider.ride({ ...neutral, compression });
        expect(torso.position.y).toBeLessThan(previous);
        previous = torso.position.y;
      }
      expect(raised - torso.position.y).toBeGreaterThan(0.05);
      expect(raised - torso.position.y).toBeLessThan(0.08);
      expect(knee.position.distanceTo(extendedKnee)).toBeGreaterThan(0.025);
      expect(torso.position.y - rider.seat.y).toBeGreaterThan(0.1);
      rider.ride({ ...neutral, standing: 0, compression: 0 });
      const seated = torso.position.clone();
      rider.ride({ ...neutral, standing: 0, compression: 1 });
      expect(torso.position.toArray()).toEqual(seated.toArray());
    } finally {
      rider.dispose();
    }
  });

  it('takes a fork-first and rear-first landing differently at the same mean travel', () => {
    const rider = new Rider(colours, 'high', 'motocross');
    const torso = rider.root.getObjectByName('Rider torso')!;
    const read = (bias: number) => {
      rider.ride({ ...neutral, standing: 1, compression: 0.5, compressionBias: bias });
      return torso.position.clone();
    };
    try {
      const front = read(1),
        both = read(0),
        rear = read(-1);
      expect(both.z - front.z).toBeGreaterThan(0.02);
      expect(rear.z - both.z).toBeGreaterThan(0.02);
      expect(front.y - rear.y).toBeGreaterThan(0.012);
      expect(read(1).distanceTo(front)).toBeLessThan(1e-10);
      rider.ride({ ...neutral, standing: 0, compression: 0.5, compressionBias: 1 });
      const seated = torso.position.clone();
      rider.ride({ ...neutral, standing: 0, compression: 0.5, compressionBias: -1 });
      expect(seated.distanceTo(torso.position)).toBeLessThan(1e-10);
    } finally {
      rider.dispose();
    }
  });
  it('keeps the helmet looking ahead through a pitched bike without freezing it to the horizon', () => {
    const rider = new Rider(colours, 'mid', 'motocross'),
      helmet = rider.root.getObjectByName('Rider head and helmet')!,
      orientation = new T.Quaternion(),
      direction = new T.Vector3();
    const gaze = (pitch: number) => {
      rider.root.rotation.x = pitch;
      rider.ride({ ...neutral, chassisPitch: pitch });
      rider.root.updateMatrixWorld(true);
      helmet.getWorldQuaternion(orientation);
      direction.set(0, 0, 1).applyQuaternion(orientation);
      return Math.atan2(-direction.y, Math.hypot(direction.x, direction.z));
    };
    try {
      const level = gaze(0),
        down = gaze(0.5) - level,
        up = gaze(-0.5) - level;
      expect(down).toBeGreaterThan(0.06);
      expect(down).toBeLessThan(0.15);
      expect(up).toBeLessThan(-0.06);
      expect(up).toBeGreaterThan(-0.15);
    } finally {
      rider.dispose();
    }
  });

  it.each(['mx250', 'mx450'])(
    '%s preserves bar and peg contacts under absorption, body shifts and steep pitch',
    (id) => {
      const definition = VEHICLES[id],
        materials = new BikeMaterials(0),
        model = new DirtBikeModel(definition, 0, 'mid', materials, mudUniforms()),
        sag = staticSag(definition),
        b = definition.bike!,
        rider = model.rider,
        point = new T.Vector3(),
        target = new T.Vector3(),
        hands = ['left', 'right'].map(
          (side) => rider.root.getObjectByName(`Motocross ${side} hand`)!,
        ),
        boots = ['left', 'right'].map(
          (side) => rider.root.getObjectByName(`Motocross ${side} boot`)!,
        );
      let handError = 0,
        bootError = 0,
        context = '';
      const base: BikePoseValues = {
        fork: sag.fork,
        shock: sag.shock,
        steer: 0,
        frontRotation: 0,
        rearRotation: 0,
        chassisLean: 0.5,
        riderOffset: 0,
        tuck: 0,
        brake: 0,
        rearBrake: 0,
        discTemp: 0,
        compoundColour: 0xffffff,
        riding: true,
      };
      try {
        for (const standing of [0, 1])
          for (const body of [-1, 0, 1])
            for (const compression of [0, 0.5, 1])
              for (const chassisPitch of [-0.6, 0, 0.6])
                for (const steer of [-0.42, 0, 0.42])
                  for (const braking of [0, 1]) {
                    model.pose({
                      ...base,
                      steer,
                      fork: T.MathUtils.lerp(sag.fork, b.forkTravel, compression),
                      shock: T.MathUtils.lerp(sag.shock, b.shockTravel, compression),
                    });
                    rider.ride({
                      ...neutral,
                      lean: 0.5,
                      standing,
                      body,
                      compression,
                      chassisPitch,
                      steer,
                      braking,
                    });
                    model.root.updateMatrixWorld(true);
                    for (let side = 0; side < 2; side++) {
                      point.fromArray(MX_GLOVE_GRIP).applyMatrix4(hands[side].matrixWorld);
                      target.copy(rider.grips[side]).applyMatrix4(model.sprung.matrixWorld);
                      const distance = point.distanceTo(target);
                      if (distance > handError) {
                        handError = distance;
                        context = JSON.stringify({
                          standing,
                          body,
                          compression,
                          chassisPitch,
                          steer,
                          braking,
                        });
                      }
                      point.fromArray(MX_BOOT_PEG).applyMatrix4(boots[side].matrixWorld);
                      target.copy(rider.pegs[side]);
                      target.y += MX_PEG_TOP;
                      target.applyMatrix4(model.sprung.matrixWorld);
                      bootError = Math.max(bootError, point.distanceTo(target));
                    }
                  }
        expect(handError, context).toBeLessThan(1e-6);
        expect(bootError).toBeLessThan(1e-6);
      } finally {
        model.dispose();
        materials.dispose();
      }
    },
  );

  it('reproduces held and rewound poses across onboard transitions and leaves road riders unchanged', () => {
    const mx = new Rider(colours, 'mid', 'motocross'),
      road = new Rider(colours, 'mid', 'leathers'),
      pose = { ...neutral, compression: 0.8, chassisPitch: -0.35, lean: 0.4, body: -0.5 };
    try {
      mx.ride(pose);
      const first = joints(mx);
      mx.ride(pose);
      expect(joints(mx)).toEqual(first);
      mx.setFirstPerson(true, true);
      mx.ride({ ...neutral, compression: 0, chassisPitch: 0.6 });
      mx.setFirstPerson(false, true);
      mx.ride(pose);
      expect(joints(mx)).toEqual(first);
      mx.ride({ ...neutral, compression: NaN, chassisPitch: Infinity });
      expect(joints(mx).every(Number.isFinite)).toBe(true);
      road.ride(neutral);
      const roadPose = joints(road);
      road.ride({ ...neutral, compression: 1, chassisPitch: -0.6 });
      expect(joints(road)).toEqual(roadPose);
    } finally {
      mx.dispose();
      road.dispose();
    }
  });
});
