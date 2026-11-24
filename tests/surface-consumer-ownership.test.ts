import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerReadiness } from '../src/session/worker-readiness.ts';
import { H } from '../src/simulation/protocol.ts';
import type { TerrainRenderDelta } from '../src/simulation/offroad/course-terrain.ts';
import {
  SessionReplay,
  type ReplayPageStore,
  type SurfaceRecord,
} from '../src/storage/replay-pages.ts';
import type { ClientMessage, SurfaceMessage, WorkerMessage } from '../src/workers/diagnostics.ts';
import { SurfaceChannel } from '../src/workers/surface-channel.ts';

/** Execute the complete production receiver/cancellation predicate, recording
 * notification and failure method. No ACK or host ownership branch is copied.
 * The selected terrain method retains real keyframes without constructing a
 * renderer, venue mesh or authored asset. Other UI/render services are explicit
 * callback boundaries, not a claim of native graphics execution. */
function production() {
  function source(path: string, className: string) {
    const file = ts.createSourceFile(
      path,
      readFileSync(new URL(path, import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const owner = file.statements.find(
      (node): node is ts.ClassDeclaration =>
        ts.isClassDeclaration(node) && node.name?.text === className,
    );
    if (!owner) throw new Error('Missing production class ' + className);
    const member = (name: string) => {
      const node = owner.members.find((item) => item.name?.getText(file) === name);
      if (!node) throw new Error('Missing production member ' + className + '.' + name);
      return node;
    };
    return { file, member };
  }
  const main = source('../src/main.ts', 'GameApp');
  const declarations: ts.VariableDeclaration[] = [];
  const receivers: ts.ArrowFunction[] = [];
  const notifications: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(main.file) === 'cancelled')
      declarations.push(node);
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText(main.file) === 'this.worker.onmessage' &&
      ts.isArrowFunction(node.right)
    )
      receivers.push(node.right);
    if (ts.isNewExpression(node) && node.expression.getText(main.file) === 'SessionReplay') {
      const notify = node.arguments?.[2];
      if (!notify || !ts.isArrowFunction(notify))
        throw new Error('Missing production replay notification');
      notifications.push(notify);
    }
    ts.forEachChild(node, visit);
  };
  visit(main.member('start'));
  if (declarations.length !== 1 || receivers.length !== 1 || notifications.length !== 1)
    throw new Error('Expected one complete receiver, predicate and recording notification');
  const hostCode = ts.transpileModule(
    'class Host {' +
      'bind(generation) { const ' +
      declarations[0].getText(main.file) +
      '; return ' +
      receivers[0].getText(main.file) +
      '; } notification(generation) { return ' +
      notifications[0].getText(main.file) +
      '; } ' +
      main.member('fail').getText(main.file) +
      '}',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const terrain = source('../src/rendering/offroad/terrain-view.ts', 'TerrainView');
  const terrainCode = ts.transpileModule(
    'class Terrain { ' + terrain.member('record').getText(terrain.file) + ' }',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return {
    host: new Function('H', 'isEngineeringSample', hostCode + '; return Host.prototype;')(H, () => {
      throw new Error('Unselected engineering branch');
    }) as object,
    terrain: new Function(terrainCode + '; return Terrain.prototype;')() as object,
  };
}

const selected = production();
type Stage = 'render' | 'terrain' | 'warning';
type Packet = Omit<SurfaceMessage, 'epoch' | 'sequence' | 'captureGap'>;
type Receipt = Extract<ClientMessage, { type: 'surfaceAck' }>;
interface Worker {
  postMessage(message: ClientMessage): void;
  terminate(): void;
}
interface Terrain {
  history: { time: number; delta: TerrainRenderDelta }[];
  shown: number;
  showLive(): void;
  record(delta: TerrainRenderDelta | undefined, time: number, live: boolean): void;
}
interface Host extends Record<string, unknown> {
  generation: number;
  errorStopped: boolean;
  disposed: boolean;
  worker: Worker;
  circuitStartup: WorkerReadiness | null;
  state: string;
  liveSurface: unknown;
  recordingWarnings: string[];
  replay: SessionReplay;
  renderer: {
    circuit: {
      updateSurface(...values: (Float32Array | undefined)[]): void;
      offroad: { record(delta: TerrainRenderDelta | undefined, time: number, live: boolean): void };
    };
  };
  ui: { toast(message: string): void; error(message: string): void };
  bind(generation: number): (event: { data: WorkerMessage }) => void;
  notification(generation: number): (message: string) => void;
  fail(error: unknown): void;
}

const cleanup: (() => Promise<void>)[] = [];
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.restoreAllMocks();
});

function packet(time: number, full = false): Packet {
  return {
    type: 'surface',
    time,
    water: new Float32Array([1, 2]),
    rubber: new Float32Array([1, 0]),
    marbles: new Float32Array([0, 1]),
    frozen: new Float32Array([8, 0]),
    terrain: {
      blocks: new Float32Array([1, 0.125, 0.5]),
      wetness: 0.25,
      reset: full,
    },
  };
}

function fixture() {
  const channel = new SurfaceChannel(1);
  channel.reset(0, true);
  const order: string[] = [];
  const hooks: Partial<Record<Stage, () => void>> = {};
  const accepted: Receipt[] = [];
  const delivered: SurfaceMessage[] = [];
  const sent: Packet[] = [];
  const renderValues: (Float32Array | undefined)[][] = [];
  let ackFailure: Error | undefined;
  const gate = new WorkerReadiness(1);
  const ready = gate.ready.catch((error: unknown) => error);
  const terrain = Object.assign(Object.create(selected.terrain) as Terrain, {
    history: [] as Terrain['history'],
    shown: -1,
    showLive: vi.fn(),
  });
  const worker: Worker = {
    postMessage: vi.fn((message: ClientMessage) => {
      order.push('ack');
      if (message.type !== 'surfaceAck') throw new Error('Unexpected host publication');
      if (ackFailure) throw ackFailure;
      if (!channel.acknowledge(message)) throw new Error('Host acknowledged unowned surface');
      accepted.push(message);
    }),
    terminate: vi.fn(() => order.push('terminate')),
  };
  const host = Object.assign(Object.create(selected.host) as Host, {
    generation: 1,
    disposed: false,
    errorStopped: false,
    worker,
    circuitStartup: gate,
    initTimeout: 0,
    state: 'driving',
    liveSurface: null,
    recordingWarnings: [] as string[],
    referenceSession: { interrupt: vi.fn() },
    sessionReview: { stop: vi.fn() },
    tabEvidence: { observe: vi.fn() },
    performanceCapture: { interrupt: vi.fn() },
    interruptReview: vi.fn(),
    festivalOwner: { cancel: vi.fn() },
    endDemoClock: vi.fn(),
    input: { setEnabled: vi.fn() },
    audio: { stop: vi.fn() },
    renderer: {
      circuit: {
        updateSurface: vi.fn((...values: (Float32Array | undefined)[]) => {
          order.push('render');
          renderValues.push(values);
          hooks.render?.();
        }),
        offroad: {
          record: vi.fn((delta: TerrainRenderDelta | undefined, time: number, live: boolean) => {
            order.push('terrain');
            terrain.record(delta, time, live);
            hooks.terrain?.();
          }),
        },
      },
    },
    ui: {
      toast: vi.fn((_message: string) => {
        order.push('warning');
        hooks.warning?.();
      }),
      error: vi.fn((_message: string) => order.push('error')),
    },
  });
  const store: ReplayPageStore = {
    put: async () => {
      throw new Error('No frame pages should be written by this surface fixture');
    },
    get: async () => {
      throw new Error('No frame pages should be read by this surface fixture');
    },
    dispose: vi.fn(async () => undefined),
  };
  const replay = (host.replay = new SessionReplay(1, store, host.notification(1)));
  const record = replay.recordSurface.bind(replay);
  vi.spyOn(replay, 'recordSurface').mockImplementation((...args) => {
    order.push('replay');
    record(...args);
  });
  const receive = host.bind(1);
  const send = (message: SurfaceMessage, transfer: Transferable[]) => {
    const copy = structuredClone(message, { transfer });
    delivered.push(copy);
    receive({ data: copy });
  };
  const publish = (tick: number, options: { gap?: boolean; invalid?: boolean } = {}) => {
    channel.request(options.gap ? tick - 1 : tick);
    return channel.publish(
      tick,
      (full) => {
        const value = packet(tick / 120, full);
        if (options.invalid) value.water[0] = NaN;
        sent.push(value);
        return value;
      },
      send,
    );
  };
  cleanup.push(async () => {
    gate.close();
    await ready;
    await replay.dispose();
  });
  return {
    channel,
    host,
    worker,
    gate,
    ready,
    replay,
    terrain,
    store,
    hooks,
    order,
    accepted,
    delivered,
    sent,
    renderValues,
    publish,
    receive,
    send,
    failAck(error: Error) {
      ackFailure = error;
    },
  };
}

function records(replay: SessionReplay) {
  return (replay as unknown as { readonly current: { readonly surfaces: SurfaceRecord[] } }).current
    .surfaces;
}

describe('surface consumers across actual transport, recording and lifetime owners', () => {
  it.each(['driving', 'replay'])(
    'retains receiver-owned live/terrain data and immutable replay captures after ACK in %s',
    (mode) => {
      const f = fixture();
      f.host.state = mode;
      for (const tick of [60, 120, 180]) expect(f.publish(tick)).toBe(true);
      expect(f.accepted).toHaveLength(3);
      const expectedOrder =
        mode === 'driving' ? ['replay', 'render', 'terrain', 'ack'] : ['replay', 'terrain', 'ack'];
      expect(f.order).toEqual([...expectedOrder, ...expectedOrder, ...expectedOrder]);
      expect(f.sent.every((state) => state.water.byteLength === 0)).toBe(true);
      expect(f.sent.every((state) => state.terrain!.blocks.byteLength === 0)).toBe(true);
      expect(f.delivered.map((state) => state.water.byteLength)).toEqual([8, 8, 8]);
      expect(f.terrain.history.map((entry) => entry.delta.blocks.byteLength)).toEqual([12, 12, 12]);
      expect(f.terrain.showLive).toHaveBeenCalledTimes(mode === 'driving' ? 3 : 0);
      expect(f.host.liveSurface).toMatchObject({
        water: f.delivered[2].water,
        time: 1.5,
      });
      expect(f.renderValues).toHaveLength(mode === 'driving' ? 3 : 0);
      const captured = records(f.replay);
      expect(captured.map((record) => record.time)).toEqual([0.5, 1, 1.5]);
      const encoded = [1000, 65535, 0, 65535, 2000, 0, 65535, 0];
      for (const record of captured) expect(Array.from(record.data)).toEqual(encoded);
      // Changing a retained receiver field after consumption must not rewrite
      // the replay's private encoded keyframe or another transferred packet.
      f.delivered[0].water.fill(9);
      f.delivered[0].terrain!.blocks[1] = 0.25;
      expect(Array.from(captured[0].data)).toEqual(encoded);
      expect(Array.from(f.delivered[1].water)).toEqual([1, 2]);
      expect(f.terrain.history[0].delta).toBe(f.delivered[0].terrain);
      expect(f.terrain.history[1].delta.blocks[1]).toBe(0.125);
      expect(f.worker.terminate).not.toHaveBeenCalled();
    },
  );

  it('stops after a nonthrowing replay notification closes the real startup lifetime', async () => {
    const f = fixture();
    const failure = new Error('Recording warning caused terminal recovery');
    f.hooks.warning = () => f.host.fail(failure);
    expect(f.publish(60, { invalid: true })).toBe(true);
    expect(f.replay.error).toBe('Invalid replay surface');
    expect(f.host.recordingWarnings).toEqual(['Invalid replay surface']);
    expect(await f.ready).toBe(failure);
    expect(f.gate.lifetime.signal.reason).toBe(failure);
    expect(f.host.circuitStartup).toBeNull();
    expect(f.order).toEqual(['replay', 'warning', 'terminate', 'error']);
    expect(f.accepted).toEqual([]);
    expect(f.host.renderer.circuit.updateSurface).not.toHaveBeenCalled();
    expect(f.host.renderer.circuit.offroad.record).not.toHaveBeenCalled();
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
    expect(f.host.ui.error).toHaveBeenCalledExactlyOnceWith(failure.message);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(failure);
    const previous = f.host.liveSurface;
    f.receive({ data: { ...packet(2), epoch: 1, sequence: 99 } });
    expect(f.host.liveSurface).toBe(previous);
    expect(f.replay.recordSurface).toHaveBeenCalledTimes(1);
    f.channel.request(120);
    expect(f.channel.publish(120, () => packet(1), vi.fn())).toBe(false);
  });

  it('does not route a recording-notification departure into a successor or its ACK channel', async () => {
    const f = fixture();
    const next = fixture();
    const replacement = new Error('Superseded recording owner');
    f.hooks.warning = () => {
      f.gate.close(replacement);
      f.host.generation++;
      f.host.worker = next.worker;
      f.host.replay = next.replay;
      f.host.renderer = next.host.renderer;
      f.host.liveSurface = null;
      f.host.recordingWarnings = [];
    };
    expect(f.publish(60, { invalid: true })).toBe(true);
    expect(await f.ready).toBe(replacement);
    expect(f.host.liveSurface).toBeNull();
    expect(f.order).toEqual(['replay', 'warning']);
    expect(f.worker.postMessage).not.toHaveBeenCalled();
    expect(next.worker.postMessage).not.toHaveBeenCalled();
    expect(next.replay.recordSurface).not.toHaveBeenCalled();
    expect(next.host.renderer.circuit.updateSurface).not.toHaveBeenCalled();
    expect(next.host.renderer.circuit.offroad.record).not.toHaveBeenCalled();
    expect(f.host.ui.error).not.toHaveBeenCalled();
    const oldNotify = f.host.notification(1);
    oldNotify('Late recording notice');
    expect(f.host.recordingWarnings).toEqual([]);
    expect(next.publish(60)).toBe(true);
    expect(next.accepted).toHaveLength(1);
    expect(next.gate.lifetime.signal.aborted).toBe(false);
    f.channel.request(120);
    expect(f.channel.publish(120, () => packet(1), vi.fn())).toBe(false);
  });

  it.each(['render', 'terrain', 'warning'] as const)(
    'withholds credit when %s returns after actual host failure, and ignores later queued work',
    async (stage) => {
      const f = fixture();
      const failure = new Error(stage + ' requested terminal recovery');
      f.hooks[stage] = () => f.host.fail(failure);
      expect(f.publish(60, { gap: stage === 'warning' })).toBe(true);
      expect(await f.ready).toBe(failure);
      expect(f.worker.postMessage).not.toHaveBeenCalled();
      expect(f.accepted).toEqual([]);
      expect(f.worker.terminate).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(failure);
      expect(f.host.ui.error).toHaveBeenCalledExactlyOnceWith(failure.message);
      const completed = f.order.slice();
      expect(completed.slice(-3)).toEqual([stage, 'terminate', 'error']);
      f.receive({ data: { ...packet(2), epoch: 1, sequence: 99 } });
      expect(f.order).toEqual(completed);
      expect(f.gate.lifetime.signal.reason).toBe(failure);
    },
  );

  it('retains original ACK transport failure and does not grant an unaccepted credit', async () => {
    const f = fixture();
    const failure = new Error('ACK transport rejected the send');
    f.failAck(failure);
    expect(f.publish(60)).toBe(true);
    expect(f.order).toEqual(['replay', 'render', 'terrain', 'ack', 'terminate', 'error']);
    expect(await f.ready).toBe(failure);
    expect(f.accepted).toEqual([]);
    expect(records(f.replay)).toHaveLength(1);
    expect(f.terrain.history).toHaveLength(1);
    expect(f.delivered[0].water.byteLength).toBe(8);
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
    f.channel.request(120);
    const capture = vi.fn(() => packet(1));
    expect(f.channel.publish(120, capture, f.send)).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    expect(f.gate.lifetime.signal.reason).toBe(failure);
  });

  it.each(['return', 'throw'] as const)(
    'keeps a capture-time replacement pending when the obsolete capture will %s',
    (outcome) => {
      const f = fixture();
      const failure = new Error('Obsolete capture failed');
      const obsolete = packet(1);
      f.channel.request(120);
      const run = () =>
        f.channel.publish(
          120,
          () => {
            f.channel.reset(0, true);
            f.channel.request(60);
            if (outcome === 'throw') throw failure;
            return obsolete;
          },
          f.send,
        );
      if (outcome === 'throw') expect(run).toThrow(failure);
      else expect(run()).toBe(false);
      expect(f.order).toEqual([]);
      expect(f.delivered).toEqual([]);
      expect(obsolete.water.byteLength).toBe(8);
      expect(obsolete.terrain!.blocks.byteLength).toBe(12);
      expect(f.channel.pending).toBe(true);
      const full: boolean[] = [];
      expect(
        f.channel.publish(
          60,
          (reset) => {
            full.push(reset);
            return packet(0.5, reset);
          },
          f.send,
        ),
      ).toBe(true);
      expect(full).toEqual([true]);
      expect(f.delivered[0]).toMatchObject({ epoch: 2, sequence: 2, terrain: { reset: true } });
      expect(f.delivered[0].captureGap).toBeUndefined();
      expect(f.accepted).toEqual([{ type: 'surfaceAck', epoch: 2, sequence: 2 }]);
      expect(f.channel.pending).toBe(false);
      expect(f.replay.recordSurface).toHaveBeenCalledTimes(1);
      expect(f.worker.terminate).not.toHaveBeenCalled();
    },
  );
});
