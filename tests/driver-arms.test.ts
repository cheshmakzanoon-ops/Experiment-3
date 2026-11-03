import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';
import { HAND_TRAVEL } from '../src/rendering/vehicle-bodies/driver-arms.ts';

/** The catalogue drivers' hands must stay on the steering wheel as it turns.
 * Before DriverArms the arms were static geometry ending at 3 and 9 o'clock while
 * the rim rotated up to ~2.3 turns lock to lock, so the gloves left the wheel as
 * soon as the player steered (cockpit and chase views). One machine per cabin
 * builder: closed car, single-seater, kart, buggy. */
const MACHINES = ['eh3', 'gt8f', 'jf2', 'hf67', 'sk125', 'bg2'] as const;

function arms(id: string) {
  const def = VEHICLES[id],
    body = buildVehicleBody(1, def, bodySheetFor(def)!),
    cabin = body.lods[0].cabin!;
  return { cabin, rig: cabin.arms!, column: cabin.steering.parent as T.Group };
}

describe('driver arms follow the steering wheel', () => {
  it.each(MACHINES)('%s: gloves stay on the rim and bones keep their length', (id) => {
    const { cabin, rig, column } = arms(id);
    expect(rig, `${id} has arms`).not.toBeNull();
    expect(rig.group.parent).toBe(column.parent);
    column.updateMatrix();
    const inverse = column.matrix.clone().invert(),
      radius = cabin.layout.wheel.radius;
    for (const turn of [-6, -2.4, -1, -0.3, 0, 0.3, 1, 2.4, 6]) {
      cabin.steering.rotation.z = turn;
      rig.update(turn);
      rig.gloves().forEach((glove, i) => {
        const local = glove.clone().applyMatrix4(inverse);
        // On the rim circle (the wheel's own radius) and in its plane.
        expect(Math.hypot(local.x, local.y), `${id} turn ${turn} glove ${i} radius`).toBeCloseTo(
          radius,
          1,
        );
        expect(Math.abs(local.z), `${id} turn ${turn} glove ${i} plane`).toBeLessThan(0.05);
      });
      for (const span of rig.spans()) {
        // Never stretched: both segments keep the bone length (the hand is pulled
        // back, not the arm lengthened, when it would be out of reach).
        expect(span.upperNow).toBeCloseTo(span.upper, 3);
        expect(span.foreNow).toBeLessThanOrEqual(span.fore + 1e-3);
        expect(span.foreNow).toBeGreaterThan(span.fore * 0.5);
      }
    }
  });

  it.each(MACHINES)('%s: the gloves move with the wheel, up to the travel limit', (id) => {
    const { cabin, rig, column } = arms(id);
    const at = (turn: number) => {
      cabin.steering.rotation.z = turn;
      rig.update(turn);
      return rig.gloves();
    };
    const rest = at(0),
      quarter = at(0.5),
      wide = at(HAND_TRAVEL),
      beyond = at(HAND_TRAVEL + 3),
      back = at(-0.5);
    rest.forEach((glove, i) => {
      // A half-radian of steering moves each hand by a clear fraction of the radius.
      expect(glove.distanceTo(quarter[i]), `${id} +0.5`).toBeGreaterThan(
        cabin.layout.wheel.radius * 0.35,
      );
      expect(glove.distanceTo(back[i]), `${id} -0.5`).toBeGreaterThan(
        cabin.layout.wheel.radius * 0.35,
      );
      // Past the travel limit the hand holds its place and the rim slides through it.
      expect(wide[i].distanceTo(beyond[i]), `${id} hold`).toBeLessThan(1e-6);
    });
    // Rest pose is exactly where the former static arms put the hands, on the rim.
    column.updateMatrix();
    rest.forEach((glove, i) => {
      const local = glove.clone().applyMatrix4(column.matrix.clone().invert());
      expect(Math.abs(Math.atan2(local.y, local.x)), `${id} rest ${i}`).toSatisfy(
        (a: number) => a < 0.35 || Math.abs(a - Math.PI) < 0.35,
      );
    });
  });

  it('keeps the arm and glove meshes finite while the wheel is thrown through its range', () => {
    const { cabin, rig } = arms('eh3');
    for (let k = 0; k <= 200; k++) {
      const turn = Math.sin(k / 7) * 7;
      cabin.steering.rotation.z = turn;
      rig.update(turn);
    }
    rig.group.traverse((o) => {
      for (const v of [...o.position.toArray(), ...o.scale.toArray(), ...o.quaternion.toArray()])
        expect(Number.isFinite(v), o.name).toBe(true);
    });
  });
});
