import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioUnlock, UNLOCK_EVENTS, settle, type UnlockableContext } from '../src/audio/unlock.ts';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((ready, failed) => {
    resolve = ready;
    reject = failed;
  });
  return { promise, resolve, reject };
}

const owners = new Set<AudioUnlock>();
function fixture(state: UnlockableContext['state'] = 'suspended', target = new EventTarget()) {
  const context = {
    state,
    resume: vi.fn(() => Promise.resolve()),
  };
  const unlock = new AudioUnlock(context, target);
  owners.add(unlock);
  return { context, unlock, target };
}

afterEach(() => {
  for (const owner of owners) owner.dispose();
  owners.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('audio activation ownership', () => {
  it('makes direct attempts inert after repeated disposal without changing the state diagnostic', () => {
    const { context, unlock } = fixture();
    unlock.dispose();
    unlock.dispose();
    unlock.attempt();
    expect(context.resume).not.toHaveBeenCalled();
    expect(unlock.attempts).toBe(0);
    expect(unlock.locked).toBe(true);
    context.state = 'running';
    expect(unlock.locked).toBe(false);
  });

  it('ignores a previously captured activation callback after its owner is disposed', () => {
    const target = new EventTarget();
    const listen = vi.spyOn(target, 'addEventListener');
    const { context, unlock } = fixture('suspended', target);
    const callback = listen.mock.calls.find(([type]) => type === 'pointerdown')?.[1];
    expect(typeof callback).toBe('function');
    unlock.dispose();
    (callback as EventListener).call(target, new Event('pointerdown'));
    expect(context.resume).not.toHaveBeenCalled();
    expect(unlock.attempts).toBe(0);
  });

  it('does not ask a context that was already closed to resume', () => {
    const { context, unlock, target } = fixture('closed');
    for (const type of UNLOCK_EVENTS) target.dispatchEvent(new Event(type));
    unlock.attempt();
    expect(context.resume).not.toHaveBeenCalled();
    expect(unlock.attempts).toBe(0);
    expect(unlock.locked).toBe(true);
  });

  it('stops issuing activation requests when a pending context closes', async () => {
    const held = deferred();
    const { context, unlock, target } = fixture();
    context.resume.mockReturnValue(held.promise);
    target.dispatchEvent(new Event('keydown'));
    context.state = 'closed';
    for (const type of UNLOCK_EVENTS) target.dispatchEvent(new Event(type));
    held.reject(new DOMException('The context is closed', 'InvalidStateError'));
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(unlock.attempts).toBe(1);
  });

  it('contains a synchronous activation failure and retries on the next gesture', async () => {
    const { context, unlock, target } = fixture();
    context.resume.mockImplementationOnce(() => {
      throw new DOMException('Activation unavailable', 'NotAllowedError');
    });
    expect(() => unlock.attempt()).not.toThrow();
    expect(unlock.attempts).toBe(1);
    target.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(unlock.attempts).toBe(2);
  });

  it('keeps retrying real gestures while resume is pending and after a later interruption', async () => {
    const pending = UNLOCK_EVENTS.map(() => deferred());
    const { context, unlock, target } = fixture();
    for (const request of pending) context.resume.mockReturnValueOnce(request.promise);
    for (const type of UNLOCK_EVENTS) target.dispatchEvent(new Event(type));
    expect(context.resume).toHaveBeenCalledTimes(UNLOCK_EVENTS.length);
    context.state = 'running';
    for (const request of pending) request.resolve();
    await Promise.resolve();
    target.dispatchEvent(new Event('click'));
    expect(unlock.locked).toBe(false);
    expect(context.resume).toHaveBeenCalledTimes(UNLOCK_EVENTS.length);
    context.state = 'interrupted';
    target.dispatchEvent(new Event('touchend'));
    expect(context.resume).toHaveBeenCalledTimes(UNLOCK_EVENTS.length + 1);
  });

  it('contains late rejection from the old owner while a replacement owns activation', async () => {
    const held = deferred();
    const target = new EventTarget();
    const old = fixture('suspended', target);
    old.context.resume.mockReturnValue(held.promise);
    target.dispatchEvent(new Event('keydown'));
    old.unlock.dispose();
    const replacement = fixture('suspended', target);
    held.reject(new Error('Old context closed'));
    await Promise.resolve();
    target.dispatchEvent(new Event('pointerdown'));
    expect(old.context.resume).toHaveBeenCalledTimes(1);
    expect(replacement.context.resume).toHaveBeenCalledTimes(1);
    expect(old.unlock.attempts).toBe(1);
    expect(replacement.unlock.attempts).toBe(1);
  });

  it('does not reinstall listeners when a pending request resolves after disposal', async () => {
    const held = deferred();
    const { context, unlock, target } = fixture();
    context.resume.mockReturnValue(held.promise);
    target.dispatchEvent(new Event('mousedown'));
    unlock.dispose();
    held.resolve();
    await Promise.resolve();
    for (const type of UNLOCK_EVENTS) target.dispatchEvent(new Event(type));
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(unlock.attempts).toBe(1);
  });
});

describe('bounded audio activation waits', () => {
  it.each(['resolve', 'reject'] as const)(
    'settles only once when %s arrives after the deadline',
    async (outcome) => {
      vi.useFakeTimers();
      const request = deferred();
      const finished = vi.fn();
      const waiting = settle(request.promise, 250).then(finished);
      await vi.advanceTimersByTimeAsync(249);
      expect(finished).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(finished).toHaveBeenCalledTimes(1);
      if (outcome === 'resolve') request.resolve();
      else request.reject(new Error('Late autoplay denial'));
      await Promise.resolve();
      expect(finished).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'releases its deadline timer on an early %s',
    async (outcome) => {
      vi.useFakeTimers();
      const request = deferred();
      const waiting = settle(request.promise, 250);
      expect(vi.getTimerCount()).toBe(1);
      if (outcome === 'resolve') request.resolve();
      else request.reject(new Error('Autoplay denial'));
      await expect(waiting).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
