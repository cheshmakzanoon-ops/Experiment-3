import * as T from 'three';
import { SuppliedDrawRanges } from './supplied-draw-ranges.ts';
import manifest from './supplied-player-lods.manifest.json' with { type: 'json' };
import type { PlayerLodData } from '../engine/assets/player-lod-data.ts';
export {
  parsePlayerLods,
  loadPlayerLods,
  type PlayerLodRow,
  type PlayerLodData,
} from '../engine/assets/player-lod-data.ts';

const fail = (): never => {
  throw new Error('Invalid supplied player LOD contract');
};
const integer = (v: number, min: number, max: number) =>
  Number.isInteger(v) && v >= min && v <= max;

/** Geometry wrappers share immutable source attributes, never materials, bones
 * or animation copies. Switching a tier swaps indices, not the player model. */
export class SuppliedPlayerLods {
  private readonly bindings: { mesh: T.Mesh; geometries: T.BufferGeometry[] }[] = [];
  private readonly owned = new Set<T.BufferGeometry>();
  readonly drawRanges?: SuppliedDrawRanges;
  private tier = 0;
  private disposed = false;
  constructor(
    root: T.Group,
    keyFor: (mesh: T.Mesh) => { meshes?: number; primitives?: number } | undefined,
    data: PlayerLodData,
  ) {
    const used = new Set<string>();
    try {
      root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const ref = keyFor(object);
        const key = `${ref?.meshes}:${ref?.primitives}`;
        const row = data.rows.get(key);
        const original: T.BufferGeometry = object.geometry;
        if (
          !row ||
          used.has(key) ||
          original.index?.count !== row.originalCount ||
          original.getAttribute('position').count !== row.vertices
        )
          fail();
        if (!row) return fail();
        used.add(key);
        const geometries = [original];
        const shared = new Map<number, T.BufferGeometry>();
        for (const level of row.levels) {
          if (level.offset < 0) {
            geometries.push(original);
            continue;
          }
          const reused = shared.get(level.offset);
          if (reused) {
            if (reused.index?.count !== level.count) fail();
            geometries.push(reused);
            continue;
          }
          const geometry = new T.BufferGeometry();
          shared.set(level.offset, geometry);
          this.owned.add(geometry);
          for (const [name, attribute] of Object.entries(original.attributes))
            geometry.setAttribute(name, attribute);
          geometry.morphAttributes = original.morphAttributes;
          geometry.morphTargetsRelative = original.morphTargetsRelative;
          geometry.boundingBox = original.boundingBox;
          geometry.boundingSphere = original.boundingSphere;
          geometry.setIndex(
            new T.BufferAttribute(
              data.indices.subarray(level.offset, level.offset + level.count),
              1,
            ),
          );
          geometries.push(geometry);
        }
        this.bindings.push({ mesh: object, geometries });
      });
      if (used.size !== manifest.primitives) fail();
      this.drawRanges = new SuppliedDrawRanges(this.bindings, true);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  setLevel(level: number, quality: 'low' | 'medium' | 'high', exactClose = false) {
    if (!integer(level, 0, 2) || this.disposed) throw new Error('Invalid player LOD selection');
    const tier = level === 0 ? (quality === 'high' || exactClose ? 0 : 1) : level + 1;
    if (tier === this.tier) return;
    this.tier = tier;
    for (const { mesh, geometries } of this.bindings) mesh.geometry = geometries[tier];
  }
  diagnostics() {
    return {
      tier: this.tier,
      triangles: manifest.triangles[this.tier],
      tiers: [...manifest.triangles],
      sha256: manifest.sha256,
      sourceSHA256: manifest.sourceSHA256,
      sharedAttributes: true,
      ownedGeometries: this.owned.size,
      disposed: this.disposed,
      drawRanges: this.drawRanges?.diagnostics() ?? null,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.drawRanges?.dispose();
    // Restore original ownership before RacingRenderer traverses/disposes scene resources.
    for (const { mesh, geometries } of this.bindings) mesh.geometry = geometries[0];
    this.owned.forEach((geometry) => geometry.dispose());
    this.owned.clear();
    this.disposed = true;
  }
}
