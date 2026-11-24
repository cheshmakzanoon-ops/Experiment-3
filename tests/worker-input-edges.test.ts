import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InputLog, Resimulation } from '../src/core/flashback.ts';
import {
  controls,
  DEFAULT_OPTIONS,
  type Controls,
  type SessionOptions,
} from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { CAR_STRIDE, HEADER } from '../src/simulation/protocol.ts';
import type { Vehicle } from '../src/simulation/vehicle.ts';
import type { ClientMessage, WorkerMessage } from '../src/workers/diagnostics.ts';
import type { FromOpenWorld, ToOpenWorld } from '../src/workers/open-world-protocol.ts';
import { MAX_PENDING_SHIFTS, ShiftInputQueue } from '../src/workers/input-queue.ts';

describe('bounded shift intent', () => {
  it('keeps pulses in order, consumes each once, and ignores neutral or invalid samples', () => {
    const queue = new ShiftInputQueue();
    for (const value of [0, 5, NaN, -2, Infinity, 1, -Infinity, -0]) queue.push(value);
    expect(queue.pending).toBe(3);
    expect([queue.take(), queue.take(), queue.take(), queue.take()]).toEqual([1, -1, 1, 0]);
    expect(queue.pending).toBe(0);
  });

  it('drops newest overflow, wraps its fixed storage, and clears all pending intent', () => {
    const queue = new ShiftInputQueue();
    for (let i = 0; i < MAX_PENDING_SHIFTS; i++) queue.push(i % 3 ? 1 : -1);
    for (let i = 0; i < 10000; i++) queue.push(-1);
    expect(queue.pending).toBe(MAX_PENDING_SHIFTS);
    for (let i = 0; i < 11; i++) expect(queue.take()).toBe(i % 3 ? 1 : -1);
    for (let i = 0; i < 11; i++) queue.push(-1);
    for (let i = 11; i < MAX_PENDING_SHIFTS; i++) expect(queue.take()).toBe(i % 3 ? 1 : -1);
    for (let i = 0; i < 11; i++) expect(queue.take()).toBe(-1);
    expect(queue.take()).toBe(0);
    queue.push(1);
    queue.clear();
    expect(queue.pending).toBe(0);
    expect(queue.take()).toBe(0);
    queue.push(-1);
    expect(queue.take()).toBe(-1);
  });
});

type Engine = Simulation | OpenWorldSimulation;
type Message = WorkerMessage | FromOpenWorld;
type InputMessage = { type: 'input'; input: Controls } | { type: 'pause'; value: boolean };
interface AppliedTick {
  tick: number;
  input: Controls;
}
const OPTIONS: SessionOptions = {
  ...DEFAULT_OPTIONS,
  mode: 'practice',
  vehicles: ['gpr1'],
  opponents: 0,
  assist: 'raw',
  seed: 9815,
};
let now = 0;
const records = new WeakMap<Engine, AppliedTick[]>();
let lastLog: InputLog | undefined;
const circuit = {
  current: undefined as Simulation | undefined,
  pump: undefined as (() => void) | undefined,
  messages: [] as Message[],
  send(data: ClientMessage) {
    circuitScope.onmessage!({ data: structuredClone(data) });
  },
  init(options = OPTIONS) {
    this.send({ type: 'init', options });
  },
};
const festival = {
  current: undefined as OpenWorldSimulation | undefined,
  pump: undefined as (() => void) | undefined,
  messages: [] as Message[],
  send(data: ToOpenWorld) {
    festivalScope.onmessage!({ data: structuredClone(data) });
  },
  init() {
    this.send({
      type: 'init',
      options: { vehicle: 'tc1', assist: 'raw', weather: 'clear', seed: 9815, traffic: false },
    });
  },
};
const circuitScope = {
  onmessage: null as ((event: { data: ClientMessage }) => void) | null,
  postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
    const copy = structuredClone(message, { transfer });
    circuit.messages.push(copy);
    if (copy.type === 'surface')
      circuit.send({ type: 'surfaceAck', epoch: copy.epoch, sequence: copy.sequence });
  },
};
const festivalScope = {
  onmessage: null as ((event: { data: ToOpenWorld }) => void) | null,
  postMessage(message: FromOpenWorld, transfer: Transferable[] = []) {
    festival.messages.push(structuredClone(message, { transfer }));
  },
};
function player(engine: Engine): Vehicle {
  return engine.cars[0];
}
function record(engine: Engine) {
  let entries = records.get(engine);
  if (!entries) records.set(engine, (entries = []));
  entries.push({ tick: engine.tick, input: { ...player(engine).input } });
}
function rows(engine: Engine) {
  return records.get(engine) ?? [];
}
function pose(engine: Engine) {
  const frame = new Float32Array(HEADER + engine.cars.length * CAR_STRIDE);
  engine.writeFrame(frame, 0, 0);
  const car = player(engine),
    body = car.body;
  return {
    frame,
    position: { ...body.position },
    velocity: { ...body.velocity },
    omega: { ...body.omega },
    orientation: { ...body.orientation },
    fuel: car.fuel,
    battery: car.battery,
    gear: car.gear,
    input: { ...car.input },
  };
}
function observeCircuit(engine: Simulation) {
  circuit.current = engine;
}
function observeFestival(engine: OpenWorldSimulation) {
  festival.current = engine;
}
function observeLog(log: InputLog) {
  lastLog = log;
}

beforeAll(async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const circuitWrite = Simulation.prototype.writeFrame;
  vi.spyOn(Simulation.prototype, 'writeFrame').mockImplementation(function (
    this: Simulation,
    ...args
  ) {
    observeCircuit(this);
    return circuitWrite.apply(this, args);
  });
  const festivalWrite = OpenWorldSimulation.prototype.writeFrame;
  vi.spyOn(OpenWorldSimulation.prototype, 'writeFrame').mockImplementation(function (
    this: OpenWorldSimulation,
    ...args
  ) {
    observeFestival(this);
    return festivalWrite.apply(this, args);
  });
  const circuitStep = Simulation.prototype.step;
  vi.spyOn(Simulation.prototype, 'step').mockImplementation(function (this: Simulation, dt) {
    record(this);
    return circuitStep.call(this, dt);
  });
  const festivalStep = OpenWorldSimulation.prototype.step;
  vi.spyOn(OpenWorldSimulation.prototype, 'step').mockImplementation(function (
    this: OpenWorldSimulation,
    dt,
  ) {
    record(this);
    return festivalStep.call(this, dt);
  });
  const logInput = InputLog.prototype.input;
  vi.spyOn(InputLog.prototype, 'input').mockImplementation(function (this: InputLog, ...args) {
    observeLog(this);
    return logInput.apply(this, args);
  });
  // Each actual worker graph loads once. Tests reinitialize through its real
  // protocol; repeated module-graph resets would retain authored world data.
  vi.stubGlobal('self', circuitScope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    circuit.pump = callback;
    return 1;
  });
  await import('../src/workers/physics.worker.ts');
  vi.stubGlobal('self', festivalScope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    festival.pump = callback;
    return 2;
  });
  await import('../src/workers/open-world.worker.ts');
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

for (const [name, runtime] of [
  ['circuit', circuit],
  ['Festival', festival],
] as const) {
  const send = (message: InputMessage) => runtime.send(message);
  const input = (shift: number, extra: Partial<Controls> = {}) =>
    send({ type: 'input', input: { ...controls(), ...extra, shift } });
  const advance = (ms: number) => {
    now += ms;
    runtime.pump!();
  };
  const start = () => {
    runtime.messages.length = 0;
    now += 1000;
    runtime.init();
    send({ type: 'pause', value: false });
    return runtime.current!;
  };

  describe(`${name} actual worker input delivery`, () => {
    it('keeps a shift followed by neutral while applying the newest analog controls', () => {
      const engine = start();
      const before = player(engine).gear;
      input(1, { throttle: 0.2 });
      input(0, { throttle: 0.6, brake: 0.1, steer: -0.15, riderLean: 0.3, rearBrake: 0.2 });
      expect(player(engine).input.shift).toBe(0);
      advance(10);
      expect(rows(engine)[0]).toMatchObject({
        tick: 0,
        input: {
          shift: 1,
          throttle: 0.6,
          brake: 0.1,
          steer: -0.15,
          riderLean: 0.3,
          rearBrake: 0.2,
        },
      });
      expect(player(engine).gear).toBe(before + 1);
      advance(30);
      expect(rows(engine).map((row) => row.input.shift)).toEqual([1, 0, 0, 0]);
      expect(runtime.messages.filter((message) => message.type === 'error')).toEqual([]);
    });

    it('consumes neutral-then-shift once across a full catch-up turn', () => {
      const engine = start();
      input(0);
      input(1);
      advance(200);
      expect(rows(engine)).toHaveLength(24);
      expect(rows(engine).map((row) => row.input.shift)).toEqual([1, ...Array(23).fill(0)]);
    });

    it('delivers distinct opposing and repeated pulses FIFO without repeating a held sample', () => {
      const engine = start();
      // Explicit nonzero messages are separate presses in this pulse protocol;
      // there need not be a neutral polling sample between two real presses.
      for (const shift of [1, -1, -1, 1]) input(shift);
      input(0, { throttle: 0.15 });
      advance(50);
      expect(rows(engine).map((row) => row.input.shift)).toEqual([1, -1, -1, 1, 0, 0]);
      expect(rows(engine)[0].input.throttle).toBe(0.15);
    });

    it('does not consume a pulse on turns with no physics step', () => {
      const engine = start();
      input(1);
      advance(3);
      input(0);
      advance(3);
      expect(rows(engine)).toHaveLength(0);
      advance(3);
      expect(rows(engine).map((row) => row.input.shift)).toEqual([1]);
    });

    it('clears pending and paused input pulses before resuming', () => {
      const engine = start();
      input(1);
      input(-1);
      send({ type: 'pause', value: true });
      input(1);
      advance(50);
      expect(rows(engine)).toHaveLength(0);
      send({ type: 'pause', value: false });
      advance(20);
      expect(rows(engine).map((row) => row.input.shift)).toEqual([0, 0]);
    });

    it('clears an old session queue when initialized again', () => {
      start();
      input(1);
      input(-1);
      runtime.init();
      const fresh = runtime.current!;
      send({ type: 'pause', value: false });
      advance(20);
      expect(rows(fresh).map((row) => row.input.shift)).toEqual([0, 0]);
    });

    it('discards stale pending shifts when the 750 ms watchdog takes ownership', () => {
      const engine = start();
      input(1);
      input(-1);
      advance(800);
      expect(rows(engine)).toHaveLength(24);
      expect(rows(engine).every((row) => row.input.shift === 0)).toBe(true);
      expect(rows(engine)[0].input.brake).toBe(0.4);
    });

    it('bounds burst delivery to the earliest 32 pulses while preserving latest analog state', () => {
      const engine = start();
      for (let i = 0; i < MAX_PENDING_SHIFTS + 20; i++) input(i < MAX_PENDING_SHIFTS ? 1 : -1);
      input(0, { throttle: 0.25 });
      advance(200);
      advance(100);
      expect(rows(engine).map((row) => row.input.shift)).toEqual([
        ...Array(MAX_PENDING_SHIFTS).fill(1),
        ...Array(36 - MAX_PENDING_SHIFTS).fill(0),
      ]);
      expect(rows(engine)[0].input.throttle).toBe(0.25);
    });
  });
}

describe('input timeline ownership', () => {
  it('clears queued pulses on successful Festival vehicle changes but preserves them after a rejected command', () => {
    now += 1000;
    festival.init();
    festival.send({ type: 'pause', value: false });
    festival.send({ type: 'input', input: { ...controls(), shift: 1 } });
    festival.send({ type: 'command', command: { type: 'vehicle', id: 'tc1' } });
    festival.send({ type: 'input', input: { ...controls(), shift: -1 } });
    festival.send({ type: 'command', command: { type: 'vehicle', id: 'missing' }, requestId: 71 });
    const current = festival.current!;
    now += 10;
    festival.pump!();
    expect(rows(current)[0].input.shift).toBe(-1);
    expect(festival.messages).toContainEqual(
      expect.objectContaining({ type: 'command-result', requestId: 71, error: expect.any(String) }),
    );
  });

  it('records queued pulses at actual application ticks and reproduces the complete resulting state', () => {
    now += 1000;
    circuit.init();
    circuit.send({ type: 'pause', value: false });
    const current = circuit.current!;
    for (let batch = 0; batch < 8; batch++) {
      for (const shift of [1, -1, 1])
        circuit.send({
          type: 'input',
          input: { ...controls(), shift, throttle: 0.1 + batch * 0.02 },
        });
      circuit.send({ type: 'input', input: { ...controls(), throttle: 0.2, steer: 0.01 } });
      now += 50;
      circuit.pump!();
    }
    const actual = rows(current)
      .filter((row) => row.input.shift !== 0)
      .map((row) => ({ tick: row.tick, shift: row.input.shift }));
    const entries = lastLog!.entries.slice();
    const logged = entries
      .filter((entry) => entry.kind === 'input' && entry.input.shift !== 0)
      .map((entry) => ({
        tick: entry.tick,
        shift: entry.kind === 'input' ? entry.input.shift : 0,
      }));
    expect(logged).toEqual(actual);
    expect(actual).toHaveLength(24);
    expect(actual.slice(0, 3)).toEqual([
      { tick: 0, shift: 1 },
      { tick: 1, shift: -1 },
      { tick: 2, shift: 1 },
    ]);
    const expected = pose(current);
    const replay = new Resimulation(OPTIONS, entries, current.tick, { now: () => 0 });
    expect(replay.run()).toBe(true);
    expect(pose(replay.simulation)).toEqual(expected);
  });

  it('discards old and during-rewind pending pulses at flashback completion', () => {
    now += 1000;
    circuit.init();
    circuit.send({ type: 'pause', value: false });
    now += 100;
    circuit.pump!();
    circuit.send({ type: 'input', input: { ...controls(), shift: 1 } });
    circuit.send({ type: 'flashback', tick: 6 });
    circuit.send({ type: 'input', input: { ...controls(), shift: -1 } });
    now += 10;
    circuit.pump!();
    const resumed = circuit.current!;
    expect(resumed.tick).toBe(6);
    const before = rows(resumed).length;
    circuit.send({ type: 'input', input: { ...controls(), shift: 1 } });
    circuit.send({ type: 'pause', value: false });
    now += 20;
    circuit.pump!();
    expect(
      rows(resumed)
        .slice(before)
        .map((row) => row.input.shift),
    ).toEqual([0, 0]);
  });

  it.each([
    ['apx01', 'aurel'],
    ['gpr1', 'aurel'],
    ['mx450', 'valley-ridge-mx'],
  ] as const)(
    '%s keeps ordinary one-message-per-tick simulation identical to immediate input dispatch',
    (vehicle, circuitId) => {
      now += 1000;
      const options = { ...OPTIONS, vehicles: [vehicle], circuit: circuitId };
      circuit.init(options);
      circuit.send({ type: 'pause', value: false });
      const current = circuit.current!,
        immediate = new Simulation(options);
      expect(current.cars[0].definition.id).toBe(vehicle);
      for (let tick = 0; tick < 48; tick++) {
        const input = {
          ...controls(),
          throttle: 0.15 + tick / 200,
          steer: Math.sin(tick) * 0.02,
          shift: tick % 17 === 0 ? 1 : 0,
        };
        circuit.send({ type: 'input', input });
        immediate.setInput(input);
        immediate.step(1 / 120);
        now += 1000 / 120;
        circuit.pump!();
        expect(current.tick).toBe(tick + 1);
        expect(pose(current)).toEqual(pose(immediate));
      }
    },
  );

  it('drops circuit pulses at an autopilot ownership handoff', () => {
    now += 1000;
    circuit.init();
    circuit.send({ type: 'pause', value: false });
    const current = circuit.current!;
    circuit.send({ type: 'input', input: { ...controls(), shift: 1 } });
    circuit.send({ type: 'autopilot', value: true });
    circuit.send({ type: 'input', input: { ...controls(), shift: -1 } });
    circuit.send({ type: 'autopilot', value: false });
    now += 20;
    circuit.pump!();
    expect(rows(current).map((row) => row.input.shift)).toEqual([0, 0]);
  });

  it('keeps ordinary Festival ticks identical to immediate input dispatch', () => {
    now += 1000;
    festival.init();
    festival.send({ type: 'pause', value: false });
    const current = festival.current!;
    const immediate = new OpenWorldSimulation({
      vehicle: 'tc1',
      assist: 'raw',
      weather: 'clear',
      seed: 9815,
      traffic: false,
    });
    for (let tick = 0; tick < 48; tick++) {
      const input = {
        ...controls(),
        throttle: 0.15 + tick / 200,
        steer: Math.sin(tick) * 0.02,
        shift: tick % 17 === 0 ? 1 : 0,
      };
      festival.send({ type: 'input', input });
      immediate.setInput(input);
      immediate.step(1 / 120);
      now += 1000 / 120;
      festival.pump!();
      expect(current.tick).toBe(tick + 1);
      expect(pose(current)).toEqual(pose(immediate));
    }
  });
});
