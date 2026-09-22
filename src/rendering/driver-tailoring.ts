import * as T from 'three';

/** Unit bone length, metre-scale cross sections. DriverRig alone owns bone
 * length and joint transforms; this surface never moves its hardpoints. */
export const UPPER_SLEEVE = Object.freeze([
  [0, 0.052, 0.045],
  [0.12, 0.061, 0.048],
  [0.32, 0.065, 0.049],
  [0.55, 0.058, 0.046],
  [0.76, 0.049, 0.043],
  [1, 0.044, 0.04],
] as const);
export const LOWER_SLEEVE = Object.freeze([
  [0, 0.041, 0.038],
  [0.15, 0.047, 0.039],
  [0.36, 0.043, 0.034],
  [0.6, 0.037, 0.029],
  [0.82, 0.032, 0.027],
  [1, 0.029, 0.026],
] as const);
export function sleeveSection(upper: boolean, u: number, angle: number) {
  if (!Number.isFinite(u) || u < 0 || u > 1 || !Number.isFinite(angle))
    throw new Error('Invalid sleeve station');
  const profile = upper ? UPPER_SLEEVE : LOWER_SLEEVE;
  let k = 0;
  while (k < profile.length - 2 && profile[k + 1][0] < u) k++;
  const a = profile[k],
    b = profile[k + 1],
    f = (u - a[0]) / (b[0] - a[0]);
  const t = f * f * (3 - 2 * f),
    rx = a[1] + (b[1] - a[1]) * t,
    rz = a[2] + (b[2] - a[2]) * t;
  const envelope = Math.sin(Math.PI * u) ** 2;
  const joint = Math.exp(-(((u - (upper ? 0.78 : 0.16)) / 0.2) ** 2));
  // Every angular harmonic is integral. A fractional angular frequency opens
  // the UV seam: its 0 and 2*pi vertices and derivatives would disagree.
  const fan = (Math.sin(u * 31 + angle * 2) + 0.35 * Math.sin(u * 53 - angle * 3)) * joint * 0.034;
  const seam = Math.exp(-((Math.sin(angle - 0.7) / 0.14) ** 2)) * 0.012;
  const fold = 1 + envelope * (fan + seam);
  const twist = upper ? 0 : (u - 0.5) * 0.19;
  const x = Math.cos(angle) * rx * fold,
    z = Math.sin(angle) * rz * fold;
  return new T.Vector3(
    x * Math.cos(twist) - z * Math.sin(twist),
    u - 0.5,
    x * Math.sin(twist) + z * Math.cos(twist),
  );
}
export function tailoredSleeve(upper: boolean) {
  const rows = 28,
    sides = 24,
    positions: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let row = 0; row <= rows; row++)
    for (let side = 0; side <= sides; side++) {
      // Duplicate UVs, not slightly different positions: weld the geometric seam
      // exactly even after float32 conversion while retaining the full UV range.
      const p = sleeveSection(upper, row / rows, ((side % sides) / sides) * Math.PI * 2);
      positions.push(p.x, p.y, p.z);
      uv.push(side / sides, row / rows);
      if (row < rows && side < sides) {
        const a = row * (sides + 1) + side,
          b = a + sides + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  for (const row of [0, rows]) {
    const c = positions.length / 3;
    positions.push(0, row / rows - 0.5, 0);
    uv.push(0.5, 0.5);
    for (let side = 0; side <= sides; side++) {
      const k = (row * (sides + 1) + side) * 3;
      positions.push(positions[k], positions[k + 1], positions[k + 2]);
      const theta = (side / sides) * Math.PI * 2;
      uv.push((Math.cos(theta) + 1) / 2, (Math.sin(theta) + 1) / 2);
      if (side < sides) {
        if (row === 0) index.push(c, c + side + 1, c + side + 2);
        else index.push(c, c + side + 2, c + side + 1);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal'),
    average = new T.Vector3();
  for (let row = 0; row <= rows; row++) {
    const first = row * (sides + 1),
      last = first + sides;
    average
      .set(
        normal.getX(first) + normal.getX(last),
        normal.getY(first) + normal.getY(last),
        normal.getZ(first) + normal.getZ(last),
      )
      .normalize();
    normal.setXYZ(first, average.x, average.y, average.z);
    normal.setXYZ(last, average.x, average.y, average.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = upper ? 'Tailored upper sleeve' : 'Tailored forearm sleeve';
  return geometry;
}

/** Seal hidden solid halo attachments, never an air intake or cooling duct.
 * Preserve the tube's analytic side normals and keep flat end-cap normals
 * separate, so sealing the solid does not introduce a longitudinal highlight. */
export function capSafetyTube(geometry: T.TubeGeometry) {
  if (geometry.parameters.closed) throw new Error('A closed-loop tube has no attachment ends');
  if (geometry.userData.safetyEndsCapped) return geometry;
  const position = geometry.getAttribute('position'),
    texture = geometry.getAttribute('uv'),
    normal = geometry.getAttribute('normal');
  const points = Array.from(position.array),
    uv = Array.from(texture.array),
    normals = Array.from(normal.array),
    index = Array.from(geometry.index!.array);
  const sides = geometry.parameters.radialSegments,
    rows = geometry.parameters.tubularSegments;
  for (const row of [0, rows]) {
    const c = points.length / 3,
      centre = new T.Vector3();
    const outward = geometry.parameters.path
      .getTangent(row / rows)
      .normalize()
      .multiplyScalar(row === 0 ? -1 : 1);
    for (let j = 0; j < sides; j++)
      centre.add(new T.Vector3().fromBufferAttribute(position, row * (sides + 1) + j));
    centre.multiplyScalar(1 / sides);
    points.push(centre.x, centre.y, centre.z);
    uv.push(0.5, 0.5);
    normals.push(outward.x, outward.y, outward.z);
    for (let j = 0; j <= sides; j++) {
      const k = row * (sides + 1) + j;
      points.push(position.getX(k), position.getY(k), position.getZ(k));
      normals.push(outward.x, outward.y, outward.z);
      uv.push(
        (Math.cos((j / sides) * Math.PI * 2) + 1) / 2,
        (Math.sin((j / sides) * Math.PI * 2) + 1) / 2,
      );
      if (j < sides) {
        const a = new T.Vector3().fromBufferAttribute(position, k).sub(centre);
        const b = new T.Vector3().fromBufferAttribute(position, k + 1).sub(centre);
        if (a.cross(b).dot(outward) > 0) index.push(c, c + j + 1, c + j + 2);
        else index.push(c, c + j + 2, c + j + 1);
      }
    }
  }
  geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.safetyEndsCapped = true;
  return geometry;
}
