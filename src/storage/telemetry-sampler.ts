import { packTelemetry, TELEMETRY_BATCH_ROWS, TELEMETRY_STRIDE } from './telemetry-schema.ts';
import type { Simulation } from '../simulation/world.ts';

/**
 * Full recording pages hold one second of data (60 telemetry rows or
 * 15 replay snapshots); explicit flushes can send partial pages. Start small,
 * then grow only when the browser has not recycled transferred pages quickly
 * enough. Sixty pages absorbs a long
 * render/main-thread hitch and slow GitHub-hosted software rendering without
 * compromising capture continuity; the reserve remains bounded and is released
 * back toward the six-page steady-state pool after recycling.
 */
export const RECORDING_TRANSPORT_INITIAL_PAGES = 6;
/** Replay snapshots are captured every eighth 120 Hz tick (15 Hz). */
export const REPLAY_TICKS = 8;
export const RECORDING_TRANSPORT_MAX_PAGES = 60;

class ElasticTransferPool {
  private readonly pool: Float32Array[] = [];
  private readonly localBuffers = new WeakSet<ArrayBuffer>();
  private readonly transferred = new Set<ArrayBuffer>();
  private allocated = 0;
  constructor(
    private readonly length: number,
    private readonly initialPages = RECORDING_TRANSPORT_INITIAL_PAGES,
    private readonly maxPages = RECORDING_TRANSPORT_MAX_PAGES,
  ) {
    if (
      !Number.isInteger(length) ||
      length <= 0 ||
      !Number.isInteger(this.initialPages) ||
      this.initialPages < 1 ||
      !Number.isInteger(maxPages) ||
      maxPages < this.initialPages
    )
      throw new Error('Invalid recording transport pool');
    for (let i = 0; i < this.initialPages; i++) this.pool.push(this.allocate());
  }
  private allocate() {
    const page = new Float32Array(this.length);
    this.localBuffers.add(page.buffer);
    this.allocated++;
    return page;
  }
  acquire() {
    return this.pool.pop() ?? (this.allocated < this.maxPages ? this.allocate() : undefined);
  }
  beginTransfer(buffer: ArrayBuffer) {
    this.transferred.add(buffer);
  }
  cancelTransfer(buffer: ArrayBuffer) {
    // A throwing postMessage leaves ownership here unless it already detached
    // the page. A synchronous consumer may also have recycled it before throwing.
    return (
      buffer.byteLength === this.length * Float32Array.BYTES_PER_ELEMENT &&
      this.transferred.delete(buffer)
    );
  }
  recycle(buffer: ArrayBuffer) {
    if (buffer.byteLength !== this.length * Float32Array.BYTES_PER_ELEMENT) return;
    let outgoing: ArrayBuffer | undefined;
    if (this.transferred.has(buffer)) outgoing = buffer;
    else {
      // Transfer back from a worker produces a new ArrayBuffer identity. Accept
      // one such return only against a detached outgoing page. Known local pages
      // are active, idle or retired; accepting one twice aliases live recordings
      // and can incorrectly shrink the allocation count below outstanding pages.
      if (this.localBuffers.has(buffer)) return;
      for (const candidate of this.transferred) {
        if (candidate.byteLength === 0) {
          outgoing = candidate;
          break;
        }
      }
    }
    if (!outgoing) return;
    this.transferred.delete(outgoing);
    this.localBuffers.add(buffer);
    // Elastic pages are a hitch reserve, not permanent session growth. Once
    // enough returned pages restore the ordinary reserve, let surplus buffers
    // become collectible and lower the allocation ceiling accordingly.
    if (this.allocated > this.initialPages && this.pool.length >= this.initialPages) {
      this.allocated--;
      return;
    }
    this.pool.push(new Float32Array(buffer));
  }
  get pages() {
    return this.allocated;
  }
}

/** Captures every second physics tick, irrespective of snapshot recycling or
 * render FPS. Transferable pages begin with a six-page reserve and can grow to
 * a bounded sixty-page reserve when the main thread is stalled. Full pages
 * hold one second of capture; frequent partial flushes use that reserve sooner.
 * If the consumer remains unavailable beyond that reserve, the gap is reported
 * explicitly rather than fabricating a continuous capture. */
export class TelemetrySampler {
  private telemetryPool: ElasticTransferPool;
  private page: Float32Array | undefined;
  private rows = 0;
  private scratch: Float32Array;
  private lastTick = -1;
  private warned = false;
  private replayPool: ElasticTransferPool;
  private replayPage: Float32Array | undefined;
  private replayRows = 0;
  private replayWarned = false;
  constructor(
    private simulation: Simulation,
    private send: (buffer: ArrayBuffer, rows: number) => void,
    private warning: (message: string) => void,
    private sendReplay: (buffer: ArrayBuffer, rows: number) => void = () => undefined,
  ) {
    this.scratch = simulation.makeFrame();
    this.telemetryPool = new ElasticTransferPool(TELEMETRY_BATCH_ROWS * TELEMETRY_STRIDE);
    this.page = this.telemetryPool.acquire();
    this.replayPool = new ElasticTransferPool(this.scratch.length * 15);
    this.replayPage = this.replayPool.acquire();
  }
  capture(stepMs = 0, droppedSeconds = 0) {
    const tick = this.simulation.tick;
    if (tick % 2 || tick === this.lastTick) return;
    // A failed send can leave a full page owned here. Retry it before appending
    // another row, so the retry cannot overflow or overwrite the captured batch.
    if (this.rows === TELEMETRY_BATCH_ROWS) this.flush();
    if (this.replayRows === 15) this.flushReplay();
    this.lastTick = tick;
    this.simulation.writeFrame(this.scratch, stepMs, droppedSeconds);
    // Stage both streams before delivery, so a failed replay send cannot skip
    // the telemetry sample from the same physics tick.
    if (tick % REPLAY_TICKS === 0) this.captureReplay();
    this.page ??= this.telemetryPool.acquire();
    if (this.page) {
      packTelemetry(this.scratch, this.page, this.rows * TELEMETRY_STRIDE);
      this.rows++;
    } else {
      if (!this.warned)
        this.warning(
          `Telemetry capture gap: the browser exhausted the ${RECORDING_TRANSPORT_MAX_PAGES}-page transport reserve before returning recording buffers.`,
        );
      this.warned = true;
    }
    if (this.replayRows === 15) this.flushReplay();
    if (this.rows === TELEMETRY_BATCH_ROWS) this.flush();
  }
  flush() {
    if (!this.page || !this.rows) return;
    const page = this.page,
      rows = this.rows,
      buffer = page.buffer as ArrayBuffer;
    this.page = undefined;
    this.rows = 0;
    this.telemetryPool.beginTransfer(buffer);
    try {
      this.send(buffer, rows);
    } catch (error) {
      if (this.telemetryPool.cancelTransfer(buffer)) {
        this.page = page;
        this.rows = rows;
      }
      throw error;
    }
  }
  private captureReplay() {
    this.replayPage ??= this.replayPool.acquire();
    if (!this.replayPage) {
      if (!this.replayWarned)
        this.warning(
          `Replay capture gap: the browser exhausted the ${RECORDING_TRANSPORT_MAX_PAGES}-page transport reserve before returning recording buffers.`,
        );
      this.replayWarned = true;
      return;
    }
    this.replayPage.set(this.scratch, this.replayRows * this.scratch.length);
    this.replayRows++;
  }
  flushReplay() {
    if (!this.replayPage || !this.replayRows) return;
    const page = this.replayPage,
      rows = this.replayRows,
      buffer = page.buffer as ArrayBuffer;
    this.replayPage = undefined;
    this.replayRows = 0;
    this.replayPool.beginTransfer(buffer);
    try {
      this.sendReplay(buffer, rows);
    } catch (error) {
      if (this.replayPool.cancelTransfer(buffer)) {
        this.replayPage = page;
        this.replayRows = rows;
      }
      throw error;
    }
  }
  recycleReplay(buffer: ArrayBuffer) {
    this.replayPool.recycle(buffer);
  }
  recycle(buffer: ArrayBuffer) {
    this.telemetryPool.recycle(buffer);
  }
  /** Read-only diagnostics for deterministic transport/backpressure tests. */
  get transportPages() {
    return {
      telemetry: this.telemetryPool.pages,
      replay: this.replayPool.pages,
      maximum: RECORDING_TRANSPORT_MAX_PAGES,
    };
  }
}
