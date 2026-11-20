import { Group, type Object3D } from 'three';

/** A dirt bike's inactive detail model or underlying vehicle slot still has a
 * world-space anchor. A scene update can stop there until the rig is shown. */
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
