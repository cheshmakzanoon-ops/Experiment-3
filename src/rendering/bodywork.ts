import * as T from 'three';
import { clamp } from '../core/math.ts';

export type BodySection = readonly [z: number, y: number, halfWidth: number, halfHeight: number];
/** Smooth, bounded longitudinal interpolation. Shape dimensions never overshoot
 * their authored envelopes; unlike an unconstrained spline this cannot create
 * inverted sidepods or a negative-width nose between narrow control sections. */
export function sampleBody(sections: readonly BodySection[], z: number): BodySection {
  if (
    !Number.isFinite(z) ||
    sections.length < 2 ||
    sections.some(
      (p, i) =>
        p.some((v) => !Number.isFinite(v)) ||
        p[2] <= 0 ||
        p[3] <= 0 ||
        (i > 0 && p[0] <= sections[i - 1][0]),
    )
  )
    throw new Error('Body sections must be finite, positive and ordered');
  z = clamp(z, sections[0][0], sections.at(-1)![0]);
  let i = 0;
  while (i < sections.length - 2 && sections[i + 1][0] < z) i++;
  const a = sections[i],
    b = sections[i + 1],
    prev = sections[Math.max(0, i - 1)],
    next = sections[Math.min(sections.length - 1, i + 2)];
  const dz = b[0] - a[0],
    t = (z - a[0]) / dz;
  const component = (axis: 1 | 2 | 3) => {
    const m0 = (b[axis] - prev[axis]) / (b[0] - prev[0]);
    const m1 = (next[axis] - a[axis]) / (next[0] - a[0]);
    return clamp(
      (2 * t ** 3 - 3 * t * t + 1) * a[axis] +
        (t ** 3 - 2 * t * t + t) * dz * m0 +
        (-2 * t ** 3 + 3 * t * t) * b[axis] +
        (t ** 3 - t * t) * dz * m1,
      Math.min(a[axis], b[axis]),
      Math.max(a[axis], b[axis]),
    );
  };
  return [z, component(1), component(2), component(3)];
}

/** Near-car shell. Cross-section flattening and a narrower ventral section give
 * the sidepod a real undercut instead of an inflated ellipsoid. Endcaps are
 * separate vertices so they cannot round the silhouette into the adjoining skin. */
export function sculptedLoft(sections: readonly BodySection[], undercut = 0, flatten = 0) {
  sampleBody(sections, sections[0]?.[0] ?? 0);
  if (
    ![undercut, flatten].every(Number.isFinite) ||
    undercut < 0 ||
    undercut > 0.9 ||
    flatten < 0 ||
    flatten > 0.9
  )
    throw new Error('Invalid body cross-section');
  const rows: BodySection[] = [],
    sides = 40;
  for (let i = 0; i < sections.length - 1; i++) {
    const subdivisions = clamp(Math.ceil((sections[i + 1][0] - sections[i][0]) * 12), 3, 10);
    for (let j = 0; j < subdivisions; j++)
      rows.push(
        sampleBody(
          sections,
          sections[i][0] + ((sections[i + 1][0] - sections[i][0]) * j) / subdivisions,
        ),
      );
  }
  rows.push(sections.at(-1)!);
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const start = sections[0][0],
    span = sections.at(-1)![0] - start;
  for (const [z, y, w, h] of rows)
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides) * Math.PI * 2 - Math.PI / 2,
        sn = Math.sin(angle),
        cs = Math.cos(angle);
      const lower = clamp((-sn - 0.05) / 0.85, 0, 1);
      positions.push(
        Math.sign(cs) * Math.abs(cs) ** (1 - flatten * 0.4) * w * (1 - lower * undercut),
        y + Math.sign(sn) * Math.abs(sn) ** (1 - flatten * 0.5) * h,
        z,
      );
      uvs.push(j / sides, (z - start) / span);
    }
  for (let i = 0; i < rows.length - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const skinCount = positions.length / 3;
  for (const end of [0, rows.length - 1]) {
    const source = end * (sides + 1),
      base = positions.length / 3;
    positions.push(0, rows[end][1], rows[end][0]);
    uvs.push(0.5, 0.5);
    for (let j = 0; j <= sides; j++) {
      positions.push(...positions.slice((source + j) * 3, (source + j + 1) * 3));
      uvs.push(j / sides, end === 0 ? 0 : 1);
    }
    for (let j = 0; j < sides; j++) {
      if (end === 0) indices.push(base, base + j + 2, base + j + 1);
      else indices.push(base, base + j + 1, base + j + 2);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const average = new T.Vector3();
  for (let first = 0; first < skinCount; first += sides + 1) {
    const last = first + sides;
    average
      .set(
        normals.getX(first) + normals.getX(last),
        normals.getY(first) + normals.getY(last),
        normals.getZ(first) + normals.getZ(last),
      )
      .normalize();
    normals.setXYZ(first, average.x, average.y, average.z);
    normals.setXYZ(last, average.x, average.y, average.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** An original, thin closed airfoil swept across X. Shape is presentation only;
 * its authored camber does not pretend to be a CFD-derived force coefficient. */
export function wingElement(
  span: number,
  chord: number,
  camber: number,
  thickness: number,
  sweep = 0.08,
  gull = 0.03,
) {
  if (
    ![span, chord, camber, thickness, sweep, gull].every(Number.isFinite) ||
    span <= 0 ||
    chord <= 0 ||
    thickness <= 0
  )
    throw new Error('Invalid airfoil dimensions');
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const across = 20,
    around = 32,
    stride = around + 1;
  for (let i = 0; i <= across; i++) {
    const x = (((i / across) * 2 - 1) * span) / 2,
      edge = Math.abs(x) / (span / 2),
      taper = 1 - 0.16 * edge ** 4,
      localCamber = camber * (1 - 0.18 * edge ** 2);
    for (let j = 0; j <= around; j++) {
      // Cosine spacing resolves a rounded nose; the analytic zero at each end
      // keeps the two skins coincident even after Float32 conversion.
      const angle = (j / around) * 2 * Math.PI,
        u = 0.5 - 0.5 * Math.cos(angle),
        side = j <= around / 2 ? 1 : -1,
        section = thickness * 2.1 * Math.sqrt(u) * (1 - u) * (1 - 0.3 * u);
      positions.push(
        x,
        4 * localCamber * u * (1 - u) + side * section - gull * edge ** 2,
        chord * taper * (0.5 - u) - sweep * edge ** 2,
      );
      uvs.push(i / across, u);
    }
  }
  // A knife-edge trailing seam must not average the opposing skin normals.
  // Keep its lower copy separate; the leading UV seam is smoothed below.
  const lowerTrailing = positions.length / 3;
  for (let i = 0; i <= across; i++) {
    const source = i * stride + around / 2;
    positions.push(...positions.slice(source * 3, source * 3 + 3));
    uvs.push(i / across, 1);
  }
  for (let i = 0; i < across; i++)
    for (let j = 0; j < around; j++) {
      const a = j === around / 2 ? lowerTrailing + i : i * stride + j,
        b = j === around / 2 ? lowerTrailing + i + 1 : (i + 1) * stride + j,
        nextA = i * stride + j + 1,
        nextB = (i + 1) * stride + j + 1;
      indices.push(a, b, nextA, b, nextB, nextA);
    }
  // Cambered sections are concave: a centre fan can cross outside the skin.
  // Triangulate each actual outline and isolate the cap normals/planar UVs.
  for (const row of [0, across]) {
    const base = positions.length / 3,
      contour: T.Vector2[] = [];
    for (let j = 0; j < around; j++) {
      const source = (row * stride + j) * 3,
        y = positions[source + 1],
        z = positions[source + 2];
      positions.push(positions[source], y, z);
      uvs.push(0.5 + (z + sweep) / chord, 0.5 + (y + gull) / (2 * (Math.abs(camber) + thickness)));
      contour.push(new T.Vector2(y, z));
    }
    for (const [a, b, c] of T.ShapeUtils.triangulateShape(contour, [])) {
      const ab = contour[b].clone().sub(contour[a]),
        ac = contour[c].clone().sub(contour[a]),
        outward = (ab.x * ac.y - ab.y * ac.x) * (row === 0 ? -1 : 1) > 0;
      if (outward) indices.push(base + a, base + b, base + c);
      else indices.push(base + a, base + c, base + b);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal'),
    average = new T.Vector3();
  for (let i = 0; i <= across; i++) {
    const first = i * stride,
      last = first + around;
    average
      .set(
        normals.getX(first) + normals.getX(last),
        normals.getY(first) + normals.getY(last),
        normals.getZ(first) + normals.getZ(last),
      )
      .normalize();
    normals.setXYZ(first, average.x, average.y, average.z);
    normals.setXYZ(last, average.x, average.y, average.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Bevelled Y/Z plate; two millimetre highlight edges replace unrounded boxes. */
export function aeroPlate(
  outline: readonly (readonly [z: number, y: number])[],
  thickness = 0.024,
) {
  const shape = new T.Shape(outline.map(([z, y]) => new T.Vector2(-z, y)));
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.003,
    bevelThickness: 0.002,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -thickness / 2);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}
