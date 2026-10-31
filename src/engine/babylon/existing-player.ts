import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import type { Scene } from '@babylonjs/core/scene.js';
import '@babylonjs/loaders/glTF/index.js';
import manifest from '../../rendering/supplied-player.manifest.json' with { type: 'json' };

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}
/** Reuse the exact authored asset, never a redownload from a third-party site.
 * High-detail inspection only: production LOD/animation parity is still open. */
export async function loadExistingPlayer(scene: Scene, base: string, signal: AbortSignal) {
  const url = new URL('models/supplied-player.glb.gz', base);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Existing model request failed: ${response.status}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  if (
    compressed.byteLength !== manifest.compressedBytes ||
    (await sha256(compressed)) !== manifest.compressedSHA256
  )
    throw new Error('Existing model compressed integrity check failed');
  signal.throwIfAborted();
  const raw = new Uint8Array(
    await new Response(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).arrayBuffer(),
  );
  if (raw.byteLength !== manifest.bytes || (await sha256(raw)) !== manifest.sha256)
    throw new Error('Existing model integrity check failed');
  signal.throwIfAborted();
  const container = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
  if (signal.aborted || scene.isDisposed) {
    container.dispose();
    throw new DOMException('Model load cancelled', 'AbortError');
  }
  return container;
}
