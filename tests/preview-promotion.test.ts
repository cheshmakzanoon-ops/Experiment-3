import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PreviewPromotion } from '../src/core/preview-promotion.ts';

function fixture() {
  const owner = new PreviewPromotion();
  const candidate = { dispose: vi.fn() };
  let finish!: (value: typeof candidate | null) => void;
  let current = true;
  const job = {
    current: () => current,
    create: vi.fn(
      (_cancelled: () => boolean) =>
        new Promise<typeof candidate | null>((resolve) => {
          finish = resolve;
        }),
    ),
    adopt: vi.fn(),
    dispose: vi.fn((value: typeof candidate) => value.dispose()),
    reveal: vi.fn(),
  };
  return {
    owner,
    candidate,
    job,
    finish: () => finish(candidate),
    invalidate: () => {
      current = false;
    },
  };
}

describe('owned Academy venue promotion', () => {
  it('coalesces entry and adopts/reveals once', async () => {
    const f = fixture();
    const first = f.owner.run(f.job);
    expect(f.owner.busy).toBe(true);
    expect(f.owner.run(f.job)).toBe(first);
    await Promise.resolve();
    expect(f.job.create).toHaveBeenCalledTimes(1);
    f.finish();
    await first;
    expect(f.job.adopt).toHaveBeenCalledExactlyOnceWith(f.candidate);
    expect(f.job.reveal).toHaveBeenCalledTimes(1);
    expect(f.candidate.dispose).not.toHaveBeenCalled();
    expect(f.owner.busy).toBe(false);
  });
  it('closing/navigating keeps build ownership but never reopens the panel', async () => {
    const f = fixture();
    const pending = f.owner.run(f.job);
    await Promise.resolve();
    f.owner.closePanel();
    expect(f.owner.busy).toBe(true);
    f.finish();
    await pending;
    expect(f.job.adopt).toHaveBeenCalledTimes(1);
    expect(f.job.reveal).not.toHaveBeenCalled();
  });
  it('explicit reentry can request the panel again without a second build', async () => {
    const f = fixture();
    const pending = f.owner.run(f.job);
    await Promise.resolve();
    f.owner.closePanel();
    expect(f.owner.run(f.job)).toBe(pending);
    f.finish();
    await pending;
    expect(f.job.create).toHaveBeenCalledTimes(1);
    expect(f.job.reveal).toHaveBeenCalledTimes(1);
  });
  it.each(['lifetime', 'generation'])(
    'disposes a late candidate after %s cancellation',
    async (kind) => {
      const f = fixture();
      const pending = f.owner.run(f.job);
      await Promise.resolve();
      if (kind === 'lifetime') f.owner.invalidate();
      else f.invalidate();
      expect(f.job.create.mock.calls[0][0]()).toBe(true);
      f.finish();
      await pending;
      expect(f.candidate.dispose).toHaveBeenCalledTimes(1);
      expect(f.job.adopt).not.toHaveBeenCalled();
      expect(f.job.reveal).not.toHaveBeenCalled();
      expect(f.owner.busy).toBe(false);
    },
  );
  it('releases ownership and propagates build failure', async () => {
    const owner = new PreviewPromotion();
    await expect(
      owner.run({
        current: () => true,
        create: async () => {
          throw new Error('GPU construction failed');
        },
        adopt: vi.fn(),
        dispose: vi.fn(),
        reveal: vi.fn(),
      }),
    ).rejects.toThrow('GPU construction failed');
    expect(owner.busy).toBe(false);
  });
  it('does not begin construction after its owner was invalidated', async () => {
    const f = fixture();
    const pending = f.owner.run(f.job);
    f.owner.invalidate();
    await pending;
    expect(f.job.create).not.toHaveBeenCalled();
    expect(f.job.reveal).not.toHaveBeenCalled();
    expect(f.owner.busy).toBe(false);
  });
  it('does not resurrect an error UI when a cancelled build rejects late', async () => {
    const owner = new PreviewPromotion();
    let reject!: (error: Error) => void;
    const pending = owner.run({
      current: () => true,
      create: () =>
        new Promise<null>((_resolve, fail) => {
          reject = fail;
        }),
      adopt: vi.fn(),
      dispose: vi.fn(),
      reveal: vi.fn(),
    });
    await Promise.resolve();
    owner.invalidate();
    reject(new Error('late context loss'));
    await expect(pending).resolves.toBeUndefined();
    expect(owner.busy).toBe(false);
  });
  it('disposes an unadopted candidate when installation fails', async () => {
    const f = fixture();
    f.job.adopt.mockImplementation(() => {
      throw new Error('install failed');
    });
    const pending = f.owner.run(f.job);
    await Promise.resolve();
    f.finish();
    await expect(pending).rejects.toThrow('install failed');
    expect(f.candidate.dispose).toHaveBeenCalledTimes(1);
    expect(f.job.reveal).not.toHaveBeenCalled();
  });
});

// GameApp boot owns DOM/WebGL; this source contract complements the real
// controller-button tests without constructing a fake game or renderer.
it('polls controller pause during venue ownership before generic non-driving suppression', () => {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const pump = source.slice(
    source.indexOf('this.inputPump = new InputPump'),
    source.indexOf('this.inputPump.start()'),
  );
  const promotion = pump.indexOf('if (this.academyPromotion.busy)');
  const nonDriving = pump.indexOf("if (this.state !== 'driving')");
  expect(promotion).toBeGreaterThanOrEqual(0);
  expect(promotion).toBeLessThan(nonDriving);
  expect(pump.slice(promotion, nonDriving)).toContain("this.input.pollActions(['pause']);");
  expect(pump.slice(promotion, nonDriving)).toContain('return;');
});
