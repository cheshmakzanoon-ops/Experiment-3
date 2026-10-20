import * as T from 'three';
import { smoothGpSuitSeams } from './gp-rider-suit.ts';

/** Original forged blade, in metres from the existing master-cylinder pivot.
 * REF065/076 establish the relationship of the lever, grip and gauntlet.
 * These are authored ergonomic dimensions, not measurements from photographs.
 * The former straight blade sat about 100 mm ahead of the grip; a finger
 * could not reach it without stretching. The swept blade retains its hinge
 * while bringing the contact surface within the glove's fixed joint reach. */
const blade = new T.CatmullRomCurve3([
  new T.Vector3(0, 0, 0),
  new T.Vector3(-0.02, -0.002, -0.022),
  new T.Vector3(-0.05, -0.01, -0.034),
  new T.Vector3(-0.083, -0.015, -0.037),
  new T.Vector3(-0.116, -0.02, -0.037),
  new T.Vector3(-0.143, -0.02, -0.031),
]);

export function gpFrontBrakeAngle(brake = 0) {
  return -0.25 * (Number.isFinite(brake) ? T.MathUtils.clamp(brake, 0, 1) : 0);
}

const tangent = new T.Vector3(),
  front = new T.Vector3(),
  up = new T.Vector3();

function bladeFrame(t: number) {
  blade.getTangentAt(t, tangent);
  front.set(0, 0, 1).addScaledVector(tangent, -tangent.z).normalize();
  up.crossVectors(front, tangent).normalize().negate();
}

/** Centre of the covered fingertip. Its 4.5 mm leather pad rests against
 * the forward face of the 6.5 mm blade; the hand keeps hold of the grip. */
export function gpFrontBrakeFingerTarget(finger: 0 | 1, out: T.Vector3) {
  const t = finger === 0 ? 0.51 : 0.62;
  bladeFrame(t);
  return blade.getPointAt(t, out).addScaledVector(front, 0.011);
}

export function gpFrontBrakeTip(out: T.Vector3) {
  return blade.getPointAt(1, out);
}

/** A closed, rounded blade with a thicker pivot and a returned safety tip.
 * One mesh/material replaces the old rectangular bar, with no added draw. */
export function gpFrontBrakeGeometry() {
  const rows = 28,
    sides = 8,
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    centre = new T.Vector3(),
    point = new T.Vector3();
  for (let row = 0; row <= rows; row++) {
    const t = row / rows,
      pivot = 1 - T.MathUtils.smoothstep(t, 0, 0.18),
      end = T.MathUtils.smoothstep(t, 0.92, 1),
      depth = 0.0065 + pivot * 0.003 + end * 0.0015,
      height = 0.004 + pivot * 0.001 + end * 0.0015;
    blade.getPointAt(t, centre);
    bladeFrame(t);
    for (let column = 0; column <= sides; column++) {
      const angle = (column / sides) * Math.PI * 2;
      point
        .copy(centre)
        .addScaledVector(front, Math.cos(angle) * depth)
        .addScaledVector(up, Math.sin(angle) * height);
      positions.push(point.x, point.y, point.z);
      uv.push(t, column / sides);
      if (row < rows && column < sides) {
        const a = row * (sides + 1) + column,
          b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  for (const row of [0, rows]) {
    blade.getPointAt(row / rows, centre);
    const cap = positions.length / 3,
      ring = row * (sides + 1);
    positions.push(centre.x, centre.y, centre.z);
    uv.push(row / rows, 0.5);
    for (let column = 0; column < sides; column++)
      if (row === 0) indices.push(cap, ring + column + 1, ring + column);
      else indices.push(cap, ring + column, ring + column + 1);
  }
  const geometry = new T.BufferGeometry();
  geometry.name = 'GP swept forged front-brake blade';
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  smoothGpSuitSeams(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
