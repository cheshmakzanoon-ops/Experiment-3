import * as T from 'three';
import { clamp } from '../core/math.ts';
import { trackPoint, type Track } from '../simulation/track.ts';
import { gpGridSlot } from '../simulation/gp-grid.ts';
import { batchScene, box } from './geometry.ts';
import { surfaceGridFor } from './studio/road-detail.ts';

/** REF 014/016: a short front-wheel U mark, scaled to the existing GP bikes.
 * These are original visual dimensions, not measurements of the source game.
 * Slot locations remain owned by the simulation's venue grid. */
export const GP_GRID_PAINT = Object.freeze({
  halfWidth: 0.65,
  front: 1.12,
  returnLength: 0.7,
  stroke: 0.08,
  lift: 0.01,
});

/** Thin paint follows the same elevation/bank queries as the road ribbon.
 * Its three non-overlapping quads have no raised walls or cast-shadow volume. */
export function gpGridPaintGeometry(track: Track, s: number, lateral: number) {
  const p = trackPoint(),
    position: number[] = [],
    uv: number[] = [],
    index: number[] = [],
    { halfWidth: w, front, returnLength, stroke, lift } = GP_GRID_PAINT;
  function rectangle(left: number, right: number, from: number, to: number) {
    const start = position.length / 3;
    for (const [l, along] of [
      [left, from],
      [right, from],
      [left, to],
      [right, to],
    ]) {
      const station = s + along,
        across = lateral + l;
      track.at(station, p);
      position.push(
        p.x + p.nx * across,
        p.y + p.bank * clamp(across, -12, 12) + lift,
        p.z + p.nz * across,
      );
      uv.push(across / 5, station / 5);
    }
    index.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
  }
  rectangle(-w, w, front - stroke / 2, front + stroke / 2);
  rectangle(-w, -w + stroke, front - returnLength, front - stroke / 2);
  rectangle(w - stroke, w, front - returnLength, front - stroke / 2);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** At most two retained, spatially batched paint layers share the original
 * material. Menu, followed-bike and replay switches only change visibility
 * after a family's first use. Hidden layers stay reachable for scene disposal. */
export class GridPaintPresentation {
  readonly root = new T.Group();
  private readonly layers = new Map<boolean, T.Group>();
  private grandPrix = false;
  private ready = false;

  constructor(
    private readonly track: Track,
    private readonly material: T.MeshStandardMaterial,
  ) {
    this.root.name = 'Discipline starting-grid paint';
  }

  build(parent: T.Object3D) {
    if (this.ready) return;
    this.ready = true;
    parent.add(this.root);
    this.showLayer();
  }

  setGrandPrix(enabled: boolean) {
    if (this.grandPrix === enabled) return false;
    this.grandPrix = enabled;
    if (this.ready) this.showLayer();
    return true;
  }

  private showLayer() {
    if (!this.layers.has(this.grandPrix)) {
      const layer = new T.Group(),
        grid = surfaceGridFor(this.track);
      layer.name = this.grandPrix ? 'GP front-wheel grid marks' : 'Original grid boxes';
      for (let i = 0; i < grid.rows * 2; i++) {
        const { s, lateral } = this.grandPrix
          ? gpGridSlot(this.track, i)
          : {
              s: this.track.length - grid.front - Math.floor(i / 2) * grid.spacing,
              lateral: i % 2 === 0 ? -grid.lateral : grid.lateral,
            };
        if (this.grandPrix) {
          const mark = new T.Mesh(gpGridPaintGeometry(this.track, s, lateral), this.material);
          mark.name = 'GP front-wheel grid paint';
          mark.receiveShadow = true;
          layer.add(mark);
        } else {
          // Preserve the original dimensions, transforms, shadows and material
          // for cars and the other road motorcycles, including after GP replay.
          const p = this.track.at(s, trackPoint()),
            slot = new T.Group();
          slot.position.set(
            p.x + p.nx * lateral,
            p.y + p.bank * clamp(lateral, -12, 12) + 0.012,
            p.z + p.nz * lateral,
          );
          slot.rotation.y = Math.atan2(p.tx, p.tz);
          layer.add(slot);
          for (const x of [-1.1, 1.1]) box(slot, this.material, x, 0, 0, 0.08, 0.01, 4);
          box(slot, this.material, 0, 0, 2, 2.3, 0.01, 0.08);
        }
      }
      batchScene(layer, new Set());
      this.layers.set(this.grandPrix, layer);
      this.root.add(layer);
    }
    for (const [grandPrix, layer] of this.layers) layer.visible = grandPrix === this.grandPrix;
  }

  diagnostics() {
    return {
      mode: this.grandPrix ? 'gp' : 'original',
      cachedLayers: this.layers.size,
      slots: surfaceGridFor(this.track).rows * 2,
    };
  }
}
