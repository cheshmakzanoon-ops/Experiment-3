import * as T from 'three';

interface SkinBound {
  mesh: T.SkinnedMesh;
  invalidate: () => void;
  restore: () => void;
  bones: number;
}

/** A convex bound for linear blend skinning. Each joint owns a bind-space box
 * containing every source vertex with a positive influence from that joint.
 * The union of their transformed boxes contains every weighted vertex. LODs
 * share these source attributes, so changing index sets cannot invalidate it.
 * No source vertices, weights, poses or materials are rewritten. */
export class SuppliedSkinBounds {
  private readonly entries: SkinBound[] = [];
  private disposed = false;
  private fallbacks = 0;
  constructor(root: T.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof T.SkinnedMesh)) return;
      const entry = this.create(object);
      if (entry) this.entries.push(entry);
      else this.fallbacks++;
    });
  }
  private create(mesh: T.SkinnedMesh): SkinBound | null {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const indices = geometry.getAttribute('skinIndex');
    const weights = geometry.getAttribute('skinWeight');
    if (
      !position ||
      !indices ||
      !weights ||
      geometry.morphAttributes.position?.length ||
      indices.count !== position.count ||
      weights.count !== position.count ||
      indices.itemSize !== 4 ||
      weights.itemSize !== 4
    )
      return null;
    const attributeVersion = (attribute: T.BufferAttribute | T.InterleavedBufferAttribute) =>
      attribute instanceof T.InterleavedBufferAttribute
        ? attribute.data.version
        : attribute.version;
    const versions = [position, indices, weights].map(attributeVersion);
    const bind = mesh.bindMatrix.clone();
    const boxes = new Map<number, T.Box3>();
    const point = new T.Vector3();
    let minimumSum = Infinity,
      maximumSum = 0;
    for (let vertex = 0; vertex < position.count; vertex++) {
      point.fromBufferAttribute(position, vertex).applyMatrix4(bind);
      if (![point.x, point.y, point.z].every(Number.isFinite)) return null;
      let sum = 0;
      for (let component = 0; component < 4; component++) {
        const weight = weights.getComponent(vertex, component);
        if (!Number.isFinite(weight) || weight < 0) return null;
        sum += weight;
        if (weight === 0) continue;
        const joint = indices.getComponent(vertex, component);
        if (
          !Number.isInteger(joint) ||
          !mesh.skeleton.bones[joint] ||
          !mesh.skeleton.boneInverses[joint]
        )
          return null;
        let box = boxes.get(joint);
        if (!box) {
          box = new T.Box3();
          boxes.set(joint, box);
        }
        box.expandByPoint(point);
      }
      if (!(sum > 0) || !Number.isFinite(sum)) return null;
      minimumSum = Math.min(minimumSum, sum);
      maximumSum = Math.max(maximumSum, sum);
    }
    if (!boxes.size) return null;
    // r180 initializes this field to null; its published types omit that state.
    const lazy = mesh as unknown as { boundingSphere: T.Sphere | null };
    const original = mesh.computeBoundingSphere;
    const originalSphere = mesh.boundingSphere;
    const culled = mesh.frustumCulled;
    const sphere = new T.Sphere();
    const union = new T.Box3(),
      transformed = new T.Box3(),
      matrix = new T.Matrix4();
    mesh.computeBoundingSphere = () => {
      // Unknown replacement attributes/bind or newly introduced morphs use
      // Three's exact CPU-skin calculation, never a stale optimized bound.
      if (
        mesh.geometry.getAttribute('position') !== position ||
        mesh.geometry.getAttribute('skinIndex') !== indices ||
        mesh.geometry.getAttribute('skinWeight') !== weights ||
        attributeVersion(position) !== versions[0] ||
        attributeVersion(indices) !== versions[1] ||
        attributeVersion(weights) !== versions[2] ||
        mesh.geometry.morphAttributes.position?.length ||
        !mesh.bindMatrix.equals(bind)
      ) {
        original.call(mesh);
        return;
      }
      union.makeEmpty();
      let magnitude = 1;
      for (const [joint, box] of boxes) {
        const bone = mesh.skeleton.bones[joint],
          inverse = mesh.skeleton.boneInverses[joint];
        if (!bone || !inverse) {
          sphere.center.set(0, 0, 0);
          sphere.radius = Infinity;
          mesh.boundingSphere = sphere;
          return;
        }
        matrix.multiplyMatrices(bone.matrixWorld, inverse);
        // Account conservatively for the float32 bone-palette upload, including
        // cancellation of large world translations in the inverse bind matrix.
        for (const value of matrix.elements) magnitude = Math.max(magnitude, Math.abs(value));
        matrix.premultiply(mesh.bindMatrixInverse);
        union.union(transformed.copy(box).applyMatrix4(matrix));
      }
      // Weight sums need not be exactly one after float32 decoding. A positive
      // sum scales a convex combination; bound both interval endpoints.
      for (let axis = 0; axis < 3; axis++) {
        const low = union.min.getComponent(axis),
          high = union.max.getComponent(axis);
        union.min.setComponent(axis, Math.min(low * minimumSum, low * maximumSum));
        union.max.setComponent(axis, Math.max(high * minimumSum, high * maximumSum));
      }
      for (const value of mesh.bindMatrixInverse.elements)
        magnitude = Math.max(magnitude, Math.abs(value));
      union.expandByScalar(magnitude * 1e-5);
      union.getBoundingSphere(sphere);
      if (
        ![sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius].every(Number.isFinite)
      ) {
        sphere.center.set(0, 0, 0);
        sphere.radius = Infinity;
      }
      mesh.boundingSphere = sphere;
    };
    mesh.frustumCulled = true;
    lazy.boundingSphere = null;
    return {
      mesh,
      bones: boxes.size,
      invalidate: () => {
        lazy.boundingSphere = null;
      },
      restore: () => {
        mesh.computeBoundingSphere = original;
        mesh.boundingSphere = originalSphere;
        mesh.frustumCulled = culled;
      },
    };
  }
  /** Call after posing; Three evaluates lazily after scene world matrices settle. */
  invalidate() {
    if (!this.disposed) for (const entry of this.entries) entry.invalidate();
  }
  diagnostics() {
    return {
      meshes: this.entries.length,
      jointBoxes: this.entries.reduce((n, e) => n + e.bones, 0),
      fallbacks: this.fallbacks,
    };
  }
  dispose() {
    if (this.disposed) return;
    for (const entry of this.entries) entry.restore();
    this.entries.length = 0;
    this.disposed = true;
  }
}
