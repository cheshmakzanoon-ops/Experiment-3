import * as T from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { describe, expect, it, vi } from 'vitest';
import { PreparationTrace, type PreparationCheckpoint } from '../src/rendering/preparation.ts';
import { observePreparationDraw } from '../src/rendering/preparation-passes.ts';
import type { DrawLedger } from '../src/rendering/draw-ledger.ts';

function fixture() {
  let now = 0;
  const events: PreparationCheckpoint[] = [];
  const trace = new PreparationTrace(
    () => ++now,
    (event) => events.push(event),
  );
  const scene = new T.Scene(),
    camera = new T.Camera();
  const renderer = {
    render: vi.fn(function (this: unknown, ...args: unknown[]) {
      expect(this).toBe(renderer);
      expect(args).toEqual([scene, camera]);
    }),
  };
  const ledger = { mark: vi.fn() } as unknown as Pick<DrawLedger, 'mark'>;
  const pass = new Pass();
  pass.render = vi.fn(function (this: unknown, ...args: unknown[]) {
    expect(this).toBe(pass);
    expect(args).toEqual([renderer, 'write', 'read', 0.01, false]);
    renderer.render(scene, camera);
  });
  const targets = {
    renderer: renderer as unknown as Pick<T.WebGLRenderer, 'render'>,
    scene,
    camera,
    ledger,
    composer: { passes: [pass] },
  };
  return { trace, events, targets, pass, renderer, ledger };
}

describe('preparation-only pass checkpoints', () => {
  it('forwards exact receiver/arguments/results and restores all method identities', async () => {
    const f = fixture();
    const originals = [f.renderer.render, f.ledger.mark, f.pass.render];
    await f.trace.run(
      () => {},
      async () => {
        const result = observePreparationDraw(f.trace, 'chase', f.targets, () => {
          f.ledger.mark('environment');
          Reflect.apply(f.pass.render, f.pass, [f.renderer, 'write', 'read', 0.01, false]);
          return 42;
        });
        expect(result).toBe(42);
        return true;
      },
    );
    expect([f.renderer.render, f.ledger.mark, f.pass.render]).toEqual(originals);
    expect(f.events.map((event) => [event.phase, event.label])).toEqual(
      expect.arrayContaining([
        ['start', 'chase:setup'],
        ['end', 'chase:setup'],
        ['start', 'chase:composer:0:Pass'],
        ['end', 'chase:composer:0:Pass'],
        ['start', 'chase:scene-submit'],
        ['end', 'chase:scene-submit'],
      ]),
    );
    const length = f.events.length;
    f.renderer.render(f.targets.scene, f.targets.camera);
    f.ledger.mark('composer');
    expect(f.events).toHaveLength(length);
  });
  it('streams the start before entering a blocked/throwing pass and never records a successful end', async () => {
    const f = fixture();
    f.pass.render = vi.fn(() => {
      expect(f.events.at(-1)?.label).toBe('chase:composer:0:Pass');
      expect(f.events.at(-1)?.phase).toBe('start');
      throw new Error('driver');
    });
    const original = f.pass.render;
    await expect(
      f.trace.run(
        () => {},
        async () => {
          observePreparationDraw(f.trace, 'chase', f.targets, () =>
            f.pass.render(
              {} as T.WebGLRenderer,
              {} as T.WebGLRenderTarget,
              {} as T.WebGLRenderTarget,
              0,
              false,
            ),
          );
          return true;
        },
      ),
    ).rejects.toThrow('driver');
    expect(f.pass.render).toBe(original);
    expect(
      f.events.some((event) => event.label === 'chase:composer:0:Pass' && event.phase === 'end'),
    ).toBe(false);
    expect(f.events.at(-1)?.phase).toBe('error');
  });
  it('does not execute disabled passes merely to observe them', async () => {
    const f = fixture();
    f.pass.enabled = false;
    await f.trace.run(
      () => {},
      async () => {
        observePreparationDraw(f.trace, 'chase', f.targets, () => {});
        return true;
      },
    );
    expect(f.pass.render).not.toHaveBeenCalled();
    expect(f.events.some((event) => event.label.includes(':composer:'))).toBe(false);
  });
  it('bounds retained evidence, exposes loss, and isolates observer failures', async () => {
    const trace = new PreparationTrace(
      () => 1,
      () => {
        throw new Error('observer');
      },
    );
    await expect(
      trace.run(
        () => {},
        async () => {
          for (let i = 0; i < 300; i++) trace.checkpoint('mark', `point${i}`);
          return true;
        },
      ),
    ).resolves.toBe(true);
    const snapshot = trace.snapshot()!;
    expect(snapshot.checkpoints).toHaveLength(256);
    expect(snapshot.checkpointsDropped).toBe(44);
    expect(snapshot.observerErrors).toBe(300);
    expect(snapshot.checkpoints[0].sequence).toBe(45);
  });
  it('marks cancelled fence waits as cancelled rather than GPU completion', async () => {
    const trace = new PreparationTrace();
    await trace.run(
      () => {},
      async () => {
        await trace.observeAsync(
          'chase:fence-wait',
          async () => {},
          () => true,
        );
        return false;
      },
    );
    expect(trace.snapshot()?.status).toBe('cancelled');
    expect(trace.snapshot()?.checkpoints.at(-1)?.phase).toBe('cancelled');
  });
});

it('never appends an older asynchronous wait completion into a newer preparation', async () => {
  const trace = new PreparationTrace();
  let release!: () => void;
  const old = trace.run(
    () => {},
    async () => {
      await trace.observeAsync(
        'old:fence-wait',
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      return false;
    },
  );
  await trace.run(
    () => {},
    async () => {
      trace.checkpoint('mark', 'new:ready');
      return true;
    },
  );
  const before = trace.snapshot();
  release();
  await old;
  expect(trace.snapshot()).toEqual(before);
});

it('removes temporary own methods when the originals were inherited', async () => {
  const f = fixture();
  Reflect.deleteProperty(f.pass, 'render');
  const inherited = f.pass.render;
  expect(Object.hasOwn(f.pass, 'render')).toBe(false);
  await f.trace.run(
    () => {},
    async () => {
      observePreparationDraw(f.trace, 'chase', f.targets, () => {
        expect(Object.hasOwn(f.pass, 'render')).toBe(true);
      });
      return true;
    },
  );
  expect(Object.hasOwn(f.pass, 'render')).toBe(false);
  expect(f.pass.render).toBe(inherited);
});
