import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../src/workers/fixed-step-clock.ts';
import { FrameBufferPool } from '../src/workers/frame-buffer-pool.ts';

const BYTES = 64;
const transfer = (buffer: ArrayBuffer) => structuredClone(buffer, { transfer: [buffer] });

describe('publication ownership across synchronous consumers', () => {
  it.each([1, 3])(
    'does not reclaim a newer attached publication after %i older callbacks fail',
    (depth) => {
      const pool = new FrameBufferPool(BYTES, 1);
      const failure = new Error('an older publication failed');
      let current: ArrayBuffer | undefined;
      const publish = (remaining: number): void => {
        pool.publish((buffer) => {
          if (remaining === 0) {
            current = buffer;
            new Uint8Array(buffer)[0] = 53;
            return;
          }
          expect(pool.recycle(buffer)).toBe(true);
          publish(remaining - 1);
          throw failure;
        });
      };

      expect(() => publish(depth)).toThrow(failure);
      expect(pool.available).toBe(0);
      // A newer consumer still owns the sole reserve buffer. A later frame
      // must wait, rather than silently overwrite that consumer's snapshot.
      expect(
        pool.publish((buffer) => {
          new Uint8Array(buffer)[0] = 99;
        }),
      ).toBe(false);
      expect(new Uint8Array(current!)[0]).toBe(53);
      expect(pool.recycle(current!)).toBe(true);
      expect(pool.recycle(current!)).toBe(false);
      expect(pool.available).toBe(1);
    },
  );

  it('retains newer ownership when the older callback completes successfully', () => {
    const pool = new FrameBufferPool(BYTES, 1);
    let current: ArrayBuffer | undefined;
    pool.publish((buffer) => {
      expect(pool.recycle(buffer)).toBe(true);
      pool.publish((next) => {
        current = next;
      });
    });
    expect(pool.available).toBe(0);
    expect(pool.publish(() => {})).toBe(false);
    expect(pool.recycle(current!)).toBe(true);
    expect(pool.available).toBe(1);
  });

  it('counts a newer actual transfer once when an older attached callback fails', () => {
    const pool = new FrameBufferPool(BYTES, 1);
    let received: ArrayBuffer | undefined;
    expect(() =>
      pool.publish((buffer) => {
        expect(pool.recycle(buffer)).toBe(true);
        pool.publish((next) => {
          new Uint8Array(next)[0] = 53;
          received = transfer(next);
        });
        throw new Error('old callback failed after new transfer');
      }),
    ).toThrow('old callback failed after new transfer');

    expect(pool.available).toBe(0);
    expect(new Uint8Array(received!)[0]).toBe(53);
    expect(pool.recycle(transfer(received!))).toBe(true);
    expect(pool.recycle(new ArrayBuffer(BYTES))).toBe(false);
    expect(pool.available).toBe(1);
    expect(pool.publish((buffer) => transfer(buffer))).toBe(true);
    expect(pool.publish(() => {})).toBe(false);
  });

  it('keeps the new attached identity after a synchronous transfer round trip', () => {
    const pool = new FrameBufferPool(BYTES, 1);
    let current: ArrayBuffer | undefined;
    expect(() =>
      pool.publish((buffer) => {
        expect(pool.recycle(transfer(transfer(buffer)))).toBe(true);
        pool.publish((next) => {
          current = next;
          new Uint8Array(next)[0] = 53;
        });
        throw new Error('old transferred callback failed');
      }),
    ).toThrow('old transferred callback failed');
    expect(pool.available).toBe(0);
    expect(pool.publish(() => {})).toBe(false);
    expect(new Uint8Array(current!)[0]).toBe(53);
    expect(pool.recycle(current!)).toBe(true);
    expect(pool.available).toBe(1);
  });

  it('recovers one reserve when the newer writer itself fails', () => {
    const pool = new FrameBufferPool(BYTES, 1);
    const identities = new Set<ArrayBuffer>();
    for (let i = 0; i < 32; i++) {
      expect(() =>
        pool.publish((buffer) => {
          identities.add(buffer);
          expect(pool.recycle(buffer)).toBe(true);
          pool.publish((next) => {
            identities.add(next);
            throw new Error('new writer failed');
          });
        }),
      ).toThrow('new writer failed');
      expect(pool.available).toBe(1);
    }
    expect(identities.size).toBe(1);
    expect(pool.publish(() => {})).toBe(true);
    expect(pool.publish(() => {})).toBe(false);
  });
});

it('preserves fixed ticks and bounded frame reuse through delayed transfers, overload and pauses', () => {
  let workTime = 0;
  const clock = new FixedStepClock({ now: () => workTime, maxWorkMs: 5 });
  const pool = new FrameBufferPool(BYTES, 3, 5);
  const held: { buffer: ArrayBuffer; tick: number }[] = [];
  let wallTime = 0;
  let ticks = 0;
  let skipped = 0;
  let returned = 0;
  clock.reset(wallTime);
  const publish = (required = false) => {
    const sent = pool.publish((buffer) => {
      new Float64Array(buffer)[0] = ticks;
      held.push({ buffer: transfer(buffer), tick: ticks });
    }, required);
    if (!sent) skipped++;
  };
  const recycle = () => {
    // Return in reverse delivery order, using actual detached identities.
    while (held.length) {
      const item = held.pop()!;
      expect(new Float64Array(item.buffer)[0]).toBe(item.tick);
      const buffer = transfer(item.buffer);
      expect(pool.recycle(item.buffer)).toBe(false);
      expect(pool.recycle(buffer)).toBe(true);
      expect(pool.recycle(buffer)).toBe(false);
      returned++;
    }
    expect(pool.available).toBeLessThanOrEqual(5);
  };

  for (let batch = 1; batch <= 2048; batch++) {
    wallTime += [4, 16, 53, 8, 1][batch % 5];
    clock.advance(wallTime, (dt) => {
      expect(dt).toBe(1 / 120);
      ticks++;
      workTime += batch % 9 === 0 ? 3 : 0;
    });
    publish();
    if (batch % 37 === 0) {
      // A pause must still deliver its state with ordinary frames held, then
      // exclude the paused wall interval without changing the tick counter.
      publish(true);
      clock.rebase(wallTime);
      wallTime += 30000;
      clock.rebase(wallTime);
    }
    if (batch % 17 === 0) recycle();
    expect(clock.ticks).toBe(ticks);
    expect(clock.accumulator).toBeGreaterThanOrEqual(0);
    expect(clock.accumulator).toBeLessThan(clock.dt);
  }
  recycle();
  expect(ticks).toBeGreaterThan(3000);
  expect(skipped).toBeGreaterThan(1000);
  expect(returned).toBeGreaterThan(500);
  expect(clock.budgetDroppedSeconds).toBeGreaterThan(0);
  expect(clock.elapsedDroppedSeconds).toBe(0);
  expect(clock.rejectedTimestamps).toBe(0);
});
