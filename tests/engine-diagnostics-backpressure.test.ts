import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPTIONS, controls } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import { MATERIAL, MATERIALS } from '../src/simulation/surface-material.ts';
import {
  EngineeringProbe,
  isEngineeringSample,
  type ClientMessage,
  type EngineeringMessage,
  type EngineeringSample,
  type WorkerMessage,
} from '../src/workers/diagnostics.ts';

const options = {
  ...DEFAULT_OPTIONS,
  mode: 'practice' as const,
  opponents: 0,
  seed: 72020,
};
let now = 0;
let pump: () => void;
let simulation: Simulation;
let postFailure: Error | undefined;
const messages: WorkerMessage[] = [];
const scope = {
  onmessage: null as ((event: { data: ClientMessage }) => void) | null,
  postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
    if (message.type === 'engineering' && postFailure) throw postFailure;
    messages.push(structuredClone(message, { transfer }));
  },
};
const send = (data: ClientMessage) => scope.onmessage!({ data: structuredClone(data) });
const samples = () =>
  messages.filter((message): message is EngineeringMessage => message.type === 'engineering');
const acknowledge = (message: Pick<EngineeringMessage, 'epoch' | 'sequence'>) =>
  send({ type: 'engineeringAck', epoch: message.epoch, sequence: message.sequence });
function advance(batches: number) {
  for (let i = 0; i < batches; i++) {
    send({ type: 'input', input: { ...controls(), brake: 0.4 } });
    now += 100;
    pump();
  }
}
function observeSimulation(value: Simulation) {
  simulation = value;
}

beforeAll(async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const writeFrame = Simulation.prototype.writeFrame;
  vi.spyOn(Simulation.prototype, 'writeFrame').mockImplementation(function (
    this: Simulation,
    ...args
  ) {
    observeSimulation(this);
    return writeFrame.apply(this, args);
  });
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    pump = callback;
    return 1;
  });
  await import('../src/workers/physics.worker.ts');
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the actual physics worker engineering transport', () => {
  beforeEach(() => {
    postFailure = undefined;
    send({ type: 'engineering', enabled: false });
    for (const message of samples()) acknowledge(message);
    messages.length = 0;
    now += 1000;
    send({ type: 'init', options });
  });
  it('keeps one immutable copied sample while physics advances and does not construct discarded samples', () => {
    const capture = vi.spyOn(EngineeringProbe.prototype, 'sample');
    try {
      send({ type: 'engineering', enabled: true });
      const first = samples()[0];
      const saved = structuredClone(first);
      send({ type: 'pause', value: false });
      advance(30);
      expect(simulation.tick).toBe(360);
      expect(samples()).toEqual([saved]);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(messages.filter((message) => message.type === 'frame')).toHaveLength(5);
      acknowledge(first);
      const second = samples()[1];
      expect(second.sample.tick).toBe(360);
      expect(second.sequence).toBeGreaterThan(first.sequence);
      expect(capture).toHaveBeenCalledTimes(2);
      acknowledge(first);
      acknowledge({ ...second, epoch: second.epoch + 1 });
      acknowledge({ ...second, sequence: second.sequence + 1 });
      acknowledge({ ...second, sequence: NaN });
      advance(10);
      expect(samples()).toHaveLength(2);
      expect(capture).toHaveBeenCalledTimes(2);
      expect(first).toEqual(saved);
      acknowledge(second);
      expect(samples()[2].sample.tick).toBe(480);
      expect(messages.filter((message) => message.type === 'error')).toEqual([]);
    } finally {
      capture.mockRestore();
    }
  });

  it('does not bypass the outstanding credit through repeated toggles, fresh init or late receipts', () => {
    send({ type: 'engineering', enabled: true });
    const first = samples()[0];
    const capture = vi.spyOn(EngineeringProbe.prototype, 'sample');
    try {
      for (let i = 0; i < 100; i++) {
        send({ type: 'engineering', enabled: false });
        send({ type: 'engineering', enabled: true });
      }
      send({ type: 'init', options });
      send({ type: 'engineering', enabled: true });
      send({ type: 'pause', value: false });
      advance(3);
      expect(samples()).toHaveLength(1);
      expect(capture).not.toHaveBeenCalled();
      acknowledge(first);
      const second = samples()[1];
      expect(second.epoch).toBeGreaterThan(first.epoch);
      expect(second.sample.tick).toBe(36);
      acknowledge(first);
      advance(3);
      expect(samples()).toHaveLength(2);
      acknowledge(second);
      expect(samples()[2].sample.tick).toBe(72);
    } finally {
      capture.mockRestore();
    }
  });

  it('retires a held packet while disabled without publishing, then resumes fresh inspection on enable', () => {
    send({ type: 'engineering', enabled: true });
    const first = samples()[0];
    send({ type: 'engineering', enabled: false });
    send({ type: 'pause', value: false });
    advance(3);
    acknowledge(first);
    expect(samples()).toHaveLength(1);
    send({ type: 'engineering', enabled: true });
    expect(samples()[1].sample.tick).toBe(36);
    expect(samples()[1].epoch).toBeGreaterThan(first.epoch);
  });

  it('rebases flashback inspection after the held ACK without another enable', () => {
    send({ type: 'engineering', enabled: true });
    const first = samples()[0];
    send({ type: 'pause', value: false });
    advance(3);
    send({ type: 'flashback', tick: 12 });
    now += 4;
    pump();
    expect(simulation.tick).toBe(12);
    expect(samples()).toHaveLength(1);
    acknowledge(first);
    expect(samples()).toHaveLength(2);
    expect(samples()[1].sample.tick).toBe(12);
    expect(samples()[1].epoch).toBeGreaterThan(first.epoch);
    acknowledge(first);
    expect(samples()).toHaveLength(2);
    expect(messages.filter((message) => message.type === 'error')).toEqual([]);
  });

  it('releases a rejected publication and restores inspection only after fresh initialization', () => {
    postFailure = new Error('engineering post rejected');
    send({ type: 'engineering', enabled: true });
    expect(samples()).toHaveLength(0);
    expect(messages.at(-1)).toEqual({ type: 'error', message: postFailure.message });
    postFailure = undefined;
    send({ type: 'engineering', enabled: true });
    expect(samples()).toHaveLength(0);
    send({ type: 'init', options });
    send({ type: 'engineering', enabled: true });
    expect(samples()).toHaveLength(1);
  });

  it('accepts the real mx450 dirt contacts at startup and after the first twelve physics ticks', () => {
    send({
      type: 'init',
      options: { ...options, circuit: 'valley-ridge-mx', vehicles: ['mx450'] },
    });
    send({ type: 'engineering', enabled: true });
    const first = samples()[0];
    expect(first.sample.tick).toBe(0);
    expect(first.sample.wheels.map((wheel) => wheel.surface)).toEqual(Array(4).fill(MATERIAL.DIRT));
    expect(isEngineeringSample(first.sample)).toBe(true);
    send({ type: 'pause', value: false });
    advance(1);
    acknowledge(first);
    const second = samples()[1];
    expect(second.sample.tick).toBe(12);
    expect(second.sample.wheels.map((wheel) => wheel.surface)).toEqual(
      Array(4).fill(MATERIAL.DIRT),
    );
    expect(isEngineeringSample(second.sample)).toBe(true);
    expect(messages.filter((message) => message.type === 'error')).toEqual([]);
  });
});

/** Execute the complete production receiver, cancellation predicate and fatal
 * cleanup method. Renderer setters and Worker.postMessage are callback seams;
 * no acknowledgement/ownership branch is reproduced by this fixture. */
function receiverPrototype() {
  const source = ts.createSourceFile(
    'main.ts',
    readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'GameApp',
  );
  if (!owner) throw new Error('Missing GameApp');
  const member = (name: string) => {
    const value = owner.members.find((node) => node.name?.getText(source) === name);
    if (!value) throw new Error('Missing GameApp.' + name);
    return value;
  };
  let cancelled: ts.VariableDeclaration | undefined;
  let receiver: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'cancelled')
      cancelled = node;
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText(source) === 'this.worker.onmessage' &&
      ts.isArrowFunction(node.right)
    )
      receiver = node.right;
    ts.forEachChild(node, visit);
  };
  visit(member('start'));
  if (!cancelled || !receiver) throw new Error('Missing production receiver');
  const code = ts.transpileModule(
    `class Host { bind(generation) { const ${cancelled.getText(source)}; return ${receiver.getText(source)}; } ${member('fail').getText(source)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return new Function('H', 'isEngineeringSample', code + '; return Host.prototype;')(
    H,
    isEngineeringSample,
  ) as object;
}
const hostPrototype = receiverPrototype();
interface Host {
  generation: number;
  errorStopped: boolean;
  disposed: boolean;
  worker: { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> } | null;
  renderer: { engineering: EngineeringSample | null } | null;
  ui: { error: ReturnType<typeof vi.fn> };
  bind(generation: number): (event: { data: WorkerMessage }) => void;
}
function hostFixture() {
  const order: string[] = [];
  const hooks: { consume?: () => void; acknowledge?: () => void } = {};
  const worker = {
    postMessage: vi.fn((_message: ClientMessage) => {
      order.push('ack');
      hooks.acknowledge?.();
    }),
    terminate: vi.fn(() => order.push('terminate')),
  };
  const host: Host = Object.assign(Object.create(hostPrototype) as Host, {
    generation: 1,
    errorStopped: false,
    disposed: false,
    circuitStartup: null,
    initTimeout: 0,
    worker,
    renderer: {
      set engineering(_value: EngineeringSample | null) {
        order.push('consume');
        hooks.consume?.();
      },
    },
    ui: { error: vi.fn() },
  });
  const packet: EngineeringMessage = {
    type: 'engineering',
    epoch: 1,
    sequence: 1,
    sample: {
      time: 0,
      tick: 0,
      car: 0,
      aiActive: false,
      targetSpeedMps: 0,
      targetOffsetM: 0,
      decision: 'MANUAL INPUT / AI INACTIVE',
      wheels: Array.from({ length: 4 }, () => ({
        origin: [0, 0, 0],
        contact: [0, 0, 0],
        normal: [0, 1, 0],
        loadN: 0,
        surface: 0,
        cell: 0,
        rubber: 0,
        marbles: 0,
      })),
    },
  };
  return { host, worker, order, hooks, packet, receive: host.bind(1) };
}

describe('production host engineering ownership', () => {
  afterEach(() => vi.mocked(console.error).mockRestore?.());

  it.each([true, false])(
    'acknowledges after optional renderer consumption (renderer=%s)',
    (renderer) => {
      const f = hostFixture();
      if (!renderer) f.host.renderer = null;
      f.receive({ data: f.packet });
      expect(f.order).toEqual(renderer ? ['consume', 'ack'] : ['ack']);
      expect(f.worker.postMessage).toHaveBeenCalledExactlyOnceWith({
        type: 'engineeringAck',
        epoch: 1,
        sequence: 1,
      });
    },
  );

  it('preserves a thrown consumer error and terminates without granting retired credit', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = hostFixture();
    const failure = new Error('renderer rejected sample');
    f.hooks.consume = () => {
      throw failure;
    };
    f.receive({ data: f.packet });
    expect(f.order).toEqual(['consume', 'terminate']);
    expect(f.host.errorStopped).toBe(true);
    expect(f.worker.postMessage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(failure);
    expect(f.host.ui.error).toHaveBeenCalledExactlyOnceWith(failure.message);
    f.receive({ data: f.packet });
    expect(f.order).toEqual(['consume', 'terminate']);
  });

  it.each(['replace', 'dispose', 'generation'] as const)(
    'withholds credit after a consumer causes %s',
    (departure) => {
      const f = hostFixture();
      const successor = { postMessage: vi.fn(), terminate: vi.fn() };
      f.hooks.consume = () => {
        if (departure === 'replace') f.host.worker = successor;
        else if (departure === 'dispose') f.host.disposed = true;
        else f.host.generation++;
      };
      f.receive({ data: f.packet });
      expect(f.order).toEqual(['consume']);
      expect(f.worker.postMessage).not.toHaveBeenCalled();
      expect(successor.postMessage).not.toHaveBeenCalled();
    },
  );

  it.each(['epoch', 'sequence', 'sample', 'surface'] as const)(
    'fails malformed %s before consumption or ACK',
    (fault) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const f = hostFixture();
      if (fault === 'sample') f.packet.sample.wheels[0].normal[0] = NaN;
      else if (fault === 'surface') f.packet.sample.wheels[0].surface = 12;
      else f.packet[fault] = 0;
      f.receive({ data: f.packet });
      expect(f.order).toEqual(['terminate']);
      expect(f.host.ui.error).toHaveBeenCalledExactlyOnceWith('Invalid engineering response');
      expect(f.worker.postMessage).not.toHaveBeenCalled();
    },
  );

  it('recognizes the declared material domain and rejects values outside it', () => {
    const sample = hostFixture().packet.sample;
    for (const material of MATERIALS) {
      sample.wheels[0].surface = material.id;
      expect(isEngineeringSample(sample), material.name).toBe(true);
    }
    for (const value of [-1, 0.5, 12, NaN, Infinity, -Infinity]) {
      sample.wheels[0].surface = value;
      expect(isEngineeringSample(sample), String(value)).toBe(false);
    }
  });

  it('handles an acknowledgement transport failure through the same terminal lifecycle', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = hostFixture();
    const failure = new Error('ACK transport failed');
    f.hooks.acknowledge = () => {
      throw failure;
    };
    f.receive({ data: f.packet });
    expect(f.order).toEqual(['consume', 'ack', 'terminate']);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(failure);
    expect(f.host.ui.error).toHaveBeenCalledExactlyOnceWith(failure.message);
  });
});
