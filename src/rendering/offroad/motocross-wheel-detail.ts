import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RiderDetail } from '../rider.ts';

/** An annular stepped hub with bearing shoulders and spoke flanges. Its open
 * bore receives the bike's existing fixed axle, while this part turns with
 * the wheel. Profile coordinates are radius and axial distance in metres. */
export function motocrossWheelHub(detail: RiderDetail) {
  const profile = [
    [0.0105, -0.051],
    [0.023, -0.051],
    [0.027, -0.047],
    [0.027, -0.045],
    [0.05, -0.045],
    [0.05, -0.038],
    [0.042, -0.035],
    [0.025, -0.027],
    [0.023, -0.016],
    [0.023, 0.016],
    [0.025, 0.027],
    [0.042, 0.035],
    [0.05, 0.038],
    [0.05, 0.045],
    [0.027, 0.045],
    [0.027, 0.047],
    [0.023, 0.051],
    [0.0105, 0.051],
    [0.0105, -0.051],
  ].map(([radius, axial]) => new T.Vector2(radius, axial));
  const geometry = new T.LatheGeometry(profile, detail === 'high' ? 24 : 16);
  geometry.rotateZ(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Ref 005/001: each hub flange has both leading and trailing spokes.
 * The two adjacent spokes of a same-side pair pull in opposite directions;
 * making all spokes on a flange sweep one way loses the crossed structure.
 * Rim seats alternate across the centreline and every nipple follows its
 * actual spoke axis, embedded in the rim instead of floating above it. */
export function motocrossWheelSpokes(rim: number, detail: RiderDetail) {
  const count = detail === 'high' ? 36 : 20,
    perSide = count / 2,
    cross = detail === 'high' ? 2 : 1,
    parts: T.BufferGeometry[] = [],
    axis = new T.Vector3(0, 1, 0);
  for (let k = 0; k < count; k++) {
    const side = k % 2 === 0 ? 1 : -1,
      direction = Math.floor(k / 2) % 2 === 0 ? 1 : -1,
      angle = (k / count) * Math.PI * 2,
      rimAngle = angle + (direction * cross * Math.PI * 2) / perSide,
      // Alternating heads enter opposite faces of the flange. The small dish
      // separation keeps the crossing shafts from occupying one plane.
      from = new T.Vector3(
        side * (direction > 0 ? 0.0455 : 0.0375),
        Math.cos(angle) * 0.047,
        Math.sin(angle) * 0.047,
      ),
      to = new T.Vector3(
        side * 0.008,
        Math.cos(rimAngle) * (rim - 0.001),
        Math.sin(rimAngle) * (rim - 0.001),
      ),
      vector = to.clone().sub(from).normalize(),
      orientation = new T.Quaternion().setFromUnitVectors(axis, vector),
      centre = from.clone().add(to).multiplyScalar(0.5),
      spoke = new T.CylinderGeometry(0.0019, 0.0019, from.distanceTo(to), 4, 1, true);
    spoke.applyQuaternion(orientation);
    spoke.translate(centre.x, centre.y, centre.z);
    parts.push(spoke);
    const nippleCentre = to.clone().addScaledVector(vector, -0.006),
      nipple = new T.CylinderGeometry(0.0031, 0.0027, 0.012, detail === 'high' ? 6 : 4);
    nipple.applyQuaternion(orientation);
    nipple.translate(nippleCentre.x, nippleCentre.y, nippleCentre.z);
    parts.push(nipple);
  }
  const geometry = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
