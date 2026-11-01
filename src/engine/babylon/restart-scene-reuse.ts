import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { captureRestartStaticState } from './startup-visual-state.ts';
import type { BabylonCircuitScene } from './circuit-scene.ts';
import type { Track } from '../../simulation/track.ts';
import { AUREL } from '../../simulation/circuits.ts';
import type { BabylonPresentationGpu } from './presentation-gpu.ts';
import type { PresentationSchedule } from './presentation-schedule.ts';
import { waitForPresentation } from './presentation-ready.ts';

type Graphics = ReturnType<BabylonPresentationGpu['diagnostics']>;
export function healthyRestartGraphics(graphics: Graphics, drained: boolean) {
  return (
    graphics.lost === false &&
    graphics.disposed === false &&
    graphics.losses === 0 &&
    graphics.queue.failure === null &&
    graphics.preparation.failure === null &&
    graphics.preparation.active === false &&
    (drained
      ? graphics.phase === 'idle' && graphics.settled === true && graphics.queue.pending === false
      : graphics.phase === 'idle' || graphics.phase === 'waiting')
  );
}
function trackGeometry(track: Track) {
  if (
    track.circuit !== AUREL ||
    track.flat ||
    track.preset !== 'clear' ||
    track.points.length > 4096
  )
    return null;
  const values = [
    track.length,
    ...track.points.flatMap((point) => [
      point.s,
      point.x,
      point.y,
      point.z,
      point.tx,
      point.tz,
      point.nx,
      point.nz,
      point.curvature,
      point.width,
      point.bank,
      point.gradient,
    ]),
  ];
  return values.every(Number.isFinite) ? JSON.stringify(values) : null;
}
/** Exact retained registrations/bindings, not render-state hashes or GPU queries.
 * Snapshot-driven transforms/material values deliberately remain mutable. */
function bindings(view: BabylonCircuitScene): unknown[] | null {
  const scene = view.scene;
  if (scene.isDisposed || scene.activeCamera !== view.camera || view.entrants.length !== 1)
    return null;
  const result: unknown[] = [scene, view.camera, ...view.entrants];
  for (const collection of [
    scene.meshes,
    scene.geometries,
    scene.transformNodes,
    scene.materials,
    scene.textures,
    scene.lights,
    scene.cameras,
  ])
    result.push(collection.length, ...collection);
  for (const mesh of scene.meshes) {
    if (!(mesh instanceof Mesh) || mesh.isDisposed() || mesh.hasInstances || mesh.hasThinInstances)
      return null;
    result.push(mesh.parent, mesh.geometry, mesh.material, mesh.isEnabled());
    const rows = mesh.subMeshes;
    if (
      rows === undefined &&
      mesh.geometry === null &&
      mesh.getTotalVertices() === 0 &&
      mesh.getTotalIndices() === 0
    ) {
      result.push(0);
    } else {
      if (!Array.isArray(rows)) return null;
      result.push(rows.length);
      for (const row of rows)
        result.push(
          row,
          row.materialIndex,
          row.verticesStart,
          row.verticesCount,
          row.indexStart,
          row.indexCount,
        );
    }
  }
  for (const texture of scene.textures) {
    const internal = texture.getInternalTexture();
    if (internal === null) return null;
    result.push(internal);
  }
  const staticState = captureRestartStaticState(view);
  if (staticState === null) return null;
  result.push(staticState);
  return result;
}
export class RestartSceneReuse {
  private constructor(
    readonly view: BabylonCircuitScene,
    private readonly geometry: string,
    private readonly resources: unknown[],
  ) {}
  static capture(view: BabylonCircuitScene, track: Track, graphics: Graphics, eligible: boolean) {
    if (!eligible || !healthyRestartGraphics(graphics, false)) return null;
    try {
      const geometry = trackGeometry(track),
        resources = bindings(view);
      return geometry !== null && resources
        ? new RestartSceneReuse(view, geometry, resources)
        : null;
    } catch {
      return null;
    }
  }
  valid(view: BabylonCircuitScene, track: Track, graphics: Graphics, eligible: boolean) {
    if (!eligible || view !== this.view || !healthyRestartGraphics(graphics, true)) return false;
    try {
      const resources = bindings(view);
      return (
        trackGeometry(track) === this.geometry &&
        !!resources &&
        resources.length === this.resources.length &&
        resources.every((value, index) => value === this.resources[index])
      );
    } catch {
      return false;
    }
  }
}
/** A retained scene still needs TWO new actual ready completions after reset.
 * Old installation receipts never qualify this current reset presentation. */
export class RestartPresentation {
  completed = false;
  readonly completion: Promise<void>;
  private readonly abort = new AbortController();
  constructor(
    view: BabylonCircuitScene,
    gpu: BabylonPresentationGpu,
    schedule: PresentationSchedule,
    signal: AbortSignal,
    deadline: number,
  ) {
    signal.throwIfAborted();
    if (performance.now() >= deadline)
      throw new Error('Restart presentation exceeded its original readiness budget');
    const combined = AbortSignal.any([signal, this.abort.signal]);
    const finish = schedule.prepare();
    const timeout = setTimeout(
      () =>
        this.abort.abort(new Error('Restart presentation exceeded its original readiness budget')),
      Math.max(0, deadline - performance.now()),
    );
    this.completion = waitForPresentation(view.scene, combined, gpu)
      .then(() => {
        combined.throwIfAborted();
        if (performance.now() >= deadline)
          throw new Error('Restart presentation exceeded its original readiness budget');
        this.completed = true;
      })
      .finally(() => {
        clearTimeout(timeout);
        finish();
      });
    void this.completion.catch(() => {});
    schedule.request();
  }
  dispose() {
    this.completed = false;
    this.abort.abort();
  }
}
