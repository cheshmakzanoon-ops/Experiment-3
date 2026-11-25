/// <reference lib="webworker" />
import { FixedStepClock } from './fixed-step-clock.ts';
import { FrameBufferPool } from './frame-buffer-pool.ts';
import { ShiftInputQueue } from './input-queue.ts';
import { controls, type Controls } from '../simulation/config.ts';
import { FestivalCommandValidationError, OpenWorldSimulation } from '../simulation/open-world/session.ts';
import { CAR_STRIDE, HEADER } from '../simulation/protocol.ts';
import { FESTIVAL_STATUS_CAPACITY, type FromOpenWorld, type ToOpenWorld } from './open-world-protocol.ts';

/** Festival free-roam simulation worker: the same fixed 120 Hz stepping and
 * pooled transferable snapshots as the circuit worker, plus a 10 Hz status
 * message for the festival HUD and one message per event result. Terrain
 * tiles stream inside the session within its residency budget. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
let simulation: OpenWorldSimulation | null = null,
  paused = true,
  failed = false,
  lastInput = performance.now(),
  stepMs = 0,
  lastSent = -1,
  lastStatus = -Infinity;
const clock = new FixedStepClock();
const shifts = new ShiftInputQueue();
// Receipts and their sequence survive init. Resetting a session must not let a
// stalled host accumulate another batch of copied status objects.
const statusReceipts = new Set<number>();
let statusSequence = 0;
const statusAvailable = () => statusReceipts.size < FESTIVAL_STATUS_CAPACITY;
const STATUS_BUSY = 'Festival status delivery is busy. Please try again.';
/** Transferable frame buffers of the current field size. The field grows
 * when an event adds rivals and shrinks when it ends: the pool is refilled at
 * the new size then, because buffers of the old size coming back from the
 * main thread are dropped and would otherwise leave it empty for good. */
let pool: FrameBufferPool | null = null,
  poolBytes = 0;
const send = (msg: FromOpenWorld, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);
const frameBytes = () => (HEADER + (simulation?.cars.length ?? 1) * CAR_STRIDE) * 4;
function fillPool(bytes: number) {
  pool = new FrameBufferPool(bytes, 4, 6);
  poolBytes = bytes;
}
function snapshot(required = false) {
  const current = simulation;
  if (!current) return;
  const bytes = frameBytes();
  if (bytes !== poolBytes) fillPool(bytes);
  pool!.publish((buffer) => {
    current.writeFrame(new Float32Array(buffer), stepMs, clock.droppedSeconds);
    // Ambient traffic rides with the frame it belongs to (a few hundred bytes).
    if (current.traffic.cars.length) {
      const traffic = current.trafficFrame().buffer as ArrayBuffer;
      send({ type: 'frame', buffer, traffic }, [buffer, traffic]);
    } else send({ type: 'frame', buffer }, [buffer]);
  }, required);
}
function status() {
  if (!simulation || !statusAvailable()) return;
  const sample = simulation.status(), sequence = ++statusSequence;
  statusReceipts.add(sequence);
  try {
    send({ type: 'status', sequence, status: sample });
  } catch (error) {
    statusReceipts.delete(sequence);
    throw error;
  }
  lastStatus = performance.now();
}
function applyInput(input: Controls) {
  simulation?.setInput(input);
}
scope.onmessage = (event: MessageEvent<ToOpenWorld>) => {
  const msg = event.data;
  // A queued resume or command cannot revive a partially failed simulation
  // while the host is still processing its terminal error notification.
  if (failed && msg.type !== 'init' && msg.type !== 'statusAck') return;
  try {
    switch (msg.type) {
      case 'init': {
        if (!statusAvailable()) {
          send({ type: 'error', message: STATUS_BUSY, fatal: false });
          break;
        }
        shifts.clear();
        const start = performance.now();
        simulation = new OpenWorldSimulation(msg.options);
        failed = false;
        paused = true;
        lastInput = performance.now();
        clock.reset(lastInput);
        stepMs = 0;
        fillPool(frameBytes());
        lastSent = -1;
        send({ type: 'ready', buildMs: performance.now() - start, vehicle: simulation.player.definition.id });
        snapshot(true);
        status();
        break;
      }
      case 'input':
        if (simulation && !paused) shifts.push(msg.input.shift);
        applyInput({ ...msg.input, shift: 0 });
        lastInput = performance.now();
        break;
      case 'pause':
        paused = msg.value;
        lastInput = performance.now();
        clock.rebase(lastInput);
        if (paused) {
          shifts.clear();
          applyInput(controls());
          // At capacity no step or command can change the sampled state.
          // Repeated pauses need no duplicate status or required frame, whose
          // one-off allocation would otherwise bypass normal frame credits.
          if (statusAvailable()) {
            snapshot(true);
            status();
          }
        }
        break;
      case 'command': {
        if (!statusAvailable()) {
          if (msg.requestId !== undefined)
            send({ type: 'command-result', requestId: msg.requestId, error: STATUS_BUSY });
          else send({ type: 'error', message: STATUS_BUSY, fatal: false });
          break;
        }
        const before = simulation?.cars.length;
        try {
          simulation?.command(msg.command);
        } catch (error) {
          // Only pre-mutation validation is recoverable. An execution error
          // may have changed the car field, event or terrain ownership.
          if (!(error instanceof FestivalCommandValidationError)) throw error;
          const message = error.message;
          if (msg.requestId !== undefined)
            send({ type: 'command-result', requestId: msg.requestId, error: message });
          else send({ type: 'error', message, fatal: false });
          break;
        }
        // A successful reset, travel, event or driver transition invalidates
        // pending intent belonging to the previous driving state.
        if (msg.command.type !== 'traffic') shifts.clear();
        // A field change or teleport: deliver the new state at once.
        if (simulation && (simulation.cars.length !== before || paused)) snapshot(true);
        status();
        // The caller must receive the updated state before continuing travel.
        if (msg.requestId !== undefined) send({ type: 'command-result', requestId: msg.requestId });
        break;
      }
      case 'statusAck': {
        const stalled = !statusAvailable();
        if (Number.isSafeInteger(msg.sequence) && statusReceipts.delete(msg.sequence) && stalled)
          // ACK delivery can precede the next timer after a long host stall.
          // Exclude that time even when no stalled timer callback ran.
          clock.rebase(performance.now());
        break;
      }
      case 'recycle':
        // A buffer of a previous field size is dropped (the pool was refilled).
        if (simulation && msg.buffer.byteLength === poolBytes) pool?.recycle(msg.buffer);
        break;
    }
  } catch (error) {
    failed = true;
    paused = true;
    shifts.clear();
    send({ type: 'error', message: error instanceof Error ? error.message : String(error), fatal: true });
  }
};
setInterval(() => {
  const now = performance.now();
  if (failed || paused || !simulation || !statusAvailable()) {
    clock.rebase(now);
    return;
  }
  try {
    if (now - lastInput > 750) {
      shifts.clear();
      applyInput({ ...controls(), brake: 0.4 });
    }
    const start = performance.now(),
      before = clock.ticks,
      cars = simulation.cars.length;
    clock.advance(now, (dt) => {
      const shift = shifts.take();
      if (shift) applyInput({ ...simulation!.player.input, shift });
      simulation!.step(dt);
      const result = simulation!.takeResult();
      if (result) send({ type: 'result', result });
    });
    const count = clock.ticks - before;
    if (count) stepMs = stepMs * 0.9 + ((performance.now() - start) / count) * 0.1;
    if (simulation.cars.length !== cars) snapshot(true);
    else if (simulation.tick - lastSent >= 2) {
      snapshot();
      lastSent = simulation.tick;
    }
    if (performance.now() - lastStatus >= 100) status();
  } catch (error) {
    failed = true;
    paused = true;
    shifts.clear();
    send({
      type: 'error',
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
      fatal: true,
    });
  }
}, 4);
