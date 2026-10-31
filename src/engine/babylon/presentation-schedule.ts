/** Paused scenes are static. Redraw only invalidated views, except while an
 * asset is waiting for ready rendered frames. Active driving always renders. */
export class PresentationSchedule {
  private requested = true;
  private readonly preparations = new Set<symbol>();
  /** Read-only pending demand; querying it must not consume invalidation. */
  get pending() {
    return this.requested || this.preparations.size > 0;
  }
  request() {
    this.requested = true;
  }
  reset() {
    this.preparations.clear();
    this.request();
  }
  prepare() {
    const token = Symbol();
    this.preparations.add(token);
    return () => {
      this.preparations.delete(token);
    };
  }
  rendered(readyBefore: boolean, readyAfter: boolean) {
    // Initial shaders and restored textures can finish asynchronously after
    // an invalidation. Keep drawing until that work is actually ready.
    // Readiness can finish during a draw that already skipped a mesh.
    // Only settle after a frame which was ready both before and after drawing.
    if (!readyBefore || !readyAfter) this.request();
  }
  shouldRender(paused: boolean) {
    if (paused && !this.requested && this.preparations.size === 0) return false;
    this.requested = false;
    return true;
  }
}
