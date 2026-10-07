import { F, H, carBase } from '../simulation/protocol.ts';

/** Broadcast sector colours: purple = overall session best, green = personal
 * best, yellow = no improvement, invalid = the lap was already invalid when the
 * sector closed (it never sets a best), none = not completed yet. */
export type SectorState = 'none' | 'yellow' | 'green' | 'purple' | 'invalid';
const STATES: readonly SectorState[] = ['none', 'yellow', 'green', 'purple', 'invalid'];
const SECTORS = 3;

/** Per-sector session and personal bests, derived from the published lap
 * timing (`F.SECTOR`, `F.SECTOR_1..3`, `F.LAP_VALID`, `F.LAST_LAP_VALID`).
 *
 * The simulation publishes the current sector index and the sector times of
 * the lap in progress (falling back to the last lap's). A sector closes when
 * the index advances (0→1, 1→2); the third closes when the index wraps to 0 on
 * the line, where its time is the last lap's third sector and its validity the
 * finished lap's. Observing a frame twice, or a held/paused frame, changes
 * nothing; time running backwards (replay seek, restart) starts over. */
export class SectorBoard {
  private readonly sector: Int8Array;
  private readonly personal: Float64Array;
  private readonly overall = new Float64Array(SECTORS).fill(Infinity);
  private readonly current: Uint8Array;
  private readonly previous: Uint8Array;
  private time = -Infinity;
  constructor(readonly cars: number) {
    if (!Number.isInteger(cars) || cars < 1 || cars > 64) throw new Error('Invalid sector board');
    this.sector = new Int8Array(cars).fill(-1);
    this.personal = new Float64Array(cars * SECTORS).fill(Infinity);
    this.current = new Uint8Array(cars * SECTORS);
    this.previous = new Uint8Array(cars * SECTORS);
  }
  /** Forget every best and every lap in progress. */
  reset() {
    this.time = -Infinity;
    this.sector.fill(-1);
    this.personal.fill(Infinity);
    this.overall.fill(Infinity);
    this.current.fill(0);
    this.previous.fill(0);
  }
  observe(frame: Float32Array) {
    const time = frame[H.TIME];
    if (!Number.isFinite(time) || frame[H.CARS] !== this.cars) return;
    // Presentation jitter is ignored; a real step backwards is a seek or restart.
    if (time < this.time - 0.05) this.reset();
    this.time = Math.max(this.time, time);
    for (let car = 0; car < this.cars; car++) {
      const o = carBase(car);
      const sector = Math.round(frame[o + F.SECTOR]);
      if (!(sector >= 0 && sector < SECTORS)) continue;
      const last = this.sector[car];
      this.sector[car] = sector;
      if (last < 0 || sector === last) continue;
      const row = car * SECTORS;
      if (sector === last + 1) {
        this.close(car, last, frame[o + F.SECTOR_1 + last], frame[o + F.LAP_VALID] > 0);
      } else if (sector === 0 && last === SECTORS - 1) {
        this.close(car, 2, frame[o + F.SECTOR_3], frame[o + F.LAST_LAP_VALID] > 0);
        this.previous.set(this.current.subarray(row, row + SECTORS), row);
        this.current.fill(0, row, row + SECTORS);
      } else {
        // A skipped sector (seek or teleport) cannot be timed; restart the lap.
        this.current.fill(0, row, row + SECTORS);
      }
    }
  }
  private close(car: number, k: number, seconds: number, valid: boolean) {
    const i = car * SECTORS + k;
    if (!(seconds > 0) || !Number.isFinite(seconds)) {
      this.current[i] = 0;
      return;
    }
    let state: SectorState;
    if (!valid) state = 'invalid';
    else if (seconds < this.overall[k]) {
      this.overall[k] = seconds;
      this.personal[i] = seconds;
      state = 'purple';
    } else if (seconds < this.personal[i]) {
      this.personal[i] = seconds;
      state = 'green';
    } else state = 'yellow';
    this.current[i] = STATES.indexOf(state);
  }
  /** Colour of sector `k` (0-2) in the lap `car` is driving. */
  state(car: number, k: number): SectorState {
    return STATES[this.current[car * SECTORS + k]] ?? 'none';
  }
  /** Colour of sector `k` in the last lap `car` completed. */
  lastLap(car: number, k: number): SectorState {
    return STATES[this.previous[car * SECTORS + k]] ?? 'none';
  }
  /** Fastest valid time of sector `k` this session (Infinity before one). */
  sessionBest(k: number) {
    return this.overall[k];
  }
  /** Fastest valid time of sector `k` for one car (Infinity before one). */
  personalBest(car: number, k: number) {
    return this.personal[car * SECTORS + k];
  }
}
