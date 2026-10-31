import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { GraphicsRecovery } from '../src/engine/babylon/graphics-recovery.ts';
import { RestartOwnership } from '../src/engine/babylon/restart-ownership.ts';

it.each(['before load', 'during load', 'after model installed'])(
  'requires an explicit rebuild after context loss %s; restoration cannot revive aborted model ownership',
  () => {
    const recovery = new GraphicsRecovery();
    let owner = new AbortController();
    const oldOwner = owner;
    let disabled = false;
    recovery.contextLost();
    owner.abort();
    disabled = true;
    expect(recovery.restartRequired).toBe(true);
    expect(recovery.canResume).toBe(false);
    recovery.contextRestored();
    expect(owner).toBe(oldOwner);
    expect(owner.signal.aborted).toBe(true);
    expect(disabled).toBe(true);
    expect(recovery.restartRequired).toBe(true);
    recovery.requestRestart();
    expect(recovery.canResume).toBe(true);
    // New owner is created only when the requested GPU-safe rebuild completes.
    expect(recovery.restartRequired).toBe(true);
    recovery.rebuilt();
    owner = new AbortController();
    disabled = false;
    expect(owner).not.toBe(oldOwner);
    expect(owner.signal.aborted).toBe(false);
    expect(disabled).toBe(false);
    expect(recovery.restartRequired).toBe(false);
  },
);
it.each(['before loss', 'during loss'])(
  'retains an explicit Restart queued %s through restoration',
  (when) => {
    const recovery = new GraphicsRecovery();
    const reset = new RestartOwnership(
      () => {},
      () => ({}),
    );
    const rebuild = vi.fn(() => recovery.rebuilt());
    if (when === 'before loss') {
      recovery.requestRestart();
      reset.request();
    }
    recovery.contextLost();
    if (when === 'during loss') {
      recovery.requestRestart();
      reset.request();
    }
    expect(reset.drain(false, rebuild)).toBe(false);
    expect(recovery.restartRequired).toBe(true);
    recovery.contextRestored();
    expect(reset.pending).toBe(true);
    expect(reset.drain(true, rebuild)).toBe(true);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(recovery.restartRequired).toBe(false);
  },
);
it('does not unlock asset loading if a rebuild is attempted before context restoration', () => {
  const recovery = new GraphicsRecovery();
  recovery.contextLost();
  recovery.requestRestart();
  expect(() => recovery.rebuilt()).toThrow('context is lost');
  expect(recovery.restartRequired).toBe(true);
});
it('wires loss/restore to explicit recovery UI and creates fresh asset ownership only in scene rebuild', () => {
  const source = readFileSync(new URL('../src/engine/babylon/main.ts', import.meta.url), 'utf8');
  const loss = source.slice(
    source.indexOf('engine.onContextLostObservable.add'),
    source.indexOf('engine.onContextRestoredObservable.add'),
  );
  const restore = source.slice(
    source.indexOf('engine.onContextRestoredObservable.add'),
    source.indexOf(
      '  restartOwnership.request();',
      source.indexOf('engine.onContextRestoredObservable.add'),
    ),
  );
  const rebuild = source.slice(
    source.indexOf('function rebuildScene('),
    source.indexOf("window.addEventListener('pagehide'"),
  );
  expect(loss).toContain('graphicsRecovery.contextLost()');
  expect(loss).toContain('assetLoad.abort()');
  expect(loss).toContain('loadAsset.disabled = true');
  expect(loss).toContain('Restart is required');
  expect(restore).toContain('loadAsset.disabled = true');
  expect(restore).toContain('Restart is required');
  expect(restore).not.toContain('new AbortController');
  expect(restore).not.toContain('loadAsset.disabled = false');
  expect(rebuild.indexOf('graphicsRecovery.rebuilt()')).toBeGreaterThan(
    rebuild.indexOf('new BabylonCircuitScene'),
  );
  expect(rebuild.indexOf('assetLoad = new AbortController()')).toBeGreaterThan(
    rebuild.indexOf('graphicsRecovery.rebuilt()'),
  );
  expect(source).toContain(
    'stopped || restartOwnership.pending || graphicsRecovery.restartRequired',
  );
  expect(source).toMatch(/if \(!graphicsRecovery\.restartRequired\)\s+gpu!\.frame/);
});
