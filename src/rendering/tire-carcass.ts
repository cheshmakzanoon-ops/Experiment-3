import * as T from 'three';
import { clamp } from '../core/math.ts';
import { mesh } from './geometry.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BEAD = 0.245,
  NOMINAL = 0.335;
/** Presentation-only reduced carcass model. Radius is the recorded effective
 * contact radius, NOT a new tire-force simulation. The bead remains on its
 * rigid rim. Loaded rubber develops a bounded, axle-plane contact patch whose
 * bottom matches that radius; the crown and sidewall absorb the deflection.
 * No random state, wall clock, or force feedback enters this geometry. */
export function tireDeflection(radius: number, load: number, pressure: number) {
  return clamp(
    Math.max(0, load) / (260000 * clamp(pressure / 155, 0.12, 2)),
    0,
    Math.min(0.022, Math.max(0, radius - BEAD) * 0.5),
  );
}
interface Surface {
  geometry: T.BufferGeometry;
  positions: T.BufferAttribute;
  original: Float32Array;
  seams: number[][];
}
export class TireCarcass {
  readonly root = new T.Group();
  private surfaces: Surface[] = [];
  private lastPhase = NaN;
  private lastRadius = NaN;
  private lastDeflection = NaN;
  constructor(half: number, tread: T.Material, marking: T.Material) {
    const profile = [
      new T.Vector2(BEAD, -half),
      new T.Vector2(0.306, -half),
      new T.Vector2(0.331, -half + 0.025),
      new T.Vector2(NOMINAL, -half + 0.065),
      new T.Vector2(NOMINAL, half - 0.065),
      new T.Vector2(0.331, half - 0.025),
      new T.Vector2(0.306, half),
      new T.Vector2(BEAD, half),
    ];
    mesh(this.root, new T.LatheGeometry(profile, 48).rotateZ(Math.PI / 2), tread);
    const rings = [-1, 1].map((side) =>
      new T.TorusGeometry(0.287, 0.005, 6, 48)
        .rotateY(Math.PI / 2)
        .translate(side * (half + 0.001), 0, 0),
    );
    mesh(this.root, mergeGeometries(rings, false), marking).name = 'Compound sidewall markings';
    for (const ring of rings) ring.dispose();
    this.root.name = 'Deformable tire rubber (rigid rim excluded)';
    for (const child of this.root.children) {
      if (!(child instanceof T.Mesh)) continue;
      const geometry = child.geometry as T.BufferGeometry,
        positions = geometry.getAttribute('position') as T.BufferAttribute;
      positions.setUsage(T.DynamicDrawUsage);
      const original = new Float32Array(positions.array),
        groups = new Map<string, number[]>();
      // UV and material seams retain their own vertices. Reconcile only their
      // normals after deformation, avoiding an artificial bright longitudinal seam.
      for (let i = 0; i < positions.count; i++) {
        const key = `${Math.round(original[i * 3] * 1e6)},${Math.round(original[i * 3 + 1] * 1e6)},${Math.round(original[i * 3 + 2] * 1e6)}`;
        const existing = groups.get(key);
        if (existing) existing.push(i);
        else groups.set(key, [i]);
      }
      (geometry.getAttribute('normal') as T.BufferAttribute).setUsage(T.DynamicDrawUsage);
      this.surfaces.push({
        geometry,
        positions,
        original,
        seams: [...groups.values()].filter((g) => g.length > 1),
      });
      // Conservative immutable bounds cover every permitted crown/sidewall pose.
      geometry.boundingBox = new T.Box3(
        new T.Vector3(-half - 0.015, -0.36, -0.36),
        new T.Vector3(half + 0.015, 0.36, 0.36),
      );
      geometry.boundingSphere = new T.Sphere(new T.Vector3(), Math.hypot(half + 0.015, 0.36));
    }
  }
  update(phase: number, recordedRadius: number, load: number, pressure: number, flatSpot = 0) {
    // Invalid external fixture data is never allowed to poison a GPU buffer.
    if (![phase, recordedRadius, load, pressure, flatSpot].every(Number.isFinite))
      throw new Error('Non-finite tire presentation state');
    const radius = clamp(
        (recordedRadius || NOMINAL) - clamp(flatSpot, 0, 1) * 0.002 * (1 + Math.cos(phase)),
        BEAD + 0.007,
        NOMINAL,
      ),
      deflection = tireDeflection(radius, load, pressure || 155);
    if (
      phase === this.lastPhase &&
      radius === this.lastRadius &&
      deflection === this.lastDeflection
    )
      return;
    this.lastPhase = phase;
    this.lastRadius = radius;
    this.lastDeflection = deflection;
    const sn = Math.sin(phase),
      cs = Math.cos(phase),
      free = radius + deflection;
    for (const { geometry, positions, original, seams } of this.surfaces) {
      for (let i = 0; i < positions.count; i++) {
        const x = original[3 * i],
          y = original[3 * i + 1],
          z = original[3 * i + 2],
          radial = Math.hypot(y, z),
          weight = clamp((radial - BEAD) / (NOMINAL - BEAD), 0, 1),
          scale = 1 + ((free - NOMINAL) * weight) / Math.max(BEAD, radial),
          rollingY = (y * cs - z * sn) * scale,
          rollingZ = (y * sn + z * cs) * scale,
          bottom = Math.max(rollingY, -radius),
          bulge = Math.max(0, -rollingY / Math.max(0.01, free)) ** 4 * weight * deflection * 0.35;
        // Deform in the non-spinning axle frame, then return to mesh space.
        // The contact patch stays below the axle while the UVs rotate with it.
        positions.setXYZ(
          i,
          x + Math.sign(x) * bulge,
          bottom * cs + rollingZ * sn,
          -bottom * sn + rollingZ * cs,
        );
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      const normals = geometry.getAttribute('normal') as T.BufferAttribute;
      for (const seam of seams) {
        let x = 0,
          y = 0,
          z = 0;
        for (const i of seam) {
          x += normals.getX(i);
          y += normals.getY(i);
          z += normals.getZ(i);
        }
        const length = Math.hypot(x, y, z) || 1;
        for (const i of seam) normals.setXYZ(i, x / length, y / length, z / length);
      }
      normals.needsUpdate = true;
    }
  }
}
