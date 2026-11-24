/** A bounded idle reserve for transferable snapshots. Required state changes
 * may allocate beyond the reserve; ordinary rendering waits for a return. */
export class FrameBufferPool {
  private readonly idle: ArrayBuffer[] = [];
  private readonly localBuffers = new WeakSet<ArrayBuffer>();
  private readonly outgoing = new Map<ArrayBuffer, number>();
  private publication = 0;
  private detachedCredits = 0;

  constructor(
    private readonly bytes: number,
    initialBuffers: number,
    private readonly maxIdleBuffers = initialBuffers,
  ) {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 1 ||
      !Number.isSafeInteger(initialBuffers) ||
      initialBuffers < 1 ||
      !Number.isSafeInteger(maxIdleBuffers) ||
      maxIdleBuffers < initialBuffers
    )
      throw new Error('Invalid frame buffer pool');
    for (let i = 0; i < initialBuffers; i++) this.idle.push(this.allocate());
  }

  private allocate() {
    const buffer = new ArrayBuffer(this.bytes);
    this.localBuffers.add(buffer);
    return buffer;
  }

  private retain(buffer: ArrayBuffer) {
    if (buffer.byteLength === this.bytes && this.idle.length < this.maxIdleBuffers)
      this.idle.push(buffer);
  }

  /** Fill and synchronously post one snapshot. Register before the callback so
   * a non-transferring test consumer can return that same buffer immediately. */
  publish(writeAndSend: (buffer: ArrayBuffer) => void, required = false): boolean {
    let buffer = this.idle.pop();
    // Real transfers isolate ownership. Also tolerate a harness detaching a
    // returned reference later: unavailable storage must never reach the writer.
    while (buffer && buffer.byteLength !== this.bytes) buffer = this.idle.pop();
    if (!buffer) {
      if (!required) return false;
      buffer = this.allocate();
    }
    const publication = ++this.publication;
    this.outgoing.set(buffer, publication);
    try {
      writeAndSend(buffer);
    } catch (error) {
      // A failed write/post still owns attached storage. A synchronous recycle
      // may already have republished it. Only this publication may recover its
      // attached storage; an older failure must not revoke the newer consumer.
      if (buffer.byteLength === this.bytes && this.outgoing.get(buffer) === publication) {
        this.outgoing.delete(buffer);
        this.retain(buffer);
      }
      throw error;
    } finally {
      // Transfer returns create new identities. Keep a credit rather than a
      // strong reference to every detached wrapper from required snapshots.
      if (buffer.byteLength === 0 && this.outgoing.get(buffer) === publication) {
        this.outgoing.delete(buffer);
        this.detachedCredits++;
      }
    }
    return true;
  }

  recycle(buffer: ArrayBuffer): boolean {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== this.bytes) return false;
    if (!this.outgoing.delete(buffer)) {
      // Idle and retired local buffers cannot consume somebody else's credit.
      if (this.localBuffers.has(buffer)) return false;
      if (this.detachedCredits > 0) this.detachedCredits--;
      else {
        // Support a synchronous transfer-and-return inside publish's callback,
        // before its finally block has converted the detached outgoing wrapper.
        let transferred: ArrayBuffer | undefined;
        for (const candidate of this.outgoing.keys()) {
          if (candidate.byteLength === 0) {
            transferred = candidate;
            break;
          }
        }
        if (!transferred) return false;
        this.outgoing.delete(transferred);
      }
    }
    // A matching size and transfer credit establish capacity, not sender or
    // session identity: neither can be authenticated by the existing wire data.
    this.localBuffers.add(buffer);
    this.retain(buffer);
    return true;
  }

  get available() {
    return this.idle.length;
  }
}
