import { announceNativeWorker } from './engine-worker-clock.ts';
import { OpenWorldSimulation } from '../../src/simulation/open-world/session.ts';
import type { ChannelInspection } from './engine-native-channels.ts';

/** The existing adapter controls timer delivery. The offset additionally lets
 * an ACK arrive after elapsed time but before a timer, as a suspended host can. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const clockNow = performance.now.bind(performance);
let offset = 0;
Object.defineProperty(performance, 'now', {
  configurable: true,
  value: () => clockNow() + offset,
});
let observed: OpenWorldSimulation | null = null;
let steps = 0;
let statuses = 0;
let commands = 0;
let failNext = false;
let nextPlayer = 0;
const players = new WeakMap<object, number>();
function observe(value: OpenWorldSimulation) {
  observed = value;
}
const writeFrame = OpenWorldSimulation.prototype.writeFrame;
OpenWorldSimulation.prototype.writeFrame = function (this: OpenWorldSimulation, ...args) {
  observe(this);
  return writeFrame.apply(this, args);
};
const step = OpenWorldSimulation.prototype.step;
OpenWorldSimulation.prototype.step = function (this: OpenWorldSimulation, ...args) {
  observe(this);
  const result = step.apply(this, args);
  steps++;
  return result;
};
const status = OpenWorldSimulation.prototype.status;
OpenWorldSimulation.prototype.status = function (this: OpenWorldSimulation, ...args) {
  observe(this);
  statuses++;
  return status.apply(this, args);
};
const command = OpenWorldSimulation.prototype.command;
OpenWorldSimulation.prototype.command = function (this: OpenWorldSimulation, ...args) {
  observe(this);
  commands++;
  const result = command.apply(this, args);
  if (failNext) {
    failNext = false;
    throw new Error('Native Festival fault after completed command');
  }
  return result;
};

scope.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as {
    __engineChannels?: boolean;
    id: number;
    operation: string;
    milliseconds?: number;
  };
  if (!message?.__engineChannels) return;
  event.stopImmediatePropagation();
  if (message.operation === 'failNext') failNext = true;
  if (message.operation === 'jump') {
    if (
      !Number.isFinite(message.milliseconds) ||
      message.milliseconds! < 0 ||
      message.milliseconds! > 60000
    )
      throw new Error('Invalid native fixture clock jump');
    offset += message.milliseconds!;
  }
  const player = observed?.player;
  if (player && !players.has(player)) players.set(player, ++nextPlayer);
  const inspection: ChannelInspection = {
    kind: 'festival',
    now: performance.now(),
    tick: observed?.tick ?? null,
    steps,
    probes: 0,
    statuses,
    commands,
    playerToken: player ? players.get(player)! : 0,
    throttle: player?.input.throttle ?? null,
    shift: player?.input.shift ?? null,
  };
  scope.postMessage({ __engineChannels: 'receipt', id: message.id, inspection });
});

void import('../../src/workers/open-world.worker.ts').then(() => announceNativeWorker('festival'));
