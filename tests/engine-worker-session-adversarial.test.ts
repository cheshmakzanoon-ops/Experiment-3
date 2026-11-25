import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LiveFrameClock } from '../src/rendering/live-frame-clock.ts';
import { recordFestivalBest } from '../src/session/festival-save.ts';
import { SessionLifetime } from '../src/session/session-lifetime.ts';
import { SessionStartOwner } from '../src/session/session-start-owner.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import {
  festivalDefaultVehicle,
  festivalVehicles,
  OpenWorldSimulation,
  type FestivalStatus,
} from '../src/simulation/open-world/session.ts';
import { isRace } from '../src/simulation/open-world/festival-events.ts';
import { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import { vehicleAt } from '../src/simulation/vehicles.ts';
import { FestivalStatusObserver } from '../src/steam/hooks.ts';
import { FestivalHud } from '../src/ui/festival-hud.ts';
import { minimapHeading } from '../src/ui/festival-map.ts';
import {
  EngineeringChannel,
  type ClientMessage,
  type EngineeringMessage,
  type WorkerMessage,
} from '../src/workers/diagnostics.ts';
import {
  FESTIVAL_STATUS_CAPACITY,
  type FromOpenWorld,
  type ToOpenWorld,
} from '../src/workers/open-world-protocol.ts';

const circuitOptions = {
  ...DEFAULT_OPTIONS,
  mode: 'practice' as const,
  opponents: 0,
  vehicles: ['apx01'],
  seed: 78044,
};
const festivalOptions = {
  vehicle: 'tc1',
  weather: 'clear' as const,
  assist: 'sport' as const,
  seed: 78044,
  traffic: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('adversarial copied-message ownership', () => {
  it('preserves a successor engineering credit when its acknowledged predecessor throws on return', () => {
    const simulation = new Simulation(circuitOptions);
    const channel = new EngineeringChannel();
    const sent: EngineeringMessage[] = [];
    const failure = new Error('Predecessor callback failed after handing off');
    channel.enable(true);
    expect(() =>
      channel.publish(simulation, (first) => {
        sent.push(structuredClone(first));
        expect(channel.acknowledge(first)).toBe(true);
        channel.reset();
        channel.enable(true);
        expect(channel.publish(simulation, (next) => sent.push(structuredClone(next)))).toBe(true);
        throw failure;
      }),
    ).toThrow(failure);
    expect(sent).toHaveLength(2);
    expect(sent[1].epoch).toBeGreaterThan(sent[0].epoch);
    expect(channel.acknowledge(sent[0])).toBe(false);
    expect(
      channel.publish(simulation, () => {
        throw new Error('Successor lost its credit');
      }),
    ).toBe(false);
    expect(channel.acknowledge(sent[1])).toBe(true);
    channel.enable(true);
    expect(channel.publish(simulation, (next) => sent.push(structuredClone(next)))).toBe(true);
    expect(sent).toHaveLength(3);
  });
});

/** The real workers run with queued-message ownership and native structured
 * clone transfers. Only their scheduler and clock are manually advanced. */
describe('failed initialization with old delivered receipts', () => {
  let now = 0;
  let circuitPump!: () => void;
  let festivalPump!: () => void;
  const circuitMessages: WorkerMessage[] = [];
  const festivalMessages: FromOpenWorld[] = [];
  const circuit = {
    onmessage: null as ((event: { data: ClientMessage }) => void) | null,
    postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
      circuitMessages.push(structuredClone(message, { transfer }));
    },
  };
  const festival = {
    onmessage: null as ((event: { data: ToOpenWorld }) => void) | null,
    postMessage(message: FromOpenWorld, transfer: Transferable[] = []) {
      festivalMessages.push(structuredClone(message, { transfer }));
    },
  };
  const sendCircuit = (data: ClientMessage) => circuit.onmessage!({ data: structuredClone(data) });
  const sendFestival = (data: ToOpenWorld) => festival.onmessage!({ data: structuredClone(data) });
  beforeAll(async () => {
    vi.stubGlobal('self', circuit);
    vi.stubGlobal('setInterval', (pump: () => void) => {
      circuitPump = pump;
      return 1;
    });
    await import('../src/workers/physics.worker.ts');
    vi.stubGlobal('self', festival);
    vi.stubGlobal('setInterval', (pump: () => void) => {
      festivalPump = pump;
      return 1;
    });
    await import('../src/workers/open-world.worker.ts');
    vi.unstubAllGlobals();
  });

  it('retires circuit credits across failed init without reviving the failed world or freeing newer credit', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    sendCircuit({ type: 'init', options: circuitOptions });
    sendCircuit({ type: 'engineering', enabled: true });
    const first = circuitMessages.find(
      (message): message is EngineeringMessage => message.type === 'engineering',
    )!;
    const write = Simulation.prototype.writeFrame;
    vi.spyOn(Simulation.prototype, 'writeFrame').mockImplementationOnce(function (
      this: Simulation,
      ...args
    ) {
      write.apply(this, args);
      throw new Error('Replacement init failed after constructing its frame');
    });
    sendCircuit({ type: 'init', options: circuitOptions });
    expect(circuitMessages.at(-1)).toEqual({
      type: 'error',
      message: 'Replacement init failed after constructing its frame',
    });
    const stopped = circuitMessages.length;
    sendCircuit({ type: 'engineeringAck', epoch: first.epoch, sequence: first.sequence });
    sendCircuit({ type: 'pause', value: false });
    now += 100;
    circuitPump();
    expect(circuitMessages).toHaveLength(stopped);
    sendCircuit({ type: 'init', options: circuitOptions });
    sendCircuit({ type: 'engineering', enabled: true });
    const fresh = circuitMessages
      .filter((message): message is EngineeringMessage => message.type === 'engineering')
      .at(-1)!;
    expect(fresh.sequence).toBeGreaterThan(first.sequence);
    sendCircuit({ type: 'engineeringAck', epoch: first.epoch, sequence: first.sequence });
    sendCircuit({ type: 'pause', value: false });
    now += 100;
    circuitPump();
    expect(circuitMessages.filter((message) => message.type === 'engineering')).toHaveLength(2);
    sendCircuit({ type: 'engineeringAck', epoch: fresh.epoch, sequence: fresh.sequence });
    expect(circuitMessages.filter((message) => message.type === 'engineering')).toHaveLength(3);
    sendCircuit({ type: 'engineering', enabled: false });
    for (const message of circuitMessages) {
      if (message.type === 'engineering')
        sendCircuit({ type: 'engineeringAck', epoch: message.epoch, sequence: message.sequence });
      if (message.type === 'surface')
        sendCircuit({ type: 'surfaceAck', epoch: message.epoch, sequence: message.sequence });
    }
  });

  it('keeps the 64-status bound through failed replacement init and accepts each older receipt only once', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const init = () => sendFestival({ type: 'init', options: festivalOptions });
    const statuses = () => festivalMessages.filter((message) => message.type === 'status');
    init();
    for (let i = 1; i < FESTIVAL_STATUS_CAPACITY - 2; i++)
      sendFestival({ type: 'pause', value: true });
    expect(statuses()).toHaveLength(62);
    const first = statuses()[0];
    const write = OpenWorldSimulation.prototype.writeFrame;
    vi.spyOn(OpenWorldSimulation.prototype, 'writeFrame').mockImplementationOnce(function (
      this: OpenWorldSimulation,
      ...args
    ) {
      write.apply(this, args);
      throw new Error('Festival replacement frame failed');
    });
    init();
    expect(festivalMessages.at(-1)).toMatchObject({
      type: 'error',
      fatal: true,
      message: 'Festival replacement frame failed',
    });
    const failed = festivalMessages.length;
    sendFestival({ type: 'pause', value: false });
    now += 100;
    festivalPump();
    expect(festivalMessages).toHaveLength(failed);
    init();
    init();
    expect(statuses()).toHaveLength(FESTIVAL_STATUS_CAPACITY);
    init();
    expect(festivalMessages.at(-1)).toMatchObject({ type: 'error', fatal: false });
    sendFestival({ type: 'statusAck', sequence: first.sequence });
    init();
    expect(statuses()).toHaveLength(FESTIVAL_STATUS_CAPACITY + 1);
    sendFestival({ type: 'statusAck', sequence: first.sequence });
    init();
    expect(statuses()).toHaveLength(FESTIVAL_STATUS_CAPACITY + 1);
    expect(festivalMessages.at(-1)).toMatchObject({ type: 'error', fatal: false });
    for (const packet of statuses()) sendFestival({ type: 'statusAck', sequence: packet.sequence });
  });
});

// Execute the complete session controller with the actual HUD and startup owner.
// Only renderer/transport/DOM boundaries are doubled; lifecycle methods are intact.
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

interface FrameSession {
  receive(message: FromOpenWorld): void;
  frame(time: number): void;
  dispose(): void;
  booting: boolean;
  disposed: boolean;
  renderer: object | null;
  hud: FestivalHud | null;
  status: FestivalStatus | null;
}

/** Enough DOM for the real HUD constructor, update, gamepad polling and click
 * listener. Canvas painting is the only HUD operation replaced. */
function hudDom() {
  const element = () => ({
    hidden: true,
    textContent: '',
    innerHTML: '',
    dataset: {} as Record<string, string>,
    style: { transform: '', setProperty: vi.fn() },
    classList: { toggle: vi.fn() },
    parentElement: { hidden: false },
    setAttribute: vi.fn(),
  });
  const nodes = new Map<string, ReturnType<typeof element>>();
  const button = {
    dataset: { fest: 'exit' },
    closest: () => button,
    getClientRects: () => [{}],
    click: vi.fn(),
  };
  const panel = Object.assign(element(), {
    querySelectorAll: () => [button],
    contains: (value: unknown) => value === button,
  });
  const root = Object.assign(new EventTarget(), element(), {
    querySelector: (selector: string) => {
      if (selector === '#festMenu') return panel;
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector)!;
    },
    remove: vi.fn(),
  });
  button.click.mockImplementation(() => {
    const event = new Event('click');
    Object.defineProperty(event, 'target', { value: button });
    root.dispatchEvent(event);
  });
  const document = Object.assign(new EventTarget(), {
    activeElement: button,
    pointerLockElement: null,
    hidden: false,
    createElement: () => root,
  });
  return { root, button, document, parent: { appendChild: vi.fn() } };
}

async function runningFixture(mode: 'cockpit' | 'chase', gamepad: boolean) {
  const owner = new SessionStartOwner<FrameSession>();
  const dom = hudDom();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', {
    getGamepads: () => [{ connected: true, buttons: [{ pressed: gamepad }] }],
  });
  const painter = FestivalHud.prototype as unknown as {
    paintMap(): object;
    paintMinimap(): void;
  };
  vi.spyOn(painter, 'paintMap').mockReturnValue({});
  vi.spyOn(painter, 'paintMinimap').mockImplementation(() => {});
  const simulation = new OpenWorldSimulation(festivalOptions);
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  simulation.writeFrame(frame, 0, 0);
  const navigation = { update: vi.fn(), detach: vi.fn() };
  const view = {
    mode,
    photo: false,
    night: 0,
    camera: {},
    discovered: new Set<string>(),
    cars: { bodies: { cabinOf: () => ({ navigationPane: {} }) }, navigation },
    presented: { value: frame },
    guidance: { cue: null },
    driftCue: null,
    canSubmitFrame: vi.fn(() => true),
    draw: vi.fn(() => true),
    audioView: { value: {} },
    dispose: vi.fn(),
  };
  const worker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: vi.fn(),
    postMessage: vi.fn(),
  };
  const tiles = { onerror: null, onmessageerror: null, terminate: vi.fn() };
  const bindings = {
    OpenWorldWorker: function () {
      return worker;
    },
    TileWorker: function () {
      return tiles;
    },
    LiveFrameClock,
    FestivalStatusObserver,
    emitGameEvent: () => {},
    festivalDefaultVehicle,
    carBase,
    F,
    H,
    R,
    RACE_BASE,
    isRace,
    recordFestivalBest,
    vehicleAt,
    minimapHeading,
  };
  const Constructor = new Function(
    ...Object.keys(bindings),
    `${compiled}; return FestivalSession;`,
  )(...Object.values(bindings)) as new (
    host: object,
    save: null,
    lifetime: SessionLifetime,
  ) => FrameSession;
  const host = {
    canvas: new EventTarget(),
    quality: 'low',
    loading: vi.fn(),
    loaded: vi.fn(),
    toast: vi.fn(),
    exit: vi.fn(),
    audio: { stop: vi.fn(), update: vi.fn() },
  };
  await owner.start({
    load: async () => undefined,
    create: async (_module, scope) => {
      host.exit.mockImplementation(scope.guard(() => owner.cancel()));
      const session = new Constructor(
        host,
        null,
        new SessionLifetime('Festival session closed', scope.signal),
      );
      session.renderer = view;
      session.hud = new FestivalHud(
        dom.parent as unknown as HTMLElement,
        simulation.world,
        [],
        festivalVehicles(),
        {
          start: vi.fn(),
          continue: vi.fn(),
          cancel: vi.fn(),
          reset: vi.fn(),
          resume: vi.fn(),
          exit: host.exit,
          lighting: vi.fn(),
          vehicle: vi.fn(),
          travel: vi.fn(),
          autopilot: vi.fn(),
          traffic: vi.fn(),
        },
      );
      session.hud.menuOpen = true;
      session.receive({ type: 'frame', buffer: frame.buffer });
      session.receive({ type: 'status', sequence: 1, status: simulation.status() });
      session.booting = false;
      return session;
    },
    ready: () => {},
    failed: () => {},
  });
  return { owner, session: owner.session!, host, view, navigation, worker, tiles, dom };
}

describe('Festival gamepad exit during its frame callback', () => {
  it.each(['cockpit', 'chase'] as const)(
    'returns from the %s frame after the real HUD clicks exit',
    async (mode) => {
      const h = await runningFixture(mode, true);
      try {
        expect(() => h.session.frame(100)).not.toThrow();
        expect(h.dom.button.click).toHaveBeenCalledOnce();
        expect(h.host.exit).toHaveBeenCalledOnce();
        expect(h.owner.session).toBeNull();
        expect(h.session.disposed).toBe(true);
        expect(h.view.dispose).toHaveBeenCalledOnce();
        expect(h.worker.terminate).toHaveBeenCalledOnce();
        expect(h.tiles.terminate).toHaveBeenCalledOnce();
        expect(h.navigation.update).not.toHaveBeenCalled();
        expect(h.navigation.detach).not.toHaveBeenCalled();
        expect(h.host.audio.update).not.toHaveBeenCalled();
        h.session.frame(116);
        expect(h.view.draw).toHaveBeenCalledOnce();
        expect(h.dom.button.click).toHaveBeenCalledOnce();
      } finally {
        h.owner.cancel();
      }
    },
  );

  it('still updates navigation and audio when the same HUD frame keeps its session', async () => {
    const h = await runningFixture('cockpit', false);
    try {
      h.session.frame(100);
      expect(h.owner.session).toBe(h.session);
      expect(h.navigation.update).toHaveBeenCalledOnce();
      expect(h.host.audio.update).toHaveBeenCalledOnce();
      expect(h.dom.button.click).not.toHaveBeenCalled();
    } finally {
      h.owner.cancel();
    }
  });
});
