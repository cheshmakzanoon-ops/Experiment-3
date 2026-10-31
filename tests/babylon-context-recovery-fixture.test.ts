import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { exerciseBabylonContextRecovery } from '../e2e/fixtures/babylon-context-recovery.ts';

afterEach(() => vi.unstubAllGlobals());

function fixture({ permitRestore = true, invalidateReadiness = true } = {}) {
  const tasks: (() => void)[] = [];
  const channels: {
    port1: { close: ReturnType<typeof vi.fn> };
    port2: { close: ReturnType<typeof vi.fn> };
  }[] = [];
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = { onmessage: null as (() => void) | null, close: vi.fn() };
      port2 = {
        postMessage: () => tasks.push(() => this.port1.onmessage!()),
        close: vi.fn(),
      };
      constructor() {
        channels.push(this);
      }
    },
  );
  let contextLost = false;
  let lossDispatchCompleted = false;
  const extension = {
    loseContext: vi.fn(() => {
      contextLost = true;
    }),
    restoreContext: vi.fn(() => {
      if (!lossDispatchCompleted) throw new Error('Context restoration not allowed');
    }),
  };
  const gl = {
    isContextLost: () => contextLost,
    getExtension: vi.fn((): typeof extension | null => extension),
  };
  const status = { dataset: { surfaceKind: 'formula-ribbon', sceneReady: 'true' } as DOMStringMap };
  const load = { disabled: false };
  const canvas = Object.assign(new EventTarget(), { getContext: () => gl });
  // This is the application listener. The fixture must not cancel the event or
  // clear readiness on its behalf; both are independently observed contracts.
  canvas.addEventListener('webglcontextlost', (event) => {
    if (permitRestore) event.preventDefault();
    if (invalidateReadiness) {
      delete status.dataset.surfaceKind;
      status.dataset.sceneReady = 'false';
      load.disabled = true;
    }
  });
  vi.stubGlobal('document', {
    querySelector: (selector: string) =>
      new Map<string, unknown>([
        ['#game', canvas],
        ['#status', status],
        ['#loadAsset', load],
      ]).get(selector),
  });
  return {
    tasks,
    channels,
    extension,
    gl,
    status,
    load,
    loseEvent() {
      const event = new Event('webglcontextlost', { cancelable: true });
      canvas.dispatchEvent(event);
      return event;
    },
    completeLossDispatch() {
      lossDispatchCompleted = true;
    },
    restoreEvent() {
      contextLost = false;
      canvas.dispatchEvent(new Event('webglcontextrestored'));
    },
  };
}

it('waits for an event-task boundary, not loss-handler microtasks, before restoring', async () => {
  const f = fixture();
  const settled = vi.fn();
  // Like page.evaluate, serialization must not require module-scope helpers.
  const serializedProbe = runInNewContext(`(${exerciseBabylonContextRecovery.toString()})`, {
    document,
    MessageChannel,
  }) as typeof exerciseBabylonContextRecovery;
  const completion = serializedProbe(['surfaceKind']);
  void completion.then(settled);
  expect(f.extension.loseContext).toHaveBeenCalledTimes(1);
  expect(f.tasks).toHaveLength(0); // loseContext itself does not dispatch the event.
  f.loseEvent();
  // Model the browser's microtask checkpoint before native dispatch returns
  // and commits the event's defaultPrevented restoration permission.
  await Promise.resolve();
  await Promise.resolve();
  expect(f.extension.restoreContext).not.toHaveBeenCalled();
  expect(f.tasks).toHaveLength(1);
  f.completeLossDispatch();
  f.tasks.shift()!();
  await Promise.resolve();
  expect(f.extension.restoreContext).toHaveBeenCalledTimes(1);
  expect(settled).not.toHaveBeenCalled();
  expect(f.channels[0].port1.close).toHaveBeenCalledTimes(1);
  expect(f.channels[0].port2.close).toHaveBeenCalledTimes(1);
  f.restoreEvent();
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  expect(f.tasks).toHaveLength(1);
  f.tasks.shift()!();
  await expect(completion).resolves.toEqual({
    lost: { contextLost: true, absent: true, sceneReady: 'false', loadDisabled: true },
    restored: { contextLost: false, absent: true, sceneReady: 'false', loadDisabled: true },
  });
  expect(f.channels[1].port1.close).toHaveBeenCalledTimes(1);
  expect(f.channels[1].port2.close).toHaveBeenCalledTimes(1);
  expect(f.tasks).toHaveLength(0);
});

it('cannot grant restoration permission when the application did not prevent loss default', async () => {
  const f = fixture({ permitRestore: false });
  const completion = exerciseBabylonContextRecovery(['surfaceKind']);
  const rejected = expect(completion).rejects.toThrow('application did not permit');
  expect(f.loseEvent().defaultPrevented).toBe(false);
  f.completeLossDispatch();
  f.tasks.shift()!();
  await rejected;
  expect(f.extension.restoreContext).not.toHaveBeenCalled();
  expect(f.channels).toHaveLength(1);
  expect(f.channels[0].port1.close).toHaveBeenCalledTimes(1);
  expect(f.channels[0].port2.close).toHaveBeenCalledTimes(1);
});

it('reports stale readiness instead of manufacturing application invalidation', async () => {
  const f = fixture({ invalidateReadiness: false });
  const completion = exerciseBabylonContextRecovery(['surfaceKind']);
  f.loseEvent();
  f.completeLossDispatch();
  f.tasks.shift()!();
  await Promise.resolve();
  f.restoreEvent();
  f.tasks.shift()!();
  await expect(completion).resolves.toEqual({
    lost: { contextLost: true, absent: false, sceneReady: 'true', loadDisabled: false },
    restored: { contextLost: false, absent: false, sceneReady: 'true', loadDisabled: false },
  });
  expect(f.status.dataset.surfaceKind).toBe('formula-ribbon');
  expect(f.load.disabled).toBe(false);
});

it('requires the real loss extension and an initially live context', async () => {
  const f = fixture();
  f.gl.getExtension.mockReturnValueOnce(null);
  await expect(exerciseBabylonContextRecovery(['surfaceKind'])).rejects.toThrow(
    'requires WEBGL_lose_context',
  );
  expect(f.extension.loseContext).not.toHaveBeenCalled();
  f.extension.loseContext();
  await expect(exerciseBabylonContextRecovery(['surfaceKind'])).rejects.toThrow('already lost');
  expect(f.extension.loseContext).toHaveBeenCalledTimes(1);
  expect(f.extension.restoreContext).not.toHaveBeenCalled();
  expect(f.tasks).toHaveLength(0);
});

it('keeps fixture changes and its scheduling contracts in the required Babylon workflow', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/babylon-integration.yml', import.meta.url),
    'utf8',
  );
  const paths = workflow.split('    paths:')[1]?.split('permissions:')[0];
  expect(paths).toContain("- 'e2e/fixtures/babylon-context-recovery.ts'");
  expect(paths).toContain("- 'e2e/babylon-engine.spec.ts'");
  expect(paths).toContain("- 'tests/babylon-*.test.ts'");
  const contract = workflow
    .split('name: Engine component and existing asset geometry contracts')[1]
    ?.split('      - ')[0];
  expect(contract).toContain('run: npx vitest run tests/babylon-*.test.ts');
  expect(new URL(import.meta.url).pathname.split('/').at(-1)).toMatch(/^babylon-.*\.test\.ts$/);
  expect(contract).not.toMatch(/continue-on-error|--exclude|--testNamePattern|--passWithNoTests/);
});
