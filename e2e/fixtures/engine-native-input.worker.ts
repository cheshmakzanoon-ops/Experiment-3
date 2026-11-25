import { announceNativeWorker } from './engine-worker-clock.ts';
import { Simulation } from '../../src/simulation/world.ts';
import type { Controls } from '../../src/simulation/config.ts';
import '../../src/workers/physics.worker.ts';

export interface AppliedNativeInput {
  tick: number;
  input: Controls;
}

// Observe actual inputs immediately before the real physics step. The worker's
// message handler, ShiftInputQueue and simulation are not replaced.
const applied: AppliedNativeInput[] = [];
const step = Simulation.prototype.step;
Simulation.prototype.step = function (this: Simulation, dt: number) {
  applied.push({ tick: this.tick, input: { ...this.cars[0].input } });
  return step.call(this, dt);
};

const scope = self as unknown as DedicatedWorkerGlobalScope;
const receive = scope.onmessage!;
scope.onmessage = (event: MessageEvent) => {
  if (event.data?.__nativeInput === 'inspect') {
    scope.postMessage({ __nativeInput: 'trace', id: event.data.id, applied });
    return;
  }
  receive.call(scope, event);
};
announceNativeWorker('circuit');
