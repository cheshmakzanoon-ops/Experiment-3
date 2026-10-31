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

/** Reuse the exact authored asset, never a redownload from a third-party site.
 * High-detail inspection only: production LOD/animation parity is still open. */
export async function loadExistingPlayer(scene: Scene, base: string, signal: AbortSignal) {
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
    primitiveBindings.set(container, bindExistingPlayerPrimitives(container, sources));
    return container;
  } catch (error) {
    // The caller cannot own a container from a rejected await.
    try {
      container.dispose();
    } catch (cleanupError) {
      console.error('Existing player cleanup failed:', cleanupError);
    }
    throw error;
  }
}
