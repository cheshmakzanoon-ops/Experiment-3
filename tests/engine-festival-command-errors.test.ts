import { afterEach, describe, expect, it, vi } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import type { FestivalCommand } from '../src/simulation/open-world/session.ts';
import type { FromOpenWorld, ToOpenWorld } from '../src/workers/open-world-protocol.ts';

const runtime = {
  now: 0,
  pump: undefined as (() => void) | undefined,
  messages: [] as FromOpenWorld[],
};
const scope = {
  onmessage: null as ((event: { data: ToOpenWorld }) => void) | null,
  postMessage(message: FromOpenWorld, transfer: Transferable[] = []) {
    runtime.messages.push(structuredClone(message, { transfer }));
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Real simulation commands and worker delivery, including transferred buffers.
 * The module stays loaded; each case begins with a fresh init, just as a new
 * session does, without retaining copies of the world's imported data graph. */
async function worker() {
  runtime.now = 0;
  runtime.messages.length = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => runtime.now);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    runtime.pump = callback;
    return 1;
  });
  const { OpenWorldSimulation, FestivalCommandValidationError } = await import(
    '../src/simulation/open-world/session.ts'
  );
  const commands = vi.spyOn(OpenWorldSimulation.prototype, 'command');
  const steps = vi.spyOn(OpenWorldSimulation.prototype, 'step');
  const observed: { simulation?: InstanceType<typeof OpenWorldSimulation> } = {};
  const originalStatus = OpenWorldSimulation.prototype.status;
  const statuses = vi.spyOn(OpenWorldSimulation.prototype, 'status').mockImplementation(function (
    this: InstanceType<typeof OpenWorldSimulation>,
  ) {
    observed.simulation = this;
    return originalStatus.call(this);
  });
  const originalPlaceAt = OpenWorldSimulation.prototype.placeAt;
  const placeAt = vi.spyOn(OpenWorldSimulation.prototype, 'placeAt');
  await import('../src/workers/open-world.worker.ts');
  const send = (message: ToOpenWorld) => scope.onmessage!({ data: structuredClone(message) });
  const init = () =>
    send({
      type: 'init',
      options: { vehicle: 'tc1', weather: 'clear', assist: 'sport', seed: 73021, traffic: false },
    });
  init();
  const simulation = observed.simulation!;
  return {
    commands,
    steps,
    statuses,
    placeAt,
    originalPlaceAt,
    simulation,
    FestivalCommandValidationError,
    send,
    init,
    messages: runtime.messages,
    advance(milliseconds: number) {
      runtime.now += milliseconds;
      runtime.pump!();
    },
  };
}

const invalid: { command: FestivalCommand; message: string }[] = [
  {
    command: { type: 'start', event: 'missing-event' },
    message: 'Unknown festival event missing-event',
  },
  {
    command: { type: 'travel', event: 'missing-event' },
    message: 'Unknown festival event missing-event',
  },
  {
    command: { type: 'vehicle', id: 'missing-vehicle' },
    message: 'Vehicle missing-vehicle cannot run in the festival',
  },
];

describe('Festival command error boundaries', () => {
  it.each(invalid)(
    'rejects $command.type before changing an active event',
    async ({ command, message }) => {
      const h = await worker();
      h.send({ type: 'command', command: { type: 'start', event: 'valley-sprint' } });
      const state = h.simulation.status(),
        cars = [...h.simulation.cars];
      expect(() => h.simulation.command(command)).toThrow(h.FestivalCommandValidationError);
      expect(() => h.simulation.command(command)).toThrow(message);
      expect(h.simulation.status()).toEqual(state);
      expect(h.simulation.cars).toEqual(cars);
      for (let i = 0; i < cars.length; i++) expect(h.simulation.cars[i]).toBe(cars[i]);
      expect(h.simulation.takeResult()).toBeNull();
    },
  );

  it.each(
    invalid.flatMap((entry) => [
      { ...entry, requestId: 42 },
      { ...entry, requestId: undefined },
    ]),
  )(
    'keeps $command.type validation recoverable with requestId=$requestId',
    async ({ command, message, requestId }) => {
      const h = await worker();
      h.send({ type: 'pause', value: false });
      h.messages.length = 0;
      h.send({ type: 'command', command, requestId });
      expect(h.messages).toEqual(
        requestId === undefined
          ? [{ type: 'error', message, fatal: false }]
          : [{ type: 'command-result', requestId, error: message }],
      );
      h.advance(20);
      expect(h.steps).toHaveBeenCalledTimes(2);
      h.send({ type: 'command', command: { type: 'traffic', value: false }, requestId: 43 });
      expect(h.messages.at(-2)?.type).toBe('status');
      expect(h.messages.at(-1)).toEqual({ type: 'command-result', requestId: 43 });
    },
  );

  it.each([
    { type: 'reset' },
    { type: 'start', event: 'valley-sprint' },
    { type: 'travel', event: 'valley-sprint' },
    { type: 'vehicle', id: 'tc1' },
  ] satisfies FestivalCommand[])(
    'makes a partially applied $type terminal before delivering any receipt',
    async (command) => {
      const h = await worker();
      h.send({ type: 'pause', value: false });
      const player = h.simulation.player;
      h.placeAt.mockImplementationOnce(function (this: typeof h.simulation, ...args) {
        h.originalPlaceAt.apply(this, args);
        throw new Error('Injected failure after placement');
      });
      h.messages.length = 0;
      h.send({ type: 'command', command, requestId: 44 });
      expect(h.simulation.player).not.toBe(player);
      expect(h.messages).toEqual([
        { type: 'error', message: 'Injected failure after placement', fatal: true },
      ]);
      const commands = h.commands.mock.calls.length,
        statuses = h.statuses.mock.calls.length;
      h.send({ type: 'pause', value: false });
      h.send({ type: 'input', input: { ...controls(), throttle: 1, shift: 1 } });
      h.send({ type: 'command', command: { type: 'reset' }, requestId: 45 });
      h.advance(1000);
      expect(h.commands).toHaveBeenCalledTimes(commands);
      expect(h.statuses).toHaveBeenCalledTimes(statuses);
      expect(h.steps).not.toHaveBeenCalled();
      expect(h.messages).toHaveLength(1);
    },
  );

  it('treats an ordinary exception with validation-like wording as fatal', async () => {
    const h = await worker();
    h.commands.mockImplementationOnce(() => {
      throw new Error('Unknown festival event missing-event');
    });
    h.messages.length = 0;
    h.send({ type: 'command', command: { type: 'reset' }, requestId: 46 });
    expect(h.messages).toEqual([
      { type: 'error', message: 'Unknown festival event missing-event', fatal: true },
    ]);
  });

  it('starts cleanly only after a fresh initialization following a fatal command', async () => {
    const h = await worker();
    h.commands.mockImplementationOnce(() => {
      throw undefined;
    });
    h.send({ type: 'command', command: { type: 'traffic', value: false } });
    expect(h.messages.at(-1)).toEqual({ type: 'error', message: 'undefined', fatal: true });
    h.messages.length = 0;
    h.init();
    expect(h.messages.map((message) => message.type)).toEqual(['ready', 'frame', 'status']);
    h.advance(1000);
    expect(h.steps).not.toHaveBeenCalled();
    h.send({ type: 'pause', value: false });
    h.advance(20);
    expect(h.steps).toHaveBeenCalledTimes(2);
    h.send({ type: 'command', command: { type: 'traffic', value: false }, requestId: 47 });
    expect(h.messages.at(-2)?.type).toBe('status');
    expect(h.messages.at(-1)).toEqual({ type: 'command-result', requestId: 47 });
  });

  it('also ignores queued resume and commands after an interval failure', async () => {
    const h = await worker();
    h.steps.mockImplementationOnce(() => {
      throw new Error('Injected step failure');
    });
    h.send({ type: 'pause', value: false });
    h.advance(20);
    expect(h.messages.at(-1)).toMatchObject({
      type: 'error',
      fatal: true,
      message: expect.stringContaining('Injected step failure'),
    });
    const count = h.messages.length;
    h.send({ type: 'pause', value: false });
    h.send({ type: 'command', command: { type: 'traffic', value: false }, requestId: 48 });
    h.advance(1000);
    expect(h.steps).toHaveBeenCalledTimes(1);
    expect(h.commands).not.toHaveBeenCalled();
    expect(h.messages).toHaveLength(count);
  });
});
