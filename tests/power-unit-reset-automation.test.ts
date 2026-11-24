import { afterEach, describe, expect, it, vi } from 'vitest';
import { PowerUnitAudio } from '../src/audio/power-unit.ts';
import { CAR_STRIDE, F, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { FakeContext, type FakeParam, asContext, asNode } from './fake-audio.ts';

const NAMES = [
  'turbo frequency',
  'turbo gain',
  'whine frequency',
  'whine gain',
  'motor frequency',
  'motor gain',
] as const;

function frame(step: number) {
  const result = new Float32Array(HEADER + CAR_STRIDE);
  const o = carBase(0);
  result[o + F.RPM] = 6000 + step * 400;
  result[o + F.ENGINE_TORQUE] = 400 + step * 20;
  result[o + F.THROTTLE] = 1;
  result[o + F.SPEED] = 25 + step * 4;
  result[o + F.GEAR] = step % 2 ? 2 : 1;
  result[o + RACE_BASE + R.VEHICLE] = vehicleIndex(step % 2 ? 'eh3' : 'apx01');
  return result;
}

function fixture() {
  const context = new FakeContext();
  Object.assign(context, { startRendering() {} });
  const audio = new PowerUnitAudio(asContext(context), asNode(context.destination));
  const oscillators = context.of('oscillator');
  const fixed = oscillators.flatMap((node) => [node.frequency, node.outputs[0].gain]);
  const output = context.of('gain')[0].gain;
  const filter = context.of('biquad')[0].frequency;
  for (let step = 0; step <= 10; step++) audio.update(frame(step), 0, step / 10, 1, true);
  return { context, audio, fixed, output, filter };
}

/** Interpret only the scheduling/cancellation boundary, without claiming to
 * emulate DSP. This keeps events recorded before a reset distinct from events
 * still owned by the parameter's future timeline. Native output has a separate
 * OfflineAudioContext integration gate in engine-native-audio.spec.ts. */
function pending(param: FakeParam, from: number) {
  let retained: FakeParam['events'] = [];
  for (const event of param.events) {
    if (event.kind === 'cancel') retained = retained.filter((old) => old.time < event.time);
    else retained.push(event);
  }
  return retained.filter((event) => event.time >= from);
}

afterEach(() => vi.restoreAllMocks());

describe('power-unit fixed graph reset ownership', () => {
  it.each(NAMES)('cancels the old future %s timeline before reopening output', (name) => {
    const f = fixture();
    try {
      const param = f.fixed[NAMES.indexOf(name)];
      expect(pending(param, 0).length).toBe(11);
      expect(param.events.some((event) => event.time >= 0.2 && event.value > 0)).toBe(true);
      f.audio.reset();
      expect(pending(param, 0)).toEqual([]);
      expect(param.events.at(-1)).toEqual({ kind: 'cancel', time: 0, value: 0 });
      f.audio.update(frame(0), 0, 0.05, 1, true);
      expect(pending(param, 0)).toHaveLength(1);
      expect(pending(param, 0)[0].time).toBe(0.05);
    } finally {
      f.audio.dispose();
    }
  });

  it.each(NAMES)('still cancels every independent owner after a failed %s cancellation', (name) => {
    const f = fixture();
    const failing = f.fixed[NAMES.indexOf(name)];
    const failure = new Error(name);
    const cancel = vi.spyOn(failing, 'cancelScheduledValues').mockImplementationOnce(() => {
      throw failure;
    });
    const fade = vi.spyOn(f.output, 'setTargetAtTime');
    try {
      expect(() => f.audio.reset()).toThrow(failure);
      for (const param of [...f.fixed, f.filter]) {
        if (param !== failing) expect(pending(param, 0)).toEqual([]);
      }
      expect(fade).toHaveBeenCalledExactlyOnceWith(0, 0, 0.02);
      expect(f.context.of('source').every((source) => source.outputs.length === 0)).toBe(true);
      expect(() => f.audio.reset()).not.toThrow();
      expect(cancel).toHaveBeenCalledTimes(2);
      expect(pending(failing, 0)).toEqual([]);
    } finally {
      f.audio.dispose();
    }
  });

  it('cancels from native device time while preserving the existing output fade', () => {
    const f = fixture();
    const fade = vi.spyOn(f.output, 'setTargetAtTime');
    const jumps = vi.spyOn(f.output, 'setValueAtTime');
    f.context.currentTime = 0.25;
    f.output.value = 0.37;
    try {
      f.audio.reset();
      for (const param of f.fixed) {
        expect(pending(param, 0.25)).toEqual([]);
        expect(pending(param, 0).map((event) => event.time)).toEqual([0, 0.1, 0.2]);
        expect(param.events.at(-1)).toEqual({ kind: 'cancel', time: 0.25, value: 0 });
      }
      expect(fade).toHaveBeenCalledExactlyOnceWith(0, 0.25, 0.02);
      expect(jumps).not.toHaveBeenCalled();
      expect(f.output.value).toBe(0.37);
      expect(f.context.of('oscillator').every((node) => node.stopped.length === 0)).toBe(true);
    } finally {
      f.audio.dispose();
    }
  });

  it('drops the old parameter schedule when a discontinuity creates a new timeline', () => {
    const f = fixture();
    f.context.currentTime = 0.1;
    try {
      f.audio.update(frame(0), 0, 5, 1, true);
      for (const param of f.fixed) {
        const future = pending(param, 0.1);
        expect(future).toHaveLength(1);
        expect(future[0].time).toBe(5);
      }
    } finally {
      f.audio.dispose();
    }
  });
});
