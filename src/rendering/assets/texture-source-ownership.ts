import type * as T from 'three';

// Texture.clone() shares Source and its pixels. Cache ownership belongs to
// that source, not to an individual material's disposable texture handle.
// Weak entries do not retain an abandoned cache, source or decoded image.
const sharedSources = new WeakSet<T.Source>();
const sharedImages = new WeakSet<object>();
const closedImages = new WeakSet<ImageBitmap>();

/** Declare an immutable decoded source owned by a cache beyond one scene.
 * Mark both identities: a new Source may wrap the same decoded image. There
 * is intentionally no scene-level unmark; dropping a cache or replacing its
 * layer must not revoke ownership from outstanding texture clones. */
export function markSharedTextureSource(texture: T.Texture) {
  sharedSources.add(texture.source);
  const image: unknown = texture.image;
  if (typeof image === 'object' && image !== null) sharedImages.add(image);
}

/** Release a scene-owned GPU handle and, only when exclusive to scene owners,
 * its decoded bitmap. Multiple handles may alias one bitmap, which is closed
 * at most once. Shared cache images survive for the next renderer's upload. */
export function disposeSceneTexture(texture: T.Texture) {
  const source = texture.source,
    image: unknown = texture.image;
  let failed = false;
  let failure: unknown;
  try {
    texture.dispose();
  } catch (error) {
    failed = true;
    failure = error;
  }
  // Decoded storage is a separate owned resource. A GPU-disposal listener
  // failure must not strand it, or revoke a shared cache's borrowed pixels.
  if (
    typeof ImageBitmap !== 'undefined' &&
    image instanceof ImageBitmap &&
    !sharedSources.has(source) &&
    !sharedImages.has(image) &&
    !closedImages.has(image)
  ) {
    closedImages.add(image);
    try {
      image.close();
    } catch (error) {
      if (!failed) throw error;
    }
  }
  if (failed) throw failure;
}
