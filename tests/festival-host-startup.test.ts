import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionLifetime } from '../src/session/session-lifetime.ts';
import { SessionStartOwner, type SessionStartScope } from '../src/session/session-start-owner.ts';

interface Session {
  dispose(): void;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const owners: SessionStartOwner<Session>[] = [];
function owner() {
  const result = new SessionStartOwner<Session>();
  owners.push(result);
  return result;
}

function task() {
  const imported = deferred<{ name: string }>();
  const prepared = deferred<Session>();
  const scopes: SessionStartScope[] = [];
  const load = vi.fn(() => imported.promise);
  const create = vi.fn((_module: { name: string }, scope: SessionStartScope) => {
    scopes.push(scope);
    return prepared.promise;
  });
  const ready = vi.fn<(session: Session) => void>();
  const failed = vi.fn();
  return {
    load, create, ready, failed, imported, prepared,
    scope: () => {
      expect(scopes).toHaveLength(1);
      return scopes[0];
    },
    async importModule() {
      imported.resolve({ name: 'festival' });
      await Promise.resolve();
      expect(create).toHaveBeenCalledOnce();
    },
  };
}

afterEach(() => {
  for (const active of owners.splice(0)) active.cancel();
});

describe('Festival host startup ownership', () => {
  it('owns the import and startup, then retains the session until cancellation', async () => {
    const active = owner(), start = task();
    const session = { dispose: vi.fn() };
    const pending = active.start(start);
    expect(active.starting).toBe(true);
    expect(active.session).toBeNull();
    expect(start.create).not.toHaveBeenCalled();
    await start.importModule();
    expect(start.scope().signal.aborted).toBe(false);
    expect(start.ready).not.toHaveBeenCalled();
    start.prepared.resolve(session);
    await pending;
    expect(active.starting).toBe(false);
    expect(active.session).toBe(session);
    expect(start.ready).toHaveBeenCalledExactlyOnceWith(session);
    expect(start.scope().current()).toBe(true);
    expect(start.scope().signal.aborted).toBe(false);
    active.cancel();
    expect(start.scope().current()).toBe(false);
    expect(start.scope().signal.aborted).toBe(true);
    expect(active.session).toBeNull();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(start.failed).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores an import that completes with %s after the host has exited',
    async (outcome) => {
      const active = owner(), start = task();
      const pending = active.start(start);
      active.cancel();
      expect(active.starting).toBe(false);
      if (outcome === 'resolve') start.imported.resolve({ name: 'festival' });
      else start.imported.reject(new Error('Late module failure'));
      await expect(pending).resolves.toBeUndefined();
      expect(start.create).not.toHaveBeenCalled();
      expect(start.ready).not.toHaveBeenCalled();
      expect(start.failed).not.toHaveBeenCalled();
      expect(active.session).toBeNull();
    },
  );

  it('cancels the real session lifetime during preparation without reporting an application error', async () => {
    const active = owner();
    const preparing = deferred<void>(), loader = deferred<void>();
    const released = vi.fn(), loaded = vi.fn(), ready = vi.fn(), failed = vi.fn();
    const pending = active.start({
      load: async () => undefined,
      create: async (_module, scope) => {
        // FestivalSession.start links this lifetime to FestivalStartOptions.signal.
        // Exercise that production cancellation contract, including a shared loader
        // which can reject after the session and host have already departed.
        const lifetime = new SessionLifetime('Festival session closed', scope.signal);
        lifetime.signal.addEventListener('abort', released, { once: true });
        preparing.resolve();
        await lifetime.wait(loader.promise);
        loaded();
        return { dispose: () => lifetime.close() };
      },
      ready, failed,
    });
    await preparing.promise;
    active.cancel();
    await expect(pending).resolves.toBeUndefined();
    expect(released).toHaveBeenCalledOnce();
    expect(loaded).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    loader.reject(new Error('Late shared-loader failure'));
    await Promise.resolve();
    expect(active.starting).toBe(false);
    expect(active.session).toBeNull();
  });

  it('keeps host cancellation linked to a successfully started session lifetime', async () => {
    const active = owner();
    const released = vi.fn(), ready = vi.fn(), failed = vi.fn();
    await active.start({
      load: async () => undefined,
      create: async (_module, scope) => {
        const lifetime = new SessionLifetime('Festival session closed', scope.signal);
        lifetime.signal.addEventListener('abort', released, { once: true });
        return { dispose: () => lifetime.close() };
      },
      ready, failed,
    });
    expect(ready).toHaveBeenCalledOnce();
    expect(released).not.toHaveBeenCalled();
    active.cancel();
    active.cancel();
    expect(released).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
    expect(active.session).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)(
    'preserves replacement startup when a cancelled session later settles with %s',
    async (outcome) => {
      const active = owner(), first = task(), second = task();
      const oldPending = active.start(first);
      await first.importModule();
      const effects: string[] = [];
      const oldEffect = first.scope().guard((message: string) => effects.push(message));
      oldEffect('old loading');
      // Both synchronous abort cleanup and eventual late disposal can call the
      // host. Neither may touch shared UI/input/audio after ownership changes.
      first.scope().signal.addEventListener('abort', () => oldEffect('abort callback'));
      const stale = { dispose: vi.fn(() => oldEffect('late audio stop')) };
      active.cancel();
      const newPending = active.start(second);
      await second.importModule();
      oldEffect('late loaded');
      oldEffect('late exit');
      second.scope().guard(() => effects.push('new loading'))();
      if (outcome === 'resolve') first.prepared.resolve(stale);
      else first.prepared.reject(new Error('Departed session failed'));
      await expect(oldPending).resolves.toBeUndefined();
      expect(active.starting).toBe(true);
      expect(active.session).toBeNull();
      expect(second.scope().signal.aborted).toBe(false);
      expect(second.scope().current()).toBe(true);
      expect(first.ready).not.toHaveBeenCalled();
      expect(first.failed).not.toHaveBeenCalled();
      expect(stale.dispose).toHaveBeenCalledTimes(outcome === 'resolve' ? 1 : 0);
      expect(effects).toEqual(['old loading', 'new loading']);
      const replacement = { dispose: vi.fn() };
      second.prepared.resolve(replacement);
      await newPending;
      expect(active.starting).toBe(false);
      expect(active.session).toBe(replacement);
      expect(second.ready).toHaveBeenCalledExactlyOnceWith(replacement);
      expect(replacement.dispose).not.toHaveBeenCalled();
    },
  );

  it('does not load duplicate sessions while importing, preparing, or running', async () => {
    const active = owner(), first = task(), duplicate = task();
    const pending = active.start(first);
    await active.start(duplicate);
    await first.importModule();
    await active.start(duplicate);
    const session = { dispose: vi.fn() };
    first.prepared.resolve(session);
    await pending;
    await active.start(duplicate);
    expect(duplicate.load).not.toHaveBeenCalled();
    expect(first.load).toHaveBeenCalledOnce();
    expect(active.session).toBe(session);
  });

  it.each(['import', 'prepare', 'ready'] as const)(
    'cleans up and reports genuine %s failure exactly once',
    async (stage) => {
      const active = owner(), start = task();
      const fault = new Error(`${stage} failed`);
      const session = { dispose: vi.fn() };
      if (stage === 'ready') start.ready.mockImplementation(() => { throw fault; });
      const pending = active.start(start);
      const rejected = expect(pending).rejects.toBe(fault);
      if (stage === 'import') start.imported.reject(fault);
      else {
        await start.importModule();
        if (stage === 'prepare') start.prepared.reject(fault);
        else start.prepared.resolve(session);
      }
      await rejected;
      expect(start.failed).toHaveBeenCalledOnce();
      expect(active.starting).toBe(false);
      expect(active.session).toBeNull();
      expect(session.dispose).toHaveBeenCalledTimes(stage === 'ready' ? 1 : 0);
      if (stage !== 'import') {
        expect(start.scope().signal.aborted).toBe(true);
        expect(start.scope().current()).toBe(false);
      }
    },
  );

  it('does not mistake an AbortError from an owned startup for intentional host cancellation', async () => {
    const active = owner(), start = task();
    const fault = new DOMException('A loader failed independently', 'AbortError');
    const pending = active.start(start);
    const rejected = expect(pending).rejects.toBe(fault);
    await start.importModule();
    start.prepared.reject(fault);
    await rejected;
    expect(start.failed).toHaveBeenCalledOnce();
  });
});
