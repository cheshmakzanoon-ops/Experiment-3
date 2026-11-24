import { describe, expect, it } from 'vitest';
import {
  POWER_UNIT_MAX_CONTINUOUS_GAP,
  POWER_UNIT_MAX_LIVE_BURSTS,
  PowerUnitAudio,
} from '../src/audio/power-unit.ts';
import { CAR_STRIDE, F, HEADER, carBase } from '../src/simulation/protocol.ts';
import { FakeContext, asContext, asNode } from './fake-audio.ts';

const o = carBase(0);
function frame(rpm = 12000, gear = 6) {
  const data = new Float32Array(HEADER + CAR_STRIDE);
  data[o + F.RPM] = rpm;
  data[o + F.ENGINE_TORQUE] = -50;
  data[o + F.THROTTLE] = 0;
  data[o + F.SPEED] = 70;
  data[o + F.GEAR] = gear;
  return data;
}

function fixture(offline = false) {
  const context = new FakeContext();
  if (offline) Object.assign(context, { startRendering() {} });
  const audio = new PowerUnitAudio(asContext(context), asNode(context.destination));
  const filter = context.of('biquad')[0];
  const update = (time: number, data = frame(), audioTime = time) => {
    context.currentTime = audioTime;
    audio.update(data, 0, time, 1, true);
  };
  const owned = () => (audio as unknown as { voices: ReadonlySet<unknown> }).voices.size;
  return { audio, context, filter, update, owned };
}

describe('power-unit continuous cadence', () => {
  it('produces the same constant-trajectory rate at 5, 10, 30 and 60 Hz', () => {
    const counts = [5, 10, 30, 60].map((hz) => {
      const f = fixture();
      for (let i = 0; i <= hz * 10; i++) {
        f.update(i / hz);
        expect(f.owned()).toBeLessThan(POWER_UNIT_MAX_LIVE_BURSTS);
      }
      const count = f.audio.bursts;
      // The previous 0.1 s cap produced only 70 events at 5 Hz.
      expect(count).toBeGreaterThanOrEqual(139);
      expect(count).toBeLessThanOrEqual(140);
      expect(f.context.of('source')).toHaveLength(count);
      f.audio.dispose();
      return count;
    });
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it.each([[1 / 5], [1 / 10], [1 / 30], [1 / 60], [0.02, 0.23, 0.06, 0.15, 0.04, 0.25]])(
    'preserves time-weighted rates as load and cadence change: %j',
    (...cadence) => {
      const f = fixture();
      const segments = [
        { seconds: 2, rpm: 12000, rate: 14 },
        { seconds: 3, rpm: 9750, rate: 7 },
        { seconds: 2, rpm: 8625, rate: 3.5 },
        { seconds: 3, rpm: 7000, rate: 0 },
      ];
      let time = 0;
      let step = 0;
      let integral = 0;
      f.update(time);
      for (const segment of segments) {
        const end = time + segment.seconds;
        while (time < end - 1e-12) {
          time = Math.min(end, time + cadence[step++ % cadence.length]);
          f.update(time, frame(segment.rpm));
          expect(f.owned()).toBeLessThan(POWER_UNIT_MAX_LIVE_BURSTS);
        }
        integral += segment.rate * segment.seconds;
        // Every interval uses the supplied sample's rate, including the last
        // partial interval at a state boundary. Fractional events carry forward.
        expect(Math.abs(f.audio.bursts - integral)).toBeLessThanOrEqual(1);
      }
      expect(integral).toBe(56);
      f.audio.dispose();
    },
  );

  it.each([6, 7])('bounds events at the 2 Hz continuous-update boundary in gear %s', (gear) => {
    const f = fixture();
    f.update(0);
    f.update(POWER_UNIT_MAX_CONTINUOUS_GAP, frame(12000, gear));
    const expected = gear === 6 ? 7 : 8;
    expect(f.audio.bursts).toBe(expected);
    expect(f.owned()).toBe(expected);
    const starts = f.context.of('source').map((source) => source.started[0]);
    expect(starts.every((time) => time >= 0.5 && time < 1)).toBe(true);
    f.audio.dispose();
  });

  it('does not accumulate elapsed time from repeated timestamps', () => {
    const f = fixture();
    f.update(0);
    for (let i = 0; i < 1000; i++) f.update(0);
    expect(f.audio.bursts).toBe(0);
    f.update(0.2);
    expect(f.audio.bursts).toBe(2);
    f.audio.dispose();
  });

  it('retains the live ownership cap when supplied time runs ahead of a frozen device', () => {
    const f = fixture();
    for (let i = 0; i <= 1000; i++) {
      f.update(i / 5, frame(), 0);
      expect(f.owned()).toBeLessThanOrEqual(POWER_UNIT_MAX_LIVE_BURSTS);
    }
    expect(f.audio.bursts).toBe(POWER_UNIT_MAX_LIVE_BURSTS);
    expect(f.context.of('source')).toHaveLength(POWER_UNIT_MAX_LIVE_BURSTS);
    f.audio.reset();
    expect(f.owned()).toBe(0);
    f.audio.dispose();
  });

  it('preschedules the complete 5 Hz offline trajectory while device time is zero', () => {
    const f = fixture(true);
    for (let i = 0; i <= 50; i++) f.update(i / 5, frame(), 0);
    expect(f.audio.bursts).toBe(140);
    expect(f.owned()).toBe(140);
    expect(f.context.of('source').every((source) => source.outputs.length === 1)).toBe(true);
    f.audio.reset();
    expect(f.owned()).toBe(0);
    expect(f.context.of('source').every((source) => source.stopped.length === 1)).toBe(true);
    expect(f.filter.frequency.events.at(-1)).toEqual({ kind: 'cancel', time: 0, value: 0 });
    f.audio.dispose();
  });
});

describe('power-unit timeline discontinuities', () => {
  it.each([0.500001, 3, 60, Number.MAX_VALUE])(
    'drops a %s second gap without stale crackles or gear changes',
    (gap) => {
      const f = fixture();
      f.update(0);
      f.update(0.1);
      const source = f.context.of('source')[0];
      const level = source.outputs[0];
      const ended = source.onended;
      f.update(0.1 + gap, frame(12000, 7), 0.1);
      expect(f.audio.bursts).toBe(1);
      expect(f.owned()).toBe(0);
      expect(source.stopped).toHaveLength(1);
      expect(source.outputs).toEqual([]);
      expect(level.outputs).toEqual([]);
      expect(source.onended).toBeNull();
      expect(f.filter.frequency.events.at(-1)).toEqual({ kind: 'cancel', time: 0.1, value: 0 });
      ended?.();
      expect(f.owned()).toBe(0);
      f.audio.dispose();
    },
  );

  it('restarts with current state after a multisecond pause without carrying fractional debt', () => {
    const f = fixture();
    f.update(0);
    f.update(0.1);
    expect(f.audio.bursts).toBe(1);
    f.update(4, frame(12000, 7));
    expect(f.audio.bursts).toBe(1);
    f.update(4.05, frame(12000, 7));
    expect(f.audio.bursts).toBe(1);
    f.update(4.1, frame(12000, 7));
    expect(f.audio.bursts).toBe(2);
    const start = f.context.of('source')[1].started[0];
    expect(start).toBeGreaterThanOrEqual(4.1);
    expect(start).toBeLessThan(4.15);
    f.audio.dispose();
  });

  it('rebases a backward presentation clock and cancels the previous future plan', () => {
    const f = fixture();
    f.update(0);
    f.update(0.1);
    f.update(0.05, frame(12000, 7), 0.1);
    expect(f.audio.bursts).toBe(1);
    expect(f.owned()).toBe(0);
    expect(f.context.of('source')[0].stopped).toHaveLength(1);
    f.update(0.1, frame(12000, 7));
    expect(f.audio.bursts).toBe(1);
    f.update(0.15, frame(12000, 7));
    expect(f.audio.bursts).toBe(2);
    f.audio.dispose();
  });

  it.each([NaN, Infinity, -Infinity, -1])(
    'rejects invalid time %s before scheduling any AudioParam events',
    (time) => {
      const f = fixture();
      f.update(0);
      f.update(0.1);
      for (let i = 0; i < 100; i++) f.update(time, frame(12000, i % 2 ? 6 : 7), 0.1);
      expect(f.audio.bursts).toBe(1);
      expect(f.owned()).toBe(0);
      const events = f.context.nodes.flatMap((node) => [
        ...node.frequency.events,
        ...node.gain.events,
      ]);
      expect(events.every((event) => Number.isFinite(event.time) && event.time >= 0)).toBe(true);
      f.update(0.2, frame(12000, 7));
      expect(f.audio.bursts).toBe(1);
      f.update(0.3, frame(12000, 7));
      expect(f.audio.bursts).toBe(2);
      f.audio.dispose();
    },
  );

  it('does not reopen audio if a discontinuity cleanup callback disposes the graph', () => {
    const f = fixture();
    f.update(0);
    f.update(0.1);
    const source = f.context.of('source')[0];
    source.stop = () => f.audio.dispose();
    f.update(4, frame(12000, 7));
    expect(f.audio.bursts).toBe(1);
    expect(f.owned()).toBe(0);
    expect(f.context.nodes.every((node) => node.outputs.length === 0)).toBe(true);
  });
});
