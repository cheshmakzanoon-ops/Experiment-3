import { describe, expect, it, vi } from 'vitest';
import { AudioUnlock, UNLOCK_EVENTS, settle } from '../src/audio/unlock.ts';

/** A context the autoplay policy is holding: resume() stays pending until a gesture. */
function held() {
  let resolve: () => void = () => undefined;
  const ctx = {
    state: 'suspended' as AudioContextState | 'interrupted',
    resume: vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = () => {
            ctx.state = 'running';
            r();
          };
        }),
    ),
  };
  return { ctx, release: () => resolve() };
}

describe('autoplay policy (browser and desktop shell)', () => {
  it('does not wait for ever on a resume() the browser keeps pending', async () => {
    vi.useFakeTimers();
    const { ctx } = held();
    let done = false;
    const waiting = settle(ctx.resume(), 250).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(249);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await waiting;
    expect(done).toBe(true);
    vi.useRealTimers();
  });
  it('returns at once when the resume settles, and never rejects', async () => {
    await expect(settle(Promise.resolve(), 10_000)).resolves.toBeUndefined();
    await expect(
      settle(Promise.reject(new Error('InvalidState')), 10_000),
    ).resolves.toBeUndefined();
  });
  it('asks to resume on every gesture that counts as activation, until the context runs', () => {
    const target = new EventTarget(),
      { ctx, release } = held();
    const unlock = new AudioUnlock(ctx, target);
    expect(unlock.locked).toBe(true);
    // A gamepad button or a focus change is not a user activation: nothing is asked.
    target.dispatchEvent(new Event('gamepadconnected'));
    target.dispatchEvent(new Event('focus'));
    expect(ctx.resume).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('keydown'));
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event('pointerdown'));
    expect(ctx.resume).toHaveBeenCalledTimes(2); // still locked: keep asking
    release();
    expect(unlock.locked).toBe(false);
    target.dispatchEvent(new Event('click'));
    expect(ctx.resume).toHaveBeenCalledTimes(2); // running: no more requests
    expect(unlock.attempts).toBe(2);
    unlock.dispose();
  });
  it('lists the gestures browsers accept, and stops listening when disposed', () => {
    for (const type of ['pointerdown', 'mousedown', 'keydown', 'touchend', 'click'])
      expect(UNLOCK_EVENTS).toContain(type);
    expect(UNLOCK_EVENTS).not.toContain('gamepadconnected');
    const target = new EventTarget(),
      { ctx } = held(),
      unlock = new AudioUnlock(ctx, target);
    unlock.dispose();
    target.dispatchEvent(new Event('keydown'));
    expect(ctx.resume).not.toHaveBeenCalled();
  });
  it('survives a resume() that rejects (the next gesture asks again)', async () => {
    const target = new EventTarget(),
      ctx = {
        state: 'suspended' as AudioContextState,
        resume: vi.fn(() => Promise.reject(new Error('NotAllowedError'))),
      };
    const unlock = new AudioUnlock(ctx, target);
    target.dispatchEvent(new Event('keydown'));
    await Promise.resolve();
    target.dispatchEvent(new Event('keydown'));
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    unlock.dispose();
  });
});
