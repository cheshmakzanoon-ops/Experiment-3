/** Input messages carry shift pulses, not held button levels. Keep a small
 * ordered reserve across message turns; analog controls are applied directly.
 * At 120 Hz this reserve drains within 267 ms. Overflow drops the newest
 * pulse, preserving already accepted intent without an unbounded tail. */
export const MAX_PENDING_SHIFTS = 32;

export class ShiftInputQueue {
  private readonly shifts = new Int8Array(MAX_PENDING_SHIFTS);
  private head = 0;
  private count = 0;

  get pending() {
    return this.count;
  }

  push(value: number) {
    if (!Number.isFinite(value) || value === 0) return;
    if (this.count === this.shifts.length) return;
    this.shifts[(this.head + this.count) % this.shifts.length] = Math.sign(value);
    this.count++;
  }

  /** Consume once, immediately before one simulation step. */
  take(): number {
    if (!this.count) return 0;
    const shift = this.shifts[this.head];
    this.head = (this.head + 1) % this.shifts.length;
    this.count--;
    return shift;
  }

  clear() {
    this.head = this.count = 0;
  }
}
