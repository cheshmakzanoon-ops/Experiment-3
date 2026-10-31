/** Restart authority changes at the input event, not when the GPU catches up.
 * Only scene replacement is deferred. Repeated requests keep the latest owner;
 * draining never resets input, pause state, or simulation a second time. */
export class RestartOwnership<T extends object> {
  private owner: T | null = null;
  constructor(
    private readonly abortAssets: () => void,
    private readonly resetAuthority: () => T,
  ) {}
  get pending() {
    return this.owner !== null;
  }
  request() {
    this.abortAssets();
    this.owner = this.resetAuthority();
  }
  drain(ready: boolean, rebuild: (owner: T) => void) {
    if (!ready || !this.owner) return false;
    const owner = this.owner;
    rebuild(owner);
    if (this.owner === owner) this.owner = null;
    return true;
  }
}
