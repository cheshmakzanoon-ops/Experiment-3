import { describe, expect, it, vi } from 'vitest';
import { BuildQueue, type BuildProgress } from '../src/rendering/build-queue.ts';

const retainedTasks = (queue: BuildQueue) => Reflect.get(queue, 'tasks') as unknown[];

describe('construction queue callback cancellation', () => {
  it.each([0, 1])(
    'stops when pending progress cancels task %i without another yield',
    async (at) => {
      const queue = new BuildQueue(),
        work: number[] = [],
        reports: BuildProgress[] = [],
        yieldControl = vi.fn(async () => {});
      let cancelled = false;
      for (let index = 0; index < 3; index++) queue.add(`Task ${index}`, 0, () => work.push(index));
      expect(
        await queue.run(
          (progress) => {
            reports.push(progress);
            if (progress.completed === at) cancelled = true;
          },
          () => cancelled,
          yieldControl,
          () => 0,
        ),
      ).toBe(false);
      expect(work).toEqual(at === 0 ? [] : [0]);
      expect(reports.map((report) => report.completed)).toEqual(at === 0 ? [0] : [0, 1]);
      expect(reports.every((report) => report.fraction < 1)).toBe(true);
      expect(yieldControl).toHaveBeenCalledTimes(at === 0 ? 0 : 1);
      expect(queue.statistics).toEqual({
        tasks: at,
        yields: at === 0 ? 0 : 1,
        workMilliseconds: 0,
        maximumTaskMilliseconds: 0,
        cancelled: true,
      });
      expect(queue.ready).toBe(false);
      expect(retainedTasks(queue)).toHaveLength(0);
    },
  );

  it.each([1, 2])(
    'does not announce completion when the last of %i tasks cancels',
    async (count) => {
      const queue = new BuildQueue(),
        reports: BuildProgress[] = [];
      let cancelled = false,
        time = 0;
      for (let index = 0; index < count; index++)
        queue.add(String(index), 0, () => {
          time += 3;
          if (index === count - 1) cancelled = true;
        });
      expect(
        await queue.run(
          (progress) => reports.push(progress),
          () => cancelled,
          async () => {},
          () => time,
        ),
      ).toBe(false);
      expect(reports.map((progress) => progress.completed)).toEqual(
        Array.from({ length: count }, (_, index) => index),
      );
      expect(queue.statistics).toEqual({
        tasks: count,
        yields: 1,
        workMilliseconds: count * 3,
        maximumTaskMilliseconds: 3,
        cancelled: true,
      });
      expect(queue.ready).toBe(false);
      expect(retainedTasks(queue)).toHaveLength(0);
    },
  );

  it('stops before the next progress report when a nonfinal task cancels', async () => {
    const queue = new BuildQueue(),
      dependent = vi.fn(),
      progress = vi.fn();
    let cancelled = false;
    queue.add('First', 0, () => {
      cancelled = true;
    });
    queue.add('Dependent', 1, dependent);
    expect(
      await queue.run(
        progress,
        () => cancelled,
        async () => {},
        () => 0,
      ),
    ).toBe(false);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(dependent).not.toHaveBeenCalled();
    expect(queue.statistics.tasks).toBe(1);
    expect(queue.statistics.cancelled).toBe(true);
  });

  it('observes cancellation while an asynchronous yield is outstanding', async () => {
    const queue = new BuildQueue(),
      work = vi.fn();
    let cancelled = false,
      resume!: () => void;
    const yielded = new Promise<void>((resolve) => {
      resume = resolve;
    });
    queue.add('Deferred work', 0, work);
    const result = queue.run(
      () => {},
      () => cancelled,
      () => yielded,
      () => 0,
    );
    await Promise.resolve();
    expect(work).not.toHaveBeenCalled();
    cancelled = true;
    resume();
    expect(await result).toBe(false);
    expect(work).not.toHaveBeenCalled();
    expect(queue.statistics).toMatchObject({ tasks: 0, yields: 1, cancelled: true });
    expect(queue.ready).toBe(false);
    expect(retainedTasks(queue)).toHaveLength(0);
  });

  it('treats an initially cancelled empty queue as cancelled without progress or yielding', async () => {
    const queue = new BuildQueue(),
      progress = vi.fn(),
      yieldControl = vi.fn(async () => {}),
      now = vi.fn(() => 0);
    expect(await queue.run(progress, () => true, yieldControl, now)).toBe(false);
    expect(progress).not.toHaveBeenCalled();
    expect(yieldControl).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(queue.ready).toBe(false);
    expect(queue.statistics).toMatchObject({ tasks: 0, yields: 0, cancelled: true });
  });

  it.each([0, 2])(
    'keeps readiness uncommitted if terminal progress cancels after %i tasks',
    async (count) => {
      const queue = new BuildQueue(),
        readinessDuringProgress: boolean[] = [];
      let cancelled = false;
      for (let index = 0; index < count; index++) queue.add(String(index), 0, () => {});
      expect(
        await queue.run(
          (progress) => {
            readinessDuringProgress.push(queue.ready);
            if (progress.fraction === 1) cancelled = true;
          },
          () => cancelled,
          async () => {},
          () => 0,
        ),
      ).toBe(false);
      expect(readinessDuringProgress).toEqual(Array(count + 1).fill(false));
      expect(queue.statistics).toMatchObject({ tasks: count, cancelled: true });
      expect(queue.ready).toBe(false);
      expect(retainedTasks(queue)).toHaveLength(0);
    },
  );

  it.each([1, 2, 3, 4, 5])(
    'observes cancellation from clock read %i before further work',
    async (at) => {
      const queue = new BuildQueue(),
        work: number[] = [],
        yieldControl = vi.fn(async () => {}),
        reports: BuildProgress[] = [];
      let cancelled = false,
        reads = 0;
      for (let index = 0; index < 2; index++) queue.add(String(index), 0, () => work.push(index));
      expect(
        await queue.run(
          (progress) => reports.push(progress),
          () => cancelled,
          yieldControl,
          () => {
            if (++reads === at) cancelled = true;
            // At read 5 the second task would otherwise exhaust the slice and yield.
            return reads === 5 ? 20 : 0;
          },
        ),
      ).toBe(false);
      expect(work).toEqual(at <= 3 ? [] : [0]);
      expect(yieldControl).toHaveBeenCalledTimes(at === 1 ? 0 : 1);
      expect(reports.every((progress) => progress.fraction < 1)).toBe(true);
      expect(queue.ready).toBe(false);
      expect(queue.statistics.cancelled).toBe(true);
    },
  );

  it('releases pending callbacks across repeated cancellation without restarting a queue', async () => {
    for (let run = 0; run < 128; run++) {
      const queue = new BuildQueue(),
        work = vi.fn();
      let cancelled = false;
      for (let index = 0; index < 8; index++) queue.add(String(index), 0, work);
      expect(
        await queue.run(
          () => {
            cancelled = true;
          },
          () => cancelled,
          async () => {},
          () => 0,
        ),
      ).toBe(false);
      expect(work).not.toHaveBeenCalled();
      expect(retainedTasks(queue)).toHaveLength(0);
      expect(queue.ready).toBe(false);
      expect(() => queue.runSynchronously()).toThrow('already started');
    }
  });

  it.each(['progress', 'yield', 'work', 'completion', 'clock', 'predicate'] as const)(
    'preserves a %s exception even if it also cancels, and releases pending callbacks',
    async (stage) => {
      const queue = new BuildQueue(),
        failure = new Error(`failure in ${stage}`),
        work = vi.fn();
      let cancelled = false;
      const fail = () => {
        cancelled = true;
        throw failure;
      };
      queue.add('Only task', 0, () => {
        work();
        if (stage === 'work') fail();
      });
      await expect(
        queue.run(
          (progress) => {
            if (stage === 'progress' && progress.fraction < 1) fail();
            if (stage === 'completion' && progress.fraction === 1) fail();
          },
          () => {
            if (stage === 'predicate') fail();
            return cancelled;
          },
          async () => {
            if (stage === 'yield') fail();
          },
          () => {
            if (stage === 'clock') fail();
            return 0;
          },
        ),
      ).rejects.toBe(failure);
      expect(work).toHaveBeenCalledTimes(stage === 'work' || stage === 'completion' ? 1 : 0);
      expect(queue.ready).toBe(false);
      expect(retainedTasks(queue)).toHaveLength(0);
    },
  );

  it('publishes successful empty readiness only after final progress returns', async () => {
    const queue = new BuildQueue(),
      observations: [number, number, number, boolean][] = [],
      yieldControl = vi.fn(async () => {});
    expect(
      await queue.run(
        (progress) =>
          observations.push([progress.completed, progress.total, progress.fraction, queue.ready]),
        () => false,
        yieldControl,
        () => 0,
      ),
    ).toBe(true);
    expect(observations).toEqual([[0, 0, 1, false]]);
    expect(queue.ready).toBe(true);
    expect(queue.statistics).toMatchObject({ tasks: 0, yields: 0, cancelled: false });
    expect(yieldControl).not.toHaveBeenCalled();
  });
});
