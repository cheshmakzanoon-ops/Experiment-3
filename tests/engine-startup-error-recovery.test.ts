import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionStartOwner, type SessionStartScope } from '../src/session/session-start-owner.ts';

interface Session {
  dispose(): void;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const owners: SessionStartOwner<Session>[] = [];
function owner() {
  const active = new SessionStartOwner<Session>();
  owners.push(active);
  return active;
}

function task() {
  const imported = deferred<void>();
  const prepared = deferred<Session>();
  let scope!: SessionStartScope;
  const create = vi.fn((_module: void, startup: SessionStartScope) => {
    scope = startup;
    return prepared.promise;
  });
  return {
    imported,
    prepared,
    load: vi.fn(() => imported.promise),
    create,
    ready: vi.fn<(session: Session) => void>(),
    failed: vi.fn(),
    scope: () => scope,
    async importModule() {
      imported.resolve();
      await Promise.resolve();
      expect(create).toHaveBeenCalledOnce();
    },
  };
}

// A task boundary drains the promise jobs without waiting for the abandoned
// loader itself. A pending result fails the assertion instead of hanging a test.
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function observe(pending: Promise<void>) {
  const settled = vi.fn();
  void pending.then(
    () => settled('resolved'),
    (error: unknown) => settled('rejected', error),
  );
  return settled;
}

function expectRecoveryFailure(pending: Promise<void>, original: unknown, recovery: Error) {
  return pending.then(
    () => { throw new Error('Expected startup to reject'); },
    (error: unknown) => {
      expect(error).toBeInstanceOf(AggregateError);
      const failure = error as AggregateError;
      expect(failure.message).toBe(recovery.message);
      expect(failure.cause).toBe(original);
      expect(failure.errors).toHaveLength(2);
      expect(failure.errors[0]).toBe(original);
      expect(failure.errors[1]).toBe(recovery);
    },
  );
}

afterEach(() => {
  for (const active of owners.splice(0)) active.cancel();
});

describe('startup failure recovery', () => {
  it.each([
    { cleanupThrows: true, recoveryThrows: false },
    { cleanupThrows: false, recoveryThrows: true },
    { cleanupThrows: true, recoveryThrows: true },
  ])(
    'retains the startup cause with cleanup=$cleanupThrows and recovery=$recoveryThrows',
    async ({ cleanupThrows, recoveryThrows }) => {
      const active = owner(), start = task();
      const original = new Error('Ready failed');
      const recovery = new Error('Host recovery failed');
      const events: string[] = [];
      const session = {
        dispose: vi.fn(() => {
          events.push('dispose');
          expect(active.session).toBeNull();
          expect(start.scope().current()).toBe(false);
          // Revoked ownership makes synchronous reentrant cancellation inert.
          active.cancel();
          if (cleanupThrows) throw new Error('Cleanup failed');
        }),
      };
      start.ready.mockImplementation(() => {
        events.push('ready');
        throw original;
      });
      start.failed.mockImplementation(() => {
        events.push('recover');
        expect(active.session).toBeNull();
        expect(active.starting).toBe(false);
        expect(start.scope().signal.aborted).toBe(true);
        if (recoveryThrows) throw recovery;
      });
      const pending = active.start(start);
      const rejected = recoveryThrows
        ? expectRecoveryFailure(pending, original, recovery)
        : expect(pending).rejects.toBe(original);
      await start.importModule();
      start.prepared.resolve(session);
      await rejected;
      expect(events).toEqual(['ready', 'dispose', 'recover']);
      expect(start.failed).toHaveBeenCalledOnce();
      expect(session.dispose).toHaveBeenCalledOnce();
      expect(active.session).toBeNull();
      expect(active.starting).toBe(false);
      active.cancel();
      expect(session.dispose).toHaveBeenCalledOnce();

      const replacement = { dispose: vi.fn() };
      await active.start({
        load: async () => undefined,
        create: async () => replacement,
        ready: vi.fn(),
        failed: vi.fn(),
      });
      expect(active.session).toBe(replacement);
    },
  );

  it.each(['load', 'create'] as const)(
    'retains an owned %s rejection as the cause when host recovery throws',
    async (stage) => {
      const active = owner(), start = task();
      // Rejections need not be Error objects or truthy values.
      const original = undefined;
      const recovery = new Error('Recovery failed');
      start.failed.mockImplementation(() => { throw recovery; });
      const pending = active.start(start);
      const rejected = expectRecoveryFailure(pending, original, recovery);
      if (stage === 'load') start.imported.reject(original);
      else {
        await start.importModule();
        start.prepared.reject(original);
      }
      await rejected;
      expect(start.failed).toHaveBeenCalledOnce();
      expect(start.ready).not.toHaveBeenCalled();
      expect(active.starting).toBe(false);
      expect(active.session).toBeNull();
    },
  );

  it.each(['abort', 'dispose', 'recovery'] as const)(
    'keeps a replacement admitted during %s cleanup isolated from old recovery',
    async (boundary) => {
      const active = owner(), first = task(), second = task();
      const original = new Error('Old ready failed');
      let replacementPending!: Promise<void>;
      const replace = () => { replacementPending = active.start(second); };
      const session = {
        dispose: vi.fn(() => {
          if (boundary === 'dispose') replace();
          throw new Error('Old disposal failed');
        }),
      };
      first.ready.mockImplementation(() => { throw original; });
      first.failed.mockImplementation(() => {
        if (boundary === 'recovery') {
          replace();
          throw new Error('Old host recovery failed');
        }
        // The real host's recovery calls exitFestival(), cancelling its owner.
        active.cancel();
      });
      const pending = active.start(first);
      const settled = expect(pending).resolves.toBeUndefined();
      await first.importModule();
      if (boundary === 'abort') first.scope().signal.addEventListener('abort', replace);
      first.prepared.resolve(session);
      await settled;
      expect(first.failed).toHaveBeenCalledTimes(boundary === 'recovery' ? 1 : 0);
      expect(session.dispose).toHaveBeenCalledOnce();
      expect(active.starting).toBe(true);
      await second.importModule();
      expect(second.scope().current()).toBe(true);
      expect(second.scope().signal.aborted).toBe(false);
      const replacement = { dispose: vi.fn() };
      second.prepared.resolve(replacement);
      await replacementPending;
      expect(active.session).toBe(replacement);
      expect(replacement.dispose).not.toHaveBeenCalled();
      expect(second.ready).toHaveBeenCalledExactlyOnceWith(replacement);
    },
  );
});

describe('startup cancellation settlement', () => {
  it.each(['load', 'create'] as const)(
    'settles cancellation while %s never settles and a replacement is still loading',
    async (stage) => {
      const active = owner(), first = task(), second = task();
      const pending = active.start(first);
      const settled = observe(pending);
      if (stage === 'create') await first.importModule();
      active.cancel();
      const replacementPending = active.start(second);
      await nextTask();
      expect(settled).toHaveBeenCalledExactlyOnceWith('resolved');
      await expect(pending).resolves.toBeUndefined();
      expect(first.ready).not.toHaveBeenCalled();
      expect(first.failed).not.toHaveBeenCalled();
      expect(active.starting).toBe(true);
      expect(active.session).toBeNull();
      active.cancel();
      const replacementSettled = observe(replacementPending);
      await nextTask();
      expect(replacementSettled).toHaveBeenCalledExactlyOnceWith('resolved');
    },
  );

  it.each(['load', 'create'] as const)(
    'observes late %s rejection after cancellation has already settled',
    async (stage) => {
      const active = owner(), first = task(), second = task();
      const settled = observe(active.start(first));
      if (stage === 'create') await first.importModule();
      active.cancel();
      await nextTask();
      expect(settled).toHaveBeenCalledExactlyOnceWith('resolved');
      const replacementPending = active.start(second);
      await second.importModule();
      const replacement = { dispose: vi.fn() };
      second.prepared.resolve(replacement);
      await replacementPending;
      const late = new Error('Departed operation failed');
      if (stage === 'load') first.imported.reject(late);
      else first.prepared.reject(late);
      await nextTask();
      expect(first.failed).not.toHaveBeenCalled();
      expect(first.ready).not.toHaveBeenCalled();
      expect(settled).toHaveBeenCalledExactlyOnceWith('resolved');
      expect(active.session).toBe(replacement);
      expect(replacement.dispose).not.toHaveBeenCalled();
    },
  );

  it('ignores a late imported module after cancellation has already settled', async () => {
    const active = owner(), start = task();
    const settled = observe(active.start(start));
    active.cancel();
    await nextTask();
    expect(settled).toHaveBeenCalledExactlyOnceWith('resolved');
    start.imported.resolve();
    await nextTask();
    expect(start.create).not.toHaveBeenCalled();
    expect(start.ready).not.toHaveBeenCalled();
    expect(start.failed).not.toHaveBeenCalled();
    expect(active.session).toBeNull();
  });

  it.each([false, true])(
    'disposes a late created session exactly once after settlement, with dispose throwing=%s',
    async (cleanupThrows) => {
      const active = owner(), first = task(), second = task();
      const settled = observe(active.start(first));
      await first.importModule();
      const sharedEffect = vi.fn();
      const oldEffect = first.scope().guard(sharedEffect);
      const stale = {
        dispose: vi.fn(() => {
          oldEffect();
          if (cleanupThrows) throw new Error('Departed cleanup failed');
        }),
      };
      active.cancel();
      await nextTask();
      expect(settled).toHaveBeenCalledExactlyOnceWith('resolved');
      const replacementPending = active.start(second);
      await second.importModule();
      first.prepared.resolve(stale);
      await nextTask();
      expect(stale.dispose).toHaveBeenCalledOnce();
      expect(sharedEffect).not.toHaveBeenCalled();
      expect(first.ready).not.toHaveBeenCalled();
      expect(first.failed).not.toHaveBeenCalled();
      expect(active.starting).toBe(true);
      expect(second.scope().current()).toBe(true);
      expect(second.scope().signal.aborted).toBe(false);
      const replacement = { dispose: vi.fn() };
      second.prepared.resolve(replacement);
      await replacementPending;
      expect(active.session).toBe(replacement);
      active.cancel();
      expect(stale.dispose).toHaveBeenCalledOnce();
      expect(replacement.dispose).toHaveBeenCalledOnce();
    },
  );

  it('disposes a created session when cancellation precedes its adoption job', async () => {
    const active = owner(), start = task();
    const pending = active.start(start);
    await start.importModule();
    const session = { dispose: vi.fn() };
    start.prepared.resolve(session);
    active.cancel();
    await pending;
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(start.ready).not.toHaveBeenCalled();
    expect(start.failed).not.toHaveBeenCalled();
    expect(active.session).toBeNull();
  });
});
