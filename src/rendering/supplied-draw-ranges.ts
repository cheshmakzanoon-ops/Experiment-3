import * as T from 'three';

interface RangeBounds {
  index: T.BufferAttribute;
  position: T.BufferAttribute | T.InterleavedBufferAttribute;
  indexVersion: number;
  positionVersion: number;
  boxes: T.Box3[];
}
const TRIANGLES_PER_BLOCK = 128;
const BLOCK = TRIANGLES_PER_BLOCK * 3;
const version = (a: T.BufferAttribute | T.InterleavedBufferAttribute) =>
  a instanceof T.InterleavedBufferAttribute ? a.data.version : a.version;

/** Trim only wholly off-frustum prefixes/suffixes of static triangle streams.
 * The remaining contiguous range preserves every index, winding and ordering.
 * No vertices, materials, index buffers or draw calls are added. In particular,
 * transparent triangles are never sorted, and shadow/mirror cameras own their
 * own range. Original ranges are restored immediately after each submission. */
export class SuppliedDrawRanges {
  enabled = true;
  private readonly bounds = new Map<T.BufferGeometry, RangeBounds>();
  private readonly restore: (() => void)[] = [];
  private disposed = false;
  private readonly frustum = new T.Frustum();
  private readonly matrix = new T.Matrix4();
  private readonly point = new T.Vector3();
  private submissions = 0;
  private omittedIndices = 0;
  constructor(bindings: readonly { mesh: T.Mesh; geometries: readonly T.BufferGeometry[] }[]) {
    for (const { mesh, geometries } of bindings) {
      // Skinned, instanced and morphing geometry needs deformation-aware bounds;
      // retain the existing full submission for those paths.
      if (mesh instanceof T.SkinnedMesh || mesh instanceof T.InstancedMesh) continue;
      for (const geometry of geometries) this.prepare(geometry);
      if (!geometries.some((g) => this.bounds.has(g))) continue;
      const before = mesh.onBeforeRender,
        after = mesh.onAfterRender;
      const beforeShadow = mesh.onBeforeShadow,
        afterShadow = mesh.onAfterShadow;
      let held: { geometry: T.BufferGeometry; start: number; count: number } | null = null;
      const reset = () => {
        if (!held) return;
        held.geometry.setDrawRange(held.start, held.count);
        held = null;
      };
      const select = (camera: T.Camera, geometry: T.BufferGeometry, material: T.Material) => {
        reset();
        if (!this.enabled || this.disposed || camera instanceof T.ArrayCamera) return;
        // Unknown vertex programs or displacement may move an otherwise rejected
        // triangle into view. Fall back rather than guessing its envelope.
        if (
          !(
            material instanceof T.MeshStandardMaterial ||
            material instanceof T.MeshBasicMaterial ||
            material instanceof T.MeshDepthMaterial ||
            material instanceof T.MeshDistanceMaterial
          ) ||
          ('displacementMap' in material && material.displacementMap) ||
          ('wireframe' in material && material.wireframe)
        )
          return;
        const b = this.bounds.get(geometry);
        if (
          !b ||
          geometry.index !== b.index ||
          geometry.attributes.position !== b.position ||
          version(b.index) !== b.indexVersion ||
          version(b.position) !== b.positionVersion ||
          geometry.morphAttributes.position?.length ||
          geometry.groups.length
        )
          return;
        const { start, count } = geometry.drawRange;
        // A non-triangle-aligned caller range changes primitive assembly. Keep it
        // intact, including unusual finite counts, instead of rounding indices.
        if (start !== 0 || count !== Infinity) return;
        this.matrix
          .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
          .multiply(mesh.matrixWorld);
        if (!this.matrix.elements.every(Number.isFinite) || this.matrix.determinant() === 0) return;
        this.frustum.setFromProjectionMatrix(this.matrix, camera.coordinateSystem);
        if (
          this.frustum.planes.some(
            (p) => ![p.normal.x, p.normal.y, p.normal.z, p.constant].every(Number.isFinite),
          )
        )
          return;
        let first = 0,
          last = b.boxes.length - 1;
        while (first <= last && !this.frustum.intersectsBox(b.boxes[first])) first++;
        while (last >= first && !this.frustum.intersectsBox(b.boxes[last])) last--;
        const lo = Math.min(first * BLOCK, b.index.count);
        const hi = last < first ? lo : Math.min((last + 1) * BLOCK, b.index.count);
        this.submissions++;
        this.omittedIndices += b.index.count - (hi - lo);
        if (hi - lo === b.index.count) return;
        held = { geometry, start, count };
        geometry.setDrawRange(lo, hi - lo);
      };
      mesh.onBeforeRender = (...args) => {
        before.apply(mesh, args);
        select(args[2], args[3], args[4]);
      };
      mesh.onAfterRender = (...args) => {
        reset();
        after.apply(mesh, args);
      };
      mesh.onBeforeShadow = (...args) => {
        beforeShadow.apply(mesh, args);
        select(args[3], args[4], args[5]);
      };
      mesh.onAfterShadow = (...args) => {
        reset();
        afterShadow.apply(mesh, args);
      };
      this.restore.push(() => {
        reset();
        mesh.onBeforeRender = before;
        mesh.onAfterRender = after;
        mesh.onBeforeShadow = beforeShadow;
        mesh.onAfterShadow = afterShadow;
      });
    }
  }
  private prepare(geometry: T.BufferGeometry) {
    if (this.bounds.has(geometry)) return;
    const index = geometry.index,
      position = geometry.getAttribute('position');
    if (
      !index ||
      index.count < BLOCK * 2 ||
      index.count % 3 ||
      !position ||
      position.itemSize !== 3 ||
      geometry.groups.length ||
      geometry.morphAttributes.position?.length
    )
      return;
    const boxes: T.Box3[] = [];
    for (let start = 0; start < index.count; start += BLOCK) {
      const box = new T.Box3(),
        end = Math.min(start + BLOCK, index.count);
      for (let i = start; i < end; i++) {
        const vertex = index.getX(i);
        if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count) return;
        this.point.fromBufferAttribute(position, vertex);
        if (![this.point.x, this.point.y, this.point.z].every(Number.isFinite)) return;
        box.expandByPoint(this.point);
      }
      // Extra local-space margin protects near-plane silhouettes from float32
      // matrix/attribute rounding; it can only retain more source triangles.
      box.expandByScalar(1e-3);
      boxes.push(box);
    }
    this.bounds.set(geometry, {
      index,
      position,
      indexVersion: version(index),
      positionVersion: version(position),
      boxes,
    });
  }
  diagnostics() {
    return {
      meshes: this.restore.length,
      geometries: this.bounds.size,
      submissions: this.submissions,
      omittedTriangles: this.omittedIndices / 3,
    };
  }
  dispose() {
    if (this.disposed) return;
    for (const restore of this.restore) restore();
    this.restore.length = 0;
    this.bounds.clear();
    this.disposed = true;
  }
}
