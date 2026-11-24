import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { add, type BikeMaterials } from '../bike.ts';
import type { RiderDetail } from '../rider.ts';
import { MX_FRONT_HOSE_JOIN } from './motocross-mechanics.ts';

/** A slip-on grip in its own rotating frame. +axial points toward the bar
 * end. The palm rests on a smooth crown, the fingers find raised half-waffles
 * underneath and the inboard flange and wire grooves are part of the rubber. */
export function motocrossGrip(detail: RiderDetail, side: number) {
  const high = detail === 'high',
    sides = high ? 20 : 12;
  const rows: [number, number, number][] = [
    [-0.061, 0.016, 0],
    [-0.0605, 0.024, 0],
    [-0.059, 0.027, 0],
    [-0.056, 0.026, 0],
    [-0.053, 0.019, 0],
    [-0.05, 0.018, 0],
    [-0.0485, 0.0168, 0],
    [-0.0465, 0.0168, 0],
    [-0.045, 0.018, 0],
  ];
  const repeats = high ? 8 : 5;
  for (let row = 0; row < repeats; row++) {
    const start = -0.044 + row * (0.089 / repeats),
      width = 0.089 / repeats;
    rows.push(
      [start, 0.0177, 0],
      [start + width * 0.25, 0.0177, 1],
      [start + width * 0.65, 0.0177, 1],
    );
  }
  rows.push(
    [0.046, 0.018, 0],
    [0.0475, 0.0168, 0],
    [0.0495, 0.0168, 0],
    [0.051, 0.018, 0],
    [0.058, 0.0188, 0],
    [0.061, 0.0175, 0],
    [0.063, 0.014, 0],
  );
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (const [row, [axial, radius, relief]] of rows.entries()) {
    for (let k = 0; k <= sides; k++) {
      const angle = (2 * Math.PI * k) / sides;
      const underside = T.MathUtils.smoothstep(-Math.cos(angle), -0.32, 0.26);
      const blocks = k % 4 === 0 ? 0 : k % 4 === 2 ? 1 : 0.7;
      const r = radius + relief * 0.0022 * underside * blocks;
      positions.push(side * axial, r * Math.cos(angle), r * Math.sin(angle));
      uvs.push((axial + 0.061) / 0.124, k / sides);
      if (row && k) {
        const c = row * (sides + 1) + k,
          a = c - sides - 2;
        if (side > 0) indices.push(a, a + 1, c, a, c, c - 1);
        else indices.push(a, c, a + 1, a, c - 1, c);
      }
    }
  }
  // End caps have their own planar UVs and normals.
  for (const row of [0, rows.length - 1]) {
    const centre = positions.length / 3,
      outward = (row ? 1 : -1) * side;
    positions.push(side * rows[row][0], 0, 0);
    uvs.push(0.5, 0.5);
    for (let k = 0; k <= sides; k++) {
      const i = (row * (sides + 1) + k) * 3;
      positions.push(positions[i], positions[i + 1], positions[i + 2]);
      uvs.push(
        0.5 + (0.5 * positions[i + 1]) / rows[row][1],
        0.5 + (0.5 * positions[i + 2]) / rows[row][1],
      );
      if (k) {
        if (outward > 0) indices.push(centre, centre + k, centre + k + 1);
        else indices.push(centre, centre + k + 1, centre + k);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const seam = new T.Vector3(),
    other = new T.Vector3();
  for (let row = 0; row < rows.length; row++) {
    const a = row * (sides + 1),
      b = a + sides;
    seam.fromBufferAttribute(normals, a).add(other.fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, seam.x, seam.y, seam.z);
    normals.setXYZ(b, seam.x, seam.y, seam.z);
  }
  return geometry;
}

/** Forged lever in its pivot frame. The root flares around the pivot, the
 * shank sweeps forward, and the indexed fingers meet the broad outer blade. */
export function motocrossLeverBlade(side: number) {
  // Distance from pivot, fore/aft sweep, half-depth and half-thickness.
  const sections = [
    [0, 0, 0.009, 0.0038],
    [0.009, 0.001, 0.013, 0.004],
    [0.026, 0.005, 0.0115, 0.0038],
    [0.05, 0.008, 0.009, 0.0035],
    [0.077, 0.0035, 0.008, 0.0037],
    [0.098, 0, 0.0085, 0.004],
    [0.123, 0, 0.008, 0.004],
    [0.14, 0, 0.004, 0.0032],
  ];
  const profile = [
    [1, 0.56],
    [0.66, 1],
    [-0.66, 1],
    [-1, 0.56],
    [-1, -0.56],
    [-0.66, -1],
    [0.66, -1],
    [1, -0.56],
  ];
  const p: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  const tri = (a: number, b: number, c: number) => {
    if (side > 0) index.push(a, b, c);
    else index.push(a, c, b);
  };
  for (const [row, [axial, sweep, depth, thickness]] of sections.entries()) {
    for (const [k, [y, z]] of profile.entries()) {
      p.push(side * axial, y * thickness, sweep + z * depth);
      uv.push(axial / 0.14, k / profile.length);
      if (!row) continue;
      const a = (row - 1) * profile.length + k;
      const b = (row - 1) * profile.length + ((k + 1) % profile.length);
      tri(a, b, b + profile.length);
      tri(a, b + profile.length, a + profile.length);
    }
  }
  for (let k = 1; k < profile.length - 1; k++) {
    const end = (sections.length - 1) * profile.length;
    tri(0, k + 1, k);
    tri(end, end + k, end + k + 1);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** Upper control lines travel with the bars. The first bend clears the
 * number plate. The brake joins the moving fork hose along its own tangent. */
function addUpperControlLine(
  steer: T.Group, m: BikeMaterials, side: number, high: boolean, barY: number, barZ: number,
) {
  const brake = side < 0;
  const start = brake
    ? new T.Vector3(-0.228, barY + 0.008, barZ + 0.048)
    : new T.Vector3(0.241, barY + 0.005, barZ + 0.0595);
  const lead = brake ? new T.Vector3(0.46, 0.26, 0.85).normalize() : new T.Vector3(0, 0, 1);
  const length = brake ? 0.017 : 0.011;
  const outlet = start.clone().addScaledVector(lead, length);
  const crest = new T.Vector3(side * 0.17, barY + 0.064, barZ + 0.109);
  const bend = new T.Vector3(-side * 0.026, -0.016, -0.002);
  const join = MX_FRONT_HOSE_JOIN;
  const end = brake ? new T.Vector3(join.x, join.y, join.z) : new T.Vector3(0.054, 0.11, 0.05);
  const exit = brake
    ? new T.Vector3(join.dx, join.dy, join.dz).normalize()
    : new T.Vector3(-0.32, -0.94, -0.12).normalize();

  const path = new T.CurvePath<T.Vector3>();
  path.add(new T.CubicBezierCurve3(outlet, outlet.clone().addScaledVector(lead, 0.045),
    crest.clone().sub(bend), crest));
  path.add(new T.CubicBezierCurve3(crest, crest.clone().add(bend),
    end.clone().addScaledVector(exit, -0.045), end));
  const hose = add(steer, new T.TubeGeometry(path, 20, brake ? 0.004 : 0.0032, 5, false), m.dark);
  hose.name = brake ? 'Motocross master-cylinder hose' : 'Motocross clutch cable housing';

  // The eye is clamped to the inboard face of the hydraulic reservoir.
  // The opposite side has a cable ferrule seated in its axial barrel adjuster.
  if (brake) {
    const eye = add(steer, new T.CylinderGeometry(0.0075, 0.0075, 0.006, high ? 12 : 8),
      m.aluminium, -0.229, barY + 0.008, barZ + 0.046);
    eye.rotation.z = Math.PI / 2;
    const bolt = add(steer, new T.CylinderGeometry(0.0055, 0.0055, 0.0036, 6),
      m.steel, -0.2248, barY + 0.008, barZ + 0.046);
    bolt.rotation.z = Math.PI / 2;
    // Rubber chafe protection covers the two tube rings at the number plate.
    const sleeve = add(steer, new T.CylinderGeometry(0.0052, 0.0052, 0.014, high ? 10 : 8), m.dark);
    sleeve.position.copy(end);
    sleeve.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), exit);
  }
  const ferrule = add(steer,
    new T.CylinderGeometry(brake ? 0.0052 : 0.0042, brake ? 0.006 : 0.005, length, high ? 10 : 8),
    brake ? m.aluminium : m.dark);
  ferrule.name = brake ? 'Motocross brake hose crimp' : 'Motocross clutch adjuster ferrule';
  ferrule.position.copy(start).addScaledVector(lead, length / 2);
  ferrule.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), lead);
}

/** Split saddles sit on the top yoke. The front master cylinder and cable
 * clutch each have a fixed perch under the lever pivot. All of this hardware
 * belongs to the existing steering batches. Dimensions are in metres. */
export function addMotocrossControlMounts(
  steer: T.Group,
  detail: RiderDetail,
  m: BikeMaterials,
  barY: number,
  barZ: number,
) {
  const high = detail === 'high';
  for (const side of [-1, 1]) {
    const clampX = side * 0.071,
      clampZ = barZ + 0.032;
    add(
      steer,
      new RoundedBoxGeometry(0.035, 0.045, 0.047, 1, 0.006),
      m.aluminium,
      clampX,
      barY - 0.07,
      clampZ,
    );
    add(
      steer,
      new RoundedBoxGeometry(0.035, 0.015, 0.052, 1, 0.005),
      m.dark,
      clampX,
      barY - 0.041,
      clampZ,
    );
    for (const fore of [-1, 1])
      add(
        steer,
        new T.CylinderGeometry(0.005, 0.005, 0.004, 6),
        m.steel,
        clampX,
        barY - 0.032,
        clampZ + fore * 0.017,
      );

    addUpperControlLine(steer, m, side, high, barY, barZ);
    const x = side * 0.251;
    add(
      steer,
      new T.CylinderGeometry(0.017, 0.017, 0.016, high ? 16 : 10),
      m.dark,
      x,
      barY - 0.009,
      barZ + 0.016,
    ).rotation.z = Math.PI / 2;
    const pivotX = side * (0.3 - Math.cos(0.25) * 0.07);
    const pivotZ = barZ + 0.07 + Math.sin(0.25) * 0.07;
    const perch = add(
      steer,
      new RoundedBoxGeometry(0.021, 0.018, 0.082, 1, 0.005),
      m.dark,
      (x + pivotX) / 2,
      barY - 0.019,
      (barZ + 0.016 + pivotZ) / 2,
    );
    perch.rotation.y = Math.atan2(pivotX - x, pivotZ - barZ - 0.016);
    add(
      steer,
      new T.CylinderGeometry(0.006, 0.006, 0.007, 6),
      m.steel,
      pivotX,
      barY - 0.004,
      pivotZ,
    );
    if (side < 0) {
      add(
        steer,
        new RoundedBoxGeometry(0.04, 0.025, 0.047, 1, 0.005),
        m.dark,
        x,
        barY + 0.008,
        barZ + 0.036,
      );
      add(
        steer,
        new RoundedBoxGeometry(0.042, 0.005, 0.049, 1, 0.002),
        m.aluminium,
        x,
        barY + 0.023,
        barZ + 0.036,
      );
      if (high)
        for (const k of [-1, 1])
          add(
            steer,
            new T.CylinderGeometry(0.0026, 0.0026, 0.002, 8),
            m.steel,
            x + k * 0.014,
            barY + 0.026,
            barZ + 0.036 + k * 0.017,
          );
    } else {
      add(
        steer,
        new T.CylinderGeometry(0.006, 0.006, 0.033, 10),
        m.aluminium,
        x - 0.01,
        barY + 0.005,
        barZ + 0.043,
      ).rotation.x = Math.PI / 2;
      add(
        steer,
        new T.CylinderGeometry(0.009, 0.009, 0.005, high ? 12 : 8),
        m.dark,
        x - 0.01,
        barY + 0.005,
        barZ + 0.035,
      ).rotation.x = Math.PI / 2;
    }
  }
}
