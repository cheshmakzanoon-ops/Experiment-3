import type { SurfaceMessage } from './diagnostics.ts';

/** Sixty seconds at the existing 60-tick cadence, matching the recording
 * transport's stall reserve. Terrain packets are bounded by the course grid. */
export const SURFACE_TRANSPORT_MAX_PACKETS = 120;

type SurfaceState = Omit<SurfaceMessage, 'epoch' | 'sequence' | 'captureGap'>;
type SurfaceReceipt = Pick<SurfaceMessage, 'epoch' | 'sequence'>;

/** Surface arrays belong to the receiver after posting. An ACK retires exactly
 * one publication, after all host consumers have copied or retained its data.
 * Pending work is only a tick, never another array snapshot or terrain delta. */
export class SurfaceChannel {
  private epoch = 0;
  private sequence = 0;
  private readonly outstanding = new Map<number, number>();
  private pendingTick: number | null = null;
  private full = true;
  private previousGap = false;
  private warned = false;

  constructor(private readonly capacity = SURFACE_TRANSPORT_MAX_PACKETS) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error('Invalid surface transport capacity');
  }

  /** A new timeline requires a full terrain rebase. Already posted packets
   * retain their credits across both init and flashback; resetting cannot
   * allocate around a stalled consumer. A rewind only retains a capture gap
   * if an omitted keyframe is before its new endpoint. */
  reset(tick: number, newSession = false) {
    this.epoch++;
    this.previousGap = newSession
      ? false
      : this.previousGap || (this.pendingTick !== null && tick > this.pendingTick);
    if (newSession) this.warned = false;
    this.pendingTick = null;
    this.full = true;
  }

  request(tick: number) {
    this.pendingTick ??= tick;
  }

  get pending() {
    return this.pendingTick !== null;
  }

  /** Capture lazily, only after reserving bounded outgoing ownership. Leaving
   * renderDelta uncalled while blocked preserves its bounded changed-cell set.
   * A failed capture/post forces a full rebase because renderDelta may already
   * have consumed that set. A detached failed post still owns its ACK credit. */
  publish(
    tick: number,
    capture: (full: boolean) => SurfaceState,
    send: (message: SurfaceMessage, transfer: Transferable[]) => void,
  ): boolean {
    if (this.pendingTick === null || this.outstanding.size >= this.capacity) return false;
    const requested = this.pendingTick,
      epoch = this.epoch,
      sequence = ++this.sequence,
      full = this.full,
      gap = this.previousGap || tick > requested,
      captureGap = gap && !this.warned;
    this.pendingTick = null;
    this.full = false;
    this.outstanding.set(sequence, epoch);
    let message: SurfaceMessage | undefined;
    try {
      message = { ...capture(full), epoch, sequence, ...(captureGap ? { captureGap } : {}) };
      // A source callback may replace the session before publication.
      if (this.epoch !== epoch) {
        this.outstanding.delete(sequence);
        return false;
      }
      this.previousGap = false;
      if (captureGap) this.warned = true;
      send(message, [
        message.water.buffer as ArrayBuffer,
        message.rubber.buffer as ArrayBuffer,
        message.marbles.buffer as ArrayBuffer,
        ...(message.frozen ? [message.frozen.buffer as ArrayBuffer] : []),
        ...(message.terrain ? [message.terrain.blocks.buffer as ArrayBuffer] : []),
      ]);
      return true;
    } catch (error) {
      // A synchronous ACK may already have retired this ticket. Sequence IDs
      // never repeat, so an older failure cannot revoke a newer publication.
      const owned = this.outstanding.get(sequence) === epoch;
      if (owned && (!message || message.water.buffer.byteLength !== 0))
        this.outstanding.delete(sequence);
      if (owned && this.epoch === epoch) {
        this.pendingTick = Math.min(requested, this.pendingTick ?? requested);
        this.full = true;
        this.previousGap ||= gap;
        if (captureGap) this.warned = false;
      }
      throw error;
    }
  }

  acknowledge({ epoch, sequence }: SurfaceReceipt): boolean {
    if (
      !Number.isSafeInteger(epoch) ||
      epoch < 1 ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      this.outstanding.get(sequence) !== epoch
    )
      return false;
    this.outstanding.delete(sequence);
    return true;
  }
}
