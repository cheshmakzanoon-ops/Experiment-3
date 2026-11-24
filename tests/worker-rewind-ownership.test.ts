import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputLog } from '../src/core/flashback.ts';
import {
  controls,
  DEFAULT_OPTIONS,
  type Controls,
  type SessionOptions,
} from '../src/simulation/config.ts';
import { OpenWorldSimulation, type FreeRoamOptions } from '../src/simulation/open-world/session.ts';
import { CAR_STRIDE, H, HEADER } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import { RECORDING_TRANSPORT_MAX_PAGES } from '../src/storage/telemetry-sampler.ts';
import type { ClientMessage, SurfaceMessage, WorkerMessage } from '../src/workers/diagnostics.ts';
import type { FromOpenWorld, ToOpenWorld } from '../src/workers/open-world-protocol.ts';
import { SURFACE_TRANSPORT_MAX_PACKETS } from '../src/workers/surface-channel.ts';

type Engine = Simulation | OpenWorldSimulation;
type Applied = { tick: number; input: Controls };
type CircuitFrame = Extract<WorkerMessage, { type: 'frame' }>;
type FestivalFrame = Extract<FromOpenWorld, { type: 'frame' }>;
const CIRCUIT: SessionOptions = {
  ...DEFAULT_OPTIONS,
  mode: 'practice',
  circuit: 'valley-ridge-mx',
  vehicles: ['mx450'],
  opponents: 0,
  assist: 'raw',
  seed: 68038,
};
const FESTIVAL: FreeRoamOptions = {
  vehicle: 'tc1',
  assist: 'raw',
  weather: 'clear',
  seed: 68038,
  traffic: false,
  session: 'worker-ownership',
};
const DT = 1 / 120;
let now = 0;
let active: 'circuit' | 'festival' | null = null;
let circuitPump: () => void;
let festivalPump: () => void;
let circuit: Simulation;
let festival: OpenWorldSimulation;
let inputLog: InputLog;
const applied = new WeakMap<Engine, Applied[]>();
const circuitMessages: WorkerMessage[] = [];
const festivalMessages: FromOpenWorld[] = [];
const detached: ArrayBuffer[] = [];
const circuitScope = {
  onmessage: null as ((event: { data: ClientMessage }) => void) | null,
  postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
    circuitMessages.push(structuredClone(message, { transfer }));
    for (const value of transfer) if (value instanceof ArrayBuffer) detached.push(value);
  },
};
const festivalScope = {
  onmessage: null as ((event: { data: ToOpenWorld }) => void) | null,
  postMessage(message: FromOpenWorld, transfer: Transferable[] = []) {
    festivalMessages.push(structuredClone(message, { transfer }));
    for (const value of transfer) if (value instanceof ArrayBuffer) detached.push(value);
  },
};
function asWorker<T>(kind: typeof active, operation: () => T): T {
  const previous = active;
  active = kind;
  try {
    return operation();
  } finally {
    active = previous;
  }
}
const sendCircuit = (data: ClientMessage, transfer: Transferable[] = []) =>
  asWorker('circuit', () => circuitScope.onmessage!({ data: structuredClone(data, { transfer }) }));
const sendFestival = (data: ToOpenWorld, transfer: Transferable[] = []) =>
  asWorker('festival', () =>
    festivalScope.onmessage!({ data: structuredClone(data, { transfer }) }),
  );
const ack = (packet: Pick<SurfaceMessage, 'epoch' | 'sequence'>) =>
  sendCircuit({ type: 'surfaceAck', epoch: packet.epoch, sequence: packet.sequence });
const surfaces = () => circuitMessages.filter((m): m is SurfaceMessage => m.type === 'surface');
const circuitFrames = () => circuitMessages.filter((m): m is CircuitFrame => m.type === 'frame');
const festivalFrames = () => festivalMessages.filter((m): m is FestivalFrame => m.type === 'frame');
const rows = (engine: Engine) => applied.get(engine) ?? [];
function advance(kind: 'circuit' | 'festival', ms: number) {
  now += ms;
  asWorker(kind, kind === 'circuit' ? circuitPump : festivalPump);
}
function observe(engine: Engine) {
  if (active === 'circuit') circuit = engine as Simulation;
  if (active === 'festival') festival = engine as OpenWorldSimulation;
}
function observeLog(log: InputLog) {
  inputLog = log;
}
function beforeStep(engine: Engine) {
  if (!active) return;
  observe(engine);
  let list = applied.get(engine);
  if (!list) applied.set(engine, (list = []));
  list.push({ tick: engine.tick, input: { ...engine.cars[0].input } });
}

/** Full Float32 presentation plus native Float64 body/vehicle/tire state.
 * Timing diagnostics are deliberately supplied as zero to both serializers.
 * The direct driver has no worker clock, recorder, pool or queued input code. */
function state(engine: Engine) {
  const frame = new Float32Array(HEADER + engine.cars.length * CAR_STRIDE);
  engine.writeFrame(frame, 0, 0);
  const schema: string[] = [];
  const numbers: number[] = [];
  const scalars = (prefix: string, value: object) => {
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (typeof item === 'number' || typeof item === 'boolean') {
        schema.push(`${prefix}.${key}:${typeof item}`);
        numbers.push(Number(item));
      }
    }
  };
  for (let id = 0; id < engine.cars.length; id++) {
    const car = engine.cars[id];
    scalars(`car${id}`, car);
    scalars(`car${id}.body`, car.body);
    for (const key of [
      'position',
      'velocity',
      'acceleration',
      'omega',
      'angularAcceleration',
      'orientation',
      'force',
      'torque',
      'inertia',
    ] as const)
      scalars(`car${id}.body.${key}`, car.body[key]);
    scalars(`car${id}.input`, car.input);
    for (let i = 0; i < car.tires.length; i++) scalars(`car${id}.tire${i}`, car.tires[i]);
  }
  return { frame, schema, precise: new Float64Array(numbers) };
}
function expectState(actual: Engine, expected: Engine) {
  const a = state(actual),
    b = state(expected);
  expect(a.schema).toEqual(b.schema);
  expect(
    Buffer.from(a.frame.buffer).equals(Buffer.from(b.frame.buffer)),
    'Float32 frame bytes',
  ).toBe(true);
  expect(
    Buffer.from(a.precise.buffer).equals(Buffer.from(b.precise.buffer)),
    'Float64 authoritative state bytes',
  ).toBe(true);
}
function directCircuit(entries: Applied[], target: number) {
  const expected = new Simulation(CIRCUIT);
  for (let tick = 0; tick < target; tick++) {
    expect(entries[tick].tick).toBe(tick);
    expected.setInput(entries[tick].input);
    expected.step(DT);
  }
  return expected;
}
function driveBatch(shift: readonly number[], input: Partial<Controls> = {}) {
  for (const pulse of shift)
    sendCircuit({ type: 'input', input: { ...controls(), ...input, shift: pulse } });
  sendCircuit({ type: 'input', input: { ...controls(), ...input } });
  advance('circuit', 50);
}
function exhaustCircuit() {
  sendCircuit({ type: 'init', options: CIRCUIT });
  sendCircuit({ type: 'pause', value: false });
  for (let batch = 0; batch < 600; batch++) {
    sendCircuit({ type: 'input', input: { ...controls(), brake: 0.4 } });
    advance('circuit', 100);
  }
  expect(circuit.tick).toBe(7200);
  expect(circuitFrames()).toHaveLength(5);
  expect(surfaces()).toHaveLength(SURFACE_TRANSPORT_MAX_PACKETS);
  for (const kind of ['telemetry', 'replayFrames'])
    expect(circuitMessages.filter((m) => m.type === kind)).toHaveLength(
      RECORDING_TRANSPORT_MAX_PAGES,
    );
}
function completeRewind(target: number) {
  for (let turn = 0; turn < 10; turn++) {
    advance('circuit', 10);
    if (circuit.tick === target) return;
  }
  throw new Error(`Rewind did not reach ${target}`);
}

beforeAll(async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const circuitWrite = Simulation.prototype.writeFrame;
  vi.spyOn(Simulation.prototype, 'writeFrame').mockImplementation(function (
    this: Simulation,
    ...args
  ) {
    if (active === 'circuit') observe(this);
    return circuitWrite.apply(this, args);
  });
  const circuitStep = Simulation.prototype.step;
  vi.spyOn(Simulation.prototype, 'step').mockImplementation(function (this: Simulation, dt) {
    beforeStep(this);
    return circuitStep.call(this, dt);
  });
  const festivalWrite = OpenWorldSimulation.prototype.writeFrame;
  vi.spyOn(OpenWorldSimulation.prototype, 'writeFrame').mockImplementation(function (
    this: OpenWorldSimulation,
    ...args
  ) {
    if (active === 'festival') observe(this);
    return festivalWrite.apply(this, args);
  });
  const festivalStep = OpenWorldSimulation.prototype.step;
  vi.spyOn(OpenWorldSimulation.prototype, 'step').mockImplementation(function (
    this: OpenWorldSimulation,
    dt,
  ) {
    beforeStep(this);
    return festivalStep.call(this, dt);
  });
  const logInput = InputLog.prototype.input;
  vi.spyOn(InputLog.prototype, 'input').mockImplementation(function (this: InputLog, ...args) {
    if (active === 'circuit') observeLog(this);
    return logInput.apply(this, args);
  });
  // Load each real graph once; fresh sessions use their actual init messages.
  vi.stubGlobal('self', circuitScope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    circuitPump = callback;
    return 1;
  });
  await import('../src/workers/physics.worker.ts');
  vi.stubGlobal('self', festivalScope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    festivalPump = callback;
    return 2;
  });
  await import('../src/workers/open-world.worker.ts');
});
beforeEach(() => {
  // Retire actual outstanding tickets, including any completion published by an
  // ACK, before the next case. No private worker state or capacity is reset.
  for (let i = 0; i < circuitMessages.length; i++) {
    const message = circuitMessages[i];
    if (message.type === 'surface') ack(message);
  }
  circuitMessages.length = festivalMessages.length = detached.length = 0;
  now += 1000;
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('worker rewind, input and recording ownership', () => {
  it('restores and resumes exact input ticks while every ordinary transport is held', () => {
    exhaustCircuit();
    const original = circuit;
    for (let batch = 0; batch < 4; batch++) driveBatch([1, -1, 1], { throttle: 0.18, steer: 0.01 });
    const target = circuit.tick;
    const expected = directCircuit(rows(original), target);
    expectState(circuit, expected);
    for (let batch = 0; batch < 4; batch++) driveBatch([-1, 1], { throttle: 0.3, steer: -0.01 });
    const oldSurface = surfaces()[0];
    const oldPage = circuitMessages.find((m) => m.type === 'replayFrames')!;
    if (oldPage.type !== 'replayFrames') throw new Error('Missing held recording page');
    const oldBytes = Buffer.from(oldPage.buffer.slice(0));
    sendCircuit({ type: 'input', input: { ...controls(), shift: -1 } });
    sendCircuit({ type: 'flashback', tick: target });
    sendCircuit({ type: 'input', input: { ...controls(), shift: 1 } });
    completeRewind(target);
    const rewound = circuit;
    expect(rewound).not.toBe(original);
    expectState(rewound, expected);
    expect(circuitMessages.some((m) => m.type === 'flashback')).toBe(false);
    expect(Buffer.from(oldPage.buffer).equals(oldBytes)).toBe(true);

    // Duplicate rewind requests are rejected without replacing the accepted
    // target. A frame return supplies no surface credit; forged ACKs supply none.
    sendCircuit({ type: 'flashback', tick: target - 8 });
    sendCircuit({ type: 'input', input: { ...controls(), shift: -1, throttle: 0.22 } });
    expected.setInput({ ...controls(), throttle: 0.22 });
    const returned = circuitFrames()[0].buffer;
    sendCircuit({ type: 'recycle', buffer: returned }, [returned]);
    ack({ ...oldSurface, epoch: oldSurface.epoch + 1 });
    ack({ ...oldSurface, sequence: oldSurface.sequence + 10000 });
    advance('circuit', 200);
    expect(circuit.tick).toBe(target);
    expect(circuitMessages.some((m) => m.type === 'flashback')).toBe(false);
    const beforeAck = circuitMessages.length;
    ack(oldSurface);
    const completion = circuitMessages.slice(beforeAck);
    expect(completion.map((m) => m.type)).toEqual(['flashback', 'surface', 'frame']);
    expect(completion[0]).toMatchObject({ type: 'flashback', tick: target });
    const surface = completion[1] as SurfaceMessage;
    expect(surface.epoch).toBeGreaterThan(oldSurface.epoch);
    expect(surface.terrain!.reset).toBe(true);
    expect(surface.water).toEqual(expected.track.water);
    expect(surface.rubber).toEqual(expected.track.rubber);
    expect(surface.marbles).toEqual(expected.track.marbles);
    expect(surface.terrain!.blocks).toEqual(expected.offroad!.terrain.renderDelta(true).blocks);
    expectState(rewound, expected);
    const completedLength = circuitMessages.length;
    ack(oldSurface);
    expect(circuitMessages).toHaveLength(completedLength);

    // Old recording returns precede any new recorder publication. They cannot
    // introduce old samples or aliases into the fresh recording reserve.
    const oldReturn = circuitMessages.find((m) => m.type === 'telemetry')!;
    if (oldReturn.type !== 'telemetry') throw new Error('Missing telemetry page');
    sendCircuit({ type: 'recycleTelemetry', buffer: oldReturn.buffer }, [oldReturn.buffer]);
    sendCircuit({ type: 'pause', value: false, sequence: 11 });
    const resumedStart = rows(rewound).length;
    const payloadStart = circuitMessages.length;
    for (let batch = 0; batch < 4; batch++) {
      driveBatch([1, -1, 1], { throttle: 0.16, steer: 0.005 });
      for (const shift of [1, -1, 1, 0, 0, 0]) {
        expected.setInput({ ...controls(), throttle: 0.16, steer: 0.005, shift });
        expected.step(DT);
      }
      expectState(rewound, expected);
    }
    expect(
      rows(rewound)
        .slice(resumedStart)
        .map((row) => row.input.shift),
    ).toEqual(Array.from({ length: 4 }, () => [1, -1, 1, 0, 0, 0]).flat());
    const shifted = inputLog.entries.filter(
      (entry) => entry.tick >= target && entry.kind === 'input' && entry.input.shift !== 0,
    );
    expect(shifted.map((entry) => entry.tick)).toEqual(
      Array.from({ length: 4 }, (_, i) => [
        target + i * 6,
        target + i * 6 + 1,
        target + i * 6 + 2,
      ]).flat(),
    );
    sendCircuit({ type: 'pause', value: true, sequence: 12 });
    const pages = circuitMessages.slice(payloadStart).filter((m) => m.type === 'replayFrames');
    expect(pages).toHaveLength(1);
    const page = pages[0];
    expect(page.rows).toBe(3);
    const captured = new Float32Array(page.buffer);
    expect(
      Array.from({ length: page.rows }, (_, row) => captured[row * (HEADER + CAR_STRIDE) + H.TICK]),
    ).toEqual([target + 8, target + 16, target + 24]);
    expect(Buffer.from(oldPage.buffer).equals(oldBytes)).toBe(true);

    // A second accepted rewind must replay the newly written branch, not the
    // discarded original future. Its completion again needs its own old credit.
    const secondTarget = target + 16;
    const branch = [
      ...rows(original).slice(0, target),
      ...rows(rewound).slice(resumedStart, resumedStart + 16),
    ];
    const expectedSecond = directCircuit(branch, secondTarget);
    sendCircuit({ type: 'flashback', tick: secondTarget });
    completeRewind(secondTarget);
    expectState(circuit, expectedSecond);
    expect(circuitMessages.filter((m) => m.type === 'flashback')).toHaveLength(1);
    const secondStart = circuitMessages.length;
    ack(surfaces()[1]);
    expect(circuitMessages.slice(secondStart).map((m) => m.type)).toEqual([
      'flashback',
      'surface',
      'frame',
    ]);
    expect(circuitMessages[secondStart]).toMatchObject({ type: 'flashback', tick: secondTarget });
    expectState(circuit, expectedSecond);
    expect(circuitMessages.filter((m) => m.type === 'error')).toEqual([
      { type: 'error', message: 'Invalid flashback request' },
    ]);
    expect(detached.every((buffer) => buffer.byteLength === 0)).toBe(true);
  });

  it('init replaces a blocked rewind and discards its old intent without letting late credits complete it', () => {
    exhaustCircuit();
    driveBatch([1, 1, -1], { throttle: 0.15 });
    const oldSurface = surfaces()[0];
    sendCircuit({ type: 'flashback', tick: circuit.tick - 8 });
    completeRewind(7198);
    sendCircuit({ type: 'input', input: { ...controls(), shift: 1 } });
    const start = circuitMessages.length;
    sendCircuit({ type: 'init', options: CIRCUIT });
    const fresh = circuit;
    const expected = new Simulation(CIRCUIT);
    sendCircuit({ type: 'pause', value: false });
    driveBatch([-1, 1], { brake: 0.2 });
    for (const shift of [-1, 1, 0, 0, 0, 0]) {
      expected.setInput({ ...controls(), brake: 0.2, shift });
      expected.step(DT);
    }
    // The new session requests its first surface at tick 60, independently of
    // its initial pose. Advance to that actual cadence before releasing credit.
    for (let batch = 0; batch < 9; batch++) {
      driveBatch([], { brake: 0.2 });
      for (let tick = 0; tick < 6; tick++) {
        expected.setInput({ ...controls(), brake: 0.2 });
        expected.step(DT);
      }
    }
    expectState(fresh, expected);
    ack(oldSurface);
    expect(circuitMessages.slice(start).some((m) => m.type === 'flashback')).toBe(false);
    const surface = surfaces().at(-1)!;
    expect(surface.epoch).toBeGreaterThan(oldSurface.epoch);
    expect(surface.terrain!.reset).toBe(true);
    expect(surface.time).toBe(expected.race.time);
    expect(surface.terrain!.blocks).toEqual(expected.offroad!.terrain.renderDelta(true).blocks);
    expect(rows(fresh).map((row) => row.input.shift)).toEqual([-1, 1, ...Array(58).fill(0)]);
    expect(circuitMessages.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('Festival event and driver transitions own queued shifts even when all ordinary frames are held', () => {
    sendFestival({ type: 'init', options: FESTIVAL });
    const expected = new OpenWorldSimulation(FESTIVAL);
    sendFestival({ type: 'pause', value: false });
    for (let batch = 0; batch < 8; batch++) {
      sendFestival({ type: 'input', input: { ...controls(), throttle: 0.1 } });
      advance('festival', 50);
      for (let tick = 0; tick < 6; tick++) {
        expected.setInput({ ...controls(), throttle: 0.1 });
        expected.step(DT);
      }
    }
    expect(festivalFrames()).toHaveLength(4);
    expectState(festival, expected);
    sendFestival({ type: 'input', input: { ...controls(), shift: 1 } });
    sendFestival({ type: 'input', input: { ...controls(), shift: -1 } });
    sendFestival({
      type: 'command',
      command: { type: 'start', event: 'valley-sprint' },
      requestId: 21,
    });
    expected.command({ type: 'start', event: 'valley-sprint' });
    const event = festival;
    const before = rows(event).length;
    const initial = festivalFrames().at(-1)!;
    expect(new Float32Array(initial.buffer)[H.CARS]).toBe(4);
    sendFestival({ type: 'input', input: { ...controls(), shift: 1, throttle: 0.2 } });
    sendFestival({
      type: 'command',
      command: { type: 'vehicle', id: 'not-a-vehicle' },
      requestId: 22,
    });
    advance('festival', 50);
    for (const shift of [1, 0, 0, 0, 0, 0]) {
      expected.setInput({ ...controls(), throttle: 0.2, shift });
      expected.step(DT);
    }
    expect(
      rows(event)
        .slice(before)
        .map((row) => row.input.shift),
    ).toEqual([1, 0, 0, 0, 0, 0]);
    expectState(festival, expected);

    sendFestival({ type: 'input', input: { ...controls(), shift: -1 } });
    sendFestival({ type: 'pause', value: true });
    expected.setInput(controls());
    sendFestival({ type: 'command', command: { type: 'cancel' }, requestId: 23 });
    expected.command({ type: 'cancel' });
    sendFestival({ type: 'command', command: { type: 'vehicle', id: 'tc1' }, requestId: 24 });
    expected.command({ type: 'vehicle', id: 'tc1' });
    sendFestival({ type: 'input', input: { ...controls(), shift: 1 } });
    expected.setInput(controls());
    sendFestival({ type: 'pause', value: false });
    const resumed = rows(festival).length;
    advance('festival', 50);
    for (let tick = 0; tick < 6; tick++) expected.step(DT);
    expect(
      rows(festival)
        .slice(resumed)
        .map((row) => row.input.shift),
    ).toEqual([0, 0, 0, 0, 0, 0]);
    expectState(festival, expected);
    expect(festivalMessages.filter((m) => m.type === 'error')).toEqual([]);
    expect(festivalMessages).toContainEqual({
      type: 'command-result',
      requestId: 22,
      error: 'Vehicle not-a-vehicle cannot run in the festival',
    });
    expect(detached.every((buffer) => buffer.byteLength === 0)).toBe(true);
  });
});
