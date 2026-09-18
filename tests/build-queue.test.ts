import { expect, it } from 'vitest';
import { BuildQueue } from '../src/rendering/build-queue.ts';

it('honors construction priorities, yields between bounded work and reports real completion', async () => {
  const queue = new BuildQueue(),
    order: number[] = [],
    fractions: number[] = [];
  let time = 0,
    yields = 0;
  for (let i = 0; i < 10; i++)
    queue.add(`Chunk ${i}`, i % 2, () => {
      order.push(i);
      time += 3;
    });
  expect(queue.ready).toBe(false);
  expect(order).toEqual([]);
  expect(
    await queue.run(
      (p) => fractions.push(p.fraction),
      () => false,
      async () => {
        yields++;
      },
      () => time,
      8,
    ),
  ).toBe(true);
  expect(order).toEqual([0, 2, 4, 6, 8, 1, 3, 5, 7, 9]);
  expect(yields).toBe(4);
  expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
  expect(fractions.at(-1)).toBe(1);
  expect(queue.statistics).toMatchObject({
    tasks: 10,
    yields: 4,
    workMilliseconds: 30,
    maximumTaskMilliseconds: 3,
    cancelled: false,
  });
  expect(queue.ready).toBe(true);
  expect(() => queue.add('Late', 0, () => undefined)).toThrow();
  await expect(
    queue.run(
      () => undefined,
      () => false,
    ),
  ).rejects.toThrow('already started');
});
it('cancels both before and after a yield without running the next task', async () => {
  for (const duringYield of [false, true]) {
    const queue = new BuildQueue();
    let count = 0,
      cancelled = !duringYield;
    queue.add('Cancelled resource', 0, () => {
      count++;
    });
    expect(
      await queue.run(
        () => undefined,
        () => cancelled,
        async () => {
          cancelled = true;
        },
      ),
    ).toBe(false);
    expect(count).toBe(0);
    expect(queue.ready).toBe(false);
    expect(queue.statistics.cancelled).toBe(true);
  }
});
it('surfaces task failure, never completes or runs dependent work', async () => {
  const queue = new BuildQueue();
  let reached = false;
  queue.add('Fail', 0, () => {
    throw new Error('Actual construction fault');
  });
  queue.add('Dependent job', 1, () => {
    reached = true;
  });
  await expect(
    queue.run(
      () => undefined,
      () => false,
      async () => undefined,
    ),
  ).rejects.toThrow('Actual construction fault');
  expect(reached).toBe(false);
  expect(queue.ready).toBe(false);
});
it('synchronous and cooperative queues preserve the same stable work ordering', async () => {
  const paths: number[][] = [[], []];
  const queues = paths.map((path) => {
    const queue = new BuildQueue();
    [2, 0, 2, 1, 0].forEach((priority, i) => queue.add(String(i), priority, () => path.push(i)));
    return queue;
  });
  queues[0].runSynchronously();
  await queues[1].run(
    () => undefined,
    () => false,
    async () => undefined,
  );
  expect(paths[0]).toEqual(paths[1]);
  expect(queues.every((queue) => queue.ready)).toBe(true);
});
it('rejects malformed task metadata and slice budgets', async () => {
  const queue = new BuildQueue();
  expect(() => queue.add('', 0, () => undefined)).toThrow();
  expect(() => queue.add('Infinite', Infinity, () => undefined)).toThrow();
  await expect(
    queue.run(
      () => undefined,
      () => false,
      async () => undefined,
      () => 0,
      NaN,
    ),
  ).rejects.toThrow();
});
