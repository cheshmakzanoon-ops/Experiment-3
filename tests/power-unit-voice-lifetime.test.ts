import { afterEach, describe, expect, it, vi } from 'vitest';
import { Random } from '../src/core/math.ts';
import {
  POWER_UNIT_MAX_LIVE_BURSTS,
  PowerUnitAudio,
  newPowerUnitMix,
  powerUnitMix,
} from '../src/audio/power-unit.ts';
import { CAR_STRIDE, F, HEADER, carBase } from '../src/simulation/protocol.ts';
import { FakeContext, FakeNode, asContext, asNode } from './fake-audio.ts';

const o = carBase(0);
function frame(gear = 6, crackle = true) {
  const data = new Float32Array(HEADER + CAR_STRIDE);
  data[o + F.RPM] = 12000;
  data[o + F.ENGINE_TORQUE] = crackle ? -50 : 600;
  data[o + F.THROTTLE] = crackle ? 0 : 1;
  data[o + F.SPEED] = 70;
  data[o + F.GEAR] = gear;
  return data;
}
function fixture(offline = false, sampleRate = 48000) {
  const context = new FakeContext();
  context.sampleRate = sampleRate;
  if (offline) Object.assign(context, { startRendering() {} });
  const audio = new PowerUnitAudio(asContext(context), asNode(context.destination));
  const filter = context.of('biquad')[0];
  const update = (time: number, gear = 6, crackle = true) => {
    context.currentTime = time;
    audio.update(frame(gear, crackle), 0, time, 1, true);
  };
  return { context, audio, filter, update };
}
function owned(audio: PowerUnitAudio) {
  return (audio as unknown as { voices: ReadonlySet<unknown> }).voices.size;
}
function firstBurst() {
  const f = fixture();
  f.update(0);
  f.update(0.1);
  const source = f.context.of('source')[0];
  return { ...f, source, level: source.outputs[0] };
}

afterEach(() => vi.restoreAllMocks());

describe('power-unit transient ownership', () => {
  it('cancels a future burst and filter event before a reset presentation reopens', () => {
    const { audio, context, filter, source, level, update } = firstBurst();
    expect(source.started).toEqual([0.16721548994537444]);
    expect(owned(audio)).toBe(1);
    audio.reset();
    expect(source.stopped).toEqual([undefined]);
    expect(source.outputs).toEqual([]);
    expect(level.outputs).toEqual([]);
    expect(source.onended).toBeNull();
    expect(owned(audio)).toBe(0);
    expect(filter.frequency.events.at(-1)).toEqual({ kind: 'cancel', time: 0.1, value: 0 });
    update(0.125, 6, false);
    expect(context.of('source')).toHaveLength(1);
    update(0.225);
    expect(context.of('source')).toHaveLength(2);
    expect(owned(audio)).toBe(1);
    expect(context.of('source')[1].outputs[0].outputs).toEqual([filter]);
    expect(source.stopped).toHaveLength(1);
    audio.dispose();
  });

  it('owns overlapping shift and crackle branches and ignores late ended callbacks', () => {
    const f = fixture();
    f.update(0);
    f.update(0.1, 7);
    const sources = f.context.of('source');
    expect(sources).toHaveLength(2);
    expect(sources[0].started).toEqual([0.1]);
    const levels = sources.map((source) => source.outputs[0]);
    const ended = sources.map((source) => source.onended);
    const releases = [...sources, ...levels].map((node) => vi.spyOn(node, 'disconnect'));
    f.audio.reset();
    expect(sources.every((source) => source.stopped.length === 1)).toBe(true);
    expect([...sources, ...levels].every((node) => node.outputs.length === 0)).toBe(true);
    f.update(0.2, 7, false);
    f.update(0.21, 8, false);
    expect(owned(f.audio)).toBe(1);
    ended.forEach((callback) => callback?.());
    expect(owned(f.audio)).toBe(1);
    expect(releases.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    f.audio.dispose();
  });

  it('retires natural completion without stopping an already ended source', () => {
    const { audio, source, level } = firstBurst();
    const ended = source.onended;
    const releases = [source, level].map((node) => vi.spyOn(node, 'disconnect'));
    ended?.();
    expect(owned(audio)).toBe(0);
    expect(source.stopped).toEqual([]);
    expect(source.onended).toBeNull();
    ended?.();
    audio.reset();
    audio.dispose();
    expect(releases.every((spy) => spy.mock.calls.length === 1)).toBe(true);
  });

  it('reaps completed audio-time voices when ended delivery is delayed', () => {
    const { audio, source, level, update } = firstBurst();
    const ended = source.onended;
    update(0.21, 6, false);
    expect(owned(audio)).toBe(0);
    expect(source.stopped).toEqual([]);
    expect([source, level].every((node) => node.outputs.length === 0)).toBe(true);
    ended?.();
    expect(owned(audio)).toBe(0);
    audio.dispose();
  });

  it('uses the exact rounded buffer duration instead of a nominal 30ms expiry', () => {
    const f = fixture(false, 44117);
    f.update(0, 3, false);
    f.update(0.1, 4, false);
    const end = 0.1 + Math.ceil(44117 * 0.03) / 44117;
    f.update(end - 1e-9, 4, false);
    expect(owned(f.audio)).toBe(1);
    f.update(end, 4, false);
    expect(owned(f.audio)).toBe(0);
    f.audio.dispose();
  });

  it('does not expire a past-scheduled source before its immediate playback finishes', () => {
    const f = fixture();
    f.update(0.95, 3, false);
    f.context.currentTime = 2;
    f.audio.update(frame(4, false), 0, 1, 1, true);
    expect(f.context.of('source')[0].started).toEqual([1]);
    // Keep the supplied timeline continuous and behind the device clock: this
    // isolates actual playback expiry from discontinuity cleanup.
    f.context.currentTime = 2.029;
    f.audio.update(frame(4, false), 0, 1.029, 1, true);
    expect(owned(f.audio)).toBe(1);
    f.context.currentTime = 2.03;
    f.audio.update(frame(4, false), 0, 1.03, 1, true);
    expect(owned(f.audio)).toBe(0);
    f.audio.dispose();
  });

  it('bounds a stalled real-time clock without allocating rejected voices and resumes later', () => {
    const f = fixture();
    f.update(0, 3, false);
    for (let i = 0; i < 1000; i++) f.update(0, i % 2 ? 3 : 4, false);
    expect(f.context.of('source')).toHaveLength(POWER_UNIT_MAX_LIVE_BURSTS);
    expect(owned(f.audio)).toBe(POWER_UNIT_MAX_LIVE_BURSTS);
    expect(f.audio.bursts).toBe(POWER_UNIT_MAX_LIVE_BURSTS);
    f.update(1, 3, false);
    expect(owned(f.audio)).toBe(0);
    f.update(1.01, 4, false);
    expect(owned(f.audio)).toBe(1);
    expect(f.audio.bursts).toBe(POWER_UNIT_MAX_LIVE_BURSTS + 1);
    f.audio.dispose();
  });

  it('preserves complete offline future plans while audio time is still zero', () => {
    const f = fixture(true);
    f.audio.update(frame(3, false), 0, 0, 1, true);
    for (let i = 1; i <= 200; i++) f.audio.update(frame(i % 2 ? 4 : 3, false), 0, i / 60, 1, true);
    expect(f.context.currentTime).toBe(0);
    expect(f.audio.bursts).toBe(200);
    expect(owned(f.audio)).toBe(200);
    expect(f.context.of('source').every((source) => source.outputs.length === 1)).toBe(true);
    expect(f.context.of('source').map((source) => source.started[0])).toEqual(
      Array.from({ length: 200 }, (_, i) => (i + 1) / 60),
    );
    f.audio.reset();
    expect(owned(f.audio)).toBe(0);
    expect(f.context.of('source').every((source) => source.stopped.length === 1)).toBe(true);
    f.audio.dispose();
  });

  it('disposes all live branches once and makes later updates and resets inert', () => {
    const { audio, context, source } = firstBurst();
    const ended = source.onended;
    const releases = context.nodes.map((node) => vi.spyOn(node, 'disconnect'));
    audio.dispose();
    expect(owned(audio)).toBe(0);
    expect(context.nodes.every((node) => node.outputs.length === 0)).toBe(true);
    expect(
      context.nodes
        .filter((node) => node.started.length)
        .every((node) => node.stopped.length === 1),
    ).toBe(true);
    const counts = releases.map((spy) => spy.mock.calls.length);
    const allocations = context.nodes.length;
    audio.dispose();
    audio.reset();
    ended?.();
    expect(() => audio.update(new Float32Array(), 0, 1, 1, true)).not.toThrow();
    expect(releases.map((spy) => spy.mock.calls.length)).toEqual(counts);
    expect(context.nodes).toHaveLength(allocations);
  });

  it.each(['stop', 'source disconnect', 'gain disconnect'] as const)(
    'releases independent transient ownership after a failed %s',
    (failure) => {
      const { audio, context, source, level } = firstBurst();
      const stopping = vi.spyOn(source, 'stop');
      const sourceRelease = vi.spyOn(source, 'disconnect');
      const levelRelease = vi.spyOn(level, 'disconnect');
      const failing =
        failure === 'stop'
          ? stopping
          : failure === 'source disconnect'
            ? sourceRelease
            : levelRelease;
      failing.mockImplementation(() => {
        throw new Error(failure);
      });
      expect(() => audio.reset()).not.toThrow();
      expect(owned(audio)).toBe(0);
      expect(stopping).toHaveBeenCalledTimes(1);
      expect(sourceRelease).toHaveBeenCalledTimes(1);
      expect(levelRelease).toHaveBeenCalledTimes(1);
      expect(source.onended).toBeNull();
      audio.dispose();
      expect(context.of('oscillator').every((node) => node.stopped.length === 1)).toBe(true);
    },
  );

  it('attempts output reset after a failed filter cancellation and permits a later retry', () => {
    const { audio, context, filter, source, update } = firstBurst();
    const failure = new Error('automation unavailable');
    const cancel = vi
      .spyOn(filter.frequency, 'cancelScheduledValues')
      .mockImplementationOnce(() => {
        throw failure;
      });
    expect(() => audio.reset()).toThrow(failure);
    expect(source.stopped).toHaveLength(1);
    expect(owned(audio)).toBe(0);
    expect(context.of('gain')[0].gain.events.at(-1)).toEqual({
      kind: 'target',
      value: 0,
      time: 0.1,
    });
    expect(cancel).toHaveBeenCalledOnce();
    update(0.2, 6, false);
    update(0.21, 7, false);
    expect(owned(audio)).toBe(1);
    audio.dispose();
  });

  it('finishes terminal graph cleanup before reporting the first oscillator failure', () => {
    const { audio, context, source } = firstBurst();
    const failure = new Error('oscillator unavailable');
    vi.spyOn(context.of('oscillator')[0], 'stop').mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => audio.dispose()).toThrow(failure);
    expect(source.stopped).toHaveLength(1);
    expect(
      context
        .of('oscillator')
        .slice(1)
        .every((node) => node.stopped.length === 1),
    ).toBe(true);
    expect(context.nodes.every((node) => node.outputs.length === 0)).toBe(true);
    expect(owned(audio)).toBe(0);
    expect(() => audio.dispose()).not.toThrow();
  });

  it('blocks reentrant scheduling during reset and releases 1000 generations', () => {
    const f = fixture();
    for (let i = 0; i < 1000; i++) {
      const time = i / 10;
      f.update(time, 3, false);
      f.update(time + 0.001, 4, false);
      const source = f.context.of('source').at(-1)!;
      const stop = source.stop.bind(source);
      source.stop = () => {
        stop();
        f.audio.reset();
        f.audio.update(frame(5, false), 0, time + 0.002, 1, true);
      };
      f.audio.reset();
      expect(owned(f.audio)).toBe(0);
      expect(source.stopped).toHaveLength(1);
      expect(source.outputs).toHaveLength(0);
    }
    expect(f.audio.bursts).toBe(1000);
    f.audio.dispose();
  });
});

const setupFailures = [
  'handler',
  'buffer',
  'gain allocation',
  'gain value',
  'source connection',
  'gain connection',
  'filter event',
  'start',
  'partial start',
] as const;
describe('failed transient setup', () => {
  it.each(setupFailures)('retires all allocated nodes after %s fails', (stage) => {
    const f = fixture();
    f.update(0, 3, false);
    const originalSource = f.context.createBufferSource.bind(f.context);
    const originalGain = f.context.createGain.bind(f.context);
    const failure = new Error(stage);
    let source!: FakeNode;
    let level: FakeNode | undefined;
    vi.spyOn(f.context, 'createBufferSource').mockImplementationOnce(() => {
      source = originalSource();
      if (stage === 'handler' || stage === 'buffer')
        Object.defineProperty(source, stage === 'handler' ? 'onended' : 'buffer', {
          get: () => null,
          set: () => {
            throw failure;
          },
        });
      if (stage === 'source connection')
        vi.spyOn(source, 'connect').mockImplementationOnce(() => {
          throw failure;
        });
      if (stage === 'start' || stage === 'partial start') {
        const start = source.start.bind(source);
        vi.spyOn(source, 'start').mockImplementationOnce((time) => {
          if (stage === 'partial start') start(time);
          throw failure;
        });
      }
      return source;
    });
    vi.spyOn(f.context, 'createGain').mockImplementationOnce(() => {
      if (stage === 'gain allocation') throw failure;
      level = originalGain();
      if (stage === 'gain value')
        Object.defineProperty(level.gain, 'value', {
          set: () => {
            throw failure;
          },
        });
      if (stage === 'gain connection')
        vi.spyOn(level, 'connect').mockImplementationOnce(() => {
          throw failure;
        });
      return level;
    });
    if (stage === 'filter event')
      vi.spyOn(f.filter.frequency, 'setValueAtTime').mockImplementationOnce(() => {
        throw failure;
      });
    expect(() => f.update(0.01, 4, false)).toThrow(failure);
    expect(owned(f.audio)).toBe(0);
    expect(source.outputs).toEqual([]);
    if (level) expect(level.outputs).toEqual([]);
    expect(f.audio.bursts).toBe(0);
    vi.restoreAllMocks();
    f.audio.reset();
    f.update(1, 3, false);
    f.update(1.01, 4, false);
    expect(f.audio.bursts).toBe(1);
    expect(owned(f.audio)).toBe(1);
    f.audio.dispose();
  });
});

/** Frozen scheduling behavior from before ownership was introduced. */
function legacyEvents(samples: { time: number; data: Float32Array }[]) {
  const random = new Random(90127),
    mix = newPowerUnitMix();
  let previousGear = NaN,
    lastTime = NaN,
    clock = 0;
  const events: [number, number, number][] = [];
  for (const { time, data } of samples) {
    const m = powerUnitMix(data, 0, previousGear, mix);
    previousGear = data[o + F.GEAR];
    const dt = Number.isFinite(lastTime) ? Math.min(0.1, Math.max(0, time - lastTime)) : 0;
    lastTime = time;
    if (m.shift > 0) events.push([time, 0.28, 2400]);
    else if (m.shift < 0) events.push([time, 0.2, 1500]);
    clock += m.crackleRate * dt;
    while (clock >= 1) {
      clock -= 1;
      events.push([
        time + random.next() * dt,
        0.1 + random.next() * 0.12,
        1300 + random.next() * 1400,
      ]);
    }
  }
  return events;
}

describe('unchanged ordinary audio scheduling', () => {
  // The former 5 Hz cap lost elapsed time; its corrected rate and bounded
  // ownership are covered by power-unit-cadence.test.ts instead of this baseline.
  it.each([10, 30, 60])('preserves exact event times, gains and filter values at %s Hz', (hz) => {
    const f = fixture();
    const samples = Array.from({ length: hz * 10 + 1 }, (_, i) => ({
      time: i / hz,
      data: frame(3 + (Math.floor(i / hz) % 4), Math.floor(i / hz) % 3 !== 1),
    }));
    for (const { time, data } of samples) {
      f.context.currentTime = time;
      f.audio.update(data, 0, time, 1, true);
      expect(owned(f.audio)).toBeLessThan(POWER_UNIT_MAX_LIVE_BURSTS);
    }
    const frequencies = f.filter.frequency.events.filter((event) => event.kind === 'set');
    const actual = f.context
      .of('source')
      .map((source, i) => [
        source.started[0],
        f.context.nodes[f.context.nodes.indexOf(source) + 1].gain.value,
        frequencies[i].value,
      ]);
    expect(actual).toEqual(legacyEvents(samples));
    expect(f.audio.bursts).toBe(actual.length);
    f.audio.dispose();
  });
});
