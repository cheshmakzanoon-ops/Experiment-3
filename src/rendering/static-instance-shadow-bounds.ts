import * as T from 'three';

/** Conservative second-stage shadow culling for a KNOWN rigid authored batch.
 * Three first tests an aggregate sphere. A long stand can intersect that sphere
 * while every vertex lies outside the light frustum. Test its retained local AABB
 * in the light's clip space, then suppress only that provably empty submission.
 *
 * No LOD, instance transform, caster flag, vertex/index buffer, or colour-pass
 * state changes. Original draw ranges and instance counts are restored immediately
 * after the shadow draw. A caller
 * that changes the authored geometry/instances gets the ordinary full submission;
 * this is deliberately not a generic bound for animated or custom vertex shaders.
 */
export class StaticInstanceShadowBounds {
  /** An independent uncropped control for rendering equivalence tests. */
  enabled = true;
  private readonly box: T.Box3;
  private readonly frustum = new T.Frustum();
  private readonly matrix = new T.Matrix4();
  private held = false;
  private start = 0;
  private count = Infinity;
  private instanceCount = 0;
  private rejected = 0;
  private tested = 0;
  private disposed = false;
  private readonly detach: () => void;

  constructor(readonly mesh: T.InstancedMesh) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    const instances = mesh.instanceMatrix;
    const bounds = mesh.boundingBox;
    if (
      !bounds ||
      bounds.isEmpty() ||
      !(position instanceof T.BufferAttribute) ||
      position.itemSize !== 3 ||
      !(instances instanceof T.InstancedBufferAttribute) ||
      ![bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(
        Number.isFinite,
      )
    )
      throw new Error('Static instance shadow bounds require a finite authored batch');
    // Can only retain extra geometry near a plane; protects float32 transform
    // rounding, including the thin end of a stand viewed along a low sun angle.
    this.box = bounds.clone().expandByScalar(0.001);
    const positionVersion = position.version;
    const indexVersion = index?.version;
    const instanceVersion = instances.version;
    const before = mesh.onBeforeShadow,
      after = mesh.onAfterShadow,
      render = mesh.onBeforeRender;
    const reset = () => {
      if (!this.held) return;
      geometry.setDrawRange(this.start, this.count);
      mesh.count = this.instanceCount;
      this.held = false;
    };
    mesh.onBeforeShadow = (...args) => {
      reset();
      before.apply(mesh, args);
      const camera = args[3],
        material = args[5];
      if (
        !this.enabled ||
        this.disposed ||
        !(camera instanceof T.PerspectiveCamera || camera instanceof T.OrthographicCamera) ||
        mesh.geometry !== geometry ||
        args[4] !== geometry ||
        geometry.getAttribute('position') !== position ||
        position.version !== positionVersion ||
        geometry.index !== index ||
        index?.version !== indexVersion ||
        mesh.instanceMatrix !== instances ||
        instances.version !== instanceVersion ||
        mesh.boundingBox !== bounds ||
        mesh.count > instances.count ||
        geometry.morphAttributes.position?.length ||
        !(material instanceof T.MeshDepthMaterial || material instanceof T.MeshDistanceMaterial) ||
        material.onBeforeCompile !== T.Material.prototype.onBeforeCompile ||
        material.displacementMap ||
        (material instanceof T.MeshDepthMaterial && material.wireframe)
      )
        return;
      this.matrix
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(mesh.matrixWorld);
      if (!this.matrix.elements.every(Number.isFinite) || this.matrix.determinant() === 0) return;
      this.frustum.setFromProjectionMatrix(this.matrix, camera.coordinateSystem);
      for (const p of this.frustum.planes)
        if (
          !Number.isFinite(p.normal.x) ||
          !Number.isFinite(p.normal.y) ||
          !Number.isFinite(p.normal.z) ||
          !Number.isFinite(p.constant)
        )
          return;
      this.tested++;
      if (this.frustum.intersectsBox(this.box)) return;
      this.start = geometry.drawRange.start;
      this.count = geometry.drawRange.count;
      this.instanceCount = mesh.count;
      this.held = true;
      this.rejected++;
      geometry.setDrawRange(this.start, 0);
      // Three still submits a zero-index instanced draw. A zero instance count
      // takes its explicit early return and avoids that empty driver call too.
      mesh.count = 0;
    };
    mesh.onAfterShadow = (...args) => {
      reset();
      after.apply(mesh, args);
    };
    // An interrupted shadow pass must not leave a subsequent colour draw empty.
    mesh.onBeforeRender = (...args) => {
      reset();
      render.apply(mesh, args);
    };
    this.detach = () => {
      reset();
      mesh.onBeforeShadow = before;
      mesh.onAfterShadow = after;
      mesh.onBeforeRender = render;
      mesh.removeEventListener('dispose', onDispose);
    };
    const onDispose = () => this.dispose();
    mesh.addEventListener('dispose', onDispose);
  }
  diagnostics() {
    return { tested: this.tested, rejected: this.rejected };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
  }
}
