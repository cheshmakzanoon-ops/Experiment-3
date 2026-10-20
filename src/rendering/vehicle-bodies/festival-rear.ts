import * as T from 'three';
import { clamp } from '../../core/math.ts';
import { tessellateBodyCurve } from './body-curvature.ts';
import type { ClosedBodyModel } from './closed-body.ts';
import type { CarMaterials } from './common.ts';
import { roundedBox, tubeGeometry, type Pt } from './loft.ts';
import { sharedMaterials } from './materials.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';
import type { FestivalLampPocket } from './festival-nose.ts';

/** Rear shoulder construction follows the same original dimensions at every
 * LOD. It starts behind the rear tyre envelope; neither axle nor contact pose
 * is changed. References 018/099 motivate the wrapped, layered construction,
 * not these authored shapes or dimensions. */
export function festivalBumperSeam(model: ClosedBodyModel) {
  return model.f.y(model.s.style === 'supercar' ? 0.38 : 0.49);
}

function rearProfile(model: ClosedBodyModel) {
  const top = festivalBumperSeam(model),
    height = top - model.control(model.zRear)[0][1],
    amplitude = model.s.style === 'supercar' ? 0.032 : 0.038;
  return { top, height, amplitude };
}

function rearProjection(model: ClosedBodyModel) {
  const sweep = model.s.rearSweep ?? 0,
    depth = Math.max(0.3, model.s.overhang[1] - model.f.radius - 0.09),
    halfSquared = model.halfWidth(model.zRear) ** 2,
    profile = rearProfile(model);
  return (x: number, y: number, z: number) => {
    const t = clamp((model.zRear + depth - z) / depth, 0, 1),
      blend = t * t * (3 - 2 * t),
      shape = (x * x) / (halfSquared + x * x),
      u = clamp((profile.top - y) / profile.height, 0, 1),
      bumper = -profile.amplitude * 16 * u * u * (1 - u) ** 2,
      offset = sweep * shape + bumper;
    return {
      z: z + offset * blend,
      dx: (sweep * blend * 2 * x * halfSquared) / (halfSquared + x * x) ** 2,
      dy: (profile.amplitude * 32 * u * (1 - u) * (1 - 2 * u) * blend) / profile.height,
      dz: 1 - (offset * 6 * t * (1 - t)) / depth,
    };
  };
}

export function festivalRearZ(
  model: ClosedBodyModel,
  x: number,
  z: number,
  y = model.f.y(model.s.tail),
) {
  return model.s.rearSweep ? rearProjection(model)(x, y, z).z : z;
}

/** The skin, lamp optics, exhausts and trim share one deformation. Applying
 * its inverse-transpose to normals keeps the smooth shoulder reflection
 * continuous while leaving the hard edges of separate parts intact. */
export function warpFestivalRear(
  geometry: T.BufferGeometry,
  model: ClosedBodyModel,
  detail: Detail,
) {
  if (!model.s.rearSweep) return;
  const start = model.f.rearAxle - model.f.radius - 0.09;
  geometry.computeBoundingBox();
  if (geometry.boundingBox!.min.z >= start) return;
  const sweep = model.s.rearSweep,
    depth = Math.max(0.3, model.s.overhang[1] - model.f.radius - 0.09),
    halfSquared = model.halfWidth(model.zRear) ** 2,
    bumperProfile = rearProfile(model),
    project = rearProjection(model),
    supercar = model.s.style === 'supercar',
    tolerance = [supercar ? 0.0025 : 0.0015, 0.003, 0.008][detail];
  tessellateBodyCurve(
    geometry,
    (x, z, y) => {
      const t = clamp((model.zRear + depth - z) / depth, 0, 1),
        u = clamp((bumperProfile.top - y) / bumperProfile.height, 0, 1),
        bumper = -bumperProfile.amplitude * 16 * u * u * (1 - u) ** 2;
      return z + ((sweep * x * x) / (halfSquared + x * x) + bumper) * t * t * (3 - 2 * t);
    },
    (z) => z < start,
    // A 1.5–2.5 mm near-LOD chord is subpixel in the normal chase view. Tiny
    // specular pieces retain their authored normals without over-tessellating
    // every long rear trim strip to a fraction of a millimetre.
    tolerance,
    true,
    // The SC7's short bumper crown needs denser chords than its broad rear
    // shoulder. Refine only that band; refining every rear trim piece to this
    // precision would waste geometry outside the visible curvature.
    supercar
      ? (_x, y) =>
          y < bumperProfile.top + 0.008 && y > bumperProfile.top - bumperProfile.height - 0.008
            ? [0.0006, 0.001, 0.004][detail]
            : tolerance
      : undefined,
  );
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal'),
    n = new T.Vector3();
  for (let i = 0; i < position.count; i++) {
    const warp = project(position.getX(i), position.getY(i), position.getZ(i));
    position.setZ(i, warp.z);
    if (normal) {
      n.set(
        normal.getX(i) - (warp.dx * normal.getZ(i)) / warp.dz,
        normal.getY(i) - (warp.dy * normal.getZ(i)) / warp.dz,
        normal.getZ(i) / warp.dz,
      ).normalize();
      normal.setXYZ(i, n.x, n.y, n.z);
    }
  }
  position.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export interface FestivalTailPocket {
  side: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Counter-clockwise outline in the rear face's X/Y plane. */
  outline: Pt[];
}

function counterClockwise(points: Pt[]) {
  const area = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  return area < 0 ? points.reverse() : points;
}

/** Two tapered lamps leave a painted bridge across the rear face. Their
 * outline is cut from the actual cap; the lens does not sit on solid paint. */
export function festivalTailPockets(model: ClosedBodyModel): FestivalTailPocket[] {
  if (!model.s.rearSweep) return [];
  const supercar = model.s.style === 'supercar',
    height = supercar ? 0.095 : 0.12,
    y = Math.min(model.f.y(model.s.tail) - 0.14, model.topY(model.zRear) - height * 0.72),
    available = Math.min(
      model.sideX(model.zRear, y - height * 0.5),
      model.sideX(model.zRear, y + height * 0.5),
    ),
    width = available * 0.63;
  return [-1, 1].map((side) => {
    const x = side * available * 0.6;
    const outline = counterClockwise(
      [
        [-0.5, -0.34],
        [-0.42, -0.5],
        [0.3, -0.5],
        [0.5, -0.12],
        [0.47, 0.24],
        [0.3, 0.5],
        [-0.46, 0.44],
      ].map(([u, v]) => [x + side * u * width, y + v * height]),
    );
    return { side, x, y, width, height, outline };
  });
}

function rearRing(
  pocket: FestivalTailPocket,
  z: number,
  outerScale: number,
  innerScale: number,
  outerDepth: number,
  innerDepth: number,
) {
  const positions: number[] = [],
    indices: number[] = [];
  for (const [x, y] of pocket.outline) {
    const dx = x - pocket.x,
      dy = y - pocket.y;
    positions.push(
      pocket.x + dx * outerScale,
      pocket.y + dy * outerScale,
      z + outerDepth,
      pocket.x + dx * innerScale,
      pocket.y + dy * innerScale,
      z + innerDepth,
    );
  }
  for (let i = 0; i < pocket.outline.length; i++) {
    const a = i * 2,
      b = ((i + 1) % pocket.outline.length) * 2;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function rearPane(pocket: FestivalTailPocket, z: number, scale: number) {
  const shape = new T.Shape(
    pocket.outline.map(
      ([x, y]) =>
        new T.Vector2(pocket.x + (x - pocket.x) * scale, pocket.y + (y - pocket.y) * scale),
    ),
  );
  const geometry = new T.ShapeGeometry(shape).translate(0, 0, z);
  const index = geometry.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function addFestivalTailLights(
  parts: Parts,
  model: ClosedBodyModel,
  mats: CarMaterials,
  detail: Detail,
  cover: T.Material,
  optics: T.Material,
) {
  const z = model.zRear;
  for (const pocket of festivalTailPockets(model)) {
    parts.add(rearRing(pocket, z, 1.015, 0.95, -0.0005, 0.008), sharedMaterials.trim());
    parts.add(rearRing(pocket, z, 0.95, 0.87, 0.008, 0.05), optics);
    parts.add(rearPane(pocket, z + 0.051, 0.9), optics);
    const guide: [number, number, number][] = [
      [-0.39, 0.26],
      [0.23, 0.27],
      [0.35, 0.1],
      [0.33, -0.06],
      [0.21, -0.27],
      [-0.36, -0.27],
    ].map(([u, v]) => [
      pocket.x + pocket.side * pocket.width * u,
      pocket.y + pocket.height * v,
      z + 0.021,
    ]);
    parts.add(tubeGeometry(guide, 0.005, detail === 0 ? 26 : 14, 5), mats.tail);
    const cells = detail === 0 ? 8 : 4;
    for (let k = 0; k < cells; k++)
      parts.add(
        roundedBox((pocket.width * 0.56) / cells, 0.012, 0.008, 0.002, 1),
        mats.tail,
        placed(
          pocket.x + pocket.side * pocket.width * (((k + 0.5) / cells) * 0.6 - 0.33),
          pocket.y + 0.002,
          z + 0.032,
        ),
      );
    // Separate clear reverse-light segment, still under the shared cover.
    parts.add(
      roundedBox(pocket.width * 0.18, 0.008, 0.006, 0.002, 1),
      sharedMaterials.chrome(),
      placed(pocket.x - pocket.side * pocket.width * 0.27, pocket.y - 0.014, z + 0.027),
    );
    parts.add(rearPane(pocket, z + 0.003, 0.96), cover);
  }
}

/** The original registration mounting well is cut into the rear skin. RH3
 * locates it on the hatch; SC7 places it below the engine cooling outlet. */
export function festivalRegistrationPocket(model: ClosedBodyModel): FestivalTailPocket | null {
  if (!model.s.rearSweep) return null;
  const supercar = model.s.style === 'supercar',
    width = supercar ? 0.6 : 0.64,
    height = supercar ? 0.16 : 0.19,
    y = model.f.y(supercar ? 0.49 : 0.73),
    outline = counterClockwise(
      [
        [-0.5, -0.3],
        [-0.44, -0.5],
        [0.44, -0.5],
        [0.5, -0.3],
        [0.5, 0.28],
        [0.42, 0.5],
        [-0.42, 0.5],
        [-0.5, 0.28],
      ].map(([u, v]) => [u * width, y + v * height]),
    );
  return { side: 0, x: 0, y, width, height, outline };
}

/** A deep painted mounting well and separate bumper crown give the rear its
 * panel hierarchy. All pieces join the existing paint/trim/metal batches. */
export function addFestivalRearBodywork(
  parts: Parts,
  model: ClosedBodyModel,
  mats: CarMaterials,
  detail: Detail,
) {
  const pocket = festivalRegistrationPocket(model);
  if (!pocket) return;
  const z = model.zRear;
  parts.add(rearRing(pocket, z, 1.006, 0.82, -0.0005, 0.056), mats.paint);
  parts.add(rearPane(pocket, z + 0.058, 0.86), sharedMaterials.plastic());
  parts.add(
    roundedBox(pocket.width * 0.77, pocket.height * 0.57, 0.006, 0.004, 1),
    sharedMaterials.trim(),
    placed(0, pocket.y - 0.004, z + 0.047),
  );
  parts.add(
    roundedBox(pocket.width * 0.73, pocket.height * 0.48, 0.004, 0.003, 1),
    sharedMaterials.steel(),
    placed(0, pocket.y - 0.004, z + 0.042),
  );
  for (const side of [-1, 1])
    parts.add(
      new T.SphereGeometry(0.003, 6, 4),
      sharedMaterials.chrome(),
      placed(side * pocket.width * 0.31, pocket.y + pocket.height * 0.14, z + 0.038),
    );

  const seamY = festivalBumperSeam(model),
    half = model.sideX(z, seamY) * 0.97,
    bumperLine: [number, number, number][] = [];
  for (let k = 0; k <= 12; k++) {
    const u = (k / 12) * 2 - 1;
    bumperLine.push([u * half, seamY + Math.abs(u) ** 4 * 0.025, z - 0.0012]);
  }
  parts.add(tubeGeometry(bumperLine, 0.0016, detail === 0 ? 40 : 20, 4), sharedMaterials.trim());

  if (model.s.style === 'supercar') {
    // A concealed sheet return closes the lower cap/side junction. Their
    // independently triangulated outer faces can use different boundary
    // chords; this 4 mm deep underlap prevents sky showing through a subpixel
    // seam without covering the external shoulder or bumper highlight.
    const vertices: number[] = [],
      indices: number[] = [],
      floor = model.control(z)[0][1],
      rows = detail === 0 ? 18 : 9;
    for (const side of [-1, 1]) {
      const first = vertices.length / 3;
      for (let k = 0; k <= rows; k++) {
        const y = floor + 0.002 + (k / rows) * (seamY + 0.04 - floor),
          edge = model.sideX(z, y);
        vertices.push(side * (edge + 0.003), y, z + 0.004);
        vertices.push(side * (edge - 0.012), y, z + 0.004);
      }
      for (let k = 0; k < rows; k++) {
        const a = first + k * 2,
          b = a + 2;
        if (side > 0) indices.push(a, a + 1, b, b, a + 1, b + 1);
        else indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const returnSheet = new T.BufferGeometry();
    returnSheet.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    returnSheet.setIndex(indices);
    returnSheet.computeVertexNormals();
    parts.add(returnSheet, mats.paint);
  }

  if (model.s.style !== 'supercar') {
    const top = model.topY(z) - 0.03,
      bottom = seamY + 0.045,
      width = Math.min(model.sideX(z, top) * 0.95, model.sideX(z, bottom) * 0.9),
      hatchLine: [number, number, number][] = [
        [-width, top, z - 0.0012],
        [-width, bottom + 0.12, z - 0.0012],
        [-width * 0.98, bottom + 0.025, z - 0.0012],
        [-width * 0.91, bottom, z - 0.0012],
        [0, bottom, z - 0.0012],
        [width * 0.91, bottom, z - 0.0012],
        [width * 0.98, bottom + 0.025, z - 0.0012],
        [width, bottom + 0.12, z - 0.0012],
        [width, top, z - 0.0012],
      ];
    parts.add(tubeGeometry(hatchLine, 0.0015, detail === 0 ? 72 : 36, 4), sharedMaterials.trim());
  }
}

/** SC7 duct: a forward taper opening into the rear haunch, with its entire
 * edge evaluated on the curved skin. Local Y is the outward side normal;
 * local X/Z span longitudinal distance and height. */
export function festivalSidePockets(model: ClosedBodyModel): FestivalLampPocket[] {
  if (!model.s.rearSweep || !model.s.sideIntake) return [];
  const width = 0.56,
    depth = 0.225,
    z = model.f.rearAxle + model.f.radius + 0.39,
    y = model.f.y(model.s.belt) - 0.045;
  return [-1, 1].map((side) => {
    const x = side * model.sideX(z, y),
      base = new T.Matrix4().makeBasis(
        new T.Vector3(0, 0, side),
        new T.Vector3(side, 0, 0),
        new T.Vector3(0, 1, 0),
      );
    base.setPosition(x, y, z);
    const outline = counterClockwise(
      [
        [-0.5, -0.44],
        [0.35, -0.35],
        [0.5, -0.17],
        [0.41, 0.12],
        [-0.34, 0.5],
        [-0.5, 0.36],
      ].map(([u, v]) => [side * u * width, v * depth]),
    );
    return { side, width, depth, base, inverse: base.clone().invert(), outline };
  });
}

export function festivalSidePoint(
  model: ClosedBodyModel,
  pocket: FestivalLampPocket,
  point: Pt,
  inset = 0,
) {
  const p = new T.Vector3(point[0], 0, point[1]).applyMatrix4(pocket.base);
  p.x = pocket.side * (model.sideX(p.z, p.y) - inset);
  return p;
}

/** A reveal, deep throat and closed back replace the raised square applique.
 * Two horizontal vanes sit inside the opening and merge into existing draws. */
export function addFestivalSideDucts(
  parts: Parts,
  model: ClosedBodyModel,
  detail: Detail,
  optics: T.Material,
) {
  for (const pocket of festivalSidePockets(model)) {
    const ring = (wall: boolean) => {
      const vertices: number[] = [],
        indices: number[] = [];
      for (const point of pocket.outline) {
        const a = festivalSidePoint(
            model,
            pocket,
            [point[0] * (wall ? 0.97 : 1.015), point[1] * (wall ? 0.97 : 1.015)],
            wall ? 0.007 : -0.001,
          ),
          b = festivalSidePoint(
            model,
            pocket,
            [point[0] * (wall ? 0.82 : 0.97), point[1] * (wall ? 0.82 : 0.97)],
            wall ? 0.075 : 0.007,
          );
        vertices.push(...a.toArray(), ...b.toArray());
      }
      for (let i = 0; i < pocket.outline.length; i++) {
        const a = i * 2,
          b = ((i + 1) % pocket.outline.length) * 2;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return geometry;
    };
    parts.add(ring(false), sharedMaterials.trim());
    parts.add(ring(true), sharedMaterials.plastic());
    const center = festivalSidePoint(model, pocket, [0, 0], 0.076),
      positions = center.toArray(),
      indices: number[] = [];
    for (const p of pocket.outline)
      positions.push(
        ...festivalSidePoint(model, pocket, [p[0] * 0.85, p[1] * 0.85], 0.076).toArray(),
      );
    for (let i = 0; i < pocket.outline.length; i++)
      indices.push(0, ((i + 1) % pocket.outline.length) + 1, i + 1);
    const floor = new T.BufferGeometry();
    floor.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    floor.setIndex(indices);
    floor.computeVertexNormals();
    parts.add(floor, optics);
    for (const v of [-0.15, 0.12]) {
      const line: [number, number, number][] = [];
      for (let k = 0; k <= 8; k++) {
        const u = -0.39 + (k / 8) * (v > 0 ? 0.65 : 0.72);
        line.push(
          festivalSidePoint(
            model,
            pocket,
            [pocket.side * u * pocket.width, v * pocket.depth],
            0.033,
          ).toArray(),
        );
      }
      parts.add(tubeGeometry(line, 0.0035, detail === 0 ? 12 : 8, 4), sharedMaterials.trim());
    }
  }
}
