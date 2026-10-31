import { Material } from '@babylonjs/core/Materials/material.js';
import type { Geometry } from '@babylonjs/core/Meshes/geometry.js';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import type { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import type { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo.js';
import type { PlayerLodData } from '../assets/player-lod-data.ts';
import {
  bindExistingPlayerLodRows,
  type ExistingPlayerPrimitiveBinding,
} from './existing-player-primitives.ts';
import type { BabylonPresentationGpu } from './presentation-gpu.ts';
import manifest from '../../rendering/supplied-player-lods.manifest.json' with { type: 'json' };

type Indices = Uint16Array | Uint32Array;
type Tier = 0 | 1 | 2 | 3;
interface Entry {
  binding: ExistingPlayerPrimitiveBinding;
  geometry: Geometry;
  submesh: SubMesh;
  bounds: BoundingInfo;
  material: Material;
  parent: ExistingPlayerPrimitiveBinding['mesh']['parent'];
  skeleton: ExistingPlayerPrimitiveBinding['mesh']['skeleton'];
  attributes: readonly (readonly [string, VertexBuffer])[];
  tiers: readonly Indices[];
}
export interface ExistingPlayerLodRequest {
  readonly signal: AbortSignal;
  /** The caller's existing absolute deadline; the adapter never extends it. */
  readonly deadline: number;
}

function invalid(detail: string): never {
  throw new Error(`Invalid existing player index tiers: ${detail}`);
}
const integer = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

/** Opt-in index-only adapter; construction leaves original tier 0 untouched.
 *
 * Supply immutable primitive bindings and data returned by the hash-verifying
 * loadPlayerLods. Derivative arrays/row values are privately snapshotted here;
 * original source arrays are retained by identity and must not be mutated by
 * another owner. Only this adapter may change bound index/submesh state.
 *
 * The supplied GPU owner MUST own this same scene/context. All writes, including
 * normal restoration/disposal, run inside its existing prepare lane: prior draw
 * completion, exclusive writes, then observed upload-fence completion. This is
 * NOT a visible-presentation receipt; callers still require ready rendered frames.
 *
 * Preflight/cancellation before commit makes no changes. A synchronous commit or
 * GPU-boundary failure poisons this adapter. A failure after acquiring prepare's
 * lease also poisons that GPU owner; rejection by an already-busy/unavailable
 * owner does not claim to poison somebody else's lease. Public
 * Babylon setIndices releases the old buffer before allocating its replacement:
 * transactional rollback after allocation failure is deliberately NOT promised.
 * Never resume a partly modified model. External normal teardown owns the model;
 * this adapter never disposes meshes, geometry, materials, skeletons or textures.
 */
export class ExistingPlayerLods {
  private entries: Entry[];
  private readonly scene;
  private selected: Tier = 0;
  private completed: Tier = 0;
  private requested: Tier | null = null;
  private failure: unknown;
  private failed = false;
  private disposed = false;
  private abandoned = false;
  private closing = false;
  private pending: Promise<void> | null = null;
  private cancelPending: AbortController | null = null;
  private closingTask: Promise<void> | null = null;

  constructor(
    bindings: readonly ExistingPlayerPrimitiveBinding[],
    data: PlayerLodData,
    private readonly gpu: Pick<BabylonPresentationGpu, 'prepare'>,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (
      !Object.isFrozen(bindings) ||
      bindings.some((binding) => !Object.isFrozen(binding) || !Object.isFrozen(binding.source))
    )
      invalid('mutable primitive bindings');
    const joined = bindExistingPlayerLodRows(bindings, data);
    if (!(data.indices instanceof Uint32Array) || data.indices.byteLength > manifest.bytes)
      invalid('derivative index array');
    this.scene = bindings[0].mesh.getScene();
    const indices = data.indices.slice();
    const counts = [0, 0, 0, 0];
    let next = 0;
    this.entries = joined.map(({ binding, row }) => {
      const mesh = binding.mesh,
        original = mesh.getIndices();
      if (
        !(original instanceof Uint16Array || original instanceof Uint32Array) ||
        original.length !== binding.source.originalCount ||
        !mesh.geometry ||
        mesh.subMeshes.length !== 1 ||
        !mesh.material ||
        !Array.isArray(row.levels) ||
        row.levels.length !== 3
      )
        invalid('source geometry');
      const tiers: Indices[] = [original];
      if (original.some((vertex) => vertex >= binding.source.vertices)) invalid('source vertex');
      const ranges = new Map<number, Uint32Array>();
      counts[0] += original.length / 3;
      row.levels.forEach((level, index) => {
        if (
          !level ||
          !integer(level.count, 3, original.length) ||
          level.count % 3 ||
          !Number.isFinite(level.error) ||
          level.error < 0 ||
          level.error > manifest.levels[index].error * 1.001
        )
          invalid('derivative level');
        let stream: Indices;
        if (level.offset === -1) {
          if (level.count !== original.length || level.error !== 0) invalid('original alias');
          stream = original;
        } else {
          if (!integer(level.offset, 0, indices.length - level.count)) invalid('derivative range');
          const previous = ranges.get(level.offset);
          if (previous && previous.length !== level.count) invalid('derivative alias');
          stream = previous ?? indices.subarray(level.offset, level.offset + level.count);
          if (!previous) {
            if (level.offset !== next) invalid('derivative range ownership');
            if (stream.some((vertex) => vertex >= binding.source.vertices))
              invalid('derivative vertex');
            ranges.set(level.offset, stream);
            next += level.count;
          }
        }
        tiers.push(stream);
        counts[index + 1] += stream.length / 3;
      });
      return {
        binding,
        geometry: mesh.geometry,
        submesh: mesh.subMeshes[0],
        bounds: mesh.getBoundingInfo(),
        material: mesh.material,
        parent: mesh.parent,
        skeleton: mesh.skeleton,
        attributes: mesh
          .getVerticesDataKinds()
          .map((kind) => [kind, mesh.getVertexBuffer(kind)!] as const),
        tiers,
      };
    });
    if (next !== indices.length || counts.some((count, tier) => count !== manifest.triangles[tier]))
      invalid('tier budgets');
    this.validateCurrent();
  }

  private validateCurrent() {
    if (this.disposed || this.scene.isDisposed) invalid('disposed scene or adapter');
    for (const entry of this.entries) {
      const { binding, geometry, submesh, bounds } = entry,
        mesh = binding.mesh;
      if (
        mesh.isDisposed() ||
        mesh.getScene() !== this.scene ||
        mesh.geometry !== geometry ||
        geometry.isDisposed() ||
        geometry.meshes.length !== 1 ||
        geometry.meshes[0] !== mesh ||
        // Pinned runtime leaves this unset; its declaration incorrectly makes
        // the callback non-nullable. Reject every truthy external update hook.
        Boolean(geometry.onGeometryUpdated) ||
        mesh.instances.length ||
        mesh.hasThinInstances ||
        mesh.morphTargetManager ||
        mesh.isUnIndexed ||
        mesh.checkCollisions ||
        mesh.material !== entry.material ||
        mesh.material.fillMode !== Material.TriangleFillMode ||
        this.scene.forceWireframe ||
        this.scene.forcePointsCloud ||
        mesh.parent !== entry.parent ||
        mesh.skeleton !== entry.skeleton ||
        mesh.getTotalVertices() !== binding.source.vertices ||
        mesh.getIndices() !== entry.tiers[this.selected] ||
        mesh.getTotalIndices() !== entry.tiers[this.selected].length ||
        mesh.subMeshes.length !== 1 ||
        mesh.subMeshes[0] !== submesh ||
        submesh.materialIndex !== 0 ||
        submesh.indexStart !== 0 ||
        submesh.indexCount !== entry.tiers[this.selected].length ||
        submesh.verticesStart !== 0 ||
        submesh.verticesCount !== binding.source.vertices ||
        mesh.getBoundingInfo() !== bounds ||
        submesh.getBoundingInfo() !== bounds ||
        mesh.getVerticesDataKinds().length !== entry.attributes.length ||
        entry.attributes.some(([kind, buffer]) => mesh.getVertexBuffer(kind) !== buffer)
      )
        invalid(`ownership changed at ${binding.source.key}`);
    }
  }

  private deadline(deadline: number) {
    if (!Number.isFinite(deadline) || this.now() >= deadline) invalid('expired deadline');
  }

  /** Cancellation is honored until the synchronous commit begins. Once begun,
   * caller cancellation cannot release GPU ownership: finish/fence it and return
   * the committed result. dispose() may then restore tier 0 under a new lease. */
  async setTier(tier: number, request: ExistingPlayerLodRequest): Promise<void> {
    if (!integer(tier, 0, 3)) invalid('tier');
    if (this.failed) throw this.failure;
    if (this.disposed || this.closing) invalid('disposed or closing adapter');
    if (this.pending) invalid('another tier operation is pending');
    request.signal.throwIfAborted();
    this.deadline(request.deadline);
    this.validateCurrent();
    if (tier === this.selected) return;
    const controller = new AbortController();
    this.cancelPending = controller;
    this.requested = tier as Tier;
    // Publish pending ownership before calling the external GPU boundary.
    const work = Promise.resolve().then(() =>
      this.change(
        tier as Tier,
        AbortSignal.any([request.signal, controller.signal]),
        request.deadline,
      ),
    );
    this.pending = work;
    try {
      await work;
    } finally {
      this.pending = null;
      this.cancelPending = null;
      this.requested = null;
    }
  }

  private async change(tier: Tier, signal: AbortSignal, deadline: number) {
    let rejected: unknown,
      preflightRejected = false;
    try {
      await this.gpu.prepare(
        `Original player index tier ${tier}`,
        deadline,
        async (invalidated) => {
          invalidated.throwIfAborted();
          try {
            signal.throwIfAborted();
            this.deadline(deadline);
            this.validateCurrent();
          } catch (error) {
            // A safe rejection must still drain the owner's lease, not poison it
            // merely because the user cancelled before any index was changed.
            rejected = error;
            preflightRejected = true;
            return;
          }
          // No await or user callback between these writes. Updating indexCount
          // first prevents setIndices(..., true) from replacing the one submesh.
          // Its full-source bounds remain global because its range spans this tier.
          for (const entry of this.entries) {
            const target = entry.tiers[tier];
            if (entry.geometry.getIndices() === target) continue;
            entry.submesh.indexCount = target.length;
            entry.geometry.setIndices(target, entry.binding.source.vertices, false, true);
          }
          this.selected = tier;
          this.validateCurrent();
        },
      );
    } catch (error) {
      this.failed = true;
      this.failure = error;
      throw error;
    }
    if (preflightRejected) throw rejected;
    this.completed = tier;
  }

  /** Restore before relinquishing a live model. Cancels an uncommitted request,
   * but awaits any already-started upload/fence. Caller retains the original
   * operation deadline. On a poisoned owner, external teardown must dispose the
   * container first; a later dispose() only abandons metadata, never claims a
   * successful restoration or touches destroyed resources. */
  async dispose(deadline: number): Promise<void> {
    if (this.disposed) return;
    if (this.scene.isDisposed || this.entries.every(({ binding }) => binding.mesh.isDisposed())) {
      this.cancelPending?.abort(new DOMException('Index-tier owner disposed', 'AbortError'));
      this.entries = [];
      this.disposed = true;
      this.abandoned = true;
      return;
    }
    if (this.closingTask) return this.closingTask;
    this.closing = true;
    this.cancelPending?.abort(new DOMException('Index-tier adapter closing', 'AbortError'));
    this.closingTask = (async () => {
      try {
        await this.pending;
      } catch {
        /* The first GPU failure, if any, remains authoritative. */
      }
      if (this.scene.isDisposed || this.entries.every(({ binding }) => binding.mesh.isDisposed())) {
        this.entries = [];
        this.disposed = true;
        this.abandoned = true;
        return;
      }
      if (this.failed) throw this.failure;
      this.deadline(deadline);
      this.validateCurrent();
      if (this.selected !== 0) await this.change(0, new AbortController().signal, deadline);
      this.entries = [];
      this.disposed = true;
    })().finally(() => {
      this.closingTask = null;
      // A preflight/deadline rejection made no writes: allow an explicit retry
      // with a valid caller-owned lease/deadline. A poisoned adapter stays closed.
      if (!this.failed && !this.disposed) this.closing = false;
    });
    return this.closingTask;
  }

  diagnostics() {
    return {
      tier: this.failed ? null : this.completed,
      selectedTier: this.failed ? null : this.selected,
      pendingTier: this.requested,
      triangles: this.failed ? null : manifest.triangles[this.selected],
      disposed: this.disposed,
      abandoned: this.abandoned,
      closing: this.closing,
      failed: this.failed,
      failure: this.failed
        ? this.failure instanceof Error
          ? this.failure.message
          : String(this.failure)
        : null,
    };
  }
}
