import * as T from 'three';
import { add, tube, type BikeMaterials } from '../bike.ts';
import type { RiderDetail } from '../rider.ts';

type Point = readonly [z: number, y: number];

/** A softly broken casting perimeter in the bike's YZ plane. Extrusion is
 * centred across X, so two sides keep their real width without negative
 * object scales or mirrored triangle winding. All pieces enter the existing
 * rigid material batches; no new articulation or per-frame allocation. */
function castProfile(
  outline: readonly Point[],
  depth: number,
  detail: RiderDetail,
  holes: T.Path[] = [],
  bevel = 0.002,
) {
  const shape = new T.Shape(),
    blend = 0.19;
  for (let i = 0; i < outline.length; i++) {
    const previous = outline[(i + outline.length - 1) % outline.length],
      current = outline[i],
      next = outline[(i + 1) % outline.length],
      entry = [
        T.MathUtils.lerp(current[0], previous[0], blend),
        T.MathUtils.lerp(current[1], previous[1], blend),
      ];
    if (i === 0) shape.moveTo(entry[0], entry[1]);
    else shape.lineTo(entry[0], entry[1]);
    shape.quadraticCurveTo(
      current[0],
      current[1],
      T.MathUtils.lerp(current[0], next[0], blend),
      T.MathUtils.lerp(current[1], next[1], blend),
    );
  }
  shape.closePath();
  shape.holes.push(...holes);
  const geometry = new T.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: detail === 'high' ? 3 : detail === 'mid' ? 2 : 1,
    bevelEnabled: detail !== 'far' && bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** References 005/011/012: the water-cooled single is an irregular crankcase,
 * water jacket and small pump housings within the open frame.
 * These original forms replace the old rounded block and decorative air-
 * cooling fins. Side covers follow their cast lobes and carry a real seam.
 * The MX250 definition calls for a compact two-stroke head without a cam
 * housing; that distinction is authored from its engine cycle. */
export function addMotocrossPowertrain(
  parent: T.Group,
  detail: RiderDetail,
  materials: BikeMaterials,
  cast: T.MeshStandardMaterial,
  magnesium: T.MeshStandardMaterial,
  cycle: 'two-stroke' | 'four-stroke' = 'four-stroke',
) {
  const twoStroke = cycle === 'two-stroke';
  const caseOutline: readonly Point[] = [
    [-0.188, -0.411],
    [-0.181, -0.347],
    [-0.147, -0.307],
    [-0.095, -0.305],
    [-0.071, -0.282],
    [0.001, -0.286],
    [0.029, -0.311],
    [0.073, -0.326],
    [0.11, -0.367],
    [0.106, -0.418],
    [0.079, -0.456],
    [0.022, -0.484],
    [-0.092, -0.488],
    [-0.157, -0.466],
  ];
  add(parent, castProfile(caseOutline, 0.184, detail, [], 0.004), cast).name =
    'Motocross continuous split crankcase';
  // Raised machined split around the sump, rather than a painted stripe.
  if (detail !== 'far') {
    const seam = caseOutline.map(([z, y]) => [0, y, z] as [number, number, number]);
    seam.push(seam[0]);
    add(parent, tube(seam, 0.0024, detail === 'high' ? 44 : 28, 4), materials.steel);
  }
  for (const side of [-1, 1]) {
    const radius = side > 0 ? 0.073 : 0.085,
      z = side > 0 ? -0.071 : -0.047,
      y = -0.392,
      boltCount = side > 0 ? 6 : 7,
      outline: Point[] = [],
      segments = detail === 'high' ? 42 : detail === 'mid' ? 28 : 18;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2,
        // Bolt tabs are cast into the outline. Their pitch follows the actual
        // fasteners rather than independent discs floating around a circle.
        tab = Math.max(0, Math.cos(a * boltCount)) ** 6,
        r = radius + 0.006 * tab;
      outline.push([z + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    add(parent, castProfile(outline, 0.016, detail, [], 0.0018), materials.steel, side * 0.101);
    const face = outline.map(([pz, py]) => [z + (pz - z) * 0.92, y + (py - y) * 0.92] as const);
    add(parent, castProfile(face, 0.021, detail, [], 0.003), magnesium, side * 0.108).name =
      `Motocross ${side > 0 ? 'ignition' : 'clutch'} cover casting`;
    if (detail !== 'far') {
      for (let k = 0; k < boltCount; k++) {
        const a = (k / boltCount) * Math.PI * 2;
        add(
          parent,
          new T.CylinderGeometry(0.0038, 0.0038, 0.005, 6),
          materials.steel,
          side * 0.122,
          y + Math.sin(a) * radius * 0.93,
          z + Math.cos(a) * radius * 0.93,
        ).rotation.z = Math.PI / 2;
      }
      // Small timing/oil inspection plug is set into the cover face.
      add(
        parent,
        new T.CylinderGeometry(0.019, 0.019, 0.003, 16),
        cast,
        side * 0.1205,
        y,
        z,
      ).rotation.z = Math.PI / 2;
      add(parent, new T.BoxGeometry(0.001, 0.003, 0.015), materials.dark, side * 0.1225, y, z);
    }
  }
  const jacket: readonly Point[] = twoStroke
    ? [
        [-0.034, -0.31],
        [0.093, -0.321],
        [0.112, -0.264],
        [0.094, -0.19],
        [0.062, -0.178],
        [-0.048, -0.19],
        [-0.063, -0.24],
      ]
    : [
        [-0.03, -0.307],
        [0.089, -0.319],
        [0.09, -0.249],
        [0.059, -0.123],
        [0.028, -0.104],
        [-0.057, -0.117],
        [-0.067, -0.15],
      ];
  add(parent, castProfile(jacket, twoStroke ? 0.14 : 0.125, detail, [], 0.004), cast).name =
    twoStroke
      ? 'Motocross compact two-stroke water jacket'
      : 'Motocross tapered cylinder water jacket';
  add(
    parent,
    castProfile(
      twoStroke
        ? [
            [-0.052, -0.198],
            [-0.061, -0.172],
            [-0.049, -0.145],
            [0.048, -0.134],
            [0.09, -0.154],
            [0.103, -0.193],
          ]
        : [
            [-0.071, -0.15],
            [-0.075, -0.102],
            [-0.061, -0.075],
            [0.026, -0.065],
            [0.067, -0.085],
            [0.075, -0.133],
          ],
      twoStroke ? 0.148 : 0.157,
      detail,
      [],
      0.006,
    ),
    twoStroke ? cast : magnesium,
  ).name = twoStroke
    ? 'Motocross compact two-stroke cylinder head'
    : 'Motocross shouldered cam cover';
  if (detail !== 'far') {
    for (const side of [-1, 1]) {
      // Long casting ribs bridge the water-jacket wall; these are structural
      // raised lands, not the old six air-cooling fins around the barrel.
      for (const z of [-0.022, 0.03])
        add(
          parent,
          tube(
            [
              [side * (twoStroke ? 0.072 : 0.065), -0.29, z + 0.026],
              [side * (twoStroke ? 0.072 : 0.065), twoStroke ? -0.242 : -0.2, z],
              [side * (twoStroke ? 0.072 : 0.065), twoStroke ? -0.197 : -0.132, z - 0.009],
            ],
            0.004,
            8,
            4,
          ),
          cast,
        );
      if (twoStroke) {
        for (const z of [-0.025, 0.028])
          add(
            parent,
            new T.CylinderGeometry(0.0045, 0.0045, 0.011, 6),
            materials.steel,
            side * 0.045,
            -0.133 + z * 0.11,
            z,
          ).rotation.x = -0.11;
      } else {
        add(
          parent,
          new T.CylinderGeometry(0.006, 0.006, 0.008, 6),
          materials.steel,
          side * 0.081,
          -0.102,
          0.008,
        ).rotation.z = Math.PI / 2;
      }
    }
    add(
      parent,
      castProfile(
        [
          [0.038, -0.318],
          [0.042, -0.344],
          [0.066, -0.358],
          [0.091, -0.35],
          [0.104, -0.329],
          [0.09, -0.303],
          [0.061, -0.299],
        ],
        0.022,
        detail,
      ),
      cast,
      -0.101,
    ).name = 'Motocross cast coolant pump';
    add(
      parent,
      tube(
        [
          [-0.113, -0.32, 0.078],
          [-0.112, -0.255, 0.116],
          [-0.118, -0.237, 0.18],
        ],
        0.009,
        12,
        6,
      ),
      materials.dark,
    );
    // Ignition cap + lead, and the intake boot under the tank, fill the
    // correct small spaces while leaving daylight around the engine/frame.
    add(
      parent,
      new T.CylinderGeometry(0.011, 0.009, 0.044, 8),
      materials.dark,
      0,
      twoStroke ? -0.123 : -0.059,
      -0.012,
    ).rotation.x = -0.2;
    add(
      parent,
      tube(
        [
          [0, twoStroke ? -0.105 : -0.041, -0.014],
          [0.036, twoStroke ? -0.087 : -0.029, -0.067],
          [0.052, -0.065, -0.143],
        ],
        0.0038,
        12,
        5,
      ),
      materials.dark,
    );
    add(
      parent,
      tube(
        [
          [0, twoStroke ? -0.252 : -0.141, -0.052],
          [0, twoStroke ? -0.246 : -0.133, -0.111],
          [0, twoStroke ? -0.19 : -0.079, -0.167],
        ],
        twoStroke ? 0.022 : 0.028,
        10,
        8,
      ),
      materials.dark,
    );
    // Connected rear-brake master cylinder and pushrod beside the right peg.
    add(parent, new T.CylinderGeometry(0.012, 0.009, 0.079, 10), cast, -0.134, -0.334, -0.178);
    add(
      parent,
      new T.CylinderGeometry(0.0035, 0.0035, 0.065, 6),
      materials.steel,
      -0.134,
      -0.399,
      -0.178,
    );
    add(
      parent,
      tube(
        [
          [-0.137, -0.427, -0.174],
          [-0.146, -0.443, -0.12],
          [-0.163, -0.445, -0.024],
        ],
        0.006,
        9,
        5,
      ),
      materials.aluminium,
    );
  }
}

/** The MX250's two-stroke pipe: header, diverging cones, broad belly,
 * converging cones and stinger are one continuous surface. Radius changes
 * follow the welded stations instead of scaling a constant-width tube.
 * The last straight section enters the existing silencer along its actual
 * rotated axis. Only construction allocates; it uses the shared titanium
 * vertex-colour material and joins the normal rigid/mud batches. */
export function motocrossExpansionChamber(detail: RiderDetail) {
  const inlet = (z: number, radius: number) =>
      [-0.177, -0.005 - Math.sin(0.22) * z, -0.615 + Math.cos(0.22) * z, radius] as const,
    stations = [
      [0, -0.225, 0.096, 0.022],
      [-0.025, -0.241, 0.153, 0.022],
      [-0.073, -0.275, 0.218, 0.028],
      [-0.13, -0.322, 0.255, 0.042],
      [-0.194, -0.365, 0.23, 0.068],
      [-0.218, -0.37, 0.132, 0.08],
      [-0.22, -0.336, 0.016, 0.082],
      [-0.211, -0.271, -0.096, 0.064],
      [-0.19, -0.17, -0.226, 0.033],
      [-0.177, -0.071, -0.351, 0.018],
      inlet(0.26, 0.018),
      inlet(0.22, 0.018),
      inlet(0.151, 0.018),
    ] as const,
    curve = new T.CatmullRomCurve3(stations.map(([x, y, z]) => new T.Vector3(x, y, z))),
    lengths = curve.getLengths(512),
    length = lengths[lengths.length - 1],
    profile = stations.map((station, i) => {
      const sample = (i / (stations.length - 1)) * (lengths.length - 1),
        lower = Math.floor(sample),
        distance = T.MathUtils.lerp(
          lengths[lower],
          lengths[Math.min(lower + 1, 512)],
          sample - lower,
        );
      return { t: distance / length, radius: station[3] };
    }),
    segments = detail === 'high' ? 64 : detail === 'mid' ? 36 : 20,
    sides = detail === 'high' ? 18 : detail === 'mid' ? 12 : 8,
    welds = profile.slice(2, 9).map((station) => station.t),
    rings = new Set(Array.from({ length: segments + 1 }, (_, i) => i / segments));
  if (detail !== 'far')
    for (const weld of welds)
      for (const offset of [-0.0035, -0.0008, 0, 0.0008, 0.0035]) rings.add(weld + offset / length);
  const samples = [...rings].sort((a, b) => a - b),
    positions: number[] = [],
    colours: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    tangent = curve.getTangentAt(0),
    previousTangent = tangent.clone(),
    normal = new T.Vector3(0, 1, 0).cross(tangent).normalize(),
    binormal = new T.Vector3(),
    rotation = new T.Quaternion(),
    warm = new T.Color(0xb9ac93),
    hot = new T.Color(0x85889d),
    weldColour = new T.Color(0x747b94),
    colour = new T.Color();
  for (const [row, t] of samples.entries()) {
    const centre = curve.getPointAt(t);
    tangent.copy(curve.getTangentAt(t));
    rotation.setFromUnitVectors(previousTangent, tangent);
    normal.applyQuaternion(rotation).addScaledVector(tangent, -normal.dot(tangent)).normalize();
    binormal.crossVectors(tangent, normal).normalize();
    previousTangent.copy(tangent);
    const next = profile.findIndex((station) => station.t >= t),
      upper = Math.max(1, next),
      a = profile[upper - 1],
      b = profile[upper],
      blend = (t - a.t) / (b.t - a.t),
      weldDistance = Math.min(...welds.map((weld) => Math.abs(t - weld) * length)),
      bead =
        detail === 'far' ? 0 : 0.0009 * (1 - T.MathUtils.smoothstep(weldDistance, 0.0005, 0.0017)),
      radius = T.MathUtils.lerp(a.radius, b.radius, blend) + bead;
    colour.copy(hot).lerp(warm, T.MathUtils.smoothstep(t, 0, 0.3));
    if (detail !== 'far')
      colour.lerp(weldColour, 0.34 * (1 - T.MathUtils.smoothstep(weldDistance, 0.001, 0.005)));
    for (let side = 0; side <= sides; side++) {
      const angle = (side / sides) * Math.PI * 2,
        nx = Math.cos(angle),
        ny = Math.sin(angle);
      positions.push(
        centre.x + radius * (normal.x * nx + binormal.x * ny),
        centre.y + radius * (normal.y * nx + binormal.y * ny),
        centre.z + radius * (normal.z * nx + binormal.z * ny),
      );
      colours.push(colour.r, colour.g, colour.b);
      uvs.push(side / sides, (t * length) / 0.08);
      if (row < samples.length - 1 && side < sides) {
        const start = row * (sides + 1) + side,
          end = start + sides + 1;
        indices.push(start, start + 1, end, start + 1, end + 1, end);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // The duplicated UV seam is spatially closed and shares its smooth normal.
  const normals = geometry.getAttribute('normal');
  for (let row = 0; row < samples.length; row++) {
    const first = row * (sides + 1),
      last = first + sides;
    normal
      .set(
        normals.getX(first) + normals.getX(last),
        normals.getY(first) + normals.getY(last),
        normals.getZ(first) + normals.getZ(last),
      )
      .normalize();
    normals.setXYZ(first, normal.x, normal.y, normal.z);
    normals.setXYZ(last, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Curved 3.8 mm sump scoop. Two skins and closed returns leave a real bowl
 * above the guard, with a raised forward nose and flared side protection. */
export function motocrossSumpGuard(detail: RiderDetail) {
  const rows = detail === 'high' ? 20 : detail === 'mid' ? 12 : 8,
    columns = detail === 'high' ? 10 : 6,
    stride = (rows + 1) * (columns + 1),
    positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (const inner of [false, true])
    for (let row = 0; row <= rows; row++) {
      const t = row / rows,
        z = T.MathUtils.lerp(-0.202, 0.174, t),
        nose = T.MathUtils.smoothstep(t, 0.58, 1),
        width = 0.11 - 0.024 * nose - 0.017 * (1 - T.MathUtils.smoothstep(t, 0, 0.2)),
        floor = -0.529 + 0.122 * nose * nose;
      for (let column = 0; column <= columns; column++) {
        const u = (column / columns) * 2 - 1;
        positions.push(u * width, floor + 0.041 * Math.abs(u) ** 3 + (inner ? 0.0038 : 0), z);
        uvs.push(column / columns, t);
        if (row < rows && column < columns) {
          const a = (inner ? stride : 0) + row * (columns + 1) + column,
            b = a + columns + 1;
          if (inner) indices.push(a, b, a + 1, a + 1, b, b + 1);
          else indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
  const edge = (a: number, b: number) => indices.push(a, a + stride, b, b, a + stride, b + stride);
  for (let column = 0; column < columns; column++) {
    edge(column + 1, column);
    edge(rows * (columns + 1) + column, rows * (columns + 1) + column + 1);
  }
  for (let row = 0; row < rows; row++) {
    edge(row * (columns + 1), (row + 1) * (columns + 1));
    edge((row + 1) * (columns + 1) + columns, row * (columns + 1) + columns);
  }
  // Offset along the outside normal. A vertical-only offset thins the wall
  // at the steep forward scoop and its rolled side returns.
  const outside = new T.BufferGeometry();
  outside.setAttribute('position', new T.Float32BufferAttribute(positions.slice(0, stride * 3), 3));
  outside.setIndex(indices.slice(0, rows * columns * 6));
  outside.computeVertexNormals();
  const outsideNormal = outside.getAttribute('normal');
  for (let i = 0; i < stride; i++) {
    positions[(i + stride) * 3] = positions[i * 3] - outsideNormal.getX(i) * 0.0038;
    positions[(i + stride) * 3 + 1] = positions[i * 3 + 1] - outsideNormal.getY(i) * 0.0038;
    positions[(i + stride) * 3 + 2] = positions[i * 3 + 2] - outsideNormal.getZ(i) * 0.0038;
  }
  outside.dispose();
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Hollow cast axle lug replaces a rectangular block. The bore remains open
 * around a separately modelled steel axle and follows the sliding lower fork. */
export function motocrossAxleLug(detail: RiderDetail) {
  const hole = new T.Path();
  // Explicit bore facets are independent of the coarse outer casting curves.
  // Reserve 1.5 mm for the bevel so its narrowest section still clears the
  // 19 mm steel axle, even on the mid-detail casting.
  for (let i = 0; i <= 24; i++) {
    const a = -(i / 24) * Math.PI * 2,
      x = Math.cos(a) * 0.0135,
      y = Math.sin(a) * 0.0135;
    if (i === 0) hole.moveTo(x, y);
    else hole.lineTo(x, y);
  }
  return castProfile(
    [
      [-0.03, 0.063],
      [0.022, 0.063],
      [0.028, 0.032],
      [0.035, 0.006],
      [0.028, -0.025],
      [-0.007, -0.031],
      [-0.031, -0.019],
      [-0.035, 0.009],
    ],
    0.045,
    detail,
    [hole],
    0.0015,
  );
}

/** A broad, tapering formed arm with a real longitudinal axle adjustment
 * slot. The pivot and wheel endpoints retain the existing suspension frame. */
export function motocrossSwingarmRail(length: number, side: number, detail: RiderDetail) {
  const hole = new T.Path();
  hole.absellipse(-length + 0.004, 0, 0.025, 0.0115, 0, Math.PI * 2, true);
  const geometry = castProfile(
    [
      [0.026, 0.029],
      [-0.025, 0.042],
      [-length * 0.24, 0.057],
      [-length * 0.72, 0.036],
      [-length - 0.034, 0.025],
      [-length - 0.039, -0.021],
      [-length * 0.67, -0.029],
      [-length * 0.19, -0.037],
      [0.023, -0.031],
    ],
    0.031,
    detail,
    detail === 'far' ? [] : [hole],
    0.002,
  );
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const t = T.MathUtils.clamp(-p.getZ(i) / length, 0, 1);
    p.setX(i, p.getX(i) + side * (0.09 + 0.01 * t + 0.012 * Math.sin(t * Math.PI)));
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Rolled outlet lip, tapered end cap and recessed bore. There is no flat
 * disc hiding behind the outlet: a ray down the centre passes through it. */
export function motocrossSilencerOutlet(detail: RiderDetail) {
  const points = [
    [0.0442, -0.162],
    [0.0435, -0.178],
    [0.035, -0.207],
    [0.029, -0.222],
    [0.022, -0.222],
    [0.0215, -0.214],
    [0.0215, -0.142],
    [0.025, -0.142],
    [0.025, -0.162],
    [0.0442, -0.162],
  ]
    .reverse()
    .map(([r, z]) => new T.Vector2(r, z));
  const geometry = new T.LatheGeometry(points, detail === 'high' ? 32 : detail === 'mid' ? 20 : 12);
  geometry.rotateX(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
