import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveFrameClock } from '../src/rendering/live-frame-clock.ts';
import { FestivalControls, festivalMenuState } from '../src/session/festival-controls.ts';
import { SessionLifetime } from '../src/session/session-lifetime.ts';
import { SessionStartOwner, type SessionStartScope } from '../src/session/session-start-owner.ts';
import { recordFestivalBest, type FestivalSave } from '../src/session/festival-save.ts';
import {
  isRace,
  type FestivalEvent,
  type FestivalResult,
} from '../src/simulation/open-world/festival-events.ts';
import {
  festivalDefaultVehicle,
  OpenWorldSimulation,
  type FestivalCommand,
  type FestivalStatus,
} from '../src/simulation/open-world/session.ts';
import { FestivalStatusObserver } from '../src/steam/hooks.ts';
import type { GameEvent } from '../src/steam/events.ts';
import {
  FESTIVAL_STATUS_CAPACITY,
  type FromOpenWorld,
  type ToOpenWorld,
} from '../src/workers/open-world-protocol.ts';

/** Use the complete production host class, including its constructor, failure,
 * cancellation and command methods. Only the GPU/bootstrap dependencies are
 * omitted: these cases connect the already-created session to the real worker. */
const source = ts.createSourceFile(
  'free-roam.ts',
  readFileSync(new URL('../src/session/free-roam.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'FestivalSession',
)!;
const compiled = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

interface Port {
  onmessage: ((event: { data: FromOpenWorld }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(message: ToOpenWorld, transfer?: Transferable[]): void;
  terminate(): void;
}
interface Session {
  receive(message: FromOpenWorld): void;
  post(message: ToOpenWorld): void;
  commandAndWait(command: FestivalCommand): Promise<void>;
  travel(id: string, retry?: boolean): Promise<void>;
  dispose(): void;
  setPaused(value: boolean): void;
  booting: boolean;
  disposed: boolean;
  travelling: boolean;
  drivingInputEnabled: boolean;
  commandRequests: Map<number, { timer: ReturnType<typeof setTimeout> }>;
  events: readonly FestivalEvent[];
  current: Float32Array | null;
  status: FestivalStatus | null;
  renderer: ReturnType<typeof renderer> | null;
  hud: ReturnType<typeof menus> | null;
  controls: FestivalControls | null;
  achievements: FestivalStatusObserver;
  save: FestivalSave;
}

const wire = {
  now: 0,
  pump: undefined as (() => void) | undefined,
  outbound: [] as FromOpenWorld[],
  allStatuses: [] as Extract<FromOpenWorld, { type: 'status' }>[],
  simulation: undefined as OpenWorldSimulation | undefined,
};
const workerScope = {
  onmessage: null as ((event: { data: ToOpenWorld }) => void) | null,
  postMessage(message: FromOpenWorld, transfer: Transferable[] = []) {
    const copy = structuredClone(message, { transfer });
    wire.outbound.push(copy);
    if (copy.type === 'status') wire.allStatuses.push(copy);
  },
};
const sendWorker = (message: ToOpenWorld) => workerScope.onmessage!({ data: message });

beforeAll(async () => {
  vi.stubGlobal('self', workerScope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    wire.pump = callback;
    return 1;
  });
  await import('../src/workers/open-world.worker.ts');
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  wire.now += 1000;
  wire.outbound.length = wire.allStatuses.length = 0;
  wire.simulation = undefined;
  vi.spyOn(performance, 'now').mockImplementation(() => wire.now);
  const status = OpenWorldSimulation.prototype.status;
  vi.spyOn(OpenWorldSimulation.prototype, 'status').mockImplementation(function (
    this: OpenWorldSimulation,
  ) {
    wire.simulation = this;
    return status.call(this);
  });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), { pointerLockElement: null, exitPointerLock: vi.fn() }),
  );
});
const owners: SessionStartOwner<Session>[] = [];
afterEach(() => {
  for (const owner of owners.splice(0)) owner.cancel();
  for (const message of wire.allStatuses)
    sendWorker({ type: 'statusAck', sequence: message.sequence });
  expect(vi.getTimerCount()).toBe(0);
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderer() {
  return {
    discovered: new Set<string>(),
    activeEvent: null as string | null,
    gate: null as unknown,
    ready: vi.fn(() => true),
    prestream: vi.fn(),
    dispose: vi.fn(),
  };
}
function menus() {
  const state = {
    menuOpen: false,
    mapOpen: false,
    cardOpen: false,
    resultsOpen: false,
    showMenu: vi.fn((open: boolean) => {
      state.menuOpen = open;
    }),
    showMap: vi.fn((open: boolean) => {
      state.mapOpen = open;
    }),
    hideResults: vi.fn(),
    recordActivity: vi.fn<(result: FestivalResult) => void>(),
    dispose: vi.fn(),
  };
  return state;
}

async function linked(owner = new SessionStartOwner<Session>()) {
  if (!owners.includes(owner)) owners.push(owner);
  const inbound: ToOpenWorld[] = [],
    sent: ToOpenWorld[] = [],
    events: GameEvent[] = [],
    effects: string[] = [];
  const port = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn((message: ToOpenWorld, transfer: Transferable[] = []) => {
      const copy = structuredClone(message, { transfer });
      inbound.push(copy);
      sent.push(copy);
    }),
    terminate: vi.fn(),
  } satisfies Port;
  const tiles = { onerror: null, onmessageerror: null, terminate: vi.fn() };
  const view = renderer(),
    hud = menus();
  const host = {
    canvas: new EventTarget(),
    loading: vi.fn<(message: string) => void>(),
    loaded: vi.fn(),
    toast: vi.fn<(message: string) => void>(),
    exit: vi.fn(),
    driving: vi.fn<(on: boolean) => void>(),
    save: vi.fn(async (_save: FestivalSave) => {}),
    audio: { stop: vi.fn() },
  };
  let session!: Session;
  const Constructor = new Function(
    'OpenWorldWorker',
    'TileWorker',
    'LiveFrameClock',
    'FestivalStatusObserver',
    'emitGameEvent',
    'festivalDefaultVehicle',
    'isRace',
    'recordFestivalBest',
    `${compiled}; return FestivalSession;`,
  )(
    function () {
      return port;
    },
    function () {
      return tiles;
    },
    LiveFrameClock,
    FestivalStatusObserver,
    (event: GameEvent) => events.push(event),
    festivalDefaultVehicle,
    isRace,
    recordFestivalBest,
  ) as new (host: object, save: null, lifetime: SessionLifetime) => Session;
  const create = async (_module: undefined, scope: SessionStartScope) => {
    host.loading.mockImplementation(scope.guard((message) => effects.push(`loading:${message}`)));
    host.loaded.mockImplementation(scope.guard(() => effects.push('loaded')));
    host.toast.mockImplementation(scope.guard((message) => effects.push(`toast:${message}`)));
    host.exit.mockImplementation(
      scope.guard(() => {
        effects.push('exit');
        owner.cancel();
      }),
    );
    session = new Constructor(
      host,
      null,
      new SessionLifetime('Festival session closed', scope.signal),
    );
    session.renderer = view;
    session.hud = hud;
    session.controls = new FestivalControls(hud, {
      pause: (value) => session.post({ type: 'pause', value }),
      driving: host.driving,
      menuState: () => festivalMenuState(session.status, session.save, 'day'),
      card: () => null,
      start: () => {},
      continue: () => {},
    });
    return session;
  };
  await owner.start({ load: async () => undefined, create, ready: () => {}, failed: () => {} });
  const deliverQueued = port.onmessage as unknown as (event: { data: FromOpenWorld }) => void;
  const flushWorker = () => {
    while (inbound.length) sendWorker(inbound.shift()!);
  };
  const deliver = () => {
    const message = wire.outbound.shift();
    if (message) deliverQueued({ data: message });
    return message;
  };
  const flush = () => {
    for (let count = 0; inbound.length || wire.outbound.length; count++) {
      if (count > 1000) throw new Error('Message delivery did not settle');
      flushWorker();
      if (wire.outbound.length) deliver();
    }
  };
  session.post({
    type: 'init',
    options: { vehicle: 'tc1', weather: 'clear', assist: 'sport', seed: 75028, traffic: false },
  });
  flush();
  const simulation = wire.simulation!;
  session.events = simulation.events;
  session.booting = false;
  return {
    owner,
    session,
    host,
    view,
    hud,
    port,
    tiles,
    inbound,
    sent,
    events,
    effects,
    simulation,
    flushWorker,
    deliver,
    flush,
    advance(milliseconds: number) {
      wire.now += milliseconds;
      wire.pump!();
    },
  };
}

function settled(promise: Promise<void>) {
  const result: { done: boolean; error?: unknown } = { done: false };
  void promise.then(
    () => {
      result.done = true;
    },
    (error: unknown) => {
      result.done = true;
      result.error = error;
    },
  );
  return result;
}

describe('Festival worker, session and startup-owner composition', () => {
  it('applies real travel state and its discovery before settling the matching command', async () => {
    const h = await linked(),
      event = h.simulation.events[0];
    const result = settled(h.session.commandAndWait({ type: 'travel', event: event.spec.id }));
    h.flushWorker();
    expect(wire.outbound.map((message) => message.type)).toEqual([
      'frame',
      'status',
      'command-result',
    ]);
    h.deliver();
    h.deliver();
    await Promise.resolve();
    expect(result.done).toBe(false);
    expect(h.session.status!.discovered).toContain(event.spec.id);
    expect(h.view.discovered.has(event.spec.id)).toBe(true);
    expect(h.events).toContainEqual({
      type: 'festival.discovered',
      id: event.spec.id,
      total: h.session.status!.discovered.length,
    });
    expect(h.sent.at(-1)!.type).toBe('statusAck');
    h.flush();
    await Promise.resolve();
    expect(result).toEqual({ done: true });
    expect(h.session.commandRequests.size).toBe(0);
    expect(h.owner.session).toBe(h.session);
  });

  it('settles a busy command without mutation, then can travel after the actual host drains receipts', async () => {
    const h = await linked();
    h.session.setPaused(false);
    h.flush();
    for (let i = 0; i < FESTIVAL_STATUS_CAPACITY; i++) h.advance(100);
    const player = h.simulation.player,
      tick = h.simulation.tick;
    const first = settled(
      h.session.commandAndWait({ type: 'travel', event: h.simulation.events[0].spec.id }),
    );
    h.flushWorker();
    h.flush();
    await Promise.resolve();
    expect(first).toMatchObject({
      done: true,
      error: new Error('Festival status delivery is busy. Please try again.'),
    });
    expect(h.simulation.player).toBe(player);
    expect(h.simulation.tick).toBe(tick);
    expect(h.owner.session).toBe(h.session);
    const second = settled(
      h.session.commandAndWait({ type: 'travel', event: h.simulation.events[0].spec.id }),
    );
    h.flush();
    await Promise.resolve();
    expect(second).toEqual({ done: true });
    expect(h.simulation.player).not.toBe(player);
  });

  it.each(['consumer', 'toast', 'exit'] as const)(
    'releases the startup owner and pending travel after a status failure even if %s throws',
    async (stage) => {
      const h = await linked(),
        original = new Error('Status application failed'),
        reporting = new Error(`${stage} callback failed`);
      const pending = settled(
        h.session.commandAndWait({ type: 'travel', event: h.simulation.events[0].spec.id }),
      );
      h.flushWorker();
      vi.spyOn(h.session.achievements, 'observe').mockImplementationOnce(() => {
        throw original;
      });
      if (stage === 'toast')
        h.host.toast.mockImplementationOnce(() => {
          throw reporting;
        });
      if (stage === 'exit')
        h.host.exit.mockImplementationOnce(() => {
          h.owner.cancel();
          throw reporting;
        });
      h.deliver(); // new frame precedes the status and command receipt
      if (stage === 'consumer') expect(() => h.deliver()).not.toThrow();
      else expect(() => h.deliver()).toThrow(reporting);
      await Promise.resolve();
      expect(pending.done).toBe(true);
      expect(pending.error).toBe(original);
      // Keep a failure diagnostic from formatting the complete authored route
      // graph retained by an incorrectly owned session.
      expect(h.owner.session === null).toBe(true);
      expect(h.session.disposed).toBe(true);
      expect(h.session.commandRequests.size).toBe(0);
      expect(h.port.terminate).toHaveBeenCalledOnce();
      expect(h.tiles.terminate).toHaveBeenCalledOnce();
      expect(h.view.dispose).toHaveBeenCalledOnce();
      const sent = h.sent.length;
      h.flush(); // the already-queued command receipt cannot revive the closed owner
      expect(h.sent).toHaveLength(sent);
      expect(h.host.exit).toHaveBeenCalledOnce();
    },
  );

  it('cancels pending travel and ignores old replies while a replacement owns the host', async () => {
    const first = await linked();
    const pending = settled(
      first.session.commandAndWait({ type: 'travel', event: first.simulation.events[0].spec.id }),
    );
    first.flushWorker();
    const queued = wire.outbound.splice(0);
    first.owner.cancel();
    await Promise.resolve();
    expect(pending).toMatchObject({ done: true, error: new Error('Festival session closed') });
    const second = await linked(first.owner);
    const messages = first.sent.length,
      effects = first.effects.length;
    for (const message of queued) first.session.receive(message);
    expect(first.sent).toHaveLength(messages);
    expect(first.effects).toHaveLength(effects);
    expect(second.owner.session).toBe(second.session);
    expect(second.session.disposed).toBe(false);
    expect(second.host.toast).not.toHaveBeenCalled();
    expect(second.session.commandRequests.size).toBe(0);
  });

  it('keeps a timed-out move paused when its genuine worker confirmation arrives later', async () => {
    const h = await linked();
    const pending = h.session.travel(h.simulation.events[0].spec.id);
    h.flushWorker(); // worker has moved, but the host has not received confirmation
    await vi.advanceTimersByTimeAsync(8000);
    await pending;
    expect(h.session.travelling).toBe(false);
    expect(h.session.drivingInputEnabled).toBe(false);
    expect(h.host.toast).toHaveBeenCalledWith('The festival simulation did not confirm the move.');
    h.flush();
    await Promise.resolve();
    expect(h.session.drivingInputEnabled).toBe(false);
    expect(h.session.commandRequests.size).toBe(0);
    expect(h.owner.session).toBe(h.session);
    expect(h.host.loaded).toHaveBeenCalledOnce();
  });
});
