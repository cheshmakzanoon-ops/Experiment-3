import { Material } from '@babylonjs/core/Materials/material.js';
import {
  createBabylonGridPaint,
  gridPaintEligible,
  type BabylonGridPaintOptions,
} from './grid-paint.ts';

/** Live qualification is original dry Formula only; the isolated factory remains unchanged. */
export function liveGridPaintEligible(
  track: BabylonGridPaintOptions['track'],
  context: BabylonGridPaintOptions['context'],
) {
  return gridPaintEligible(track, context) && !track.flat && track.preset === 'clear';
}

type GridOwner = Awaited<ReturnType<typeof createBabylonGridPaint>>;

/** Owns the staged environment across asynchronous preparation and scene teardown.
 * Compilation may yield between leases: only installation releases normal draws.
 * Cancellation never interrupts the adapter's compiler-drain boundary. */
export class GridPreparation {
  private owner: GridOwner | undefined;
  private disposed = false;
  private bindings: {
    mesh: ReturnType<GridOwner['diagnostics']>['meshes'][number];
    geometry: unknown;
    world: number[];
    data: string;
    resources: unknown[];
  }[] = [];
  private material: ReturnType<GridOwner['diagnostics']>['material'] | undefined;
  private materialState = '';
  private finishPlugin: unknown;
  private meshResources(mesh: ReturnType<GridOwner['diagnostics']>['meshes'][number]) {
    return [
      ...['position', 'normal', 'uv'].map((kind) => mesh.getVertexBuffer(kind)?.getBuffer()),
      mesh.geometry?.getIndexBuffer(),
      ...mesh.subMeshes.flatMap((row) => [
        row,
        row.materialIndex,
        row.verticesStart,
        row.verticesCount,
        row.indexStart,
        row.indexCount,
      ]),
    ];
  }
  private meshData(mesh: ReturnType<GridOwner['diagnostics']>['meshes'][number]) {
    return JSON.stringify(
      ['position', 'normal', 'uv']
        .map((kind) => Array.from(mesh.getVerticesData(kind) ?? []))
        .concat([Array.from(mesh.getIndices() ?? [])]),
    );
  }
  private materialData(material: ReturnType<GridOwner['diagnostics']>['material']) {
    return JSON.stringify([
      material.albedoColor.asArray(),
      material.roughness,
      material.metallic,
      material.alpha,
      material.backFaceCulling,
      material.twoSidedLighting,
      material.disableDepthWrite,
      material.disableColorWrite,
      material.zOffset,
      material.zOffsetUnits,
    ]);
  }
  private drawable = false;
  private ready = false;
  readonly eligible: boolean;
  readonly completion: Promise<void>;
  /** Resolves only after every original compiler/upload lease has drained. */
  readonly prepared: Promise<void>;
  private preparedComplete = false;
  private installStarted = false;
  private readonly cancelStaged = () => {
    // Staged resources may share a context with a sibling's active compiler.
    // Reject promptly; the staging coordinator owns drain-before-disposal.
    if (this.preparedComplete && !this.installStarted)
      this.rejectCompletion(this.options.signal.reason);
  };
  private resolveCompletion!: () => void;
  private rejectCompletion!: (error: unknown) => void;
  constructor(
    private readonly options: BabylonGridPaintOptions,
    load: typeof createBabylonGridPaint = createBabylonGridPaint,
    mode: { staged?: boolean } = {},
  ) {
    this.eligible = liveGridPaintEligible(options.track, options.context);
    this.completion = new Promise<void>((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });
    // A staged owner can fail before its caller reaches installation. Retain
    // the rejecting public promise without an unhandled intermediate rejection.
    void this.completion.catch(() => {});
    this.prepared = this.prepare(load);
    void this.prepared
      .then(
        () => {
          if (!mode.staged) this.install();
        },
        (error) => this.rejectCompletion(error),
      )
      .catch((error) => this.rejectCompletion(error));
  }
  private current() {
    return (
      !this.disposed &&
      !this.options.signal.aborted &&
      !this.options.scene.isDisposed &&
      this.options.isCurrent()
    );
  }
  private active() {
    this.options.signal.throwIfAborted();
    if (!this.current())
      throw new DOMException('Grid paint preparation ownership changed', 'AbortError');
    if (performance.now() >= this.options.deadline)
      throw new Error('Grid paint preparation deadline exceeded');
  }
  get canDraw() {
    return this.current() && this.drawable;
  }
  get completed() {
    return this.current() && this.ready;
  }
  /** Validate exact retained resources, not only diagnostic counts. No GPU query. */
  receipt() {
    if (!this.completed) throw new Error('Grid paint environment is not ready');
    const scope = {
      dryOnly: true,
      gpSwitchingParity: false,
      weatherParity: false,
      shadowParity: false,
    };
    if (!this.eligible)
      return {
        state: 'ineligible',
        parts: 0,
        materials: 0,
        textures: 0,
        slots: 0,
        boxes: 0,
        triangles: 0,
        ...scope,
      };
    const d = this.owner!.diagnostics(),
      scene = this.options.scene;
    const valid =
      d.state === 'ready' &&
      d.meshes.length === 2 &&
      this.bindings.length === 2 &&
      d.material === this.material &&
      scene.materials.includes(d.material) &&
      d.activeParts === 2 &&
      d.activeMaterials === 1 &&
      this.materialData(d.material) === this.materialState &&
      d.material.roughness === 0.55 &&
      !!this.finishPlugin &&
      d.material.pluginManager?.getPlugin('OriginalCircuitPaintFinish') === this.finishPlugin &&
      !d.material.pluginManager?.getPlugin('OriginalFormulaGrounding') &&
      !d.material.albedoTexture &&
      !d.material.bumpTexture &&
      d.slots === 12 &&
      d.boxes === 36 &&
      d.triangles === 432 &&
      this.bindings.every(
        (b, i) =>
          d.meshes[i] === b.mesh &&
          !b.mesh.isDisposed() &&
          b.mesh.isEnabled() &&
          b.mesh.isVisible &&
          b.mesh.visibility === 1 &&
          b.mesh.parent === null &&
          b.mesh.material === d.material &&
          b.mesh.geometry === b.geometry &&
          !!b.mesh.geometry &&
          scene.geometries.includes(b.mesh.geometry) &&
          scene.meshes.includes(b.mesh) &&
          b.mesh.sideOrientation === Material.CounterClockWiseSideOrientation &&
          b.mesh.isWorldMatrixFrozen &&
          b.mesh.worldMatrixFromCache.asArray().every((v, j) => v === b.world[j]) &&
          this.meshData(b.mesh) === b.data &&
          this.meshResources(b.mesh).length === b.resources.length &&
          this.meshResources(b.mesh).every((value, j) => value === b.resources[j]),
      ) &&
      d.meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0) === 432;
    if (!valid) throw new Error('Original grid paint activation incomplete');
    return {
      state: d.state,
      parts: 2,
      materials: 1,
      textures: 0,
      slots: 12,
      boxes: 36,
      triangles: 432,
      ...scope,
    };
  }
  dispose() {
    this.options.signal.removeEventListener('abort', this.cancelStaged);
    this.disposed = true;
    this.drawable = this.ready = false;
    if (this.preparedComplete && !this.installStarted)
      this.rejectCompletion(new DOMException('Staged environment disposed', 'AbortError'));
    // Explicitly drain even if Scene.dispose skipped its observers or threw.
    this.owner?.dispose();
  }
  private async prepare(load: typeof createBabylonGridPaint) {
    try {
      this.active();
      if (this.eligible) {
        this.owner = await load(this.options);
        this.active();
        const d = this.owner.diagnostics();
        this.material = d.material;
        this.finishPlugin = d.material.pluginManager?.getPlugin('OriginalCircuitPaintFinish');
        this.materialState = this.materialData(d.material);
        this.bindings = d.meshes.map((mesh) => ({
          mesh,
          geometry: mesh.geometry,
          world: Array.from(mesh.worldMatrixFromCache.asArray()),
          data: this.meshData(mesh),
          resources: this.meshResources(mesh),
        }));
      }
      this.preparedComplete = true;
      this.options.signal.addEventListener('abort', this.cancelStaged, { once: true });
    } catch (error) {
      this.cleanupFailure(error);
    }
  }
  /** Starts installation/subscription synchronously. No await between batch calls. */
  install(): Promise<void> {
    if (this.installStarted) return this.completion;
    if (!this.preparedComplete)
      throw new Error('Grid paint installation requires one prepared owner');
    this.installStarted = true;
    this.options.signal.removeEventListener('abort', this.cancelStaged);
    void this.present().then(this.resolveCompletion, this.rejectCompletion);
    return this.completion;
  }
  private async present() {
    try {
      this.active();
      if (this.eligible) {
        // install subscribes synchronously before the next frame can run.
        const installed = this.owner!.install();
        this.drawable = true;
        await installed;
        this.active();
      }
      this.drawable = this.ready = true;
      this.receipt();
    } catch (error) {
      this.cleanupFailure(error);
    }
  }
  private cleanupFailure(error: unknown): never {
    try {
      this.dispose();
    } catch (cleanupError) {
      try {
        console.error('Grid paint cleanup failed', cleanupError);
      } catch {
        /* Reporting must not replace the primary failure or skip draining. */
      }
    }
    throw error;
  }
}

/** Unknown, incomplete, replaced or mutated owners never qualify retained reuse. */
export function gridPreparationValid(owner: GridPreparation | undefined, expected = owner) {
  if (!owner || owner !== expected || !owner.completed) return false;
  try {
    owner.receipt();
    return true;
  } catch {
    return false;
  }
}
