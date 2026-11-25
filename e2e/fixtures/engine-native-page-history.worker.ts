/// <reference lib="webworker" />

import { Simulation } from '../../src/simulation/world.ts';
import type { Controls } from '../../src/simulation/config.ts';
import '../../src/workers/physics.worker.ts';

/** Read-only inspection around the real worker, with its ordinary native
 * performance clock, interval, message dispatch, physics and transfer pools. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const instance = crypto.randomUUID();
let steps = 0;
let tick = 0;
let paused = true;
let inputMessages = 0;
let positiveShifts = 0;
let negativeShifts = 0;
let lastInput: Controls | null = null;
const applied: { tick: number; throttle: number; shift: number }[] = [];
const step = Simulation.prototype.step;
Simulation.prototype.step = function (this: Simulation, dt: number) {
  const input = this.cars[0].input;
  if (input.shift > 0) positiveShifts++;
  if (input.shift < 0) negativeShifts++;
  applied.push({ tick: this.tick, throttle: input.throttle, shift: input.shift });
  if (applied.length > 64) applied.shift();
  const result = step.call(this, dt);
  steps++;
  tick = this.tick;
  return result;
};

const receive = scope.onmessage!;
scope.onmessage = (event: MessageEvent) => {
  if (event.data?.__pageHistory === 'inspect') {
    scope.postMessage({
      __pageHistory: 'inspection',
      id: event.data.id,
      instance,
      steps,
      tick,
      paused,
      inputMessages,
      positiveShifts,
      negativeShifts,
      lastInput,
      applied,
    });
    return;
  }
  receive.call(scope, event);
  if (event.data?.type === 'pause') paused = event.data.value;
  if (event.data?.type === 'input') {
    inputMessages++;
    lastInput = { ...event.data.input };
  }
};
scope.postMessage({ __pageHistory: 'ready', instance });
