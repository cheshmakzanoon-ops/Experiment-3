import { announceNativeWorker } from './engine-worker-clock.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { EngineeringProbe } from '../../src/workers/diagnostics.ts';
import type { ChannelInspection } from './engine-native-channels.ts';

/** Test-only observation and one-shot fault injection around real methods.
 * Neither the worker protocol, channel ownership nor stepping is replaced. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
let observed: Simulation | null = null;
let steps = 0;
let probes = 0;
let failNext = false;
function observe(value: Simulation) {
  observed = value;
}
const writeFrame = Simulation.prototype.writeFrame;
Simulation.prototype.writeFrame = function (this: Simulation, ...args) {
  observe(this);
  return writeFrame.apply(this, args);
};
const step = Simulation.prototype.step;
Simulation.prototype.step = function (this: Simulation, ...args) {
  observe(this);
  const result = step.apply(this, args);
  steps++;
  if (failNext) {
    failNext = false;
    throw new Error('Native circuit fault after completed step');
  }
  return result;
};
const sample = EngineeringProbe.prototype.sample;
EngineeringProbe.prototype.sample = function (this: EngineeringProbe, ...args) {
  probes++;
  return sample.apply(this, args);
};

scope.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as { __engineChannels?: boolean; id: number; operation: string };
  if (!message?.__engineChannels) return;
  event.stopImmediatePropagation();
  if (message.operation === 'failNext') failNext = true;
  const inspection: ChannelInspection = {
    kind: 'circuit',
    now: performance.now(),
    tick: observed?.tick ?? null,
    steps,
    probes,
    statuses: 0,
    commands: 0,
    playerToken: 0,
    throttle: observed?.cars[0].input.throttle ?? null,
    shift: observed?.cars[0].input.shift ?? null,
  };
  scope.postMessage({ __engineChannels: 'receipt', id: message.id, inspection });
});

// Register the observation listener before the production onmessage handler.
void import('../../src/workers/physics.worker.ts').then(() => announceNativeWorker('circuit'));
