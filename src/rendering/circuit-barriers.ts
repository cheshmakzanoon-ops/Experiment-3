import { APRON_SEPARATION_M } from './ground-profile.ts';
import * as T from 'three';
import { Track, trackPoint } from '../simulation/track.ts';
import { clamp } from '../core/math.ts';
import { catchFenceMaterial, installCircuitFinish } from './circuit-finish.ts';
import { mesh } from './geometry.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The outer dimensions retain the previous barrier proxy; bevels only remove
// material. The footing embeds 15 mm below the displayed grass to close its
// separation gap. Profiles follow BOTH endpoints, including camber/gradient.
const profile = [
  [-0.275, -APRON_SEPARATION_M - 0.015],
  [0.275, -APRON_SEPARATION_M - 0.015],
  [0.275, 0.16],
  [0.17, 0.55],
  [0.17, 0.89],
  [0.12, 0.94],
  [-0.12, 0.94],
  [-0.17, 0.89],
  [-0.17, 0.55],
  [-0.275, 0.16],
];
function at(track: Track, s: number, side: number, outward = 0, height = 0) {
  const p = track.at(s, trackPoint());
  const l = side * (track.boundary(s, side) + outward);
  return new T.Vector3(p.x + p.nx * l, p.y + p.bank * clamp(l, -12, 12) + height, p.z + p.nz * l);
}
export function barrierGeometry(track: Track, start: number, end: number, side: number) {
  if (![start, end, side].every(Number.isFinite) || end <= start || ![-1, 1].includes(side))
    throw new Error('Invalid barrier span');
  const position: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let edge = 0; edge < profile.length; edge++) {
    const next = (edge + 1) % profile.length,
      base = position.length / 3;
    for (const [s, point] of [
      [start, edge],
      [start, next],
      [end, edge],
      [end, next],
    ]) {
      const [x, y] = profile[point],
        p = at(track, s, side, x * side, y);
      position.push(p.x, p.y, p.z);
      uv.push(s / 5, y / 5);
    }
    // Profile is counter-clockwise in (normal,height); +tangent is extrusion.
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  // End caps are triangulated independently so bevels retain hard face normals.
  const faces = T.ShapeUtils.triangulateShape(
    profile.map(([x, y]) => new T.Vector2(x, y)),
    [],
  );
  for (const s of [start, end]) {
    const base = position.length / 3;
    for (const [x, y] of profile) {
      const p = at(track, s, side, x * side, y);
      position.push(p.x, p.y, p.z);
      uv.push(s / 5, y / 5);
    }
    for (const [a, b, c] of faces)
      index.push(
        ...(s === start ? [base + a, base + c, base + b] : [base + a, base + b, base + c]),
      );
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** At most 80 m per draw, unlike the old two full-lap fence meshes and full-lap
 * instance bounds. Nothing here adds a new collision wall or blocks a pit route. */
export function buildBarrierChunk(
  track: Track,
  root: T.Group,
  start: number,
  end: number,
  materials: ReturnType<typeof barrierMaterials>,
) {
  const chunk = new T.Group();
  for (const side of [-1, 1]) {
    const blocks: T.BufferGeometry[] = [],
      steel: T.BufferGeometry[] = [];
    const vertices: number[] = [],
      uv: number[] = [],
      indices: number[] = [];
    const count = Math.ceil((end - start) / 3.8);
    const beam = (a: T.Vector3, b: T.Vector3, r = 0.023) => {
      const g = new T.CylinderGeometry(r, r, a.distanceTo(b), 6);
      g.applyQuaternion(
        new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize()),
      );
      g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
      steel.push(g);
    };
    for (let i = 0; i < count; i++) {
      const a = start + ((end - start) * i) / count,
        b = start + ((end - start) * (i + 1)) / count;
      blocks.push(barrierGeometry(track, a + 0.008, b - 0.008, side));
      const p = at(track, a, side, 0.23, 0.93),
        q = at(track, a, side, 0.23, 3.4),
        r = at(track, a, side, -0.17, 3.8);
      beam(p, q, 0.036);
      beam(q, r, 0.033);
      // Support rails follow the same slope as each small fence section.
      for (const h of [1.18, 2.32, 3.4])
        beam(at(track, a, side, 0.23, h), at(track, b, side, 0.23, h), 0.012);
      for (const [height, offset] of [
        [0.96, 0.23],
        [3.4, 0.23],
        [3.8, -0.17],
      ]) {
        const p = at(track, a, side, offset, height);
        vertices.push(p.x, p.y, p.z);
        uv.push(a / 5, height / 5);
      }
    }
    for (const [height, offset] of [
      [0.96, 0.23],
      [3.4, 0.23],
      [3.8, -0.17],
    ]) {
      const p = at(track, end, side, offset, height);
      vertices.push(p.x, p.y, p.z);
      uv.push(end / 5, height / 5);
    }
    for (let i = 0; i < count; i++)
      for (let row = 0; row < 2; row++) {
        const a = i * 3 + row;
        indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    for (const [parts, material, name] of [
      [blocks, materials.concrete, 'Profiled concrete'],
      [steel, materials.steel, 'Catch-fence supports'],
    ] as const) {
      const g = mergeGeometries(parts, false)!;
      parts.forEach((p) => p.dispose());
      mesh(chunk, g, material).name = `${name} ${side} ${Math.round(start)}m`;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    const fence = mesh(chunk, g, materials.fence);
    fence.name = `Filtered fence ${side} ${Math.round(start)}m`;
    fence.castShadow = false;
    fence.receiveShadow = false;
  }
  // Paired sides share three material draws per longitudinal chunk. Keep the
  // transparent wire's shadow policy; the generic prop batcher must not turn it
  // back into an opaque shadow caster. Bounds remain local to this short span.
  for (const [name, material] of Object.entries(materials)) {
    const pieces = chunk.children.filter((o) => (o as T.Mesh).material === material) as T.Mesh[];
    const geometry = mergeGeometries(
      pieces.map((o) => o.geometry),
      false,
    )!;
    pieces.forEach((o) => o.geometry.dispose());
    const object = mesh(root, geometry, material);
    object.name = `Circuit ${name} ${Math.round(start)}-${Math.round(end)}m`;
    if (name === 'fence') {
      object.castShadow = false;
      object.receiveShadow = false;
    }
  }
  chunk.clear();
}
export function barrierMaterials() {
  const concrete = new T.MeshStandardMaterial({ color: 0xc4c3b7, roughness: 0.92 });
  installCircuitFinish(concrete, 'concrete');
  return {
    concrete,
    steel: new T.MeshStandardMaterial({ color: 0x7e8583, metalness: 0.65, roughness: 0.48 }),
    fence: catchFenceMaterial(),
  };
}
