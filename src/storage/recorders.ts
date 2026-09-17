import { drawTelemetry, type TelemetryView } from './telemetry-plots.ts';
import {
  F,
  H,
  HEADER,
  CAR_STRIDE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { CHANNELS, packTelemetry, telemetryCsv } from './telemetry-schema.ts';
export { TELEMETRY_FIELDS } from './telemetry-schema.ts';
import { clamp } from '../core/math.ts';
const REPLAY_FIELDS = [
  F.X,
  F.Y,
  F.Z,
  F.QX,
  F.QY,
  F.QZ,
  F.QW,
  F.VX,
  F.VY,
  F.VZ,
  F.SPEED,
  F.STEER,
  F.RPM,
  F.GEAR,
  F.THROTTLE,
  F.BRAKE,
  F.FUEL,
  F.BATTERY,
  F.FRONT_HEALTH,
  F.FLOOR_HEALTH,
  F.REAR_HEALTH,
  F.S,
  F.LAPS,
  F.LAP_TIME,
  F.BEST_LAP,
  F.LAST_LAP,
  F.PENALTY,
  F.PIT_PHASE,
  F.IN_PIT,
  F.RANK,
  F.FINISH,
  F.G_LONG,
  F.G_LAT,
  F.G_VERT,
  F.IMPACT,
  F.COMPOUND,
  F.WAKE,
  F.PIT_STOPS,
];
const REPLAY_WHEELS = [
  W.OMEGA,
  W.ROTATION,
  W.COMPRESSION,
  W.DISC_TEMP,
  W.LOAD,
  W.FLAT,
  W.WATER,
  W.SLIP,
];
const RC = REPLAY_FIELDS.length + REPLAY_WHEELS.length * 4;
/** A bounded 20-minute, 15 Hz pose recorder; camera interpolation stays at display rate.
 * It never retains scene objects or transferable worker buffers. */
export class ReplayRecorder {
  readonly capacity: number;
  readonly stride: number;
  private data: Float32Array;
  count = 0;
  head = 0;
  private last = -Infinity;
  constructor(
    readonly cars: number,
    seconds = 1200,
  ) {
    this.capacity = seconds * 15;
    this.stride = HEADER + cars * RC;
    this.data = new Float32Array(this.capacity * this.stride);
  }
  append(frame: Float32Array) {
    const time = frame[H.TIME];
    if (time - this.last < 1 / 15 - 1e-4) return;
    this.last = time;
    const offset = this.head * this.stride;
    this.data.set(frame.subarray(0, HEADER), offset);
    let index = offset + HEADER;
    for (let id = 0; id < this.cars; id++) {
      const b = carBase(id);
      for (const f of REPLAY_FIELDS) this.data[index++] = frame[b + f];
      for (let w = 0; w < 4; w++)
        for (const f of REPLAY_WHEELS)
          this.data[index++] = frame[b + WHEEL_BASE + w * WHEEL_STRIDE + f];
    }
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }
  private offset(index: number) {
    return ((this.head - this.count + index + this.capacity) % this.capacity) * this.stride;
  }
  get start() {
    return this.count ? this.data[this.offset(0) + H.TIME] : 0;
  }
  get end() {
    return this.count ? this.data[this.offset(this.count - 1) + H.TIME] : 0;
  }
  get duration() {
    return this.end - this.start;
  }
  private expand(index: number, out: Float32Array) {
    out.fill(0);
    let p = this.offset(index);
    out.set(this.data.subarray(p, p + HEADER));
    p += HEADER;
    for (let id = 0; id < this.cars; id++) {
      const b = carBase(id);
      for (const f of REPLAY_FIELDS) out[b + f] = this.data[p++];
      for (let w = 0; w < 4; w++)
        for (const f of REPLAY_WHEELS) out[b + WHEEL_BASE + w * WHEEL_STRIDE + f] = this.data[p++];
    }
  }
  sample(seconds: number, a: Float32Array, b: Float32Array) {
    if (!this.count) return 0;
    const time = clamp(seconds + this.start, this.start, this.end);
    let lo = 0,
      hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.data[this.offset(mid) + H.TIME] <= time) lo = mid;
      else hi = mid;
    }
    this.expand(lo, a);
    this.expand(hi, b);
    return clamp((time - a[H.TIME]) / (b[H.TIME] - a[H.TIME] || 1), 0, 1);
  }
  makeFrame() {
    return new Float32Array(HEADER + CAR_STRIDE * this.cars);
  }
  get bytes() {
    return this.data.byteLength;
  }
}
export class TelemetryRecorder {
  readonly stride = CHANNELS.length;
  readonly capacity: number;
  private data: Float32Array;
  constructor(seconds = 900) {
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600)
      throw new Error('Invalid telemetry capacity');
    this.capacity = Math.ceil(60 * seconds);
    this.data = new Float32Array(this.capacity * this.stride);
  }
  count = 0;
  head = 0;
  private last = -1;
  append(frame: Float32Array) {
    if (frame[H.TICK] === this.last) return;
    this.last = frame[H.TICK];
    packTelemetry(frame, this.data, this.head * this.stride);
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }
  offset(index: number) {
    return ((this.head - this.count + index + this.capacity) % this.capacity) * this.stride;
  }
  at(index: number, column: number) {
    return this.data[this.offset(index) + column];
  }
  appendBatch(batch: Float32Array, rows: number) {
    if (!Number.isInteger(rows) || rows < 0 || rows * this.stride > batch.length)
      throw new Error('Invalid telemetry batch');
    for (let row = 0; row < rows; row++) {
      this.data.set(
        batch.subarray(row * this.stride, (row + 1) * this.stride),
        this.head * this.stride,
      );
      this.head = (this.head + 1) % this.capacity;
      this.count = Math.min(this.count + 1, this.capacity);
    }
  }
  snapshot() {
    const values = new Float32Array(this.count * this.stride);
    for (let row = 0; row < this.count; row++)
      values.set(
        this.data.subarray(this.offset(row), this.offset(row) + this.stride),
        row * this.stride,
      );
    return values;
  }
  csv() {
    return telemetryCsv(this.snapshot(), this.count);
  }
  draw(
    canvas: HTMLCanvasElement,
    lapComparison = false,
    view: TelemetryView = 'driver',
    trackLength = 2973,
  ) {
    drawTelemetry(canvas, this, view, lapComparison, trackLength);
  }
}
