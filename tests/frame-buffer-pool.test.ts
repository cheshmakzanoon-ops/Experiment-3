import { describe, expect, it } from 'vitest';
import { FrameBufferPool } from '../src/workers/frame-buffer-pool.ts';

const BYTES = 64;
const transfer = (buffer: ArrayBuffer) => structuredClone(buffer, { transfer: [buffer] });

function post(pool: FrameBufferPool, received: ArrayBuffer[], required = false) {
  return pool.publish((buffer) => received.push(transfer(buffer)), required);
}

describe('transferable frame buffer ownership', () => {
  it('bounds ordinary delivery and retains only the configured reserve after required snapshots return', () => {
    const pool = new FrameBufferPool(BYTES, 2, 3);
    const received: ArrayBuffer[] = [];
    expect(post(pool, received)).toBe(true);
    expect(post(pool, received)).toBe(true);
    expect(post(pool, received)).toBe(false);
    for (let i = 0; i < 8; i++) expect(post(pool, received, true)).toBe(true);
    expect(pool.available).toBe(0);
    expect(received).toHaveLength(10);
    for (const buffer of received) expect(pool.recycle(transfer(buffer))).toBe(true);
    expect(pool.available).toBe(3);
    const next: ArrayBuffer[] = [];
    for (let i = 0; i < 3; i++) expect(post(pool, next)).toBe(true);
    expect(post(pool, next)).toBe(false);
    expect(next.every((buffer) => buffer.byteLength === BYTES)).toBe(true);
  });

  it('accepts fresh transferred identities once and ignores wrong sizes or detached duplicate returns', () => {
    const pool = new FrameBufferPool(BYTES, 2);
    const received: ArrayBuffer[] = [];
    post(pool, received);
    post(pool, received);
    const returned = transfer(received[0]);
    expect(pool.recycle(received[0])).toBe(false);
    expect(pool.recycle(new ArrayBuffer(BYTES - 4))).toBe(false);
    expect(pool.recycle(new ArrayBuffer(BYTES + 4))).toBe(false);
    expect(pool.recycle(returned)).toBe(true);
    expect(pool.recycle(returned)).toBe(false);
    expect(pool.available).toBe(1);
    expect(post(pool, received)).toBe(true);
    expect(returned.byteLength).toBe(0);
    expect(pool.recycle(returned)).toBe(false);
    expect(post(pool, received)).toBe(false);
    expect(pool.recycle(transfer(received[1]))).toBe(true);
  });

  it('preserves non-transferring consumers without treating unrelated attached buffers as returns', () => {
    const pool = new FrameBufferPool(BYTES, 1);
    const received: ArrayBuffer[] = [];
    expect(pool.recycle(new ArrayBuffer(BYTES))).toBe(false);
    pool.publish((buffer) => received.push(buffer));
    expect(pool.recycle(new ArrayBuffer(BYTES))).toBe(false);
    expect(pool.recycle(received[0])).toBe(true);
    expect(pool.recycle(received[0])).toBe(false);
    pool.publish((buffer) => received.push(buffer));
    expect(received[1]).toBe(received[0]);
    expect(pool.publish(() => {})).toBe(false);
  });

  it('does not let idle or retired local identities consume another detached outgoing credit', () => {
    const pool = new FrameBufferPool(BYTES, 1);
    const received: ArrayBuffer[] = [];
    let attached: ArrayBuffer | undefined;
    pool.publish((buffer) => {
      attached = buffer;
    });
    post(pool, received, true);
    expect(pool.recycle(attached!)).toBe(true);
    expect(pool.recycle(attached!)).toBe(false);
    const retired = transfer(received[0]);
    expect(pool.recycle(retired)).toBe(true);
    expect(pool.available).toBe(1);
    post(pool, received);
    expect(pool.recycle(retired)).toBe(false);
    expect(pool.recycle(transfer(received[1]))).toBe(true);
    expect(pool.available).toBe(1);
  });

  it('recovers the same attached buffer after repeated writer or post failures', () => {
    const pool = new FrameBufferPool(BYTES, 1);
    const attempted = new Set<ArrayBuffer>();
    const failure = new Error('frame publication failed');
    for (let i = 0; i < 12; i++) {
      expect(() =>
        pool.publish((buffer) => {
          attempted.add(buffer);
          new Uint8Array(buffer)[0] = i;
          throw failure;
        }),
      ).toThrow(failure);
      expect(pool.available).toBe(1);
    }
    expect(attempted.size).toBe(1);
    const received: ArrayBuffer[] = [];
    expect(post(pool, received)).toBe(true);
    expect(new Uint8Array(received[0])[0]).toBe(11);
    expect(post(pool, received)).toBe(false);
  });

  it('retains a required allocation when publication fails before transfer', () => {
    const pool = new FrameBufferPool(BYTES, 1);
    const received: ArrayBuffer[] = [];
    post(pool, received);
    expect(() =>
      pool.publish(() => {
        throw new Error('required post failed');
      }, true),
    ).toThrow('required post failed');
    expect(pool.available).toBe(1);
    expect(post(pool, received)).toBe(true);
    expect(post(pool, received)).toBe(false);
  });

  it('keeps a detached return credit without resurrecting storage when publication throws after transfer', () => {
    const pool = new FrameBufferPool(BYTES, 1);
    let received: ArrayBuffer | undefined;
    expect(() =>
      pool.publish((buffer) => {
        received = transfer(buffer);
        throw new Error('after transfer');
      }),
    ).toThrow('after transfer');
    expect(pool.available).toBe(0);
    expect(pool.publish(() => {})).toBe(false);
    expect(pool.recycle(transfer(received!))).toBe(true);
    expect(pool.available).toBe(1);
  });

  it.each([false, true])(
    'does not duplicate synchronous returns if publication then throws (transfer=%s)',
    (detach) => {
      const pool = new FrameBufferPool(BYTES, 1);
      expect(() =>
        pool.publish((buffer) => {
          const returned = detach ? transfer(transfer(buffer)) : buffer;
          expect(pool.recycle(returned)).toBe(true);
          expect(pool.recycle(returned)).toBe(false);
          throw new Error('after synchronous recycle');
        }),
      ).toThrow('after synchronous recycle');
      expect(pool.available).toBe(1);
      const received: ArrayBuffer[] = [];
      expect(post(pool, received)).toBe(true);
      expect(post(pool, received)).toBe(false);
    },
  );

  it('skips returned storage that a non-transferring harness has detached again', () => {
    const pool = new FrameBufferPool(BYTES, 1);
    let shared: ArrayBuffer | undefined;
    pool.publish((buffer) => {
      shared = buffer;
    });
    expect(pool.recycle(shared!)).toBe(true);
    transfer(shared!);
    let called = false;
    expect(
      pool.publish(() => {
        called = true;
      }),
    ).toBe(false);
    expect(called).toBe(false);
    const received: ArrayBuffer[] = [];
    expect(post(pool, received, true)).toBe(true);
    expect(received[0].byteLength).toBe(BYTES);
  });

  it('rejects invalid sizes and reserve configurations', () => {
    for (const bytes of [0, -1, 0.5, NaN, Infinity])
      expect(() => new FrameBufferPool(bytes, 1)).toThrow('Invalid frame buffer pool');
    for (const count of [0, -1, 0.5, NaN, Infinity])
      expect(() => new FrameBufferPool(BYTES, count)).toThrow('Invalid frame buffer pool');
    for (const maximum of [0, 1, 2.5, NaN, Infinity])
      expect(() => new FrameBufferPool(BYTES, 2, maximum)).toThrow('Invalid frame buffer pool');
  });
});
