import * as T from 'three';
import { markItems } from '../attribute-ranges.ts';

interface SeatSection {
  bounds: T.Box3;
  matrices: Float32Array;
  colours: Float32Array;
  count: number;
  visible: boolean;
}

/** One seat draw for the whole bowl. Keep immutable runs of seats in small
 * floor-plan sections and submit only the runs intersecting this pass's
 * frustum. The full shell bounds include its pedestal and rolled seat back. */
export class MxStadiumChairSections {
  readonly mesh: T.InstancedMesh;
  private readonly sections: SeatSection[] = [];
  private readonly frustum = new T.Frustum();
  private readonly projection = new T.Matrix4();

  constructor(geometry: T.BufferGeometry, material: T.Material, seats: readonly T.Matrix4[], colours: readonly T.Color[]) {
    const mesh = this.mesh = new T.InstancedMesh(geometry, material, seats.length);
    mesh.name = 'Moulded stadium chairs (instanced)';
    mesh.receiveShadow = true;
    geometry.computeBoundingBox();
    const groups = new Map<string, number[]>();
    for (let i = 0; i < seats.length; i++) {
      const m = seats[i].elements;
      const key = Math.floor(m[12] / 8) + ',' + Math.floor(m[14] / 8);
      const run = groups.get(key);
      if (run) run.push(i); else groups.set(key,[i]);
    }
    let offset = 0;
    const box = new T.Box3();
    for (const run of groups.values()) {
      const bounds = new T.Box3();
      const matrices = new Float32Array(16 * run.length), tints = new Float32Array(3 * run.length);
      for (let j = 0; j < run.length; j++) {
        const id = run[j], m = seats[id];
        m.toArray(matrices, j * 16);
        colours[id].toArray(tints, j * 3);
        bounds.union(box.copy(geometry.boundingBox!).applyMatrix4(m));
        mesh.setMatrixAt(offset, m);
        mesh.setColorAt(offset++, colours[id]);
      }
      this.sections.push({bounds, matrices, colours: tints, count: run.length, visible: true});
    }
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.instanceColor?.setUsage(T.DynamicDrawUsage);
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }

  /** Called by the scene before Three builds its render list and uploads
   * instance buffers. Cubemap faces and photo cameras select their own seats.
   * Chairs only receive shadows, so a light pass needs no second seat list. */
  present(camera: T.Camera) {
    this.mesh.updateWorldMatrix(true,false);
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(this.mesh.matrixWorld);
    this.frustum.setFromProjectionMatrix(this.projection, camera.coordinateSystem);
    let changed = false;
    for (const section of this.sections) {
      const visible = camera instanceof T.ArrayCamera || this.frustum.intersectsBox(section.bounds);
      if (visible !== section.visible) changed = true;
      section.visible = visible;
    }
    if (!changed) return;
    const matrix = this.mesh.instanceMatrix, colour = this.mesh.instanceColor!;
    let count = 0;
    for (const section of this.sections) {
      if (!section.visible) continue;
      matrix.array.set(section.matrices, count * 16);
      colour.array.set(section.colours, count * 3);
      count += section.count;
    }
    this.mesh.count = count;
    markItems(matrix,0,count-1);
    markItems(colour,0,count-1);
  }
}
