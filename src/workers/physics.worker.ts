/// <reference lib="webworker" />
import { FixedStepClock } from './fixed-step-clock.ts';
import { FrameBufferPool } from './frame-buffer-pool.ts';
import { SurfaceChannel } from './surface-channel.ts';
import { ShiftInputQueue } from './input-queue.ts';
import { CAR_STRIDE, HEADER } from '../simulation/protocol.ts';
import { REPLAY_TICKS, TelemetrySampler } from '../storage/telemetry-sampler.ts';
import { Simulation } from '../simulation/world.ts';
import { controls, type Controls, type SessionOptions } from '../simulation/config.ts';
import { InputLog, Resimulation, applyLoggedInput, flashbackFloor } from '../core/flashback.ts';
import { EngineeringProbe, type ClientMessage, type WorkerMessage } from './diagnostics.ts';
const probe = new EngineeringProbe();
const scope = self as unknown as DedicatedWorkerGlobalScope;
let simulation: Simulation | null = null,
  paused = true,
  lastInput = performance.now(),
  stepMs = 0;
const clock = new FixedStepClock();
const shifts = new ShiftInputQueue();
const surfaces = new SurfaceChannel();
let pendingFlashback = false;
let pool: FrameBufferPool | null = null;
let telemetry: TelemetrySampler | null = null;
// D31 flashback: every applied input, the session options and a running rewind.
let log = new InputLog(),
  sessionOptions: SessionOptions | null = null,
  rewind: Resimulation | null = null;
function applyInput(input: Controls) {
  if (!simulation) return;
  applyLoggedInput(simulation, log, input);
}
function recorder(sim: Simulation) {
  return new TelemetrySampler(
    sim,
    (buffer, rows) => send({ type: 'telemetry', buffer, rows }, [buffer]),
    (message) => send({ type: 'recordingWarning', message }),
    (buffer, rows) => send({ type: 'replayFrames', buffer, rows }, [buffer]),
  );
}
/** Swap in the re-simulated session at the flashback tick and report it. */
function finishFlashback(job: Resimulation) {
  shifts.clear();
  simulation = job.simulation;
  log.truncate(job.target);
  telemetry = recorder(simulation);
  probe.reset();
  lastInput = performance.now();
  clock.reset(lastInput);
  lastSent = simulation.tick;
  lastSurface = simulation.tick;
  lastPitPhase = simulation.cars[0].pitPhase;
  surfaces.reset(simulation.tick);
  surfaces.request(simulation.tick);
  pendingFlashback = true;
  publishSurface();
}
let lastSent = -1,
  lastSurface = -1,
  lastPitPhase = 0;
const send = (msg: WorkerMessage, transfer: Transferable[] = []) =>
  scope.postMessage(msg, transfer);
function publishSurface() {
  if (!simulation || rewind) return;
  const current = simulation,
    flashback = pendingFlashback;
  const sent = surfaces.publish(
    current.tick,
    (full) => ({
      type: 'surface',
      water: current.track.water.slice(),
      rubber: current.track.rubber.slice(),
      marbles: current.track.marbles.slice(),
      frozen:
        current.track.cold && current.track.frozen.length ? current.track.frozen.slice() : undefined,
      time: current.race.time,
      terrain: current.offroad?.terrain.renderDelta(full),
    }),
    (message, transfer) => {
      // Completion waits for surface capacity: even required rebases cannot
      // bypass the bound. The host truncates replay before accepting the new
      // surface, then receives the matching pose in the original FIFO order.
      if (flashback) send({ type: 'flashback', tick: current.tick, time: current.race.time });
      send(message, transfer);
    },
  );
  if (sent && flashback && simulation === current) {
    pendingFlashback = false;
    snapshot(true);
  }
}
function engineering() {
  if (!simulation) return;
  const sample = probe.sample(simulation);
  if (sample) send({ type: 'engineering', sample });
}
function snapshot(required = false) {
  if (!simulation || !pool) return;
  // A paused consumer may still hold every transferable frame. Only an explicit
  // pause barrier, flashback completion or player pit-service transition may
  // allocate a snapshot; normal frame delivery stays pooled.
  const current = simulation;
  pool.publish((buffer) => {
    current.writeFrame(new Float32Array(buffer), stepMs, clock.droppedSeconds);
    send({ type: 'frame', buffer }, [buffer]);
  }, required);
}
scope.onmessage = (event: MessageEvent<ClientMessage>) => {
  try {
    const msg = event.data;
    switch (msg.type) {
      case 'engineering':
        probe.enable(msg.enabled);
        engineering();
        break;
      case 'init':
        shifts.clear();
        probe.reset();
        simulation = new Simulation(msg.options);
        sessionOptions = msg.options;
        log = new InputLog();
        rewind = null;
        pendingFlashback = false;
        surfaces.reset(0, true);
        telemetry = recorder(simulation);
        paused = true;
        lastInput = performance.now();
        clock.reset(lastInput);
        stepMs = 0;
        pool = new FrameBufferPool((HEADER + simulation.cars.length * CAR_STRIDE) * 4, 5, 6);
        lastSent = -1;
        lastSurface = -1;
        lastPitPhase = simulation.cars[0].pitPhase;
        snapshot();
        break;
      case 'input':
        if (simulation && !paused && !rewind && !pendingFlashback) shifts.push(msg.input.shift);
        // Analog levels and DRS/overtake retain their immediate semantics.
        // A neutral sample must not erase a shift awaiting its physics tick.
        applyInput({ ...msg.input, shift: 0 });
        lastInput = performance.now();
        break;
      case 'pause':
        if (
          msg.sequence !== undefined &&
          (!Number.isSafeInteger(msg.sequence) || msg.sequence < 1)
        )
          throw new Error('Invalid worker pause sequence');
        paused = msg.value;
        lastInput = performance.now();
        clock.rebase(lastInput);
        if (paused) {
          shifts.clear();
          telemetry?.flush();
          telemetry?.flushReplay();
          applyInput(controls());
          snapshot(true);
        }
        // Dedicated-worker messages retain this ordering: recording flushes,
        // final paused snapshot, then the matching low-frequency receipt.
        if (simulation && msg.sequence !== undefined)
          send({ type: 'pauseState', sequence: msg.sequence, value: paused, tick: simulation.tick });
        break;
      case 'pit':
        if (simulation) log.pit(simulation.tick, msg.compound);
        simulation?.requestPit(msg.compound);
        break;
      case 'autopilot':
        if (simulation) {
          if (simulation.autoPlayer !== msg.value) shifts.clear();
          log.autopilot(simulation.tick, msg.value);
          simulation.autoPlayer = msg.value;
        }
        break;
      case 'flashback':
        if (
          !simulation ||
          !sessionOptions ||
          rewind ||
          pendingFlashback ||
          !Number.isInteger(msg.tick) ||
          msg.tick < flashbackFloor(simulation.tick) ||
          msg.tick > simulation.tick
        )
          throw new Error('Invalid flashback request');
        paused = true;
        shifts.clear();
        telemetry?.flush();
        telemetry?.flushReplay();
        rewind = new Resimulation(sessionOptions, log.entries.slice(), msg.tick);
        break;
      case 'surfaceAck':
        if (surfaces.acknowledge(msg)) publishSurface();
        break;
      case 'recycleReplay':
        telemetry?.recycleReplay(msg.buffer);
        break;
      case 'recycleTelemetry':
        telemetry?.recycle(msg.buffer);
        break;
      case 'recycle':
        pool?.recycle(msg.buffer);
        break;
    }
  } catch (error) {
    paused = true;
    shifts.clear();
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
setInterval(() => {
  const now = performance.now();
  if (rewind) {
    clock.rebase(now);
    // Yield between complete ticks at the work budget or 2000-step cap so
    // cancellation and progress messages keep flowing during long rewinds.
    try {
      const job = rewind;
      if (job.run()) {
        rewind = null;
        finishFlashback(job);
      }
    } catch (error) {
      rewind = null;
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (paused || pendingFlashback || !simulation) {
    clock.rebase(now);
    return;
  }
  try {
    if (now - lastInput > 750) {
      shifts.clear();
      applyInput({ ...controls(), brake: 0.4 });
    }
    const start = performance.now(),
      before = clock.ticks;
    clock.advance(now, (dt) => {
      const shift = shifts.take();
      if (shift) applyInput({ ...simulation!.cars[0].input, shift });
      simulation!.step(dt);
      telemetry?.capture(stepMs, clock.droppedSeconds);
      // Service phases last 0.8-1.7 s. A stalled consumer (every pooled frame
      // held) or a starved worker batch must not skip one, so each player
      // phase is delivered once, on its first tick that is also a recorded
      // replay frame (every REPLAY_TICKS). Evidence rows can then be located
      // exactly in the replay, which a mid-interval tick could not be.
      const pitPhase = simulation!.cars[0].pitPhase;
      if (pitPhase !== lastPitPhase && simulation!.tick % REPLAY_TICKS === 0) {
        lastPitPhase = pitPhase;
        snapshot(true);
        lastSent = simulation!.tick;
      }
    });
    const count = clock.ticks - before;
    if (count) stepMs = stepMs * 0.9 + ((performance.now() - start) / count) * 0.1;
    if (simulation.tick - lastSent >= 2) {
      snapshot();
      lastSent = simulation.tick;
    }
    engineering();
    if (simulation.tick - lastSurface >= 60) {
      // Surface keyframes are independently timestamped. Flushing replay here
      // would send half-empty pages every 0.5 s and halve the configured stall reserve.
      // SessionReplay carries leading surface keyframes across pose-page boundaries.
      lastSurface = simulation.tick;
      surfaces.request(simulation.tick);
      publishSurface();
    }
  } catch (error) {
    paused = true;
    shifts.clear();
    send({
      type: 'error',
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
}, 4);
