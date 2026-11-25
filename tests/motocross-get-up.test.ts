import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MxRecoveryPose } from '../src/rendering/offroad/motocross-recovery.ts';
import { MX_GLOVE_WRIST } from '../src/rendering/offroad/motocross-rider-contact.ts';
import { Rider, RIDER } from '../src/rendering/rider.ts';

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 10 }) : () => undefined,
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});
afterAll(() => vi.unstubAllGlobals());

const colours = { primary: 0x90402b, secondary: 0x121212, accent: 0xeeeeee };
const sides = ['left', 'right'] as const;
const flat = {
  planeAtWorld: (_p: T.Vector3, out: T.Plane) => {
    out.setComponents(0, 1, 0, 0);
    return true;
  },
};

/** Socket-to-ground distance would miss fingers or a cuff below the dirt. */
function lowestGlovePoint(hand: T.Object3D, plane: T.Plane, out: T.Vector3) {
  const point = new T.Vector3();
  let distance = Infinity;
  hand.traverseVisible(node => {
    if (!(node instanceof T.Mesh)) return;
    const count = node.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++) {
      node.getVertexPosition(i, point).applyMatrix4(node.matrixWorld);
      const d = plane.distanceToPoint(point);
      if (d < distance) { distance = d; out.copy(point); }
    }
  });
  return distance;
}

describe('motocross rider getting up from the dirt', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s plants each actual glove on its own banked surface with the arm lengths intact',
    detail => {
      const actor = new Rider(colours, detail, 'motocross'), recovery = new MxRecoveryPose();
      const heading = 0.71, centreX = 8.5, centreZ = -5.1;
      const normal = new T.Vector3(-0.12, 1, 0.07).normalize();
      const terrain = {
        planeAtWorld(p: T.Vector3, out: T.Plane) {
          const lateral = (p.x - centreX) * Math.cos(heading) - (p.z - centreZ) * Math.sin(heading);
          const height = lateral > 0.16 ? 0.033 : lateral < -0.16 ? -0.026 : 0;
          out.set(normal, -height * normal.y);
          return true;
        },
      };
      const p = new T.Vector3(), wrist = new T.Vector3(), elbow = new T.Vector3(), plane = new T.Plane();
      const original: T.Vector3[] = [];
      try {
        for (const rise of [0, 0.06, 0.12]) {
          const y = 0.12 * centreX - 0.07 * centreZ + 0.14 + 0.81 * rise;
          recovery.place(actor, p.set(centreX, y, centreZ), heading, 'separated', 1.4, rise, 0, 5, terrain);
          actor.root.updateMatrixWorld(true);
          for (const [i, side] of sides.entries()) {
            const hand = actor.root.getObjectByName(`Motocross ${side} hand`)!;
            const arm = actor.root.getObjectByName(`Motocross ${side} upper arm`)!;
            const sleeve = actor.root.getObjectByName(`Motocross ${side} forearm`)!;
            terrain.planeAtWorld(hand.getWorldPosition(p), plane);
            expect(Math.abs(lowestGlovePoint(hand, plane, p))).toBeLessThan(0.0002);
            if (rise === 0) original[i] = p.clone();
            else expect(p.distanceTo(original[i])).toBeLessThan(0.0002);
            sleeve.getWorldPosition(elbow);
            expect(arm.getWorldPosition(p).distanceTo(elbow)).toBeCloseTo(RIDER.upperArm, 6);
            hand.localToWorld(wrist.fromArray(MX_GLOVE_WRIST));
            expect(wrist.distanceTo(elbow)).toBeCloseTo(RIDER.forearm, 5);
          }
        }
      } finally { actor.dispose(); }
    },
  );

  it('presses the chest up ahead of the waistband and releases the two wrists in sequence', () => {
    const actor = new Rider(colours, 'mid', 'motocross'), recovery = new MxRecoveryPose();
    const pelvis = actor.root.getObjectByName('Rider torso')!;
    const chest = actor.root.getObjectByName('Motocross upper chest')!;
    const hands = sides.map(side => actor.root.getObjectByName(`Motocross ${side} hand`)!);
    const p = new T.Vector3(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    const at = (rise: number) => {
      recovery.place(actor, p.set(0, 0.14 + 0.81 * rise, 0), 0, 'separated', 1.5, rise, 0, 11, flat);
      actor.root.updateMatrixWorld(true);
      return hands.map(hand => lowestGlovePoint(hand, plane, p));
    };
    try {
      const contact = at(0.15);
      expect(Math.max(...contact)).toBeLessThan(0.001);
      const release = at(0.27);
      expect(release[0] - release[1]).toBeGreaterThan(0.01);
      expect(chest.quaternion.angleTo(pelvis.quaternion)).toBeGreaterThan(0.1);
      expect(Math.min(...at(0.55))).toBeGreaterThan(0.3);
      expect(at(0.27)).toEqual(release);
    } finally { actor.dispose(); }
  });

  it('keeps the gloves and sleeves turning continuously as a rolling rider catches themselves, and clears the arms in flight', () => {
    const actor = new Rider(colours, 'mid', 'motocross'), recovery = new MxRecoveryPose();
    const limbs = sides.flatMap(side => ['hand', 'forearm'].map(part =>
      actor.root.getObjectByName(`Motocross ${side} ${part}`)!));
    const p = new T.Vector3(), previous = limbs.map(() => new T.Quaternion()), q = new T.Quaternion();
    try {
      for (const roll of [-2.7, 2.7]) {
        let largest = 0;
        for (let frame = 0; frame <= 144; frame++) {
          const seconds = frame / 200, u = seconds / 0.72, rise = u * u * (3 - 2 * u);
          const tumble = Math.sign(roll) * Math.max(0, Math.abs(roll) - 8 * seconds);
          recovery.place(actor, p.set(0, 0.14 + 0.81 * rise, 0), 0, 'separated',
            1.2 + seconds, rise, tumble, seconds, flat);
          actor.root.updateMatrixWorld(true);
          for (let k = 0; k < limbs.length; k++) {
            limbs[k].getWorldQuaternion(q);
            if (frame > 0) largest = Math.max(largest, previous[k].angleTo(q));
            previous[k].copy(q);
          }
        }
        expect(largest).toBeLessThan(0.35);
      }
      const airborne = (withGround: boolean) => {
        recovery.place(actor, p.set(0, 2.8, 0), 0.3, 'highside', 0.2, 0, 1.8, 4,
          withGround ? flat : undefined);
        return limbs.flatMap(limb => [...limb.position.toArray(), ...limb.quaternion.toArray()]);
      };
      expect(airborne(true)).toEqual(airborne(false));
    } finally { actor.dispose(); }
  });
});
