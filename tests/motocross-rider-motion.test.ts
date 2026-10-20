import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { Rider, RIDER, type RiderPose } from '../src/rendering/rider.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { addMotocrossGarment } from '../src/rendering/offroad/motocross-gear.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
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
                      hands[side].getWorldPosition(point);
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
                      boots[side].getWorldPosition(point);
                      target.copy(rider.pegs[side]).applyMatrix4(model.sprung.matrixWorld);
                      bootError = Math.max(bootError, point.distanceTo(target));
                    }
                  }
        expect(handError, context).toBeLessThan(0.03);
        expect(bootError).toBeLessThan(0.03);
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
