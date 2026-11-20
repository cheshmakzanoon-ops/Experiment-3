import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';

const TAU = 2 * Math.PI;
/** In the rear axle frame, metres. The swept steel track and five mounting
 * webs are one dished stamping. The caliper and its axle-mounted stay are
 * carried by the swingarm, independent of the spinning disc. */
export const GP_REAR_DISC = Object.freeze({
  x: -0.085,
  radius: 0.11,
  trackInner: 0.082,
  thickness: 0.0045,
  hubRadius: 0.05,
  hubOffset: 0.024,
  bore: 0.021,
  bolts: 5,
});

export function gpRearRotor(detail: RiderDetail) {
  const d = GP_REAR_DISC,
    high = detail === 'high',
    far = detail === 'far';
  const ring = (outer: number, inner: number) => {
    const plate = new T.Shape(),
      bore = new T.Path();
    plate.absarc(0, 0, outer, 0, TAU, false);
    bore.absarc(0, 0, inner, 0, TAU, true);
    plate.holes.push(bore);
    return plate;
  };
  const track = ring(d.radius, d.trackInner),
    hub = ring(d.hubRadius, d.bore);
  const pieces: T.BufferGeometry[] = [];
  for (let i = 0; i < d.bolts; i++) {
    const a = (i * TAU) / d.bolts;
    if (!far) {
      const bolt = new T.Path();
      bolt.absarc(0.037 * Math.cos(a), 0.037 * Math.sin(a), 0.0033, 0, TAU, true);
      hub.holes.push(bolt);
    }
    if (high) {
      // Two staggered sweeps per web leave a continuous outside edge.
      for (let j = 0; j < 2; j++)
        for (let k = 0; k < 3; k++) {
          const angle = a + (j * Math.PI) / d.bolts + 0.07 * k,
            radius = 0.089 + 0.0065 * k;
          const x = radius * Math.cos(angle),
            y = radius * Math.sin(angle),
            hole = new T.Path();
          for (let side = 0; side < 6; side++) {
            const phi = (-side * TAU) / 6,
              px = x + 0.0019 * Math.cos(phi),
              py = y + 0.0019 * Math.sin(phi);
            if (side === 0) hole.moveTo(px, py);
            else hole.lineTo(px, py);
          }
          hole.closePath();
          track.holes.push(hole);
        }
    }
    // Only the five webs are dished. Form the radial stations explicitly:
    // triangulating a bent plate in projection can warp its friction face.
    const steps = high ? 6 : 3,
      positions: number[] = [],
      uv: number[] = [],
      index: number[] = [];
    for (let row = 0; row <= steps; row++) {
      const t = row / steps,
        r = T.MathUtils.lerp(d.hubRadius - 0.003, d.trackInner + 0.002, t),
        centre = a + 0.24 * t,
        half = T.MathUtils.lerp(0.2, 0.14, t),
        x = d.hubOffset * (1 - T.MathUtils.smoothstep(t, 0.07, 0.93));
      for (const [wall, side] of [
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ]) {
        const theta = centre + side * half;
        positions.push(x + wall * d.thickness * 0.4, r * Math.sin(theta), -r * Math.cos(theta));
        uv.push((side + 1) / 2, t);
      }
      if (row < steps)
        for (let j = 0; j < 4; j++) {
          const p = 4 * row + j,
            q = 4 * row + ((j + 1) % 4);
          index.push(p, p + 4, q, q, p + 4, q + 4);
        }
    }
    const web = new T.BufferGeometry();
    web.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    web.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    web.setIndex(index);
    const flat = web.toNonIndexed();
    flat.computeVertexNormals();
    pieces.push(flat);
    web.dispose();
  }
  for (const [shape, offset] of [
    [track, 0],
    [hub, d.hubOffset],
  ] as const) {
    const plate = new T.ExtrudeGeometry(shape, {
      depth: d.thickness,
      bevelEnabled: false,
      curveSegments: high ? 18 : far ? 8 : 12,
    });
    plate.translate(0, 0, -d.thickness / 2);
    plate.rotateY(Math.PI / 2);
    plate.translate(offset, 0, 0);
    pieces.push(plate);
  }
  const geometry = mergeGeometries(pieces, false)!;
  for (const part of pieces) part.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = 'GP dished five-web rear brake rotor';
  return geometry;
}

type Finishes = Pick<BikeMaterials, 'aluminium' | 'dark' | 'caliper' | 'steel'>;

/** Axle-frame +Z is radial, +Y is tangent to the disc. Both pad faces stand
 * just clear of the steel and their connecting bridge passes over its rim. */
export function gpRearBrakeCaliper(detail: Exclude<RiderDetail, 'far'>, m: Finishes) {
  const group = new T.Group(),
    high = detail === 'high',
    d = GP_REAR_DISC;
  group.name = 'GP underslung rear brake and torque stay';
  group.rotation.x = 0.78;
  group.position.x = d.x;
  const add = (g: T.BufferGeometry, material: T.Material, x: number, y: number, z: number) => {
    const mesh = new T.Mesh(g, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const axleCylinder = (
    r: number,
    depth: number,
    sides: number,
    material: T.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const g = new T.CylinderGeometry(r, r, depth, sides);
    g.rotateZ(Math.PI / 2);
    return add(g, material, x, y, z);
  };
  const stay = new T.Shape();
  stay.moveTo(-0.022, 0);
  stay.quadraticCurveTo(-0.022, -0.025, 0.008, -0.022);
  stay.quadraticCurveTo(0.024, -0.02, 0.024, 0.005);
  stay.lineTo(0.034, 0.079);
  stay.quadraticCurveTo(0.034, 0.094, 0.019, 0.094);
  stay.lineTo(-0.026, 0.094);
  stay.quadraticCurveTo(-0.039, 0.091, -0.032, 0.075);
  stay.lineTo(-0.007, 0.061);
  stay.closePath();
  const eye = new T.Path();
  eye.absarc(0, 0, 0.011, 0, TAU, true);
  stay.holes.push(eye);
  const slot = new T.Path();
  slot.moveTo(0.003, 0.029);
  slot.lineTo(-0.002, 0.066);
  slot.lineTo(0.018, 0.077);
  slot.lineTo(0.017, 0.052);
  slot.closePath();
  stay.holes.push(slot);
  const bracket = new T.ExtrudeGeometry(stay, {
    depth: 0.006,
    bevelEnabled: false,
    curveSegments: high ? 10 : 5,
  });
  // Shape XY -> tangent/radial, extrusion Z -> axle.
  bracket.rotateY(Math.PI / 2);
  bracket.rotateX(Math.PI / 2);
  add(bracket, m.aluminium, -0.038, 0, 0);
  for (const side of [-1, 1]) {
    const casting = new RoundedBoxGeometry(0.012, 0.071, 0.036, high ? 2 : 1, 0.005);
    add(casting, m.caliper, side * 0.013, 0, 0.099);
    add(new T.BoxGeometry(0.003, 0.052, 0.021), m.dark, side * 0.005, 0, 0.096);
  }
  for (const y of [-0.024, 0.024]) {
    add(new RoundedBoxGeometry(0.034, 0.014, 0.012, 1, 0.0025), m.caliper, 0, y, 0.116);
    axleCylinder(0.006, 0.024, high ? 12 : 6, m.aluminium, -0.026, y, 0.086);
    if (high) axleCylinder(0.0048, 0.003, 6, m.steel, -0.039, y, 0.086);
  }
  if (high) {
    axleCylinder(0.013, 0.003, 16, m.caliper, -0.02, 0, 0.099);
    axleCylinder(0.004, 0.008, 6, m.steel, -0.024, 0.025, 0.104);
  }
  return group;
}
