import * as T from 'three';

/** Side exit behind the radiator. Its raked quadrilateral sits just inside
 * the painted surround on both prototypes. Coordinates are metres in the
 * sprung frame. U runs forward across the opening, V upwards along its rake. */
const Z0 = 0.226,
  Y0 = -0.066,
  UZ = 0.136,
  UY = 0.013,
  VZ = 0.052,
  VY = 0.171;
const DET = UZ * VY - UY * VZ;
const EPS = 1e-7;
interface CutVertex {
  index: number;
  u: number;
  v: number;
}

function indexedSurface(positions: number[], indices: number[]) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Cut the triangles themselves so a shallow viewing angle sees the depth
 * of the duct. Retained paint keeps its interpolated normals and side UVs.
 * Walls follow every intersection with the production mould, including
 * creases. No coplanar overlay, transparency or stencil pass is required. */
export function gpFairingOutlet(source: T.BufferGeometry, r2: boolean, nearby: boolean) {
  const pos = source.getAttribute('position'),
    normal = source.getAttribute('normal');
  const uv = source.getAttribute('uv'),
    index = source.index!;
  const positions = Array.from(pos.array),
    normals = Array.from(normal.array),
    coords = Array.from(uv.array);
  const kept: number[] = [],
    linerPositions: number[] = [],
    linerIndex: number[] = [];
  const vertices = new Map<number, CutVertex>();
  const depth = r2 ? 0.031 : 0.027;
  function vertex(i: number) {
    let v = vertices.get(i);
    if (!v) {
      const z = pos.getZ(i) - Z0,
        y = pos.getY(i) - Y0;
      v = { index: i, u: (z * VY - y * VZ) / DET, v: (UZ * y - UY * z) / DET };
      vertices.set(i, v);
    }
    return v;
  }
  function between(a: CutVertex, b: CutVertex, t: number) {
    if (t < EPS) return a;
    if (t > 1 - EPS) return b;
    const i = positions.length / 3;
    for (let k = 0; k < 3; k++) {
      positions.push(T.MathUtils.lerp(positions[3 * a.index + k], positions[3 * b.index + k], t));
      normals.push(T.MathUtils.lerp(normals[3 * a.index + k], normals[3 * b.index + k], t));
    }
    const length = Math.hypot(normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]);
    if (length) for (let k = 0; k < 3; k++) normals[3 * i + k] /= length;
    for (let k = 0; k < 2; k++)
      coords.push(T.MathUtils.lerp(coords[2 * a.index + k], coords[2 * b.index + k], t));
    return { index: i, u: T.MathUtils.lerp(a.u, b.u, t), v: T.MathUtils.lerp(a.v, b.v, t) };
  }
  function fan(polygon: CutVertex[]) {
    for (let i = 1; i + 1 < polygon.length; i++) {
      const a = polygon[0],
        b = polygon[i],
        c = polygon[i + 1];
      if (Math.abs((b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u)) > EPS * EPS)
        kept.push(a.index, b.index, c.index);
    }
  }
  const distances = [
    (p: CutVertex) => p.u,
    (p: CutVertex) => 1 - p.u,
    (p: CutVertex) => p.v,
    (p: CutVertex) => 1 - p.v,
  ];
  function linerVertex(v: CutVertex, inset: number) {
    const k = 3 * v.index,
      x = positions[k];
    const id = linerPositions.length / 3;
    linerPositions.push(x - Math.sign(x) * inset, positions[k + 1], positions[k + 2]);
    return id;
  }
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i),
      b = index.getX(i + 1),
      c = index.getX(i + 2);
    if (
      Math.max(pos.getZ(a), pos.getZ(b), pos.getZ(c)) < Z0 ||
      Math.min(pos.getZ(a), pos.getZ(b), pos.getZ(c)) > Z0 + UZ + VZ ||
      Math.max(pos.getY(a), pos.getY(b), pos.getY(c)) < Y0 ||
      Math.min(pos.getY(a), pos.getY(b), pos.getY(c)) > Y0 + UY + VY
    ) {
      kept.push(a, b, c);
      continue;
    }
    let cut = [vertex(a), vertex(b), vertex(c)];
    if (distances.some((distance) => cut.every((v) => distance(v) <= 0))) {
      kept.push(a, b, c);
      continue;
    }
    for (const distance of distances) {
      if (cut.every((v) => distance(v) >= 0)) continue;
      const inside: CutVertex[] = [],
        outside: CutVertex[] = [];
      for (let j = 0; j < cut.length; j++) {
        const from = cut[j],
          to = cut[(j + 1) % cut.length],
          d0 = distance(from),
          d1 = distance(to);
        (d0 >= 0 ? inside : outside).push(from);
        if (d0 < 0 !== d1 < 0) {
          const cross = between(from, to, d0 / (d0 - d1));
          inside.push(cross);
          outside.push(cross);
        }
      }
      fan(outside);
      cut = inside;
      if (cut.length < 3) break;
    }
    if (cut.length < 3) continue;
    const ring = cut.map((v) => linerVertex(v, depth));
    for (let j = 1; j + 1 < ring.length; j++) linerIndex.push(ring[0], ring[j], ring[j + 1]);
    for (let j = 0; j < cut.length; j++) {
      const a = cut[j],
        b = cut[(j + 1) % cut.length];
      if (
        a.index === b.index ||
        !distances.some((d) => Math.abs(d(a)) < EPS && Math.abs(d(b)) < EPS)
      )
        continue;
      const k = linerPositions.length / 3;
      linerVertex(a, 0);
      linerVertex(b, 0);
      linerVertex(b, depth);
      linerVertex(a, depth);
      linerIndex.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
  }
  const skin = new T.BufferGeometry();
  skin.name = source.name;
  skin.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  skin.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  skin.setAttribute('uv', new T.Float32BufferAttribute(coords, 2));
  skin.setIndex(kept);

  // Sample the uncut mould only at manufacture. Each crowned blade is
  // embedded into the sidewalls and slopes into the plenum at its leading edge.
  const probeMaterial = new T.MeshBasicMaterial({ side: T.DoubleSide });
  const probe = new T.Mesh(source, probeMaterial),
    ray = new T.Raycaster(),
    direction = new T.Vector3(-1, 0, 0);
  const hits: T.Intersection[] = [];
  const bladePos: number[] = [],
    bladeIx: number[] = [];
  const bladeCount = r2 ? 3 : 4,
    segments = nearby ? 4 : 2;
  for (const side of [-1, 1])
    for (let blade = 0; blade < bladeCount; blade++) {
      const base = bladePos.length / 3;
      for (let k = 0; k <= segments; k++) {
        const u = T.MathUtils.lerp(-0.013, 1.013, k / segments);
        const v = (blade + 1) / (bladeCount + 1);
        const y = Y0 + u * UY + v * VY,
          z = Z0 + u * UZ + v * VZ;
        ray.set(new T.Vector3(0.5, y, z), direction);
        hits.length = 0;
        ray.intersectObject(probe, false, hits);
        if (!hits.length) throw new Error('GP fairing outlet missed its mould');
        const wall = hits[0].point.x;
        for (const [inset, dy] of [
          [0.003, -0.003],
          [0.004, 0.002],
          [0.021, 0.009],
          [0.021, 0.005],
        ]) {
          bladePos.push(side * (wall - inset), y + dy, z);
        }
      }
      for (let k = 0; k < segments; k++)
        for (let j = 0; j < 4; j++) {
          const a = base + 4 * k + j,
            b = base + 4 * k + ((j + 1) % 4);
          if (side > 0) bladeIx.push(a, b, a + 4, b, b + 4, a + 4);
          else bladeIx.push(a, a + 4, b, b, a + 4, b + 4);
        }
    }
  probeMaterial.dispose();
  source.dispose();
  return {
    skin,
    liner: indexedSurface(linerPositions, linerIndex),
    blades: indexedSurface(bladePos, bladeIx),
  };
}
