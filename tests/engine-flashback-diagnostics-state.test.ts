import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { controls, DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import {
  isEngineeringSample,
  type ClientMessage,
  type EngineeringMessage,
  type WorkerMessage,
} from '../src/workers/diagnostics.ts';

const options: SessionOptions = {
  ...DEFAULT_OPTIONS,
  mode: 'practice',
  circuit: 'aurel',
  vehicles: ['apx01'],
  opponents: 0,
  assist: 'raw',
  seed: 80632,
};
let now = 0;
let pump: () => void;
let pauseSequence = 0;
const messages: WorkerMessage[] = [];
const hostMessages: ClientMessage[] = [];
const scope = {
  onmessage: null as ((event: { data: ClientMessage }) => void) | null,
  postMessage(message: WorkerMessage, transfer: Transferable[] = []) {
    messages.push(structuredClone(message, { transfer }));
  },
};
const send = (data: ClientMessage) => {
  hostMessages.push(structuredClone(data));
  scope.onmessage!({ data: structuredClone(data) });
};
const samples = () =>
  messages.filter((message): message is EngineeringMessage => message.type === 'engineering');
const acknowledge = (message: Pick<EngineeringMessage, 'epoch' | 'sequence'>) =>
  send({ type: 'engineeringAck', epoch: message.epoch, sequence: message.sequence });
const advance = (ms: number) => {
  now += ms;
  pump();
};
function resume() {
  send({ type: 'pause', value: false, sequence: ++pauseSequence });
  send({ type: 'input', input: { ...controls(), brake: 0.4 } });
}
function runForward() {
  resume();
  for (let turn = 0; turn < 3; turn++) advance(100);
}
function beginFlashback(tick: number) {
  send({ type: 'pause', value: true, sequence: ++pauseSequence });
  send({ type: 'flashback', tick });
}
function finishFlashback(tick: number) {
  const before = messages.length;
  advance(4);
  const completion = messages.slice(before);
  expect(completion.map((message) => message.type)).toEqual(['flashback', 'surface', 'frame']);
  expect(completion[0]).toMatchObject({ type: 'flashback', tick });
  const frame = completion[2];
  if (frame?.type !== 'frame') throw new Error('Missing flashback completion frame');
  expect(new Float32Array(frame.buffer)[H.TICK]).toBe(tick);
}
function expectOneEnable() {
  expect(hostMessages.filter((message) => message.type === 'engineering')).toEqual([
    { type: 'engineering', enabled: true },
  ]);
}

beforeAll(async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    pump = callback;
    return 1;
  });
  // Exercise the real worker and resimulation once per module graph. Session
  // boundaries below use init messages, not private-state or module resets.
  await import('../src/workers/physics.worker.ts');
});
beforeEach(() => {
  // Disable before returning old tickets so cleanup cannot publish successors.
  // Surface credits also survive init and must be retired through their ACKs.
  send({ type: 'engineering', enabled: false });
  for (const message of messages) {
    if (message.type === 'engineering') acknowledge(message);
    if (message.type === 'surface')
      send({ type: 'surfaceAck', epoch: message.epoch, sequence: message.sequence });
  }
  messages.length = hostMessages.length = 0;
  pauseSequence = 0;
  now += 1000;
  send({ type: 'init', options });
});
afterEach(() => {
  expect(messages.filter((message) => message.type === 'error')).toEqual([]);
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('engineering state across actual worker flashback completion', () => {
  it('resumes without another enable and restarts the twelve-tick cadence before the old sample tick', () => {
    runForward();
    send({ type: 'engineering', enabled: true });
    const before = samples()[0];
    expect(before.sample.tick).toBe(36);
    acknowledge(before);
    expect(samples()).toHaveLength(1);

    beginFlashback(12);
    finishFlashback(12);
    expect(samples()).toHaveLength(1);
    // The host completes flashback and resumes; it does not resend the debug
    // toggle. A future lastTick from the old timeline must not delay sampling.
    resume();
    advance(10);
    expect(samples()).toHaveLength(2);
    const restored = samples()[1];
    expect(restored.sample.tick).toBe(13);
    expect(restored.sample.tick).toBeLessThan(before.sample.tick);
    expect(restored.epoch).toBe(before.epoch + 1);
    expect(restored.sequence).toBe(before.sequence + 1);
    expect(isEngineeringSample(restored.sample)).toBe(true);

    acknowledge(restored);
    advance(90);
    expect(samples()).toHaveLength(2);
    advance(10);
    expect(samples()).toHaveLength(3);
    expect(samples()[2].sample.tick).toBe(restored.sample.tick + 12);
    expect(samples()[2].epoch).toBe(restored.epoch);
    expect(samples()[2].sequence).toBe(restored.sequence + 1);
    expectOneEnable();
  });

  it('holds old credit across the rebase and lets one valid ACK resume without duplicate credit', () => {
    runForward();
    send({ type: 'engineering', enabled: true });
    const held = samples()[0];
    const saved = structuredClone(held);
    expect(held.sample.tick).toBe(36);

    beginFlashback(12);
    finishFlashback(12);
    resume();
    advance(100);
    expect(samples()).toEqual([saved]);
    acknowledge({ ...held, epoch: held.epoch + 1 });
    acknowledge({ ...held, sequence: held.sequence + 1 });
    expect(samples()).toEqual([saved]);

    acknowledge(held);
    expect(samples()).toHaveLength(2);
    const restored = samples()[1];
    expect(restored.sample.tick).toBe(24);
    expect(restored.epoch).toBe(held.epoch + 1);
    expect(restored.sequence).toBe(held.sequence + 1);
    expect(isEngineeringSample(restored.sample)).toBe(true);

    acknowledge(held);
    acknowledge({ epoch: restored.epoch, sequence: held.sequence });
    advance(100);
    expect(samples()).toHaveLength(2);
    expect(held).toEqual(saved);
    acknowledge(restored);
    expect(samples()).toHaveLength(3);
    expect(samples()[2].sample.tick).toBe(36);
    expect(samples()[2].epoch).toBe(restored.epoch);
    expect(samples()[2].sequence).toBe(restored.sequence + 1);
    acknowledge(held);
    expect(samples()).toHaveLength(3);
    expectOneEnable();
  });

  it.each([false, true])(
    'keeps diagnostics disabled after rewind (previously enabled=%s)',
    (previouslyEnabled) => {
      if (previouslyEnabled) {
        send({ type: 'engineering', enabled: true });
        send({ type: 'engineering', enabled: false });
      }
      runForward();
      const before = samples().length;
      beginFlashback(12);
      finishFlashback(12);
      resume();
      advance(100);
      for (const message of samples()) acknowledge(message);
      advance(100);
      expect(samples()).toHaveLength(before);
      send({ type: 'pause', value: true, sequence: ++pauseSequence });
      expect(messages.at(-1)).toMatchObject({ type: 'pauseState', value: true, tick: 36 });
    },
  );

  it.each([false, true])(
    'keeps the latest toggle received during rewind (initially enabled=%s)',
    (initiallyEnabled) => {
      send({ type: 'engineering', enabled: initiallyEnabled });
      runForward();
      beginFlashback(12);
      expect(messages.some((message) => message.type === 'flashback')).toBe(false);
      send({ type: 'engineering', enabled: !initiallyEnabled });
      const held = samples()[0];
      expect(samples()).toHaveLength(1);

      finishFlashback(12);
      resume();
      advance(100);
      expect(samples()).toHaveLength(1);
      acknowledge(held);
      if (initiallyEnabled) {
        advance(100);
        expect(samples()).toHaveLength(1);
      } else {
        expect(samples()).toHaveLength(2);
        expect(samples()[1].sample.tick).toBe(24);
        expect(samples()[1].epoch).toBe(held.epoch + 1);
        expect(samples()[1].sequence).toBe(held.sequence + 1);
      }
    },
  );

  it('still disables inspection on fresh init even when the prior session was enabled', () => {
    send({ type: 'engineering', enabled: true });
    const held = samples()[0];
    resume();
    advance(100);
    send({ type: 'init', options });
    resume();
    advance(100);
    acknowledge(held);
    advance(100);
    expect(samples()).toHaveLength(1);
    send({ type: 'pause', value: true, sequence: ++pauseSequence });
    expect(messages.at(-1)).toMatchObject({ type: 'pauseState', value: true, tick: 24 });

    // A new session still requires an explicit choice to enable inspection.
    send({ type: 'engineering', enabled: true });
    expect(samples()).toHaveLength(2);
    expect(samples()[1].sample.tick).toBe(24);
    expect(samples()[1].epoch).toBeGreaterThan(held.epoch);
    expect(samples()[1].sequence).toBe(held.sequence + 1);
  });
});
