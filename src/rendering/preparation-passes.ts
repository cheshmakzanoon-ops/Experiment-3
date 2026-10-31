import type * as T from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import type { DrawLedger } from './draw-ledger.ts';
import type { PreparationTrace } from './preparation.ts';
import { describeProgramChanges, snapshotPrograms } from './program-inventory.ts';

/** Installed only for the synchronous preparation submission. Never retain a
 * method wrapper across an await or in ordinary driving/menu frames. */
export function observePreparationDraw<TValue>(
  trace: PreparationTrace,
  view: string,
  targets: {
    renderer: Pick<T.WebGLRenderer, 'render'> & Partial<Pick<T.WebGLRenderer, 'info'>>;
    scene: T.Scene;
    camera: T.Camera;
    ledger: Pick<DrawLedger, 'mark'>;
    composer: { passes: readonly Pass[] };
    passNames?: ReadonlyMap<Pass, string>;
  },
  draw: () => TValue,
): TValue {
  const { renderer, scene, camera, ledger, composer } = targets;
  let inventory: ReturnType<typeof snapshotPrograms> | undefined;
  try {
    if (renderer.info) {
      const programs = renderer.info.programs ?? [];
      inventory = snapshotPrograms(programs);
      trace.checkpoint(
        'mark',
        `${view}:programs-before`,
        0,
        describeProgramChanges(inventory, programs),
      );
    }
  } catch {
    trace.checkpoint('mark', `${view}:program-inventory-unavailable`);
  }
  const restoreMethod = (owner: object, key: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) Object.defineProperty(owner, key, descriptor);
    else Reflect.deleteProperty(owner, key);
  };
  const renderDescriptor = Object.getOwnPropertyDescriptor(renderer, 'render');
  const markDescriptor = Object.getOwnPropertyDescriptor(ledger, 'mark');
  const originalRender = renderer.render;
  const originalMark = ledger.mark;
  const passes = composer.passes.map((pass, index) => ({
    pass,
    index,
    render: pass.render,
    descriptor: Object.getOwnPropertyDescriptor(pass, 'render'),
  }));
  return trace.observe(`${view}:draw`, () => {
    // A start without a later end identifies the last submitted CPU operation;
    // neither marker claims GPU completion. Fence intervals remain separate.
    const setup = trace.begin(`${view}:setup`);
    let setupOpen = true;
    try {
      ledger.mark = function (phase) {
        if (setupOpen) {
          trace.end(setup, `${view}:setup`);
          setupOpen = false;
        }
        trace.checkpoint('mark', `${view}:phase:${phase}`);
        return originalMark.call(this, phase);
      };
      renderer.render = function (...args) {
        const label =
          args[0] === scene && args[1] === camera
            ? `${view}:scene-submit`
            : `${view}:offscreen-submit`;
        return trace.observe(label, () => originalRender.apply(this, args));
      };
      for (const { pass, index, render } of passes) {
        pass.render = function (...args) {
          return trace.observe(
            `${view}:composer:${index}:${targets.passNames?.get(pass) ?? (pass instanceof OutputPass ? 'output' : pass.constructor.name)}`,
            () => render.apply(this, args),
          );
        };
      }
      return draw();
    } finally {
      // Restore exact identities, not newly bound functions, on every path.
      restoreMethod(renderer, 'render', renderDescriptor);
      restoreMethod(ledger, 'mark', markDescriptor);
      for (const { pass, descriptor } of passes) restoreMethod(pass, 'render', descriptor);
      if (setupOpen) trace.checkpoint('mark', `${view}:setup-exited-before-render`);
      // Pure JS evidence only, after restoration, including failed draws. An
      // unavailable inventory must never replace the original draw failure.
      try {
        if (inventory && renderer.info)
          trace.checkpoint(
            'mark',
            `${view}:programs-after`,
            0,
            describeProgramChanges(inventory, renderer.info.programs ?? []),
          );
      } catch {
        trace.checkpoint('mark', `${view}:program-inventory-unavailable`);
      }
    }
  });
}
