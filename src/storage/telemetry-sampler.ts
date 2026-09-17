import { packTelemetry, TELEMETRY_BATCH_ROWS, TELEMETRY_STRIDE } from './telemetry-schema.ts';
import type { Simulation } from '../simulation/world.ts';

/** Captures every second physics tick, irrespective of snapshot recycling or
 * render FPS. Six transferable pages bound queued memory. Backpressure is
 * reported explicitly rather than fabricating a continuous capture. */
export class TelemetrySampler {
  private pool = Array.from(
    { length: 6 },
    () => new Float32Array(TELEMETRY_BATCH_ROWS * TELEMETRY_STRIDE),
  );
  private page: Float32Array | undefined = this.pool.pop();
  private rows = 0;
  private scratch: Float32Array;
  private lastTick = -1;
  private warned = false;
  private replayPool: Float32Array[];
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
    this.replayPool = Array.from({ length: 6 }, () => new Float32Array(this.scratch.length * 15));
    this.replayPage = this.replayPool.pop();
  }
  capture(stepMs = 0, droppedSeconds = 0) {
    const tick = this.simulation.tick;
    if (tick % 2 || tick === this.lastTick) return;
    this.lastTick = tick;
    this.simulation.writeFrame(this.scratch, stepMs, droppedSeconds);
    if (tick % 8 === 0) this.captureReplay();
    this.page ??= this.pool.pop();
    if (!this.page) {
      if (!this.warned)
        this.warning(
          'Telemetry capture gap: the browser did not return recording buffers in time.',
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
    this.replayPage ??= this.replayPool.pop();
    if (!this.replayPage) {
      if (!this.replayWarned)
        this.warning('Replay capture gap: recording buffers were not returned in time.');
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
    if (buffer.byteLength === this.scratch.length * 15 * 4 && this.replayPool.length < 6)
      this.replayPool.push(new Float32Array(buffer));
  }
  recycle(buffer: ArrayBuffer) {
    if (buffer.byteLength === TELEMETRY_BATCH_ROWS * TELEMETRY_STRIDE * 4 && this.pool.length < 6)
      this.pool.push(new Float32Array(buffer));
  }
}
