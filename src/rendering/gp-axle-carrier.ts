import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RiderDetail } from './rider.ts';

/** The inverted fork ends in a tapered forging around the through-axle.
 * Stations run across the bike. Each circular boss opens into the stanchion
 * neck above, and all levels keep the same through-bore and exterior profile. */
export function gpAxleCarrier(side: number, detail: RiderDetail) {
  const seg = detail === 'high' ? 20 : detail === 'mid' ? 14 : 10;
  const points: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const rings = [
    [-0.024, 0.013, 0],
    [-0.025, 0.024, 0.052],
    [-0.02, 0.031, 0.064],
    [0.014, 0.03, 0.063],
    [0.024, 0.023, 0.043],
    [0.0245, 0.016, 0.004],
    [0.022, 0.013, 0],
  ];
  for (const [x, rise, neck] of rings) {
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2,
        top = Math.max(0, Math.cos(a));
      points.push(
        side * x,
        rise * Math.cos(a) + neck * top ** 3,
        rise * Math.sin(a) - neck * 0.1 * top ** 2,
      );
      uv.push(j / seg, (x + 0.025) / 0.05);
    }
  }
  // Close the bore between the two recessed lips and keep it open to light.
  for (let i = 0; i < rings.length; i++) {
    const next = (i + 1) % rings.length;
    for (let j = 0; j < seg; j++) {
      const k = (j + 1) % seg,
        a = i * seg + j,
        b = next * seg + j,
        c = i * seg + k,
        d = next * seg + k;
      if (side > 0) indices.push(a, c, b, c, d, b);
      else indices.push(a, b, c, c, b, d);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The small clamp bolts belong to the sliding fork. A solid axle occupies
 * the carrier bore; its end is visible inside the hollow six-sided retainer. */
export function gpAxleFasteners(side: number) {
  const ring = new T.LatheGeometry(
    [
      new T.Vector2(0.008, -0.0028),
      new T.Vector2(0.0149, -0.0028),
      new T.Vector2(0.016, -0.0016),
      new T.Vector2(0.016, 0.0016),
      new T.Vector2(0.0145, 0.003),
      new T.Vector2(0.008, 0.003),
      new T.Vector2(0.008, -0.0028),
    ],
    6,
  );
  ring.rotateZ((-side * Math.PI) / 2).translate(side * 0.025, 0, 0);
  const pieces = [ring];
  for (const y of [0.035, 0.055]) {
    const bolt = new T.CylinderGeometry(0.0052, 0.0052, 0.0065, 6, 1);
    bolt.rotateZ(Math.PI / 2).translate(side * (y > 0.04 ? 0.02 : 0.023), y, -0.013);
    pieces.push(bolt);
  }
  const joined = mergeGeometries(pieces, false)!;
  pieces.forEach((g) => g.dispose());
  return joined;
}
