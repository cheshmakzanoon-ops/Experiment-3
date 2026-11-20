import * as T from 'three';
import type { ClosedBodyModel } from './closed-body.ts';
import type { BuiltLod, CarMaterials } from './common.ts';
import { FestivalWipers } from './festival-wipers.ts';
import { sharedMaterials } from './materials.ts';
import type { Parts } from './parts.ts';
import type { Detail } from './wheel.ts';

/** Continuous laminated screen and folded frame on the open road car.
 * +v climbs the screen. The side edges rake and wrap onto the scuttle while
 * the header spans the actual top of the glass, including both corner radii. */
export function addRoadsterScreen(
  parts: Parts,
  model: ClosedBodyModel,
  materials: CarMaterials,
  glass: T.Material,
  lod: BuiltLod,
  detail: Detail,
) {
  const foot = model.f.z(model.s.cabin[0]) + 0.012;
  const half = model.halfWidth(foot) * 0.75;
  const rise = Math.min(0.39, model.s.roof - model.s.cowl);
  const rake = rise * 0.68,
    bow = 0.087;
  function point(u: number, v: number) {
    const corner = Math.max(0, (v - 0.85) / 0.15);
    const taper = 1 - 0.11 * v - 0.065 * (1 - Math.sqrt(Math.max(0, 1 - corner * corner)));
    const x = u * half * taper;
    const baseZ = foot + bow * (1 - u * u);
    const z = baseZ - v * (rake + 0.045 * u * u);
    const y = model.surfaceY(baseZ, Math.abs(u * half)) + 0.003 + rise * v * (1 - 0.06 * u * u);
    return new T.Vector3(x, y, z);
  }
  const columns = [24, 14, 8][detail],
    cornerSteps = [6, 4, 2][detail];
  const rows = [0, 0.28, 0.6, 0.85];
  for (let i = 1; i <= cornerSteps; i++)
    rows.push(0.85 + 0.15 * Math.sin(((i / cornerSteps) * Math.PI) / 2));
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (const v of rows) {
    for (let i = 0; i <= columns; i++) {
      const t = i / columns,
        p = point(2 * t - 1, v);
      positions.push(p.x, p.y, p.z);
      uv.push(t, v);
    }
  }
  for (let j = 1; j < rows.length; j++)
    for (let i = 0; i < columns; i++) {
      const a = (j - 1) * (columns + 1) + i,
        b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const pane = new T.BufferGeometry();
  pane.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  pane.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  pane.setIndex(indices);
  pane.computeVertexNormals();
  pane.addGroup(0, indices.length, 0);
  parts.addGrouped(pane, [glass], 'Cabin glass');

  // A rounded rectangular cross-section has separate highlights on its crown,
  // bevels and inner return. The header and both A-posts share their vertices.
  const path = rows.map((v) => point(-1, v));
  for (let k = 1; k <= columns; k++) path.push(point((2 * k) / columns - 1, 1));
  for (let j = rows.length - 2; j >= 0; j--) path.push(point(1, rows[j]));
  function moulding(spine: T.Vector3[], width: number, depth: number) {
    const section = [
      [-0.76, -1],
      [0.76, -1],
      [1, -0.55],
      [1, 0.48],
      [0.72, 1],
      [-0.72, 1],
      [-1, 0.48],
      [-1, -0.55],
    ];
    const pos: number[] = [],
      idx: number[] = [];
    const tangent = new T.Vector3(),
      normal = new T.Vector3(),
      across = new T.Vector3(),
      vertex = new T.Vector3();
    for (let i = 0; i < spine.length; i++) {
      tangent
        .subVectors(spine[Math.min(i + 1, spine.length - 1)], spine[Math.max(0, i - 1)])
        .normalize();
      normal.set(spine[i].x * 0.21, rake / rise, 1);
      across.crossVectors(tangent, normal).normalize();
      normal.crossVectors(across, tangent).normalize();
      for (const [w, d] of section) {
        vertex
          .copy(spine[i])
          .addScaledVector(across, w * width)
          .addScaledVector(normal, d * depth);
        pos.push(vertex.x, vertex.y, vertex.z);
      }
      if (i)
        for (let k = 0; k < section.length; k++) {
          const a = (i - 1) * section.length + k,
            b = (i - 1) * section.length + ((k + 1) % section.length);
          idx.push(a, a + section.length, b, b, a + section.length, b + section.length);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  parts.add(moulding(path, 0.023, 0.014), materials.paint);
  const lower = Array.from({ length: columns + 1 }, (_, k) => point((2 * k) / columns - 1, 0));
  parts.add(moulding(lower, 0.012, 0.009), sharedMaterials.trim());
  if (detail === 0) {
    const midFoot = foot + bow * 0.65;
    lod.wipers = FestivalWipers.fit(pane, {
      baseZ: midFoot,
      topZ: midFoot - rake,
      rise,
      halfWidth: half,
    });
    if (lod.wipers) lod.group.add(lod.wipers.mesh);
  }
}
