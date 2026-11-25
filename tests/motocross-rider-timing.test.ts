import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { MX_BOOT_PEG, MX_GLOVE_GRIP, MX_PEG_TOP } from '../src/rendering/offroad/motocross-rider-contact.ts';
import { motocrossRecoveryStep } from '../src/rendering/offroad/motocross-rider-motion.ts';
import { MotocrossRiderSight } from '../src/rendering/offroad/motocross-rider-sight.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { relief } from '../src/simulation/offroad/course.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 10 }) : () => undefined,
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});
afterAll(() => vi.unstubAllGlobals());

function withBike(id: 'mx250' | 'mx450' | 'sm450', run: (bike: DirtBikeModel, base: BikePoseValues) => void) {
  const definition = VEHICLES[id], materials = new BikeMaterials(0);
  const model = new DirtBikeModel(definition, 0, 'mid', materials, mudUniforms());
  const base: BikePoseValues = {
    ...staticSag(definition), frontRotation: 0, rearRotation: 0, steer: 0,
    chassisLean: 0, riderOffset: 0, tuck: 0, brake: 0, rearBrake: 0, discTemp: 0,
    compoundColour: 0xffffff, riding: true, standing: 1, speed: 18, dirtSupportG: 1,
  };
  try { run(model, base); } finally { model.dispose(); materials.dispose(); }
}

describe('motocross rider timing', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s gathers the legs before the shoulders at each ramp and releases at the lip',
    (venue) => {
      const track = rigTrack(venue), course = offroadCourse(track.circuit)!;
      const sight = new MotocrossRiderSight(track, course);
      const p = trackPoint(), ground = relief();
      for (const jump of course.jumps) {
        for (const speed of [12, 20]) {
          const cue = (seconds: number, height = 0) => {
            const s = jump.takeoff - speed * seconds;
            track.at(s, p);
            const y = course.groundAt(s, 0, p, ground) + 0.56 + height;
            return { ...sight.sample(s, s, 1, 0, speed, Math.atan2(p.tx, p.tz), y, 0.56)! };
          };
          const gathered = cue(0.20), extended = cue(-0.11);
          expect(gathered.hipPreload).toBeCloseTo(1, 8);
          expect(gathered.shoulderPreload!).toBeLessThan(0.95);
          const following = cue(0.135);
          expect(following.shoulderPreload).toBeCloseTo(1, 8);
          expect(following.hipPreload!).toBeLessThan(0.9);
          expect(extended.hipPreload).toBe(0);
          expect(extended.shoulderPreload).toBe(0);
          expect(cue(-0.11, 0.8).clearance).toBeCloseTo(0.8, 8);
          expect(cue(0.20)).toEqual(gathered);
        }
      }
    },
  );

  it.each(['mx250', 'mx450'] as const)(
    '%s keeps both grips and pegs through the takeoff, flight and landing follow-through',
    (id) => withBike(id, (bike, base) => {
      const rider = bike.rider;
      const pelvis = rider.root.getObjectByName('Rider torso')!;
      const chest = rider.root.getObjectByName('Motocross upper chest')!;
      const hands = ['left', 'right'].map(side => rider.root.getObjectByName(`Motocross ${side} hand`)!);
      const boots = ['left', 'right'].map(side => rider.root.getObjectByName(`Motocross ${side} boot`)!);
      const point = new T.Vector3(), target = new T.Vector3(), angle = new T.Euler();
      const sight = { yaw: 0, gradeChange: 0, weight: 1, hipPreload: 0, shoulderPreload: 0, clearance: 0 };
      let maxContactError = 0;
      const pose = (values: Partial<BikePoseValues> = {}) => {
        bike.pose({ ...base, sight, ...values });
        bike.root.updateMatrixWorld(true);
        for (let i = 0; i < 2; i++) {
          point.fromArray(MX_GLOVE_GRIP).applyMatrix4(hands[i].matrixWorld);
          target.copy(rider.grips[i]).applyMatrix4(bike.sprung.matrixWorld);
          maxContactError = Math.max(maxContactError, point.distanceTo(target));
          point.fromArray(MX_BOOT_PEG).applyMatrix4(boots[i].matrixWorld);
          target.copy(rider.pegs[i]);
          target.y += MX_PEG_TOP;
          target.applyMatrix4(bike.sprung.matrixWorld);
          maxContactError = Math.max(maxContactError, point.distanceTo(target));
        }
        return [pelvis.position.y, angle.setFromQuaternion(chest.quaternion, 'ZYX').x];
      };
      const neutral = pose();
      sight.hipPreload = 1;
      sight.shoulderPreload = 0.85;
      const gathered = pose();
      expect(neutral[0] - gathered[0]).toBeGreaterThan(0.045);
      sight.hipPreload = 0.8;
      sight.shoulderPreload = 1;
      const release = pose();
      expect(release[0] - gathered[0]).toBeGreaterThan(0.007);
      expect(release[1] - gathered[1]).toBeGreaterThan(0.01);
      sight.hipPreload = sight.shoulderPreload = 0;
      sight.clearance = 1.1;
      // Even a tall lip cannot fold the knees on the first unsupported frame.
      expect(pose({ dirtSupportG: 0, mxFlightTime: 0.015 })).toEqual(neutral);
      const hop = pose({ dirtSupportG: 0, mxFlightTime: 0.08 });
      expect(neutral[0] - hop[0]).toBeLessThan(0.007);
      const flight = pose({ dirtSupportG: 0, mxFlightTime: 0.32 });
      expect(neutral[0] - flight[0]).toBeGreaterThan(0.025);
      sight.clearance = 0.10;
      expect(pose({ dirtSupportG: 0 })).toEqual(neutral);
      const impact = pose({ dirtSupportG: 3.6, fork: bike.definition.bike!.forkTravel, mxBottoming: 0.85 });
      const settling = pose({ mxBottoming: 0.65 });
      expect(settling[0]).toBeGreaterThan(impact[0] + 0.015);
      expect(settling[0]).toBeLessThan(neutral[0] - 0.02);
      expect(settling[1]).toBeGreaterThan(neutral[1] + 0.04);
      expect(pose()).toEqual(neutral);
      expect(maxContactError).toBeLessThan(1e-6);
    }),
  );

  it('eases off the seat, leads the hips through a berm and repeats the same gait at different display rates', () => {
    withBike('mx450', (bike, base) => {
      const rider = bike.rider;
      const pelvis = rider.root.getObjectByName('Rider torso')!;
      const chest = rider.root.getObjectByName('Motocross upper chest')!;
      const head = rider.root.getObjectByName('Rider head and helmet')!;
      const knee = rider.root.getObjectByName('Motocross left shin')!;
      const elbow = rider.root.getObjectByName('Motocross right forearm')!;
      const angle = new T.Euler();
      bike.pose({ ...base, standing: 0 });
      const seat = pelvis.position.y, restPitch = angle.setFromQuaternion(chest.quaternion, 'ZYX').x;
      bike.pose({ ...base, standing: 0.06 });
      expect(pelvis.position.y - seat).toBeGreaterThan(0.001);
      expect(pelvis.position.y - seat).toBeLessThan(0.003);
      expect(angle.setFromQuaternion(chest.quaternion, 'ZYX').x).toBe(restPitch);
      bike.pose({ ...base, sight: { yaw: 0.56, gradeChange: 0, weight: 1 } });
      const waistYaw = angle.setFromQuaternion(pelvis.quaternion, 'ZYX').y;
      const chestYaw = angle.setFromQuaternion(chest.quaternion, 'ZYX').y;
      const forward = new T.Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new T.Quaternion()));
      expect(Math.abs(waistYaw)).toBeLessThan(1e-6);
      expect(chestYaw).toBeGreaterThan(0.09);
      expect(Math.atan2(forward.x, forward.z)).toBeGreaterThan(chestYaw + 0.15);

      const sequence = (fps: number) => {
        const poses: number[][] = [];
        for (let frame = 0; frame <= fps; frame++) {
          const time = frame / fps, wave = Math.sin(2 * Math.PI * time);
          bike.pose({ ...base, time, standing: 0.5 - 0.5 * Math.cos(2 * Math.PI * time),
            chassisLean: 0.7 * wave, leanRate: 1.4 * Math.cos(2 * Math.PI * time),
            gLong: -0.8 * wave, sight: { yaw: 0.45 * wave, gradeChange: 0, weight: 1 } });
          if (frame % (fps / 10) === 0)
            poses.push([...pelvis.position.toArray(), ...chest.quaternion.toArray(),
              ...knee.position.toArray(), ...elbow.position.toArray()]);
        }
        return poses;
      };
      const thirty = sequence(30);
      expect(sequence(60)).toEqual(thirty);
      expect(sequence(120)).toEqual(thirty);
    });
  });

  it('transfers weight across a recovery stride while the downhill sole stays planted', () => {
    withBike('mx450', (bike) => {
      const rider = bike.rider;
      const pelvis = rider.root.getObjectByName('Rider torso')!;
      const chest = rider.root.getObjectByName('Motocross upper chest')!;
      const head = rider.root.getObjectByName('Rider head and helmet')!;
      const boots = ['left', 'right'].map(side => rider.root.getObjectByName(`Motocross ${side} boot`)!);
      const ground = new T.Plane(new T.Vector3(0.18, 1, -0.12).normalize(), 0);
      const angle = new T.Euler(), point = new T.Vector3(), target = new T.Vector3();
      const orientation = new T.Quaternion();
      const step = { y: 0, z: 0 };
      let maxContactError = 0, chestTurn = 0, headTurn = 0, opposingTwist = 0;
      let leftHip = 0, rightHip = 0;
      for (let i = 0; i < 180; i++) {
        const phase = i * Math.PI / 90;
        rider.separated(1, phase, 0, 1, ground);
        bike.root.updateMatrixWorld(true);
        leftHip = Math.max(leftHip, pelvis.position.x);
        rightHip = Math.min(rightHip, pelvis.position.x);
        const hipYaw = angle.setFromQuaternion(pelvis.quaternion, 'ZYX').y;
        const shoulderYaw = angle.setFromQuaternion(chest.quaternion, 'ZYX').y;
        chestTurn = Math.max(chestTurn, Math.abs(shoulderYaw));
        opposingTwist = Math.max(opposingTwist, -hipYaw * shoulderYaw);
        point.set(0, 0, 1).applyQuaternion(head.getWorldQuaternion(orientation));
        headTurn = Math.max(headTurn, Math.abs(Math.atan2(point.x, point.z)));
        for (let k = 0; k < 2; k++) {
          motocrossRecoveryStep(phase, k === 1, step);
          if (step.y > 0) continue;
          const x = k === 0 ? 0.11 : -0.11;
          target.set(x, -0.18 * x + 0.12 * step.z, step.z);
          point.fromArray(MX_BOOT_PEG).applyMatrix4(boots[k].matrixWorld);
          maxContactError = Math.max(maxContactError, point.distanceTo(target));
        }
      }
      expect(leftHip - rightHip).toBeGreaterThan(0.03);
      expect(opposingTwist).toBeGreaterThan(0.007);
      expect(chestTurn).toBeGreaterThan(0.09);
      expect(headTurn).toBeLessThan(chestTurn * 0.45);
      expect(maxContactError).toBeLessThan(1e-6);
    });
  });

  it('opens the outside elbow in the onboard view, holds the grips and restores the exterior rig', () => {
    for (const id of ['mx450', 'sm450'] as const) withBike(id, (bike, base) => {
      const rider = bike.rider, point = new T.Vector3(), target = new T.Vector3();
      const elbows = ['left', 'right'].map(side => rider.root.getObjectByName(`Motocross ${side} forearm`)!);
      const hands = ['left', 'right'].map(side => rider.root.getObjectByName(`Motocross ${side} hand`)!);
      const positions = () => elbows.flatMap(elbow => elbow.position.toArray());
      bike.pose(base);
      const exterior = positions();
      rider.setFirstPerson(true, true);
      const pose = (values: Partial<BikePoseValues>) => {
        bike.pose({ ...base, ...values });
        bike.root.updateMatrixWorld(true);
        for (let i = 0; i < 2; i++) {
          point.fromArray(MX_GLOVE_GRIP).applyMatrix4(hands[i].matrixWorld);
          target.copy(rider.grips[i]).applyMatrix4(bike.sprung.matrixWorld);
          expect(point.distanceTo(target)).toBeLessThan(1e-6);
        }
        return positions();
      };
      const rest = pose({}), left = pose({ chassisLean: 0.7 }), right = pose({ chassisLean: -0.7 });
      if (id === 'mx450') {
        // Both sleeves shift right in a left berm: inside elbow tucks, outside elbow opens.
        expect(right[0] - left[0]).toBeGreaterThan(0.02);
        expect(right[3] - left[3]).toBeGreaterThan(0.02);
        const hit = pose({ dirtSupportG: 3.8, mxBottoming: 0.9, fork: bike.definition.bike!.forkTravel });
        expect(hit[0] - rest[0]).toBeGreaterThan(0.015);
      } else {
        expect(left).toEqual(rest);
        expect(right).toEqual(rest);
      }
      expect(pose({})).toEqual(rest);
      rider.setFirstPerson(false);
      expect(positions()).toEqual(exterior);
    });
  });
});
