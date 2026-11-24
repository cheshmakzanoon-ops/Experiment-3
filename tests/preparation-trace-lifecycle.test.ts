import { expect, it, vi } from 'vitest';
import { PreparationTrace } from '../src/rendering/preparation.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

it('keeps replacement loading progress intact when an older preparation resumes', async () => {
  let now = 0;
  const trace = new PreparationTrace(() => now);
  const progress = vi.fn();
  const previousStage = deferred(), currentStage = deferred();
  const previous = trace.run(progress, async (report) => {
    report('Compiling previous circuit');
    await previousStage.promise;
    report('Waiting for previous GPU work');
    return false;
  });
  now = 10;
  const current = trace.run(progress, async (report) => {
    report('Compiling selected circuit');
    await currentStage.promise;
    report('Waiting for selected GPU work');
    return true;
  });
  now = 15;
  previousStage.resolve();
  expect(await previous).toBe(false);
  expect(progress.mock.calls.map(([label]) => label)).toEqual([
    'Compiling previous circuit',
    'Compiling selected circuit',
  ]);
  expect(trace.snapshot()).toEqual({
    status: 'preparing',
    elapsedMs: 5,
    error: null,
    stages: [{ label: 'Compiling selected circuit', elapsedMs: 5, complete: false }],
  });
  now = 20;
  currentStage.resolve();
  expect(await current).toBe(true);
  expect(progress).toHaveBeenLastCalledWith('Waiting for selected GPU work');
  expect(trace.snapshot()?.status).toBe('complete');
});

it.each(['complete', 'cancelled', 'failed'] as const)(
  'ignores a retained progress callback once the trace is %s',
  async (outcome) => {
    let now = 0;
    const trace = new PreparationTrace(() => now);
    const progress = vi.fn();
    let reportLate!: (label: string) => void;
    const failure = new Error('Shader compilation failed');
    const pending = trace.run(progress, async (report) => {
      reportLate = report;
      report('Compiling circuit');
      now = 12;
      if (outcome === 'failed') throw failure;
      return outcome === 'complete';
    });
    if (outcome === 'failed') await expect(pending).rejects.toBe(failure);
    else expect(await pending).toBe(outcome === 'complete');
    const completed = trace.snapshot();
    expect(completed?.status).toBe(outcome);
    now = 50;
    reportLate('Late GPU notification');
    expect(trace.snapshot()).toEqual(completed);
    expect(progress).toHaveBeenCalledExactlyOnceWith('Compiling circuit');
  },
);
