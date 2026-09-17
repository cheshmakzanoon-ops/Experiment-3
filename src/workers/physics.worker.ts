/// <reference lib="webworker" />
import { FixedStepper } from '../core/math.ts';
import { CAR_STRIDE, HEADER, type FromWorker, type ToWorker } from '../simulation/protocol.ts';
import { TelemetrySampler } from '../storage/telemetry-sampler.ts';
import { Simulation } from '../simulation/world.ts';
import { controls } from '../simulation/config.ts';
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
const send = (msg: FromWorker, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);
function snapshot() {
  if (!simulation || pool.length === 0) return;
  const buffer = pool.pop()!;
  simulation.writeFrame(new Float32Array(buffer), stepMs, clock.droppedSeconds);
  send({ type: 'frame', buffer }, [buffer]);
}
scope.onmessage = (event: MessageEvent<ToWorker>) => {
  try {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
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
    if (simulation.tick - lastSurface >= 60) {
      const water = simulation.track.water.slice(),
        rubber = simulation.track.rubber.slice();
      telemetry?.flushReplay();
      send({ type: 'surface', water, rubber, time: simulation.race.time }, [
        water.buffer,
        rubber.buffer,
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
