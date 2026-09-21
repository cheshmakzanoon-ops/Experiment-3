import * as T from 'three';

/** Immutable oriented bounds of selected SOLID scene structures. These are
 * captured from the actual authored mesh transforms before spatial batching;
 * empty grandstand seating volumes/fences/trees are not treated as solid walls.
 * This is a conservative structure-occlusion test, not pixel-perfect visibility. */
export class BroadcastSightlines {
  private readonly solids: { inverse: T.Matrix4; bounds: T.Box3 }[] = [];
  private readonly a = new T.Vector3();
  private readonly b = new T.Vector3();
  private readonly direction = new T.Vector3();
  private readonly hit = new T.Vector3();
  private readonly ray = new T.Ray();
  get count() {
    return this.solids.length;
  }
  add(mesh: T.Mesh) {
    if (this.solids.length >= 256) throw new Error('Broadcast occluder budget exceeded');
    mesh.updateWorldMatrix(true, false);
    const matrix = mesh.matrixWorld;
    if (!matrix.elements.every(Number.isFinite) || Math.abs(matrix.determinant()) < 1e-12)
      throw new Error('Invalid static broadcast occluder transform');
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox!;
    if (
      bounds.isEmpty() ||
      ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
    )
      throw new Error('Invalid static broadcast occluder bounds');
    this.solids.push({ inverse: matrix.clone().invert(), bounds: bounds.clone() });
  }
  blocked(from: T.Vector3, to: T.Vector3) {
    if (!Number.isFinite(from.x + from.y + from.z + to.x + to.y + to.z))
      throw new Error('Invalid broadcast sightline');
    for (const solid of this.solids) {
      this.a.copy(from).applyMatrix4(solid.inverse);
      this.b.copy(to).applyMatrix4(solid.inverse);
      const length = this.direction.copy(this.b).sub(this.a).length();
      if (length < 1e-8) continue;
      if (solid.bounds.containsPoint(this.a)) return true;
      this.ray.set(this.a, this.direction.multiplyScalar(1 / length));
      if (
        this.ray.intersectBox(solid.bounds, this.hit) &&
        this.hit.distanceTo(this.a) < length - 0.01
      )
        return true;
    }
    return false;
  }
}
