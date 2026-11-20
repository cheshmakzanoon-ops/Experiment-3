import * as T from 'three';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';
import { mesh, mergeStatic, rod } from './geometry.ts';

type MirrorStyle = 'roadster' | 'sport';
const fairingFeet = new Map<RiderDetail, T.Vector3>();
/** The road SS mounts its stays to the moulded cheek, not the fork. Sample
 * the actual shell once per LOD; all entrants share this tooling. */
export function sportMirrorFoot(body: T.Mesh, detail: RiderDetail) {
  const retained = fairingFeet.get(detail);
  if (retained) return retained;
  body.updateWorldMatrix(true, false);
  const ray = new T.Raycaster();
  for (const y of [0.18, 0.15, 0.12, 0.09])
    for (const z of [0.48, 0.53, 0.43, 0.58]) {
      ray.set(new T.Vector3(0.6, y, z), new T.Vector3(-1, 0, 0));
      const hit = ray.intersectObject(body, false)[0];
      if (!hit || hit.point.x < 0.1) continue;
      const point = body.worldToLocal(hit.point);
      fairingFeet.set(detail, point);
      return point;
    }
  return null;
}

function perimeter(style: MirrorStyle, side: number, segments: number) {
  const points: T.Vector2[] = [];
  const w = style === 'sport' ? 0.084 : 0.091,
    h = style === 'sport' ? 0.042 : 0.048;
  for (let i = 0; i < segments; i++) {
    const a = (i * 2 * Math.PI) / segments,
      c = Math.cos(a),
      s = Math.sin(a);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 0.74);
    const y =
      Math.sign(s) *
        Math.pow(Math.abs(s), 0.78) *
        (1 + (style === 'sport' ? 0.14 : 0.06) * x * side) +
      side * x * 0.17;
    points.push(new T.Vector2(x * w, y * h));
  }
  return points;
}

function housing(points: T.Vector2[]) {
  const pos: number[] = [],
    idx: number[] = [],
    uv: number[] = [];
  const rings = [
    [0.93, 0.001],
    [1, 0.007],
    [0.98, 0.023],
    [0.88, 0.042],
    [0.61, 0.057],
    [0.2, 0.067],
  ];
  for (const [radius, z] of rings)
    for (const p of points) {
      pos.push(p.x * radius, p.y * radius, z);
      uv.push(0.5 + p.x * 5, 0.5 + p.y * 8);
    }
  const n = points.length;
  for (let r = 0; r < rings.length - 1; r++)
    for (let j = 0; j < n; j++) {
      const i = r * n + j,
        k = r * n + ((j + 1) % n);
      idx.push(i, k, i + n, k, k + n, i + n);
    }
  const centre = pos.length / 3;
  pos.push(0, 0, 0.068);
  uv.push(0.5, 0.5);
  for (let j = 0; j < n; j++)
    idx.push(centre, (rings.length - 1) * n + j, (rings.length - 1) * n + ((j + 1) % n));
  const g = new T.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
function mirrorFace(points: T.Vector2[], w: number, h: number) {
  const pos = [0, 0, -0.002],
    uv = [0.5, 0.5],
    idx: number[] = [];
  points.forEach((p, j) => {
    pos.push(p.x * 0.935, p.y * 0.935, 0);
    uv.push(0.5 - p.x / (2 * w), 0.5 + p.y / (2 * h));
    idx.push(0, 1 + ((j + 1) % points.length), 1 + j);
  });
  const g = new T.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** One assembly on the appropriate sprung or steering frame. Its ordinary
 * optical faces remain reflective in chase, at a distance and on opponents.
 * Two thin inserts accept live feeds only when the followed rider uses them. */
export function buildRoadBikeMirrors(
  style: MirrorStyle,
  detail: RiderDetail,
  m: BikeMaterials,
  foot: T.Vector3,
) {
  const root = new T.Group(),
    fixed = new T.Group(),
    faces: T.Mesh[] = [];
  root.name =
    style === 'sport' ? 'Fairing-mounted aerodynamic mirrors' : 'Handlebar-mounted road mirrors';
  for (const side of [-1, 1]) {
    const start = foot.clone();
    start.x *= side;
    const elbow = start.clone().add(new T.Vector3(side * 0.047, 0.077, 0.008));
    const end =
      style === 'roadster'
        ? new T.Vector3(side * 0.474, 0.272, 0.055)
        : new T.Vector3(side * 0.355, start.y + 0.137, start.z + 0.024);
    const view = new T.Group();
    view.position.copy(end);
    view.rotation.set(0.16, side * 0.18, 0, 'YXZ');
    const pivot = end.clone().add(new T.Vector3(-side * 0.035, -0.023, 0.034));
    rod(fixed, m.steel, start, elbow, style === 'roadster' ? 0.008 : 0.012);
    rod(fixed, m.dark, elbow, pivot, style === 'roadster' ? 0.01 : 0.014);
    const shoe = mesh(fixed, new T.SphereGeometry(1, 12, 6), m.dark, start.x, start.y, start.z);
    shoe.scale.set(0.026, 0.015, 0.031);
    const ball = mesh(
      fixed,
      new T.SphereGeometry(0.017, 10, 6),
      m.steel,
      pivot.x,
      pivot.y,
      pivot.z,
    );
    ball.name = 'Mirror ball joint';
    fixed.add(view);
    const pts = perimeter(style, side, detail === 'high' ? 28 : detail === 'mid' ? 18 : 10);
    mesh(view, housing(pts), style === 'sport' ? m.paint : m.dark);
    const glass = mirrorFace(
      pts,
      style === 'sport' ? 0.084 : 0.091,
      style === 'sport' ? 0.053 : 0.057,
    );
    const lens = mesh(view, glass, m.roadMirrorGlass());
    lens.castShadow = false;
    if (detail !== 'far') {
      const feed = new T.Mesh(glass.clone(), m.roadMirrorGlass());
      feed.name = side < 0 ? 'Road mirror feed right' : 'Road mirror feed left';
      feed.position.copy(end);
      feed.quaternion.copy(view.quaternion);
      feed.translateZ(-0.0025);
      feed.visible = false;
      faces.push(feed);
      root.add(feed);
    }
  }
  mergeStatic(fixed);
  root.add(fixed);
  return { root, faces };
}
