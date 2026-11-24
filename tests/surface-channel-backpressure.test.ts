import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import type { CourseTerrain } from '../src/simulation/offroad/course-terrain.ts';
import type { ClientMessage, SurfaceMessage, WorkerMessage } from '../src/workers/diagnostics.ts';
import { SurfaceChannel, SURFACE_TRANSPORT_MAX_PACKETS } from '../src/workers/surface-channel.ts';

function state(time = 1) {
  return {
    type: 'surface' as const,
    water: new Float32Array([time]),
    rubber: new Float32Array([0.2]),
    marbles: new Float32Array([0.3]),
    frozen: new Float32Array([0.4]),
    time,
  };
}

describe('surface ownership', () => {
  it('reserves before capture, retains old-epoch credits, and accepts every ACK only once', () => {
    const channel = new SurfaceChannel(2);
    const messages: SurfaceMessage[] = [];
    const capture = vi.fn((full: boolean) => ({
      ...state(),
      terrain: { blocks: new Float32Array([2, 0.1, 0.2]), wetness: 0.2, reset: full },
    }));
    const send = (message: SurfaceMessage, transfer: Transferable[]) => {
      messages.push(structuredClone(message, { transfer }));
      expect(message.water.byteLength).toBe(0);
      expect(message.terrain!.blocks.byteLength).toBe(0);
    };
    channel.reset(0, true);
    for (const tick of [60, 120]) {
      channel.request(tick);
      expect(channel.publish(tick, capture, send)).toBe(true);
    }
    for (let tick = 180; tick <= 6000; tick += 60) {
      channel.request(tick);
      expect(channel.publish(tick, capture, send)).toBe(false);
    }
    expect(capture).toHaveBeenCalledTimes(2);
    channel.reset(5000);
    channel.request(5000);
    expect(channel.publish(5000, capture, send)).toBe(false);
    const old = messages[0];
    for (const receipt of [
      { epoch: old.epoch + 1, sequence: old.sequence },
      { epoch: old.epoch, sequence: 9999 },
      { epoch: NaN, sequence: old.sequence },
      { epoch: old.epoch, sequence: 1.5 },
    ])
      expect(channel.acknowledge(receipt)).toBe(false);
    expect(channel.acknowledge(old)).toBe(true);
    expect(channel.publish(5000, capture, send)).toBe(true);
    expect(messages[2]).toMatchObject({
      epoch: old.epoch + 1,
      captureGap: true,
      terrain: { reset: true },
    });
    expect(channel.acknowledge(old)).toBe(false);
    channel.request(5060);
    expect(channel.publish(5060, capture, send)).toBe(false);
    expect(channel.acknowledge(messages[1])).toBe(true);
    expect(channel.publish(5120, capture, send)).toBe(true);
    expect(messages[3].captureGap).toBeUndefined(); // One honest warning per session.
    for (let i = 0; i < 10; i++) {
      channel.reset(0, true);
      channel.request(60);
      expect(channel.publish(60, capture, send)).toBe(false);
    }
    expect(capture).toHaveBeenCalledTimes(4);
  });

  it.each([false, true])(
    'recovers post failure without inventing credit (detached: %s)',
    (detach) => {
      const channel = new SurfaceChannel(1);
      channel.reset(0, true);
      let failed!: SurfaceMessage;
      const full: boolean[] = [];
      const capture = (reset: boolean) => {
        full.push(reset);
        return state();
      };
      channel.request(60);
      expect(() =>
        channel.publish(60, capture, (message, transfer) => {
          failed = detach ? structuredClone(message, { transfer }) : message;
          throw new Error('post failed');
        }),
      ).toThrow('post failed');
      const send = vi.fn();
      if (detach) {
        expect(channel.publish(60, capture, send)).toBe(false);
        expect(channel.acknowledge(failed)).toBe(true);
      } else expect(channel.acknowledge(failed)).toBe(false);
      expect(channel.publish(60, capture, send)).toBe(true);
      expect(full).toEqual([true, true]);
      expect(send.mock.calls[0][0].captureGap).toBeUndefined();
      expect(channel.acknowledge(failed)).toBe(false);
      channel.request(120);
      expect(channel.publish(120, capture, send)).toBe(false);
    },
  );

  it('does not let a throwing older publication revoke reentrant new-epoch ownership', () => {
    const channel = new SurfaceChannel(1);
    channel.reset(0, true);
    channel.request(60);
    let newer!: SurfaceMessage;
    expect(() =>
      channel.publish(
        60,
        () => state(),
        (older, transfer) => {
          const delivered = structuredClone(older, { transfer });
          expect(channel.acknowledge(delivered)).toBe(true);
          channel.reset(0, true);
          channel.request(60);
          expect(
            channel.publish(
              60,
              () => state(),
              (message, nestedTransfer) => {
                newer = structuredClone(message, { transfer: nestedTransfer });
              },
            ),
          ).toBe(true);
          throw new Error('old callback failed');
        },
      ),
    ).toThrow('old callback failed');
    expect(channel.pending).toBe(false);
    channel.request(120);
    expect(channel.publish(120, () => state(), vi.fn())).toBe(false);
    expect(channel.acknowledge(newer)).toBe(true);
    expect(channel.publish(120, () => state(), vi.fn())).toBe(true);
  });
});

/** Extract the complete production receiver and its production cancellation
 * predicate. No surface branch, ACK, or lifecycle check is copied into a test. */
function receiverFactory() {
  const source = ts.createSourceFile(
    'main.ts',
    readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
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
  const owner = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'GameApp',
  ) as ts.ClassDeclaration;
  const start = owner.members.find((node) => node.name?.getText(source) === 'start');
  if (!start) throw new Error('Missing production GameApp.start');
  visit(start);
  if (!cancelled || !receiver) throw new Error('Missing production receiver or cancellation');
  const code = ts.transpileModule(
    `function bind(generation) { const ${cancelled.getText(source)}; return ${receiver.getText(source)}; }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText;
  return new Function(`${code}; return bind;`)() as (
    this: object,
    generation: number,
  ) => (event: { data: WorkerMessage }) => void;
}

const bindReceiver = receiverFactory();
function hostFixture(ack: (message: ClientMessage) => void = () => undefined) {
  const order: string[] = [];
  const worker = {
    postMessage: vi.fn((message: ClientMessage) => {
      order.push('ack');
      ack(message);
    }),
  };
  const host = {
    generation: 1,
    disposed: false,
    errorStopped: false,
    worker,
    state: 'driving',
    liveSurface: null as unknown,
    recordingWarnings: [] as string[],
    replay: {
      recordSurface: vi.fn(() => {
        order.push('replay');
      }),
    },
    renderer: {
      circuit: {
        updateSurface: vi.fn(() => {
          order.push('render');
        }),
        offroad: {
          record: vi.fn(() => {
            order.push('terrain');
          }),
        },
      },
    },
    ui: {
      toast: vi.fn(() => {
        order.push('warning');
      }),
    },
    fail: vi.fn((_error: unknown) => {
      host.errorStopped = true;
    }),
  };
  return { host, worker, order, receive: bindReceiver.call(host, 1) };
}

describe('production host surface consumption', () => {
  it('records replay and terrain, then warns about a gap and ACKs the original packet', () => {
    const { host, worker, order, receive } = hostFixture();
    const message = { ...state(), epoch: 2, sequence: 17, captureGap: true };
    receive({ data: message });
    expect(order).toEqual(['replay', 'render', 'terrain', 'warning', 'ack']);
    expect(host.liveSurface).toMatchObject({ water: message.water, time: message.time });
    expect(host.recordingWarnings).toEqual([expect.stringContaining('Surface capture gap')]);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'surfaceAck',
      epoch: 2,
      sequence: 17,
    });
    order.length = 0;
    host.state = 'replay';
    receive({ data: { ...message, sequence: 18, captureGap: false } });
    expect(order).toEqual(['replay', 'terrain', 'ack']);
    expect(host.renderer.circuit.offroad.record).toHaveBeenLastCalledWith(undefined, 1, false);
  });

  it.each(['replay', 'render', 'terrain', 'warning'] as const)(
    'does not ACK or touch a replacement session after the %s callback cancels ownership',
    (stage) => {
      const { host, worker, order, receive } = hostFixture();
      const replacement = { postMessage: vi.fn() };
      const callback =
        stage === 'replay'
          ? host.replay.recordSurface
          : stage === 'render'
            ? host.renderer.circuit.updateSurface
            : stage === 'terrain'
              ? host.renderer.circuit.offroad.record
              : host.ui.toast;
      callback.mockImplementation(() => {
        order.push(stage);
        host.generation++;
        host.worker = replacement;
      });
      receive({ data: { ...state(), epoch: 1, sequence: 1, captureGap: true } });
      expect(order.at(-1)).toBe(stage);
      expect(worker.postMessage).not.toHaveBeenCalled();
      expect(replacement.postMessage).not.toHaveBeenCalled();
      expect(host.fail).not.toHaveBeenCalled();
    },
  );

  it('does not credit failed consumption or a failed ACK, and ignores queued late packets', () => {
    for (const stage of ['consume', 'ack'] as const) {
      const { host, worker, receive } = hostFixture();
      const failure = new Error(`${stage} failed`);
      if (stage === 'consume')
        host.renderer.circuit.offroad.record.mockImplementation(() => {
          throw failure;
        });
      else
        worker.postMessage.mockImplementation(() => {
          throw failure;
        });
      receive({ data: { ...state(), epoch: 1, sequence: 1 } });
      expect(host.fail).toHaveBeenCalledExactlyOnceWith(failure);
      const calls = worker.postMessage.mock.calls.length;
      receive({ data: { ...state(), epoch: 1, sequence: 2 } });
      expect(worker.postMessage).toHaveBeenCalledTimes(calls);
      expect(host.replay.recordSurface).toHaveBeenCalledTimes(1);
    }
    const { host, worker, receive } = hostFixture();
    host.replay.recordSurface.mockImplementation(() => {
      host.disposed = true;
    });
    receive({ data: { ...state(), epoch: 1, sequence: 3 } });
    expect(host.renderer.circuit.updateSurface).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();
  });
});

function authoritativeTerrain(terrain: CourseTerrain) {
  const blocks = new Set<number>();
  // Inspect the accumulated set without consuming it through renderDelta.
  const dirty = (terrain as unknown as { readonly dirty: Iterable<number> }).dirty;
  for (const cell of dirty)
    blocks.add(
      (Math.floor(cell / terrain.columns) >> 1) * terrain.renderColumns +
        (cell % terrain.columns >> 1),
    );
  const result = new Map<number, [number, number]>();
  const sample = { depth: 0, compaction: 0 };
  for (const block of blocks) {
    terrain.renderBlock(block, sample);
    result.set(block, [Math.fround(sample.depth), Math.fround(sample.compaction)]);
  }
  return result;
}

describe('real circuit worker surface backpressure', () => {
  const messages: WorkerMessage[] = [];
  const detached: Float32Array[] = [];
  let now = 0;
  let pump: () => void;
  let current!: Simulation;
  const observeSimulation = (simulation: Simulation) => {
    current = simulation;
  };
  let consume: ((message: SurfaceMessage) => void) | undefined;
  let failNextSurface = false;
  const scope = {
    onmessage: null as ((event: { data: ClientMessage }) => void) | null,
    postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
      if (message.type === 'surface' && failNextSurface) {
        failNextSurface = false;
        throw new Error('surface post failed');
      }
      const copy = structuredClone(message, { transfer });
      messages.push(copy);
      if (message.type === 'surface') {
        detached.push(message.water, message.rubber, message.marbles);
        if (message.frozen) detached.push(message.frozen);
        if (message.terrain) detached.push(message.terrain.blocks);
        consume?.(copy as SurfaceMessage);
      }
    },
  };
  const send = (data: ClientMessage) => scope.onmessage!({ data });
  const ack = (message: SurfaceMessage) =>
    send({
      type: 'surfaceAck',
      epoch: message.epoch,
      sequence: message.sequence,
    });
  const packets = () =>
    messages.filter((message): message is SurfaceMessage => message.type === 'surface');
  const advance = (milliseconds: number) => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
      now += 100;
      pump();
    }
  };
  const init = (overrides: Partial<SessionOptions> = {}) =>
    send({
      type: 'init',
      options: { ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0, seed: 71010, ...overrides },
    });
  beforeAll(async () => {
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('self', scope);
    vi.stubGlobal('setInterval', (callback: () => void) => {
      pump = callback;
      return 1;
    });
    const original = Simulation.prototype.writeFrame;
    vi.spyOn(Simulation.prototype, 'writeFrame').mockImplementation(function (
      this: Simulation,
      ...args
    ) {
      observeSimulation(this);
      return original.apply(this, args);
    });
    // One real graph for the entire file: reinitialize through the wire protocol.
    await import('../src/workers/physics.worker.ts');
  });
  beforeEach(() => {
    failNextSurface = false;
    consume = ack;
    for (const message of messages) if (message.type === 'surface') ack(message);
    consume = undefined;
    messages.length = detached.length = 0;
    now += 1000;
    init();
  });
  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps every normal 60-tick surface and frozen field through the actual host ACK path', () => {
    init({ weather: 'snow' });
    const fixture = hostFixture(send);
    consume = (message) => {
      expect(message.water).toEqual(current.track.water);
      expect(message.rubber).toEqual(current.track.rubber);
      expect(message.marbles).toEqual(current.track.marbles);
      expect(message.frozen).toEqual(current.track.frozen);
      fixture.receive({ data: message });
    };
    send({ type: 'pause', value: false });
    advance(12000);
    const surfaces = packets();
    expect(surfaces).toHaveLength(24);
    for (let i = 1; i < surfaces.length; i++)
      expect(surfaces[i].time - surfaces[i - 1].time).toBeCloseTo(0.5, 8);
    expect(surfaces.every((message) => !message.captureGap)).toBe(true);
    expect(fixture.worker.postMessage).toHaveBeenCalledTimes(24);
    expect(detached.every((array) => array.byteLength === 0)).toBe(true);
    expect(messages.filter((message) => message.type === 'error')).toEqual([]);
  });

  it('bounds every unacknowledged byte and allocation, then restores the exact paused latest state', () => {
    init({ weather: 'snow' });
    const slices = [
      current.track.water,
      current.track.rubber,
      current.track.marbles,
      current.track.frozen,
    ].map((array) => vi.spyOn(array, 'slice'));
    send({ type: 'pause', value: false });
    advance((SURFACE_TRANSPORT_MAX_PACKETS + 8) * 500);
    expect(packets()).toHaveLength(SURFACE_TRANSPORT_MAX_PACKETS);
    expect(slices.every((slice) => slice.mock.calls.length === SURFACE_TRANSPORT_MAX_PACKETS)).toBe(
      true,
    );
    const bytes = packets().reduce(
      (sum, packet) =>
        sum +
        packet.water.byteLength +
        packet.rubber.byteLength +
        packet.marbles.byteLength +
        packet.frozen!.byteLength,
      0,
    );
    expect(bytes).toBe(SURFACE_TRANSPORT_MAX_PACKETS * 512 * 7 * 4 * 4);
    advance(5000);
    expect(packets()).toHaveLength(SURFACE_TRANSPORT_MAX_PACKETS);
    expect(slices.every((slice) => slice.mock.calls.length === SURFACE_TRANSPORT_MAX_PACKETS)).toBe(
      true,
    );
    send({ type: 'pause', value: true, sequence: 1 });
    const receipt = messages.at(-1)!;
    expect(receipt).toMatchObject({ type: 'pauseState', value: true, tick: current.tick });
    expect(current.tick).toBeGreaterThan(SURFACE_TRANSPORT_MAX_PACKETS * 60);
    const first = packets()[0];
    send({ type: 'surfaceAck', epoch: first.epoch + 1, sequence: first.sequence });
    send({ type: 'surfaceAck', epoch: first.epoch, sequence: first.sequence + 10000 });
    expect(packets()).toHaveLength(SURFACE_TRANSPORT_MAX_PACKETS);
    ack(first);
    const latest = packets().at(-1)!;
    expect(latest.time).toBe(current.race.time);
    expect(latest.captureGap).toBe(true);
    expect(latest.water).toEqual(current.track.water);
    expect(latest.rubber).toEqual(current.track.rubber);
    expect(latest.marbles).toEqual(current.track.marbles);
    expect(latest.frozen).toEqual(current.track.frozen);
    ack(first);
    ack(first);
    send({ type: 'pause', value: false });
    advance(2000);
    expect(packets()).toHaveLength(SURFACE_TRANSPORT_MAX_PACKETS + 1);
    ack(packets()[1]);
    expect(packets()).toHaveLength(SURFACE_TRANSPORT_MAX_PACKETS + 2);
    expect(packets().at(-1)!.captureGap).toBeUndefined();
    expect(messages.filter((message) => message.type === 'error')).toEqual([]);
    slices.forEach((slice) => slice.mockRestore());
  });

  it('retains all terrain deltas and bounds init and flashback rebases across old ACK ownership', () => {
    init({ circuit: 'valley-ridge-mx', vehicles: ['mx450'] });
    send({ type: 'autopilot', value: true });
    const terrain = current.offroad!.terrain;
    const exports = vi.spyOn(terrain, 'renderDelta');
    send({ type: 'pause', value: false });
    advance(SURFACE_TRANSPORT_MAX_PACKETS * 500);
    const oldPackets = packets().slice();
    expect(oldPackets).toHaveLength(SURFACE_TRANSPORT_MAX_PACKETS);
    const rendered = new Map<number, [number, number]>();
    const apply = (packet: SurfaceMessage) => {
      const delta = packet.terrain!;
      if (delta.reset) rendered.clear();
      for (let i = 0; i < delta.blocks.length; i += 3)
        rendered.set(delta.blocks[i], [delta.blocks[i + 1], delta.blocks[i + 2]]);
    };
    oldPackets.forEach(apply);
    terrain.deform(0, 30, 4000, 1, 0.1);
    advance(1000);
    terrain.deform(1, 130, 4000, 1, 0.1);
    advance(1000);
    expect(exports).toHaveBeenCalledTimes(SURFACE_TRANSPORT_MAX_PACKETS);
    expect(terrain.changed.size).toBeGreaterThan(0);
    send({ type: 'pause', value: true });
    ack(oldPackets[0]);
    const recovered = packets().at(-1)!;
    expect(recovered.terrain!.reset).toBe(false);
    expect(recovered.captureGap).toBe(true);
    apply(recovered);
    expect(rendered).toEqual(authoritativeTerrain(terrain));
    exports.mockRestore();

    const beforeInit = packets().length;
    init({ circuit: 'valley-ridge-mx', vehicles: ['mx450'] });
    send({ type: 'pause', value: false });
    advance(2000);
    expect(packets()).toHaveLength(beforeInit);
    ack(recovered); // A late old-epoch ACK frees only its own outstanding credit.
    const initialized = packets().at(-1)!;
    expect(initialized.epoch).toBeGreaterThan(recovered.epoch);
    expect(initialized.terrain!.reset).toBe(true);
    apply(initialized);
    expect(rendered).toEqual(authoritativeTerrain(current.offroad!.terrain));
    ack(recovered); // A duplicate cannot supply capacity for the rewind rebase.

    const target = current.tick - 60;
    send({ type: 'flashback', tick: target });
    const beforeFinish = messages.length;
    advance(100);
    expect(messages.slice(beforeFinish).some((message) => message.type === 'flashback')).toBe(
      false,
    );
    expect(packets()).toHaveLength(beforeInit + 1);
    advance(1000);
    expect(packets()).toHaveLength(beforeInit + 1);
    const beforeAck = messages.length;
    ack(oldPackets[1]);
    const completion = messages.slice(beforeAck);
    expect(completion.map((message) => message.type)).toEqual(['flashback', 'surface', 'frame']);
    expect(completion[0]).toMatchObject({ type: 'flashback', tick: target });
    const rewound = completion[1] as SurfaceMessage;
    expect(rewound.epoch).toBeGreaterThan(initialized.epoch);
    expect(rewound.terrain!.reset).toBe(true);
    expect(rewound.time).toBe(current.race.time);
    apply(rewound);
    expect(rendered).toEqual(authoritativeTerrain(current.offroad!.terrain));
    const frame = completion[2];
    if (frame.type !== 'frame') throw new Error('Missing flashback frame');
    expect(new Float32Array(frame.buffer)[H.TICK]).toBe(target);
    expect(messages.filter((message) => message.type === 'error')).toEqual([]);
  });

  it('rebases real terrain after a failed post consumed its incremental change set', () => {
    init({ circuit: 'valley-ridge-mx', vehicles: ['mx450'] });
    send({ type: 'pause', value: false });
    advance(500);
    const first = packets()[0];
    current.offroad!.terrain.deform(0, 30, 4000, 1, 0.1);
    failNextSurface = true;
    advance(500);
    expect(packets()).toHaveLength(1);
    expect(messages.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('surface post failed'),
    });
    expect(current.offroad!.terrain.changed.size).toBe(0);
    ack(first);
    const recovery = packets().at(-1)!;
    expect(packets()).toHaveLength(2);
    expect(recovery.terrain!.reset).toBe(true);
    const blocks = recovery.terrain!.blocks;
    const restored = new Map<number, [number, number]>();
    for (let i = 0; i < blocks.length; i += 3)
      restored.set(blocks[i], [blocks[i + 1], blocks[i + 2]]);
    expect(restored).toEqual(authoritativeTerrain(current.offroad!.terrain));
    expect(recovery.time).toBe(current.race.time);
  });
});
