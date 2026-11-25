import { describe, expect, test } from 'vitest';
import { createRafWitness } from '../e2e/fixtures/engine-native-device-ownership.ts';

// Deterministic model of HTML's ordered callback-handle snapshot. This tests the
// observer's classification; the Playwright fixture separately calibrates it
// against two genuinely native callbacks in one batch, without a clock override.
function callbackQueue() {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  return {
    request(callback: FrameRequestCallback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id: number) {
      cancelled.push(id);
      callbacks.delete(id);
    },
    batch(time: number) {
      for (const id of [...callbacks.keys()]) {
        const callback = callbacks.get(id);
        if (!callback) continue;
        callbacks.delete(id);
        callback(time);
      }
    },
    callbacks,
    cancelled,
  };
}

describe('native RAF delivery witness', () => {
  test('equal timestamp numbers in separate batches are retained without duplicate frames', () => {
    const queue = callbackQueue();
    const witness = createRafWitness(queue.request, queue.cancel);
    const timestamps: number[] = [];
    const poll: FrameRequestCallback = (time) => {
      timestamps.push(time);
      witness.delivered('menu', time);
      if (timestamps.length < 2) queue.request(poll);
    };
    queue.request(poll);
    queue.batch(100);
    queue.batch(100);

    expect(timestamps).toEqual([100, 100]);
    expect(witness.owner('menu')).toMatchObject({
      delivered: 2,
      duplicateFrames: 0,
      unwitnessedDeliveries: 0,
      timestampMismatches: 0,
      duplicateTimestamps: 1,
      lastFrame: 2,
      lastTimestamp: 100,
      timestampCollisions: [{ timestamp: 100, previousFrame: 1, frame: 2 }],
    });
    witness.stop();
    expect(queue.callbacks.size).toBe(0);
  });

  test('two callbacks for one owner in one batch are detected independently of another owner', () => {
    const queue = callbackQueue();
    const witness = createRafWitness(queue.request, queue.cancel);
    queue.request((time) => witness.delivered('menu', time));
    queue.request((time) => witness.delivered('credits', time));
    queue.request((time) => witness.delivered('menu', time));
    queue.batch(75);

    expect(witness.owner('menu')).toMatchObject({
      delivered: 2,
      duplicateFrames: 1,
      duplicateTimestamps: 1,
      unwitnessedDeliveries: 0,
      timestampMismatches: 0,
      timestampCollisions: [{ timestamp: 75, previousFrame: 1, frame: 1 }],
    });
    expect(witness.owner('credits')).toMatchObject({
      delivered: 1,
      duplicateFrames: 0,
      duplicateTimestamps: 0,
      unwitnessedDeliveries: 0,
      timestampMismatches: 0,
    });
    witness.stop();
  });

  test('a delivery before the sentinel or with a mismatched timestamp fails witness integrity', () => {
    const queue = callbackQueue();
    const witness = createRafWitness(queue.request, queue.cancel);
    witness.delivered('before-sentinel', 10);
    queue.request((time) => witness.delivered('wrong-timestamp', time + 1));
    queue.batch(10);

    expect(witness.owner('before-sentinel')).toMatchObject({
      unwitnessedDeliveries: 1,
      timestampMismatches: 1,
      lastFrame: 0,
    });
    expect(witness.owner('wrong-timestamp')).toMatchObject({
      unwitnessedDeliveries: 0,
      timestampMismatches: 1,
      lastFrame: 1,
      lastTimestamp: 11,
    });
    witness.stop();
  });

  test('stopping cancels the sentinel once and rejects late deliveries without rearming', () => {
    const queue = callbackQueue();
    const witness = createRafWitness(queue.request, queue.cancel);
    queue.batch(20);
    const [pendingId, staleSentinel] = [...queue.callbacks.entries()][0];
    witness.stop();
    const stopped = witness.snapshot();
    witness.stop();
    // A deliberately retained callback must not resurrect the stopped witness.
    staleSentinel(30);
    witness.delivered('released-owner', 30);

    expect(witness.snapshot()).toEqual(stopped);
    expect(stopped).toEqual({ frames: 1, lastTimestamp: 20, pending: false, stopped: true });
    expect(queue.cancelled).toEqual([pendingId]);
    expect(queue.callbacks.size).toBe(0);
    expect(witness.owner('released-owner')).toMatchObject({
      delivered: 1,
      unwitnessedDeliveries: 1,
    });
  });
});
