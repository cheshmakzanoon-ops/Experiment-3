import { cleanupPresentation } from './presentation-gpu.ts';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import '@babylonjs/loaders/glTF/index.js';
import manifest from '../../rendering/supplied-player.manifest.json' with { type: 'json' };
import {
  existingPlayerPrimitiveSources,
  bindExistingPlayerPrimitives,
  type ExistingPlayerPrimitiveBinding,
} from './existing-player-primitives.ts';

const primitiveBindings = new WeakMap<AssetContainer, readonly ExistingPlayerPrimitiveBinding[]>();
/** Existing resources only; the container still owns their lifetime. */
export function existingPlayerPrimitiveBindings(container: AssetContainer) {
  const bindings = primitiveBindings.get(container);
  if (!bindings || bindings.some(({ mesh }) => mesh.isDisposed()))
    throw new Error('Existing player primitive bindings are unavailable');
  return bindings;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}
/** A server may transparently decode Content-Encoding: gzip even when the
 * URL ends in .gz. Accept only the manifest's exact compressed OR raw bytes;
 * never infer integrity from headers or skip the decoded hash check. */
export async function decodeExistingPlayerBytes(
  input: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let raw = input;
  if (
    input.byteLength === manifest.compressedBytes &&
    (await sha256(input)) === manifest.compressedSHA256
  ) {
    raw = new Uint8Array(
      await new Response(
        new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).arrayBuffer(),
    );
  }
  if (raw.byteLength !== manifest.bytes || (await sha256(raw)) !== manifest.sha256)
    throw new Error('Existing model integrity check failed');
  signal.throwIfAborted();
  return raw;
}

/** Release borrowed animation adapters before their owning container. Babylon
 * already reclaims off-scene containers when their scene is disposed. Continue
 * cleanup on individual errors and return them without masking a primary error. */
export function disposeUninstalledPlayer(
  container: AssetContainer | undefined,
  adapters: readonly ({ dispose(): void } | undefined)[] = [],
) {
  return cleanupPresentation([
    ...adapters.map((adapter) => () => adapter?.dispose()),
    () => {
      if (container && !container.scene.isDisposed) container.dispose();
    },
  ]);
}

export interface ExistingPlayerInitialization {
  readonly raw: Uint8Array<ArrayBuffer>;
  readonly container: AssetContainer;
  readonly bindings: readonly ExistingPlayerPrimitiveBinding[];
}
/** An optional owner-controlled pre-return stage. The container remains off-scene
 * and belongs to this loader until successful return. Initializers must drain
 * their GPU lease before returning/rejecting; only lease invalidation may end
 * ownership early. Never dispose the container or add it to the scene here. */
export type ExistingPlayerInitializer = (asset: ExistingPlayerInitialization) => Promise<void>;

/** Reuse the exact authored asset, never a redownload from a third-party site.
 * High-detail inspection only: production LOD/animation parity is still open. */
export async function loadExistingPlayer(
  scene: Scene,
  base: string,
  signal: AbortSignal,
  initialize?: ExistingPlayerInitializer,
) {
  const url = new URL('models/supplied-player.glb.gz', base);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Existing model request failed: ${response.status}`);
  const raw = await decodeExistingPlayerBytes(new Uint8Array(await response.arrayBuffer()), signal);
  const sources = existingPlayerPrimitiveSources(raw);
  const container = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
  try {
    if (signal.aborted || scene.isDisposed)
      throw new DOMException('Model load cancelled', 'AbortError');
    // No derivative download or tier switch: even the binding check retains the
    // exact full-detail indices and every imported resource owner.
    const bindings = bindExistingPlayerPrimitives(container, sources);
    primitiveBindings.set(container, bindings);
    if (initialize) await initialize({ raw, container, bindings });
    // User cancellation cannot release an initializer's still-owned GPU lane.
    // Recheck only after its awaited drain, before publishing the container.
    signal.throwIfAborted();
    if (scene.isDisposed) throw new DOMException('Model scene disposed', 'AbortError');
    return container;
  } catch (error) {
    primitiveBindings.delete(container);
    // The caller cannot own a container from a rejected await.
    for (const cleanupError of disposeUninstalledPlayer(container))
      console.error('Existing player cleanup failed:', cleanupError);
    throw error;
  }
}
