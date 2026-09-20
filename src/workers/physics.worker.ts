/// <reference lib="webworker" />
import { FixedStepper } from '../core/math.ts';
import { CAR_STRIDE, HEADER } from '../simulation/protocol.ts';
import { TelemetrySampler } from '../storage/telemetry-sampler.ts';
import { Simulation } from '../simulation/world.ts';
import { controls } from '../simulation/config.ts';
import { EngineeringProbe, type ClientMessage, type WorkerMessage } from './diagnostics.ts';
const probe = new EngineeringProbe();
const scope = self as unknown as DedicatedWorkerGlobalScope;
let simulation: Simulation | null = null,
  paused = true,
  previous = performance.now(),
  lastInput = previous,
  stepMs = 0;
const clock = new FixedStepper();
let pool: ArrayBuffer[] = [];
let telemetry: TelemetrySampler | null = null;
let lastSent = -1,
  lastSurface = -1;
const send = (msg: WorkerMessage, transfer: Transferable[] = []) =>
  scope.postMessage(msg, transfer);
function engineering() {
  if (!simulation) return;
  const sample = probe.sample(simulation);
  if (sample) send({ type: 'engineering', sample });
}
function snapshot() {
  if (!simulation || pool.length === 0) return;
  const buffer = pool.pop()!;
  simulation.writeFrame(new Float32Array(buffer), stepMs, clock.droppedSeconds);
  send({ type: 'frame', buffer }, [buffer]);
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
        probe.reset();
        simulation = new Simulation(msg.options);
        telemetry = new TelemetrySampler(
          simulation,
          (buffer, rows) => send({ type: 'telemetry', buffer, rows }, [buffer]),
          (message) => send({ type: 'recordingWarning', message }),
          (buffer, rows) => send({ type: 'replayFrames', buffer, rows }, [buffer]),
        );
        clock.reset();
        paused = true;
        previous = performance.now();
        lastInput = previous;
        pool = Array.from(
          { length: 5 },
          () => new ArrayBuffer((HEADER + simulation!.cars.length * CAR_STRIDE) * 4),
        );
        lastSent = -1;
        lastSurface = -1;
        snapshot();
        break;
      case 'input':
        simulation?.setInput(msg.input);
        lastInput = performance.now();
        break;
      case 'pause':
        paused = msg.value;
        previous = performance.now();
        lastInput = previous;
        if (paused) {
          telemetry?.flush();
          telemetry?.flushReplay();
          simulation?.setInput(controls());
          snapshot();
        }
        break;
      case 'pit':
        simulation?.requestPit();
        break;
      case 'autopilot':
        if (simulation) simulation.autoPlayer = msg.value;
        break;
      case 'recycleReplay':
        telemetry?.recycleReplay(msg.buffer);
        break;
      case 'recycleTelemetry':
        telemetry?.recycle(msg.buffer);
        break;
      case 'recycle':
        if (
          simulation &&
          msg.buffer.byteLength === (HEADER + simulation.cars.length * CAR_STRIDE) * 4 &&
          pool.length < 6
        )
          pool.push(msg.buffer);
        break;
    }
  } catch (error) {
    paused = true;
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
setInterval(() => {
  const now = performance.now(),
    elapsed = (now - previous) / 1000;
  previous = now;
  if (paused || !simulation) return;
  try {
    if (now - lastInput > 750) simulation.setInput({ ...controls(), brake: 0.4 });
    const start = performance.now(),
      before = clock.ticks;
    clock.advance(elapsed, (dt) => {
      simulation!.step(dt);
      telemetry?.capture(stepMs, clock.droppedSeconds);
    });
    const count = clock.ticks - before;
    if (count) stepMs = stepMs * 0.9 + ((performance.now() - start) / count) * 0.1;
    if (simulation.tick - lastSent >= 2) {
      snapshot();
      lastSent = simulation.tick;
    }
    engineering();
    if (simulation.tick - lastSurface >= 60) {
      const water = simulation.track.water.slice(),
        rubber = simulation.track.rubber.slice(),
        marbles = simulation.track.marbles.slice();
      // Surface keyframes are independently timestamped. Flushing replay here
      // would send half-empty pages every 0.5 s and halve the configured stall reserve.
      // SessionReplay carries leading surface keyframes across pose-page boundaries.
      send({ type: 'surface', water, rubber, marbles, time: simulation.race.time }, [
        water.buffer,
        rubber.buffer,
        marbles.buffer,
      ]);
      lastSurface = simulation.tick;
    }
  } catch (error) {
    paused = true;
    send({
      type: 'error',
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
}, 4);
