import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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
export function motocrossWheelSpokes(rim: number, detail: RiderDetail, exposureHalfWidth?: number) {
  const distant = detail === 'far';
  const count = detail === 'high' ? 36 : distant ? 12 : 20,
    flange = distant ? 0.033 : 0.047,
    perSide = count / 2,
    cross = detail === 'high' ? 2 : 1,
    parts: T.BufferGeometry[] = [],
    axis = new T.Vector3(0, 1, 0);
  let nippleTemplate: T.BufferGeometry | undefined;
  if (!distant) {
    const blank = new T.CylinderGeometry(0.0031, 0.0027, 0.012, detail === 'high' ? 6 : 4);
    // The outer cap is buried in the rim. Compact the remaining flats and
    // the inboard shoulder once, before orienting copies on the actual shafts.
    const ix = blank.index!,
      cap = blank.groups[1];
    blank.setIndex([...ix.array.slice(0, cap.start), ...ix.array.slice(cap.start + cap.count)]);
    blank.clearGroups();
    nippleTemplate = mergeVertices(blank, 1e-6);
    blank.dispose();
  }
  for (let k = 0; k < count; k++) {
    const side = k % 2 === 0 ? 1 : -1,
      direction = Math.floor(k / 2) % 2 === 0 ? 1 : -1,
      angle = (k / count) * Math.PI * 2,
      rimAngle = angle + (direction * cross * Math.PI * 2) / perSide,
      // Alternating heads enter opposite faces of the flange. The small dish
      // separation keeps the crossing shafts from occupying one plane.
      from = new T.Vector3(
        side * (direction > 0 ? 0.0455 : 0.0375),
        Math.cos(angle) * flange,
        Math.sin(angle) * flange,
      ),
      to = new T.Vector3(
        side * 0.008,
        Math.cos(rimAngle) * (rim - 0.001),
        Math.sin(rimAngle) * (rim - 0.001),
      ),
      vector = to.clone().sub(from).normalize(),
      orientation = new T.Quaternion().setFromUnitVectors(axis, vector),
      centre = from.clone().add(to).multiplyScalar(0.5),
      radius = distant ? 0.003 : 0.0019,
      spoke = new T.CylinderGeometry(radius, radius, from.distanceTo(to), distant ? 3 : 4, 1, true);
    spoke.applyQuaternion(orientation);
    spoke.translate(centre.x, centre.y, centre.z);
    parts.push(spoke);
    if (!nippleTemplate) continue;
    const nippleCentre = to.clone().addScaledVector(vector, -0.006),
      nipple = nippleTemplate.clone();
    nipple.applyQuaternion(orientation);
    nipple.translate(nippleCentre.x, nippleCentre.y, nippleCentre.z);
    parts.push(nipple);
  }
  const geometry = mergeGeometries(parts, false)!;
  nippleTemplate?.dispose();
  for (const part of parts) part.dispose();
  if (exposureHalfWidth !== undefined) {
    // Both shafts and nipples contribute to photographed coverage. The
    // separate hoop, hub, carrier, sprocket and tread keep their exact pose.
    const count = geometry.getAttribute('position').count;
    const mask = new T.Float32BufferAttribute(new Float32Array(count * 2), 2);
    for (let i = 0; i < count; i++) mask.setXY(i, 1, exposureHalfWidth);
    geometry.setAttribute('roadSpoke', mask);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Cross-section of the rolled alloy hoop in wheel metres. The rolled edge
 * overlaps the rubber bead. The drop channel lies between the nipple seats;
 * it is visible through the spokes on both sides of the machine. */
export function motocrossRim(rim: number, halfWidth: number, segments: number) {
  const edge = halfWidth * 0.82 - 0.009;
  const section = [
    [-edge, 0.0105], [-edge + 0.002, 0.014], [-edge + 0.005, 0.013],
    [-edge * 0.64, 0.003], [0, -0.001],
    [edge * 0.64, 0.003], [edge - 0.005, 0.013], [edge - 0.002, 0.014], [edge, 0.0105],
    [edge * 0.78, -0.0005], [0, -0.006], [-edge * 0.78, -0.0005], [-edge, 0.0105],
  ];
  const geometry = new T.LatheGeometry(section.map(([x, offset]) =>
    new T.Vector2(rim + offset, x)), segments).rotateZ(Math.PI / 2);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Both service fittings project inward from the rim bed. Their two stations
 * fall between spoke nipples, and the valve's cap stays clear of the wires. */
export function motocrossRimFittings(rim: number, front: boolean, detail: RiderDetail) {
  const parts: T.BufferGeometry[] = [];
  const valve = (front ? 1.5 : 4.5) * Math.PI / 18;
  const collar = (angle: number, inset: number, length: number, outer: number, inner: number, sides: number) => {
    const g = new T.CylinderGeometry(outer, inner, length, sides);
    g.translate(0, rim - inset - length / 2, 0).rotateX(angle);
    parts.push(g);
  };
  const facets = detail === 'high' ? 10 : 6;
  collar(valve, 0.005, 0.004, 0.0075, 0.0065, facets);
  collar(valve, 0.009, 0.013, 0.0045, 0.0038, facets);
  collar(valve, 0.022, 0.01, 0.005, 0.0043, 8);
  const lock = valve + Math.PI * 0.78;
  collar(lock, 0.005, 0.003, 0.0105, 0.0105, facets);
  collar(lock, 0.008, 0.007, 0.008, 0.0073, 6);
  collar(lock, 0.015, 0.004, 0.0038, 0.0031, facets);
  const result = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return result;
}
