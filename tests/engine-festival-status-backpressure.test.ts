import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { controls } from '../src/simulation/config.ts';
import type { FestivalStatus } from '../src/simulation/open-world/session.ts';
import { FestivalStatusObserver } from '../src/steam/hooks.ts';
import type { GameEvent } from '../src/steam/events.ts';
import {
  FESTIVAL_STATUS_CAPACITY,
  type FromOpenWorld,
  type ToOpenWorld,
} from '../src/workers/open-world-protocol.ts';

type Status = Extract<FromOpenWorld, { type: 'status' }>;
const runtime = {
  now: 0,
  pump: undefined as (() => void) | undefined,
  messages: [] as FromOpenWorld[],
  failStatus: false,
};
const scope = {
  onmessage: null as ((event: { data: ToOpenWorld }) => void) | null,
  postMessage(message: FromOpenWorld, transfer: Transferable[] = []) {
    if (message.type === 'status' && runtime.failStatus) {
      runtime.failStatus = false;
      throw new Error('Status transport failed');
    }
    runtime.messages.push(structuredClone(message, { transfer }));
  },
};
const send = (data: ToOpenWorld) => scope.onmessage!({ data: structuredClone(data) });
const packets = () =>
  runtime.messages.filter((message): message is Status => message.type === 'status');
const ack = (packet: Status) => send({ type: 'statusAck', sequence: packet.sequence });

afterEach(() => {
  // The production worker's receipt owners intentionally survive init. Retire
  // only messages actually delivered by this case before the next fresh init.
  for (const packet of packets()) ack(packet);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function worker(decorate?: (sample: FestivalStatus, index: number) => FestivalStatus) {
  runtime.now = 0;
  runtime.failStatus = false;
  runtime.messages.length = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => runtime.now);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    runtime.pump = callback;
    return 1;
  });
  const { OpenWorldSimulation } = await import('../src/simulation/open-world/session.ts');
  const originalStatus = OpenWorldSimulation.prototype.status;
  const observed: { simulation?: InstanceType<typeof OpenWorldSimulation> } = {};
  let index = 0;
  const statuses = vi.spyOn(OpenWorldSimulation.prototype, 'status').mockImplementation(function (
    this: InstanceType<typeof OpenWorldSimulation>,
  ) {
    observed.simulation = this;
    const sample = originalStatus.call(this);
    return decorate ? decorate(sample, index++) : sample;
  });
  const commands = vi.spyOn(OpenWorldSimulation.prototype, 'command');
  const steps = vi.spyOn(OpenWorldSimulation.prototype, 'step');
  await import('../src/workers/open-world.worker.ts');
  const init = () =>
    send({
      type: 'init',
      options: { vehicle: 'tc1', weather: 'clear', assist: 'sport', seed: 73023, traffic: false },
    });
  init();
  const simulation = observed.simulation!;
  const advance = (milliseconds: number) => {
    runtime.now += milliseconds;
    runtime.pump!();
  };
  return {
    send,
    init,
    advance,
    statuses,
    commands,
    steps,
    simulation,
    fill() {
      send({ type: 'pause', value: false });
      for (let i = 1; i < FESTIVAL_STATUS_CAPACITY; i++) advance(100);
      expect(packets()).toHaveLength(FESTIVAL_STATUS_CAPACITY);
    },
  };
}

// Execute the complete production receive/post methods, including their
// ownership checks, without constructing a GPU renderer or full application.
const source = ts.createSourceFile(
  'free-roam.ts',
  readFileSync(new URL('../src/session/free-roam.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const owner = source.statements.find(
  (node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'FestivalSession',
)!;
const methods = ['receive', 'post'].map((name) => {
  const method = owner.members.find(
    (node): node is ts.MethodDeclaration =>
      ts.isMethodDeclaration(node) && node.name.getText(source) === name,
  );
  if (!method) throw new Error(`FestivalSession.${name} must exist`);
  return method.getText(source);
});
const compiled = ts.transpileModule(`class Host { ${methods.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function host() {
  const events: GameEvent[] = [];
  const delivered: ToOpenWorld[] = [];
  const worker = { postMessage: vi.fn((message: ToOpenWorld) => delivered.push(message)) };
  interface Host {
    receive(message: FromOpenWorld): void;
    post(message: ToOpenWorld): void;
    disposed: boolean;
    worker: typeof worker;
    achievements: { observe(status: FestivalStatus): void };
  }
  const prototype = new Function(`${compiled}; return Host.prototype;`)() as Host;
  const instance = Object.assign(Object.create(prototype) as Host, {
    disposed: false,
    worker,
    achievements: new FestivalStatusObserver((event) => events.push(event)),
    renderer: { discovered: new Set<string>(), activeEvent: null, gate: null },
    save: { discovered: [] as string[] },
    persist: vi.fn(async () => {}),
    fail: vi.fn((_error: Error, _fatal: boolean) => {
      instance.disposed = true;
    }),
  });
  return { instance, events, delivered, worker };
}

describe('lossless Festival status backpressure', () => {
  it('bounds copied statuses and stops stepping until an owned receipt returns', async () => {
    const h = await worker();
    h.fill();
    const tick = h.simulation.tick;
    const sampled = h.statuses.mock.calls.length;
    h.advance(10000);
    h.advance(10000);
    expect(h.simulation.tick).toBe(tick);
    expect(h.statuses).toHaveBeenCalledTimes(sampled);
    expect(packets()).toHaveLength(FESTIVAL_STATUS_CAPACITY);
    for (const sequence of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
      h.send({ type: 'statusAck', sequence });
      h.advance(1000);
    }
    expect(h.simulation.tick).toBe(tick);
    // Simulate a throttled timer: ACK arrives long before another pump ran.
    runtime.now += 90000;
    const first = packets()[0];
    ack(first);
    h.advance(9);
    expect(h.simulation.tick).toBe(tick + 1);
    expect(packets()).toHaveLength(FESTIVAL_STATUS_CAPACITY + 1);
    ack(first); // old duplicate cannot retire its newer replacement
    h.advance(1000);
    expect(h.simulation.tick).toBe(tick + 1);
  });

  it('rejects commands and init before mutation, while still neutralizing pause input', async () => {
    const h = await worker();
    h.fill();
    const player = h.simulation.player;
    const sampled = h.statuses.mock.calls.length;
    h.send({ type: 'command', command: { type: 'vehicle', id: 'tc1' }, requestId: 17 });
    expect(runtime.messages.at(-1)).toEqual({
      type: 'command-result',
      requestId: 17,
      error: 'Festival status delivery is busy. Please try again.',
    });
    h.send({ type: 'command', command: { type: 'traffic', value: true } });
    expect(runtime.messages.at(-1)).toMatchObject({ type: 'error', fatal: false });
    h.init();
    expect(runtime.messages.at(-1)).toMatchObject({ type: 'error', fatal: false });
    expect(h.commands).not.toHaveBeenCalled();
    expect(h.statuses).toHaveBeenCalledTimes(sampled);
    expect(h.simulation.player).toBe(player);
    const beforePause = structuredClone(h.simulation.status());
    const afterSampling = h.statuses.mock.calls.length;
    const frames = runtime.messages.filter((message) => message.type === 'frame').length;
    h.send({ type: 'input', input: { ...controls(), throttle: 1, shift: 1 } });
    for (let i = 0; i < 200; i++) h.send({ type: 'pause', value: true });
    expect(player.input.throttle).toBe(0);
    expect(player.input.shift).toBe(0);
    expect(h.statuses).toHaveBeenCalledTimes(afterSampling);
    expect(runtime.messages.filter((message) => message.type === 'frame')).toHaveLength(frames);
    expect(h.simulation.status()).toEqual(beforePause);
    expect(packets()).toHaveLength(FESTIVAL_STATUS_CAPACITY);
    ack(packets()[0]);
    const before = runtime.messages.length;
    h.send({ type: 'command', command: { type: 'traffic', value: true }, requestId: 18 });
    expect(h.commands).toHaveBeenCalledOnce();
    expect(runtime.messages.slice(before).map((message) => message.type)).toEqual([
      'frame',
      'status',
      'command-result',
    ]);
    expect(runtime.messages.at(-1)).toEqual({ type: 'command-result', requestId: 18 });
  });

  it('retains old receipt ownership across init without resetting the queue allowance', async () => {
    const h = await worker();
    const first = packets()[0];
    for (let i = 1; i < FESTIVAL_STATUS_CAPACITY - 1; i++) h.send({ type: 'pause', value: true });
    h.init();
    expect(packets()).toHaveLength(FESTIVAL_STATUS_CAPACITY);
    const latest = packets().at(-1)!;
    expect(latest.sequence).toBeGreaterThan(first.sequence);
    h.init();
    expect(packets()).toHaveLength(FESTIVAL_STATUS_CAPACITY);
    ack(first);
    h.init();
    expect(packets()).toHaveLength(FESTIVAL_STATUS_CAPACITY + 1);
    ack(first);
    h.init();
    expect(packets()).toHaveLength(FESTIVAL_STATUS_CAPACITY + 1);
  });

  it('keeps FIFO air, landing, pass, discovery and banked-chain transitions for the real observer', async () => {
    const h = await worker((sample, index) => {
      const skills = { ...sample.skills, label: '', sequence: index >= 62 ? 1 : 0 };
      if (index === 59) skills.air = { phase: 'airborne', seconds: 1.25, distance: 18 };
      if (index === 60) skills.label = 'CLEAN LANDING';
      if (index === 61) skills.label = 'CLEAN PASS';
      if (index >= 62) {
        skills.phase = 'banked';
        skills.lastBank = skills.bestChain = skills.sessionTotal = 400;
      }
      return { ...sample, discovered: index >= 62 ? ['retained-place'] : [], skills };
    });
    h.fill();
    h.advance(30000);
    const consumer = host();
    for (const packet of packets()) {
      consumer.instance.receive(packet);
      expect(consumer.delivered.at(-1)).toEqual({ type: 'statusAck', sequence: packet.sequence });
      ack(packet);
    }
    expect(consumer.events).toEqual([
      { type: 'festival.jump', airSeconds: 1.25, distance: 18 },
      { type: 'festival.cleanPass' },
      { type: 'festival.discovered', id: 'retained-place', total: 1 },
      { type: 'festival.chain', points: 400, bestChain: 400, sessionTotal: 400 },
    ]);
    expect(consumer.delivered).toHaveLength(FESTIVAL_STATUS_CAPACITY);
    expect(consumer.instance.fail).not.toHaveBeenCalled();
  });

  it('keeps normal 10 Hz cadence and command status-before-receipt when consumed', async () => {
    const h = await worker();
    ack(packets()[0]);
    h.send({ type: 'pause', value: false });
    for (let i = 0; i < 100; i++) {
      h.advance(100);
      ack(packets().at(-1)!);
    }
    expect(h.simulation.tick).toBe(1200);
    expect(packets()).toHaveLength(101);
    const before = runtime.messages.length;
    h.send({ type: 'command', command: { type: 'traffic', value: true }, requestId: 19 });
    expect(runtime.messages.slice(before).map((message) => message.type)).toEqual([
      'status',
      'command-result',
    ]);
    expect(runtime.messages.at(-1)).toEqual({ type: 'command-result', requestId: 19 });
  });

  it('allows outstanding acknowledgements after fatal execution but never resumes the failed world', async () => {
    const h = await worker();
    h.fill();
    ack(packets()[0]);
    h.commands.mockImplementationOnce(() => {
      throw new Error('Execution failed');
    });
    h.send({ type: 'command', command: { type: 'reset' }, requestId: 20 });
    expect(runtime.messages.at(-1)).toMatchObject({ type: 'error', fatal: true });
    const tick = h.simulation.tick;
    for (const packet of packets()) ack(packet);
    h.send({ type: 'pause', value: false });
    h.advance(10000);
    expect(h.simulation.tick).toBe(tick);
    const before = runtime.messages.length;
    h.init();
    expect(runtime.messages.slice(before).map((message) => message.type)).toEqual([
      'ready',
      'frame',
      'status',
    ]);
  });

  it('releases only the failed publication credit when status transport throws', async () => {
    const h = await worker();
    h.fill();
    ack(packets()[0]);
    runtime.failStatus = true;
    h.send({ type: 'pause', value: true });
    expect(runtime.messages.at(-1)).toMatchObject({
      type: 'error',
      fatal: true,
      message: 'Status transport failed',
    });
    const before = runtime.messages.length;
    h.init();
    expect(runtime.messages.slice(before).map((message) => message.type)).toEqual([
      'ready',
      'frame',
      'status',
    ]);
  });
});

describe('Festival status receipt host ownership', () => {
  it.each(['close', 'replace'] as const)(
    'never acknowledges after a consumer can %s its owner',
    (operation) => {
      const h = host();
      h.instance.achievements.observe = () => {
        if (operation === 'close') h.instance.disposed = true;
        else h.instance.worker = { postMessage: vi.fn() };
      };
      h.instance.receive({
        type: 'status',
        sequence: 1,
        status: { discovered: [] } as unknown as FestivalStatus,
      });
      expect(h.worker.postMessage).not.toHaveBeenCalled();
      expect(h.instance.worker.postMessage).not.toHaveBeenCalled();
    },
  );

  it('makes a consumer failure terminal without returning credit to the closed worker', () => {
    const h = host();
    const failure = new Error('Status consumer failed');
    h.instance.achievements.observe = () => {
      throw failure;
    };
    expect(() =>
      h.instance.receive({ type: 'status', sequence: 2, status: {} as FestivalStatus }),
    ).not.toThrow();
    expect(h.instance.fail).toHaveBeenCalledExactlyOnceWith(failure, true);
    expect(h.worker.postMessage).not.toHaveBeenCalled();
  });

  it('routes an acknowledgement transport failure into session failure', () => {
    const h = host();
    const failure = new Error('ACK transport failed');
    h.instance.achievements.observe = () => {};
    h.worker.postMessage.mockImplementation(() => {
      throw failure;
    });
    h.instance.receive({
      type: 'status',
      sequence: 3,
      status: { discovered: [] } as unknown as FestivalStatus,
    });
    expect(h.instance.fail).toHaveBeenCalledExactlyOnceWith(failure, true);
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects invalid receipt %s before consuming status',
    (sequence) => {
      const h = host();
      const observe = vi.spyOn(h.instance.achievements, 'observe');
      h.instance.receive({ type: 'status', sequence, status: {} as FestivalStatus });
      expect(h.instance.fail).toHaveBeenCalledOnce();
      expect(observe).not.toHaveBeenCalled();
      expect(h.worker.postMessage).not.toHaveBeenCalled();
    },
  );
});
