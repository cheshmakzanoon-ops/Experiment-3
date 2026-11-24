import { afterEach, expect, it, vi } from 'vitest';
import { InputPump } from '../src/input/pump.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('stops explicit and scheduled samples on disposal, then restarts from a fresh clock', () => {
  vi.useFakeTimers();
  const sample = vi.fn();
  const pump = new InputPump(sample, () => Date.now());
  pump.start();
  vi.advanceTimersByTime(20);
  expect(sample).toHaveBeenCalledTimes(1);

  pump.dispose();
  pump.poll();
  vi.advanceTimersByTime(2000);
  expect(sample).toHaveBeenCalledTimes(1);
  expect(pump.ticks).toBe(1);

  pump.start();
  pump.start();
  vi.advanceTimersByTime(20);
  expect(sample).toHaveBeenCalledTimes(2);
  expect(sample.mock.calls[1][0]).toBeGreaterThan(0);
  expect(sample.mock.calls[1][0]).toBeLessThan(0.02);
  pump.dispose();
});

it('does not sample recursively when an action restarts and immediately polls the pump', () => {
  vi.useFakeTimers();
  let restart = true;
  const sample = vi.fn(() => {
    if (!restart) return;
    restart = false;
    pump.dispose();
    pump.start();
    pump.poll();
  });
  const pump = new InputPump(sample, () => Date.now());
  pump.start();

  vi.advanceTimersByTime(20);
  expect(sample).toHaveBeenCalledTimes(1);
  expect(pump.ticks).toBe(1);
  vi.advanceTimersByTime(20);
  expect(sample).toHaveBeenCalledTimes(2);
  pump.dispose();
});

it('ignores callbacks from a canceled run after the pump has restarted', () => {
  vi.useFakeTimers();
  const intervals = vi.spyOn(globalThis, 'setInterval');
  const sample = vi.fn();
  const pump = new InputPump(sample, () => Date.now());
  pump.start();
  const canceledCallback = intervals.mock.calls[0][0] as () => void;
  pump.dispose();
  pump.start();

  canceledCallback();
  expect(sample).not.toHaveBeenCalled();
  vi.advanceTimersByTime(20);
  expect(sample).toHaveBeenCalledTimes(1);
  pump.dispose();
});

it('allows the next sample after a callback throws', () => {
  vi.useFakeTimers();
  const sample = vi.fn().mockImplementationOnce(() => {
    throw new Error('sample failed');
  });
  const pump = new InputPump(sample, () => Date.now());
  pump.start();

  expect(() => pump.poll()).toThrow('sample failed');
  vi.advanceTimersByTime(20);
  expect(sample).toHaveBeenCalledTimes(2);
  pump.dispose();
});
