import { expect, it } from 'vitest';
import * as T from 'three';
import { FORMULA_CHASE as rig, FormulaChaseSightline } from '../src/rendering/formula-chase.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

it('keeps the rear contact patches and diffuser inside a racing frame from rest to maximum speed', () => {
  for (const speed of [0, 40, 88]) {
    const cam = new T.PerspectiveCamera(
      rig.fov + Math.min(rig.fovGain, speed * 0.06),
      16 / 9,
      0.07,
      1500,
    );
    cam.position.set(
      0,
      rig.height + speed * rig.heightPerMS,
      -rig.distance - speed * rig.distancePerMS,
    );
    cam.lookAt(0, rig.lookLift, rig.lookAhead);
    cam.updateMatrixWorld();
    for (const x of [-1.04, 1.04]) {
      const corner = new T.Vector3(x, -0.5, -2.43).project(cam);
      expect(corner.y).toBeGreaterThan(-0.91);
      expect(Math.abs(corner.x)).toBeLessThan(0.55);
    }
    const horizon = new T.Vector3(0, 0, 1200).project(cam).y;
    expect(horizon).toBeGreaterThan(0.12);
    expect(horizon).toBeLessThan(0.38);
  }
});

it('reads curvature from the asphalt and drops the lead when reversing or leaving the circuit', () => {
  const track = new Track(),
    rig = new FormulaChaseSightline(),
    q = trackPoint();
  let strongest = 0;
  for (let s = 0; s < track.length; s += 20) {
    const here = track.at(s, q);
    const forward = new T.Vector3(here.tx, 0, here.tz),
      aim = new T.Vector3();
    rig.apply(track, s, 0, 61, forward, aim);
    strongest = Math.max(strongest, Math.hypot(aim.x, aim.z));
    expect(Math.hypot(aim.x, aim.z)).toBeLessThanOrEqual(0.681);
    expect(Math.abs(aim.y)).toBeLessThanOrEqual(0.32);
    for (const [road, v, heading] of [
      [here.width + 4, 61, forward],
      [0, 2, forward],
      [0, 61, forward.clone().negate()],
    ] as const) {
      const held = new T.Vector3();
      rig.apply(track, s, road, v, heading, held);
      expect(held.lengthSq()).toBe(0);
    }
  }
  expect(strongest).toBeGreaterThan(0.5);
});
