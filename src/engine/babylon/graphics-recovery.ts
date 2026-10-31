/** Restoration invalidates old GPU objects; it does not create fresh asset
 * ownership. Only an explicitly requested, completed scene rebuild unlocks it. */
export class GraphicsRecovery {
  private required = false;
  private lost = false;
  private queuedRestart = false;
  get restartRequired() {
    return this.required;
  }
  get canResume() {
    return !this.required || this.queuedRestart;
  }
  contextLost() {
    this.lost = true;
    this.required = true;
  }
  contextRestored() {
    this.lost = false;
  }
  requestRestart() {
    this.queuedRestart = true;
  }
  rebuilt() {
    if (this.lost) throw new Error('Cannot rebuild presentation while context is lost');
    this.required = false;
    this.queuedRestart = false;
  }
}
