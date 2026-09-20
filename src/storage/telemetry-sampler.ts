import { packTelemetry, TELEMETRY_BATCH_ROWS, TELEMETRY_STRIDE } from './telemetry-schema.ts';
import type { Simulation } from '../simulation/world.ts';

/**
 * Recording pages are exactly one second of data (60 telemetry rows or
 * 15 replay snapshots). Start small, then grow only when the browser has not
 * recycled transferred pages quickly enough. Thirty pages absorbs a long
 * render/main-thread hitch while keeping the worst-case 12-car transport
 * reserve below ~7 MiB across telemetry + replay.
 */
export const RECORDING_TRANSPORT_INITIAL_PAGES = 6;
export const RECORDING_TRANSPORT_MAX_PAGES = 30;

class ElasticTransferPool {
  private readonly pool: Float32Array[] = [];
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
    this.allocated++;
    return new Float32Array(this.length);
  }
  acquire() {
    return this.pool.pop() ?? (this.allocated < this.maxPages ? this.allocate() : undefined);
  }
  recycle(buffer: ArrayBuffer) {
    if (buffer.byteLength !== this.length * Float32Array.BYTES_PER_ELEMENT) return;
    // Elastic pages are a hitch reserve, not permanent session growth. Once
    // enough returned pages restore the ordinary reserve, let surplus buffers
    // become collectible and lower the allocation ceiling accordingly.
    if (this.allocated > this.initialPages && this.pool.length >= this.initialPages) {
      this.allocated--;
      return;
    }
    if (this.pool.length < this.allocated) this.pool.push(new Float32Array(buffer));
  }
  get pages() {
    return this.allocated;
  }
}

/** Captures every second physics tick, irrespective of snapshot recycling or
 * render FPS. One-second transferable pages begin with a six-second reserve and
 * can grow to a bounded thirty-second reserve when the main thread is stalled.
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
    this.lastTick = tick;
    this.simulation.writeFrame(this.scratch, stepMs, droppedSeconds);
    if (tick % 8 === 0) this.captureReplay();
    this.page ??= this.telemetryPool.acquire();
    if (!this.page) {
      if (!this.warned)
        this.warning(
          `Telemetry capture gap: the browser did not return recording buffers within the ${RECORDING_TRANSPORT_MAX_PAGES}-second transport reserve.`,
        );
      this.warned = true;
      return;
    }
    packTelemetry(this.scratch, this.page, this.rows * TELEMETRY_STRIDE);
    this.rows++;
    if (this.rows === TELEMETRY_BATCH_ROWS) this.flush();
  }
  flush() {
    if (!this.page || !this.rows) return;
    const page = this.page,
      rows = this.rows;
    this.page = undefined;
    this.rows = 0;
    this.send(page.buffer as ArrayBuffer, rows);
  }
  private captureReplay() {
    this.replayPage ??= this.replayPool.acquire();
    if (!this.replayPage) {
      if (!this.replayWarned)
        this.warning(
          `Replay capture gap: the browser did not return recording buffers within the ${RECORDING_TRANSPORT_MAX_PAGES}-second transport reserve.`,
        );
      this.replayWarned = true;
      return;
    }
    this.replayPage.set(this.scratch, this.replayRows * this.scratch.length);
    if (++this.replayRows === 15) this.flushReplay();
  }
  flushReplay() {
    if (!this.replayPage || !this.replayRows) return;
    const page = this.replayPage,
      rows = this.replayRows;
    this.replayPage = undefined;
    this.replayRows = 0;
    this.sendReplay(page.buffer as ArrayBuffer, rows);
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
