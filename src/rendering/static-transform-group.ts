import { Group, Matrix4, type Object3D } from 'three';

/** A constructed, transform-immutable subtree. Materials, visibility, instance
 * counts and shader uniforms remain live. Only its owner/ancestors may move
 * without invalidation. Call invalidateTransforms() before editing a descendant
 * transform or hierarchy; animated actors must stay outside a sealed group.
 *
 * Three r180 revisits the scene for probes, mirrors and the main view. An
 * ancestor's force flag does not require recomputing identical static matrices.
 * Compare the complete local/parent matrices, not positions or frame numbers:
 * reparenting, non-uniform scale, shadow views and replay seeks remain correct. */
export class StaticTransformGroup extends Group {
  private sealed = false;
  private valid = false;
  private readonly localAtUpdate = new Matrix4();
  private readonly parentAtUpdate = new Matrix4();
  private readonly identity = new Matrix4();

  sealTransforms() {
    this.traverse((object) => {
      if ('isSkinnedMesh' in object || 'isBone' in object)
        throw new Error('Animated skeletons cannot enter a static transform group');
    });
    this.sealed = true;
    this.invalidateTransforms();
    return this;
  }

  /** Construction/editing and independent negative-control profiling use normal
   * Three traversal. No matrices, ownership flags or resources are replaced. */
  thawTransforms() {
    this.sealed = false;
    this.invalidateTransforms();
    return this;
  }

  invalidateTransforms() {
    this.traverse((object) => {
      if (object instanceof StaticTransformGroup) object.valid = false;
    });
  }

  override add(...objects: Object3D[]) {
    this.valid = false;
    return super.add(...objects);
  }

  override remove(...objects: Object3D[]) {
    this.valid = false;
    return super.remove(...objects);
  }

  override clear() {
    this.valid = false;
    return super.clear();
  }

  private unchanged() {
    if (!this.sealed) return false;
    if (this.matrixAutoUpdate) this.updateMatrix();
    return (
      this.valid &&
      this.matrix.equals(this.localAtUpdate) &&
      (this.parent?.matrixWorld ?? this.identity).equals(this.parentAtUpdate)
    );
  }

  private remember() {
    if (!this.sealed) return;
    this.localAtUpdate.copy(this.matrix);
    this.parentAtUpdate.copy(this.parent?.matrixWorld ?? this.identity);
    this.valid = true;
  }

  override updateMatrixWorld(force?: boolean) {
    if (this.unchanged()) {
      this.matrixWorldNeedsUpdate = false;
      return;
    }
    super.updateMatrixWorld(force);
    this.remember();
  }

  override updateWorldMatrix(updateParents: boolean, updateChildren: boolean) {
    if (updateParents) this.parent?.updateWorldMatrix(true, false);
    if (this.unchanged()) {
      this.matrixWorldNeedsUpdate = false;
      return;
    }
    super.updateWorldMatrix(false, updateChildren);
    // A world-position query can update only this owner. Its descendants must
    // still be refreshed before a later colour/shadow pass uses their matrices.
    if (updateChildren) this.remember();
    else this.valid = false;
  }
}
