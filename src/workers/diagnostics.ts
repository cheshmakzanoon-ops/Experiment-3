import type { Simulation } from '../simulation/world.ts';
import type { FromWorker, ToWorker } from '../simulation/protocol.ts';

export interface EngineeringWheel {
  origin: [number, number, number];
  contact: [number, number, number];
  normal: [number, number, number];
  loadN: number;
  surface: number;
  cell: number;
  rubber: number;
  marbles: number;
}
export interface EngineeringSample {
  time: number;
  tick: number;
  car: number;
  aiActive: boolean;
  targetSpeedMps: number;
  targetOffsetM: number;
  decision: string;
  wheels: EngineeringWheel[];
}
/** Optional debug transport is separate from the fixed-size recorded protocol.
 * It cannot change input, simulation, telemetry strides or replay versions. */
export interface PauseReceipt {
  type: 'pauseState';
  sequence: number;
  value: boolean;
  tick: number;
}
export type ClientMessage =
  | Exclude<ToWorker, { type: 'pause' }>
  | { type: 'pause'; value: boolean; sequence?: number }
  | { type: 'engineering'; enabled: boolean };
export type WorkerMessage =
  | FromWorker
  | PauseReceipt
  | { type: 'engineering'; sample: EngineeringSample };

/** The menu can open immediately, before the worker has processed pause.
 * A receipt is a FIFO barrier after the final frame and recording flushes, not
 * an estimate based on elapsed time or several coincidentally equal ticks. */
export class PauseHandshake {
  private sequence = 0;
  private acknowledged = 0;
  private requested = true;
  private paused = true;
  private tick: number | null = null;
  request(value: boolean) {
    this.requested = value;
    this.tick = null;
    return { type: 'pause' as const, value, sequence: ++this.sequence };
  }
  accept(receipt: PauseReceipt, frameTick: number | undefined) {
    // A quick resume or another pause may supersede an in-flight receipt.
    if (receipt.sequence !== this.sequence || receipt.value !== this.requested) return false;
    if (!Number.isSafeInteger(receipt.tick) || receipt.tick < 0)
      throw new Error('Invalid worker pause tick');
    // Frame ticks are transported in the existing Float32 protocol. Preserve
    // its precision rather than inventing a second recording representation.
    if (receipt.value && frameTick !== Math.fround(receipt.tick))
      throw new Error('Worker pause acknowledged before its final frame');
    this.acknowledged = receipt.sequence;
    this.paused = receipt.value;
    this.tick = receipt.tick;
    return true;
  }
  status() {
    return {
      pending: this.acknowledged !== this.sequence,
      paused: this.paused,
      tick: this.tick,
      sequence: this.sequence,
    };
  }
}

/** Read-only production inspection: four wheels, at most 10 snapshots/s, only
 * while explicitly enabled. Values are copied from the latest physical solve,
 * not inferred from decorative meshes or the renderer's initial track object. */
export class EngineeringProbe {
  private enabled = false;
  private lastTick = -Infinity;
  reset() {
    this.enabled = false;
    this.lastTick = -Infinity;
  }
  enable(value: boolean) {
    if (typeof value !== 'boolean') throw new Error('Invalid engineering toggle');
    this.enabled = value;
    this.lastTick = -Infinity;
  }
  sample(simulation: Simulation): EngineeringSample | null {
    if (!this.enabled || simulation.tick - this.lastTick < 12) return null;
    const car = simulation.cars[0];
    const aiActive = simulation.autoPlayer || car.pitRequested || car.inPit || car.finishTime > 0;
    const sample: EngineeringSample = {
      time: simulation.race.time,
      tick: simulation.tick,
      car: car.id,
      aiActive,
      targetSpeedMps: car.aiTarget,
      targetOffsetM: car.aiOffset,
      decision: aiActive ? simulation.ai[0].decision : 'MANUAL INPUT / AI INACTIVE',
      wheels: car.tires.map((tire, i) => {
        const origin = car.origins[i],
          point = car.contactPoints[i],
          contact = car.contacts[i];
        return {
          origin: [origin.x, origin.y, origin.z],
          contact: [point.x, point.y, point.z],
          normal: [contact.normal.x, contact.normal.y, contact.normal.z],
          loadN: tire.load,
          surface: contact.surface,
          cell: contact.cell,
          rubber: contact.rubber,
          marbles: contact.marbles,
        };
      }),
    };
    if (!isEngineeringSample(sample)) throw new Error('Invalid engineering state');
    this.lastTick = simulation.tick;
    return sample;
  }
}
function printableLine(text: string) {
  for (let i = 0; i < text.length; i++)
    if (text.charCodeAt(i) < 32 || text.charCodeAt(i) === 127) return false;
  return true;
}
export function isEngineeringSample(value: unknown): value is EngineeringSample {
  if (!value || typeof value !== 'object') return false;
  const v = value as EngineeringSample;
  const vector = (a: unknown) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  return (
    Number.isFinite(v.time) &&
    v.time >= 0 &&
    Number.isInteger(v.tick) &&
    v.tick >= 0 &&
    v.car === 0 &&
    typeof v.aiActive === 'boolean' &&
    Number.isFinite(v.targetSpeedMps) &&
    Number.isFinite(v.targetOffsetM) &&
    typeof v.decision === 'string' &&
    v.decision.length <= 120 &&
    printableLine(v.decision) &&
    Array.isArray(v.wheels) &&
    v.wheels.length === 4 &&
    v.wheels.every(
      (w) =>
        !!w &&
        vector(w.origin) &&
        vector(w.contact) &&
        vector(w.normal) &&
        Number.isFinite(w.loadN) &&
        w.loadN >= 0 &&
        Number.isInteger(w.surface) &&
        w.surface >= 0 &&
        w.surface <= 5 &&
        Number.isInteger(w.cell) &&
        w.cell >= 0 &&
        w.cell < 512 * 7 &&
        Number.isFinite(w.rubber) &&
        w.rubber >= 0 &&
        w.rubber <= 1 &&
        Number.isFinite(w.marbles) &&
        w.marbles >= 0 &&
        w.marbles <= 1,
    )
  );
}
/** Refuse live contact/path overlays over a recorded replay or a newer/old frame.
 * Debug sampling is asynchronous; display its timestamp rather than claim that
 * it belongs to the separately transported render snapshot's exact tick. */
export function engineeringFresh(sample: EngineeringSample | null, time: number, replay: boolean) {
  return !!sample && !replay && sample.time <= time + 0.05 && time - sample.time <= 0.5;
}
