import * as T from 'three';
import bodywork from './assets/gp-bodywork.mesh.json';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';

/** The nose's Boolean instrument well contains large planar triangle fans.
 * Area-weighted normals make their narrow rim triangles alternate between
 * the wall and the outer fairing, so the painted lip shows specular spokes.
 * Corner-angle weights are independent of that fan's triangle sizes. Smooth
 * only this connected component, joining its UV seam copies by position;
 * the tank, service panels and other material batches retain their normals.
 * Positions, UVs, indices and the model's triangle/draw budgets are unchanged. */
function smoothCowlNormals(geometry: T.BufferGeometry) {
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal'),
    index = geometry.index!,
    parent = new Uint32Array(position.count),
    vertex = new Uint32Array(position.count),
    points = new Map<string, number>();
  let nose = 0;
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
    let source = points.get(key);
    if (source === undefined) points.set(key, (source = i));
    parent[i] = vertex[i] = source;
    if (position.getZ(i) > position.getZ(nose)) nose = i;
  }
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < index.count; i += 3) {
    const a = root(index.getX(i));
    parent[root(index.getX(i + 1))] = a;
    parent[root(index.getX(i + 2))] = a;
  }
  const component = root(nose),
    weighted = new Float64Array(position.count * 3),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    ab = new T.Vector3(),
    ac = new T.Vector3(),
    bc = new T.Vector3(),
    face = new T.Vector3();
  const accumulate = (i: number, angle: number) => {
    const offset = vertex[i] * 3;
    weighted[offset] += face.x * angle;
    weighted[offset + 1] += face.y * angle;
    weighted[offset + 2] += face.z * angle;
  };
  for (let i = 0; i < index.count; i += 3) {
    const ia = index.getX(i),
      ib = index.getX(i + 1),
      ic = index.getX(i + 2);
    if (root(ia) !== component) continue;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    bc.subVectors(c, b);
    face.crossVectors(ab, ac);
    const area = face.length();
    if (area < 1e-12) continue;
    face.multiplyScalar(1 / area);
    accumulate(ia, Math.atan2(area, ab.dot(ac)));
    accumulate(ib, Math.atan2(area, -ab.dot(bc)));
    accumulate(ic, Math.atan2(area, ac.dot(bc)));
  }
  for (let i = 0; i < position.count; i++) {
    if (root(i) !== component) continue;
    face.fromArray(weighted, vertex[i] * 3);
    if (face.lengthSq() > 1e-20) {
      face.normalize();
      normal.setXYZ(i, face.x, face.y, face.z);
    }
  }
  normal.needsUpdate = true;
}

/** Original Blender-authored GP-R1 bodywork, in the existing chassis frame.
 * Only the rigid sprung shell is replaced. Forks, wheels, controls, rider IK
 * and pit-service articulation retain their production owners. No async swap
 * or late unshadowed mesh can appear during a replay. Geometry is owned by each
 * model; its existing disposal path releases it. Six material batches per LOD. */
function buildGroup(
  materials: BikeMaterials,
  source: typeof bodywork.high,
  name: string,
  smoothCowl = false,
): T.Group {
  const group = new T.Group();
  group.name = name;
  for (const part of source) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(part.position, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(part.normal, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(part.uv, 2));
    geometry.setIndex(part.index);
    if (smoothCowl && part.material === 'paint') smoothCowlNormals(geometry);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material =
      materials[
        part.material as 'paint' | 'secondary' | 'accent' | 'carbon' | 'dark' | 'seat' | 'aluminium'
      ];
    if (!material) throw new Error(`Unbound GP bodywork material: ${part.material}`);
    const mesh = new T.Mesh(geometry, material);
    mesh.name = `GP bodywork / ${part.material}`;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.authoredIn = 'Blender 5.2.2';
  group.userData.referenceRevision = 'motogp-100-r5-composite';
  return group;
}

export function gpBodywork(materials: BikeMaterials, detail: RiderDetail): T.Group {
  return buildGroup(
    materials,
    detail === 'high' ? bodywork.high : bodywork.mid,
    `GP-R1 authored shell (${detail})`,
    true,
  );
}
/** Full-fairing catalogue bikes share the open instrument well, not the GP-R1
 * tank, tail or aero. The existing box-wing and road-bike identities remain. */
export function gpUpperCowl(materials: BikeMaterials, detail: RiderDetail): T.Group {
  return buildGroup(
    materials,
    detail === 'high' ? bodywork.upperHigh : bodywork.upperMid,
    `Open motorcycle instrument cowl (${detail})`,
  );
}

type BodyworkPart = (typeof bodywork.high)[number];
const compactCowls = new Map<'high' | 'mid', typeof bodywork.high>();

/** Select whole connected surfaces, welding UV-seam copies only for the
 * connectivity search. The tank and side panels overlap the nose's rear z
 * range, so clipping triangles by position would leave unrelated fragments.
 * Keep original attribute vertices when copying the selected triangles. */
function compactCowlPart(part: BodyworkPart): BodyworkPart {
  const count = part.position.length / 3,
    parent = new Uint32Array(count),
    points = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = part.position.slice(i * 3, i * 3 + 3).join(',');
    let source = points.get(key);
    if (source === undefined) points.set(key, (source = i));
    parent[i] = source;
  }
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < part.index.length; i += 3) {
    const a = root(part.index[i]);
    parent[root(part.index[i + 1])] = a;
    parent[root(part.index[i + 2])] = a;
  }
  const bounds = new Map<number, { min: number; max: number }>();
  let nose = 0;
  for (let i = 0; i < count; i++) {
    const key = root(i),
      z = part.position[i * 3 + 2],
      extent = bounds.get(key) ?? { min: z, max: z };
    extent.min = Math.min(extent.min, z);
    extent.max = Math.max(extent.max, z);
    bounds.set(key, extent);
    if (z > part.position[nose * 3 + 2]) nose = i;
  }
  const front = root(nose),
    selected = new Set(
      [...bounds]
        .filter(([key, extent]) => (part.material === 'paint' ? key === front : extent.min > 0.7))
        .map(([key]) => key),
    ),
    result: BodyworkPart = { material: part.material, position: [], normal: [], uv: [], index: [] },
    vertices = new Map<number, number>();
  for (let i = 0; i < part.index.length; i += 3) {
    if (!selected.has(root(part.index[i]))) continue;
    for (let corner = 0; corner < 3; corner++) {
      const source = part.index[i + corner];
      let target = vertices.get(source);
      if (target === undefined) {
        target = vertices.size;
        vertices.set(source, target);
        result.position.push(...part.position.slice(source * 3, source * 3 + 3));
        result.normal.push(...part.normal.slice(source * 3, source * 3 + 3));
        result.uv.push(...part.uv.slice(source * 2, source * 2 + 2));
      }
      result.index.push(target);
    }
  }
  return result;
}

type CowlVertex = { p: T.Vector3; n: T.Vector3; uv: T.Vector2 };

/** Open the GP-R2 steering/fork channel behind the intact nose. Subtract a
 * rounded plan-view prism with interpolated triangle clipping, not missing
 * whole triangles. The loop aero attaches outside these 155 mm half-width
 * cheeks, and the channel ends before the ram-air duct at z=.748.
 * A 2.5 mm dark return follows the exposed edge without another material. */
function openRearForkChannel(part: BodyworkPart, cornerSegments: number) {
  const width = 0.155,
    front = 0.735,
    radius = 0.035,
    footprint = [new T.Vector2(-width, 0.2), new T.Vector2(width, 0.2)];
  for (let side = 1; side >= -1; side -= 2)
    for (let i = 0; i <= cornerSegments; i++) {
      const angle = (side > 0 ? 0 : Math.PI / 2) + (i * Math.PI) / (cornerSegments * 2);
      footprint.push(
        new T.Vector2(
          side * (width - radius) + radius * Math.cos(angle),
          front - radius + radius * Math.sin(angle),
        ),
      );
    }
  const planes = footprint.map((point, i) => {
      const next = footprint[(i + 1) % footprint.length],
        dx = next.x - point.x,
        dz = next.y - point.y;
      return new T.Plane(new T.Vector3(-dz, 0, dx), dz * point.x - dx * point.y).normalize();
    }),
    paint: BodyworkPart = { material: 'paint', position: [], normal: [], uv: [], index: [] },
    lip: BodyworkPart = { material: 'dark', position: [], normal: [], uv: [], index: [] },
    vertices = new Map<string, number>(),
    edgeKeys = new Set<string>(),
    edges: [CowlVertex, CowlVertex][] = [],
    ab = new T.Vector3(),
    ac = new T.Vector3();
  const pointKey = (p: T.Vector3) =>
    p
      .toArray()
      .map((value) => Math.round(value * 1e7))
      .join(',');
  const interpolate = (a: CowlVertex, b: CowlVertex, t: number): CowlVertex => ({
    p: a.p.clone().lerp(b.p, t),
    n: a.n.clone().lerp(b.n, t).normalize(),
    uv: a.uv.clone().lerp(b.uv, t),
  });
  const store = (v: CowlVertex) => {
    const key = `${pointKey(v.p)}/${v.uv.x},${v.uv.y}`;
    let index = vertices.get(key);
    if (index === undefined) {
      index = vertices.size;
      vertices.set(key, index);
      paint.position.push(...v.p.toArray().map((value) => Math.round(value * 1e7) / 1e7));
      paint.normal.push(...v.n.toArray());
      paint.uv.push(...v.uv.toArray());
    }
    return index;
  };
  const emit = (polygon: CowlVertex[]) => {
    if (polygon.length < 3) return;
    for (let i = 1; i < polygon.length - 1; i++) {
      const a = polygon[0],
        b = polygon[i],
        c = polygon[i + 1];
      if (ab.subVectors(b.p, a.p).cross(ac.subVectors(c.p, a.p)).lengthSq() < 1e-18) continue;
      paint.index.push(store(a), store(b), store(c));
    }
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      if (
        a.p.distanceToSquared(b.p) < 1e-14 ||
        !planes.some(
          (plane) =>
            Math.abs(plane.distanceToPoint(a.p)) < 1e-7 &&
            Math.abs(plane.distanceToPoint(b.p)) < 1e-7,
        )
      )
        continue;
      // A segment on one cutting plane can extend beyond another rounded
      // corner. Keep only its true exposed rim, not a return on retained paint.
      let start = 0,
        end = 1;
      for (const plane of planes) {
        const da = plane.distanceToPoint(a.p),
          db = plane.distanceToPoint(b.p),
          delta = db - da;
        if (Math.abs(delta) < 1e-12) {
          if (da < -1e-7) end = -1;
        } else if (delta > 0) start = Math.max(start, -da / delta);
        else end = Math.min(end, -da / delta);
      }
      if (end <= start) continue;
      const from = interpolate(a, b, start),
        to = interpolate(a, b, end),
        key = [pointKey(from.p), pointKey(to.p)].sort().join('/');
      if (from.p.distanceToSquared(to.p) < 1e-14) continue;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push([from, to]);
      }
    }
  };
  const split = (polygon: CowlVertex[], plane: T.Plane) => {
    const inside: CowlVertex[] = [],
      outside: CowlVertex[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        da = plane.distanceToPoint(a.p),
        db = plane.distanceToPoint(b.p),
        aInside = da >= 0,
        bInside = db >= 0;
      (aInside ? inside : outside).push(a);
      if (aInside !== bInside) {
        const t = da / (da - db),
          cut = interpolate(a, b, t);
        inside.push(cut);
        outside.push(cut);
      }
    }
    return { inside, outside };
  };
  for (let i = 0; i < part.index.length; i += 3) {
    let remaining: CowlVertex[] = part.index.slice(i, i + 3).map((index) => ({
      p: new T.Vector3().fromArray(part.position, index * 3),
      n: new T.Vector3().fromArray(part.normal, index * 3),
      uv: new T.Vector2().fromArray(part.uv, index * 2),
    }));
    // The rear shoulder clears the GP-R2's steering detail at full lock.
    // This local relief leaves the wing roots and forward intake unchanged.
    for (const { p } of remaining) {
      p.y +=
        0.02 *
        (1 - T.MathUtils.smoothstep(p.z, 0.36, 0.5)) *
        T.MathUtils.smoothstep(Math.abs(p.x), 0.155, 0.195) *
        T.MathUtils.smoothstep(p.y, 0.12, 0.21);
      // Lift only the low centre of the channel's forward lead-in. The
      // fully compressed mudguard needs this clearance below the ram-air
      // throat; the inlet face, outer cheeks and mounting points stay fixed.
      p.y +=
        0.015 *
        (1 - T.MathUtils.smoothstep(Math.abs(p.x), 0.08, 0.16)) *
        T.MathUtils.smoothstep(p.z, 0.66, 0.735) *
        (1 - T.MathUtils.smoothstep(p.z, 0.76, 0.85)) *
        (1 - T.MathUtils.smoothstep(p.y, 0.068, 0.082));
    }
    // Most triangles are wholly outside the opening. Do not subdivide them
    // against earlier planes when a later plane already excludes the prism.
    if (planes.some((plane) => remaining.every(({ p }) => plane.distanceToPoint(p) < 0))) {
      emit(remaining);
      continue;
    }
    for (const plane of planes) {
      const { inside, outside } = split(remaining, plane);
      emit(outside);
      remaining = inside;
      if (remaining.length < 3) break;
    }
  }
  for (const [a, b] of edges) {
    const offset = lip.position.length / 3,
      innerA = a.p.clone().addScaledVector(a.n, -0.0025),
      innerB = b.p.clone().addScaledVector(b.n, -0.0025),
      normal = ab.subVectors(a.p, b.p).cross(ac.subVectors(innerA, b.p)).normalize();
    lip.position.push(...b.p.toArray(), ...a.p.toArray(), ...innerA.toArray(), ...innerB.toArray());
    for (let i = 0; i < 4; i++) lip.normal.push(...normal.toArray());
    const length = a.p.distanceTo(b.p);
    lip.uv.push(0, 0, length, 0, length, 0.0025, 0, 0.0025);
    lip.index.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return { paint, lip };
}

/** GP-R2 shares the compact, open prototype nose while retaining its own
 * loop aero, lower flanks, tank and tail. Extract immutable source arrays once
 * per LOD; buildGroup still gives each model independently owned geometry.
 * The mid duct's separate recessed throat must remain with its outer walls.
 * Far uses the same silhouette: one additional dark draw, fewer triangles
 * than the legacy catalogue cowl, and no silhouette pop at the LOD boundary. */
export function gpCompactCowl(materials: BikeMaterials, detail: RiderDetail): T.Group {
  const level = detail === 'high' ? 'high' : 'mid';
  let source = compactCowls.get(level);
  if (!source) {
    const parts = bodywork[level]
        .filter((part) => part.material === 'paint' || part.material === 'dark')
        .map(compactCowlPart),
      { paint, lip } = openRearForkChannel(
        parts.find((part) => part.material === 'paint')!,
        level === 'high' ? 5 : 2,
      ),
      dark = parts.find((part) => part.material === 'dark')!,
      offset = dark.position.length / 3;
    dark.position.push(...lip.position);
    dark.normal.push(...lip.normal);
    dark.uv.push(...lip.uv);
    dark.index.push(...lip.index.map((index) => index + offset));
    source = [paint, dark];
    compactCowls.set(level, source);
  }
  return buildGroup(materials, source, `GP-R2 compact instrument cowl (${detail})`, true);
}
