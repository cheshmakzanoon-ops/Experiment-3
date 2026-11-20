import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { add, type BikeMaterials } from '../bike.ts';
import type { RiderDetail } from '../rider.ts';

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
