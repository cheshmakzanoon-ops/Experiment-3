import { describe, expect, it, vi } from 'vitest';
import { prepareOwnedMenuPreview, PreviewPromotion } from '../src/core/preview-promotion.ts';

type Candidate = Parameters<typeof prepareOwnedMenuPreview>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  // Retain unusual float representations too: signed zero and a NaN payload
  // detect conversions that a numeric equality assertion would miss.
  const storage = new Uint32Array([0x12345678, 0x80000000, 0x7fc01234, 0x3f800000, 0x87654321]);
  const frame = new Float32Array(storage.buffer, 4, 3);
  const bytes = [...new Uint8Array(storage.buffer)];
  const progress = vi.fn();
  const yieldControl = vi.fn(async () => {});
  let cancelled = false;
  let pending = false;
  const stop = () => cancelled;
  const viewport = {
    pending: vi.fn(() => pending),
    applied: vi.fn(() => {
      pending = false;
    }),
  };
  const candidate = {
    waitForPreparedFrame: vi.fn<Candidate['waitForPreparedFrame']>(async () => {}),
    prepareMenuPreview: vi.fn<Candidate['prepareMenuPreview']>(async () => true),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    candidate,
    frame,
    progress,
    yieldControl,
    stop,
    viewport,
    cancel: () => {
      cancelled = true;
    },
    requestResize: () => {
      pending = true;
    },
    run: () => prepareOwnedMenuPreview(candidate, frame, progress, stop, yieldControl, viewport),
    preserved: () => {
      expect(frame.buffer).toBe(storage.buffer);
      expect(frame.byteOffset).toBe(4);
      expect([...new Uint8Array(storage.buffer)]).toEqual(bytes);
      for (const args of candidate.prepareMenuPreview.mock.calls) {
        expect(args[0]).toBe(frame);
        expect(args[1]).toBe(progress);
        expect(args[2]).toBe(stop);
        expect(args[3]).toBe(yieldControl);
      }
      for (const args of candidate.waitForPreparedFrame.mock.calls) {
        expect(args[0]).toBe(stop);
        expect(args[1]).toBe(yieldControl);
      }
    },
  };
}

describe('owned frozen menu preview preparation', () => {
  it('drains before preparation, forwards exact sample/callback identities and retains every byte', async () => {
    const f = fixture();
    const drain = deferred<void>();
    f.candidate.waitForPreparedFrame.mockReturnValueOnce(drain.promise);
    const result = f.run();
    expect(f.candidate.prepareMenuPreview).not.toHaveBeenCalled();
    expect(f.candidate.resize).not.toHaveBeenCalled();
    drain.resolve();
    await expect(result).resolves.toBe(true);
    expect(f.candidate.waitForPreparedFrame).toHaveBeenCalledTimes(1);
    expect(f.candidate.prepareMenuPreview).toHaveBeenCalledTimes(1);
    expect(f.candidate.resize).not.toHaveBeenCalled();
    expect(f.candidate.dispose).not.toHaveBeenCalled();
    f.preserved();
  });

  it('drains before each resize and re-prepares the same sample for the latest viewport', async () => {
    const f = fixture();
    const drain1 = deferred<void>(),
      drain2 = deferred<void>();
    const prepare1 = deferred<boolean>(),
      prepare2 = deferred<boolean>();
    const entered1 = deferred<void>(),
      enteredDrain2 = deferred<void>(),
      entered2 = deferred<void>();
    const calls: string[] = [];
    let width = 800;
    f.requestResize();
    f.candidate.waitForPreparedFrame
      .mockImplementationOnce(() => {
        calls.push('drain1');
        return drain1.promise;
      })
      .mockImplementationOnce(() => {
        calls.push('drain2');
        enteredDrain2.resolve();
        return drain2.promise;
      });
    f.candidate.resize.mockImplementation(() => calls.push(`resize:${width}`));
    f.candidate.prepareMenuPreview
      .mockImplementationOnce(() => {
        calls.push(`prepare:${width}`);
        entered1.resolve();
        return prepare1.promise;
      })
      .mockImplementationOnce(() => {
        calls.push(`prepare:${width}`);
        entered2.resolve();
        return prepare2.promise;
      });
    const result = f.run();
    expect(calls).toEqual(['drain1']);
    drain1.resolve();
    await entered1.promise;
    expect(calls).toEqual(['drain1', 'resize:800', 'prepare:800']);
    width = 1280;
    f.requestResize();
    prepare1.resolve(true);
    await enteredDrain2.promise;
    expect(f.candidate.resize).toHaveBeenCalledTimes(1);
    width = 1920;
    f.requestResize();
    drain2.resolve();
    await entered2.promise;
    expect(calls).toEqual([
      'drain1',
      'resize:800',
      'prepare:800',
      'drain2',
      'resize:1920',
      'prepare:1920',
    ]);
    prepare2.resolve(true);
    await expect(result).resolves.toBe(true);
    expect(f.viewport.applied).toHaveBeenCalledTimes(2);
    expect(f.viewport.pending()).toBe(false);
    expect(f.candidate.waitForPreparedFrame).toHaveBeenCalledTimes(2);
    f.preserved();
  });

  it('never starts GPU work when already cancelled', async () => {
    const f = fixture();
    f.requestResize();
    f.cancel();
    await expect(f.run()).resolves.toBe(false);
    expect(f.candidate.waitForPreparedFrame).not.toHaveBeenCalled();
    expect(f.candidate.resize).not.toHaveBeenCalled();
    expect(f.candidate.prepareMenuPreview).not.toHaveBeenCalled();
    f.preserved();
  });

  it.each(['drain', 'prepare'] as const)(
    'starts no further work after cancellation during %s',
    async (stage) => {
      const f = fixture();
      const held = deferred<boolean>();
      const entered = deferred<void>();
      if (stage === 'drain') {
        f.candidate.waitForPreparedFrame.mockImplementationOnce(async () => {
          entered.resolve();
          await held.promise;
        });
      } else {
        f.candidate.prepareMenuPreview.mockImplementationOnce(() => {
          entered.resolve();
          return held.promise;
        });
      }
      const result = f.run();
      await entered.promise;
      f.requestResize();
      f.cancel();
      held.resolve(true);
      await expect(result).resolves.toBe(false);
      expect(f.candidate.waitForPreparedFrame).toHaveBeenCalledTimes(1);
      expect(f.candidate.resize).not.toHaveBeenCalled();
      expect(f.candidate.prepareMenuPreview).toHaveBeenCalledTimes(stage === 'drain' ? 0 : 1);
      expect(f.viewport.pending()).toBe(true);
      f.preserved();
    },
  );

  it('checks cancellation after resize before beginning preparation', async () => {
    const f = fixture();
    f.requestResize();
    f.candidate.resize.mockImplementation(f.cancel);
    await expect(f.run()).resolves.toBe(false);
    expect(f.candidate.resize).toHaveBeenCalledTimes(1);
    expect(f.candidate.prepareMenuPreview).not.toHaveBeenCalled();
    f.preserved();
  });

  it('does not retry a failed readiness result even when resize is pending', async () => {
    const f = fixture();
    f.candidate.prepareMenuPreview.mockImplementationOnce(async () => {
      f.requestResize();
      return false;
    });
    await expect(f.run()).resolves.toBe(false);
    expect(f.candidate.waitForPreparedFrame).toHaveBeenCalledTimes(1);
    expect(f.candidate.prepareMenuPreview).toHaveBeenCalledTimes(1);
    expect(f.candidate.resize).not.toHaveBeenCalled();
    f.preserved();
  });

  it.each(['drain', 'resize', 'prepare'] as const)(
    'propagates %s failure while retaining caller ownership',
    async (stage) => {
      const f = fixture();
      const error = new Error(`failed ${stage}`);
      if (stage === 'drain') f.candidate.waitForPreparedFrame.mockRejectedValueOnce(error);
      if (stage === 'prepare') f.candidate.prepareMenuPreview.mockRejectedValueOnce(error);
      if (stage === 'resize') {
        f.requestResize();
        f.candidate.resize.mockImplementationOnce(() => {
          throw error;
        });
      }
      await expect(f.run()).rejects.toBe(error);
      expect(f.candidate.waitForPreparedFrame).toHaveBeenCalledTimes(1);
      expect(f.candidate.prepareMenuPreview).toHaveBeenCalledTimes(stage === 'prepare' ? 1 : 0);
      expect(f.candidate.dispose).not.toHaveBeenCalled();
      f.preserved();
    },
  );
});

describe('preview preparation inside the promotion owner', () => {
  it.each([false, true])(
    'coalesces the candidate and respects latest panel reentry=%s',
    async (reenter) => {
      const f = fixture();
      const owner = new PreviewPromotion();
      const held = deferred<boolean>(),
        entered = deferred<void>();
      f.candidate.prepareMenuPreview.mockImplementationOnce(() => {
        entered.resolve();
        return held.promise;
      });
      const job = {
        current: () => true,
        create: vi.fn(async (cancelled: () => boolean) => {
          await prepareOwnedMenuPreview(
            f.candidate,
            f.frame,
            f.progress,
            cancelled,
            f.yieldControl,
            f.viewport,
          );
          return f.candidate;
        }),
        adopt: vi.fn(),
        dispose: vi.fn((candidate: typeof f.candidate) => candidate.dispose()),
        reveal: vi.fn(),
      };
      const result = owner.run(job);
      expect(owner.run(job)).toBe(result);
      await entered.promise;
      expect(job.adopt).not.toHaveBeenCalled();
      owner.closePanel();
      if (reenter) expect(owner.run(job)).toBe(result);
      held.resolve(true);
      await result;
      expect(job.create).toHaveBeenCalledTimes(1);
      expect(job.adopt).toHaveBeenCalledExactlyOnceWith(f.candidate);
      expect(job.reveal).toHaveBeenCalledTimes(reenter ? 1 : 0);
      expect(f.candidate.dispose).not.toHaveBeenCalled();
      expect(owner.busy).toBe(false);
      expect(f.candidate.prepareMenuPreview.mock.calls[0][0]).toBe(f.frame);
    },
  );

  it('propagates preparation failure through the owner and releases the unadopted candidate once', async () => {
    const f = fixture();
    const owner = new PreviewPromotion();
    const failure = new Error('menu shader context lost');
    f.candidate.prepareMenuPreview.mockRejectedValueOnce(failure);
    const job = {
      current: () => true,
      create: async (cancelled: () => boolean) => {
        try {
          await prepareOwnedMenuPreview(
            f.candidate,
            f.frame,
            f.progress,
            cancelled,
            f.yieldControl,
            f.viewport,
          );
          return f.candidate;
        } catch (error) {
          // The candidate has not yet been returned to PreviewPromotion: its
          // construction caller still owns cleanup on preparation failure.
          f.candidate.dispose();
          throw error;
        }
      },
      adopt: vi.fn(),
      dispose: vi.fn((candidate: typeof f.candidate) => candidate.dispose()),
      reveal: vi.fn(),
    };
    await expect(owner.run(job)).rejects.toBe(failure);
    expect(f.candidate.dispose).toHaveBeenCalledTimes(1);
    expect(job.dispose).not.toHaveBeenCalled();
    expect(job.adopt).not.toHaveBeenCalled();
    expect(job.reveal).not.toHaveBeenCalled();
    expect(owner.busy).toBe(false);
  });

  it.each(['drain', 'prepare'] as const)(
    'disposes a late candidate without adoption when invalidated during %s',
    async (stage) => {
      const f = fixture();
      const owner = new PreviewPromotion();
      const held = deferred<boolean>(),
        entered = deferred<void>();
      if (stage === 'drain')
        f.candidate.waitForPreparedFrame.mockImplementationOnce(async () => {
          entered.resolve();
          await held.promise;
        });
      else
        f.candidate.prepareMenuPreview.mockImplementationOnce(() => {
          entered.resolve();
          return held.promise;
        });
      const job = {
        current: () => true,
        create: vi.fn(async (cancelled: () => boolean) => {
          await prepareOwnedMenuPreview(
            f.candidate,
            f.frame,
            f.progress,
            cancelled,
            f.yieldControl,
            f.viewport,
          );
          // Returning the locally owned resource lets PreviewPromotion release it
          // after a generation/lifetime cancellation rather than leaking it.
          return f.candidate;
        }),
        adopt: vi.fn(),
        dispose: vi.fn((candidate: typeof f.candidate) => candidate.dispose()),
        reveal: vi.fn(),
      };
      const result = owner.run(job);
      await entered.promise;
      owner.invalidate();
      f.requestResize();
      held.resolve(true);
      await result;
      expect(f.candidate.waitForPreparedFrame).toHaveBeenCalledTimes(1);
      expect(f.candidate.prepareMenuPreview).toHaveBeenCalledTimes(stage === 'drain' ? 0 : 1);
      expect(f.candidate.resize).not.toHaveBeenCalled();
      expect(job.adopt).not.toHaveBeenCalled();
      expect(job.reveal).not.toHaveBeenCalled();
      expect(f.candidate.dispose).toHaveBeenCalledTimes(1);
      expect(owner.busy).toBe(false);
    },
  );
});
