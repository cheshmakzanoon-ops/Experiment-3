import { Group, type Object3D } from 'three';

/** The unused Formula host behind a dirt bike still provides an
 * addressable world-space anchor. The scene's forced matrix update can stop
 * at that anchor until its own geometry is presented again. */
export class MxPresentationRoot extends Group {
  private descendantsStale = false;

  constructor(public suspendWhenHidden = false) {
    super();
  }

  override copy(source: Object3D, recursive = true): this {
    super.copy(source, recursive);
    this.suspendWhenHidden = source instanceof MxPresentationRoot && source.suspendWhenHidden;
    this.descendantsStale = false;
    return this;
  }

  override updateMatrixWorld(force = false) {
    if (this.suspendWhenHidden && !this.visible) {
      this.updateWorldMatrix(false, false);
      this.descendantsStale = true;
      return;
    }
    super.updateMatrixWorld(force || this.descendantsStale);
    this.descendantsStale = false;
  }
}
