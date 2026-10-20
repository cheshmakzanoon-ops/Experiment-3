import * as T from 'three';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';
import { sampleProfile } from './profile-sampling.ts';

/** Original loop-wing silhouette guided by MotoGP26 REF_049/056/060. The
 * moulded outer return joins both aerofoils; the centre remains an open duct.
 * Each station is [span, height, leading-edge Z, chord], in chassis metres.
 * These are authored visual dimensions, not measured aerodynamics. */
const STATIONS = [
  [0.195, 0.163, 0.73, 0.17],
  [0.254, 0.158, 0.738, 0.193],
  [0.311, 0.151, 0.72, 0.185],
  [0.329, 0.139, 0.704, 0.178],
  [0.333, 0.102, 0.686, 0.17],
  [0.326, 0.061, 0.67, 0.16],
  [0.305, 0.046, 0.651, 0.154],
  [0.25, 0.047, 0.535, 0.16],
  [0.187, 0.01, 0.345, 0.145],
] as const;

/** A single watertight swept aero section replaces three intersecting boxes.
 * Paint covers its outward face and the opening retains exposed carbon. The
 * half-millimetre trailing edge closes the shell instead of becoming a plane.
 * Shared entrant finishes let the final rigid batch reuse existing draws. */
export function gpR2LoopWingGeometry(
  detail: Exclude<RiderDetail, 'far'>,
  side: -1 | 1,
): { outer: T.BufferGeometry; inner: T.BufferGeometry } {
  const steps = detail === 'high' ? 30 : 16,
    ring = detail === 'high' ? 28 : 16,
    curve = new T.CatmullRomCurve3(STATIONS.map(([x, y, z]) => new T.Vector3(x, y, z))),
    stations = STATIONS.map((_, i) => i / (STATIONS.length - 1)),
    chords = STATIONS.map((s) => s[3]),
    p: number[] = [],
    uv: number[] = [],
    outer: number[] = [],
    inner: number[] = [],
    point = new T.Vector3(),
    tangent = new T.Vector3();
  const triangle = (target: number[], a: number, b: number, c: number) => {
    if (side > 0) target.push(a, b, c);
    else target.push(a, c, b);
  };
  for (let row = 0; row <= steps; row++) {
    const u = row / steps,
      chord = sampleProfile(stations, chords, u);
    curve.getPoint(u, point);
    curve.getTangent(u, tangent);
    const length = Math.hypot(tangent.x, tangent.y),
      nx = -tangent.y / length,
      ny = tangent.x / length;
    for (let column = 0; column <= ring; column++) {
      const angle = (column / ring) * Math.PI * 2,
        t = (1 - Math.cos(angle)) / 2,
        // Rounded leading edge, slender chord and a finite trailing return.
        thickness =
          chord *
          0.4 *
          (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t ** 2 + 0.2843 * t ** 3 - 0.1015 * t ** 4),
        h = Math.sign(Math.sin(angle)) * thickness - 0.0025 * Math.sin(t * Math.PI);
      p.push(side * (point.x + nx * h), point.y + ny * h, point.z - chord * t);
      uv.push(u, column / ring);
      if (row < steps && column < ring) {
        const a = row * (ring + 1) + column,
          b = a + ring + 1,
          target = column < ring / 2 ? outer : inner;
        triangle(target, a, b, a + 1);
        triangle(target, a + 1, b, b + 1);
      }
    }
  }
  // Caps are buried in the two fairing attachments and belong to carbon.
  for (const row of [0, steps]) {
    const centre = p.length / 3,
      u = row / steps;
    curve.getPoint(u, point);
    p.push(side * point.x, point.y, point.z - sampleProfile(stations, chords, u) * 0.45);
    uv.push(u, 0.5);
    for (let column = 0; column < ring; column++) {
      const a = row * (ring + 1) + column;
      if (row === 0) triangle(inner, centre, a, a + 1);
      else triangle(inner, centre, a + 1, a);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex([...outer, ...inner]);
  geometry.computeVertexNormals();
  // Duplicate UV vertices at the leading edge share one smooth normal.
  const normal = geometry.getAttribute('normal'),
    n = new T.Vector3(),
    other = new T.Vector3();
  for (let row = 0; row <= steps; row++) {
    const first = row * (ring + 1),
      last = first + ring;
    n.fromBufferAttribute(normal, first).add(other.fromBufferAttribute(normal, last)).normalize();
    normal.setXYZ(first, n.x, n.y, n.z);
    normal.setXYZ(last, n.x, n.y, n.z);
  }
  const result = { outer: geometry.clone(), inner: geometry.clone() };
  result.outer.setIndex(outer);
  result.inner.setIndex(inner);
  for (const [face, g] of Object.entries(result)) {
    g.name = `GP-R2 ${side > 0 ? 'left' : 'right'} loop wing ${face}`;
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  geometry.dispose();
  return result;
}

export function gpR2Aero(detail: Exclude<RiderDetail, 'far'>, materials: BikeMaterials): T.Group {
  const root = new T.Group();
  root.name = 'GP-R2 swept moulded loop wings';
  for (const side of [-1, 1] as const) {
    const geometry = gpR2LoopWingGeometry(detail, side);
    for (const [name, material] of [
      ['outer', materials.paint],
      ['inner', materials.carbon],
    ] as const) {
      const mesh = new T.Mesh(geometry[name], material);
      mesh.name = geometry[name].name;
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    }
  }
  return root;
}
