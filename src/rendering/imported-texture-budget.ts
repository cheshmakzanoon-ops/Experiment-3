import * as T from 'three';

type ImportedImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement;
interface ImportedAsset {
  original: T.Source;
  owned: T.Source;
  image: ImportedImage;
  textures: Set<T.Texture>;
}
const isImage = (image: unknown): image is ImportedImage =>
  (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) ||
  (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
  (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement);

/** Budget only opted-in, immutable glTF images. A separate Source prevents a
 * resized map from mutating clones still owned by the asset loader. Maps sharing
 * a source share one budget canvas; originals are retained once for restoration.
 * ImageBitmap upload ignores flipY, so the importer must use unflipped glTF UVs. */
export class ImportedTextureBudget {
  private readonly sources = new Map<T.Source, ImportedAsset>();
  private readonly assets = new Set<ImportedAsset>();
  private readonly registered = new Set<T.Texture>();
  private limit = 512;
  private anisotropy = 8;

  register(texture: T.Texture) {
    if (
      this.registered.has(texture) ||
      texture.userData.suppliedPlayerTexture !== true ||
      texture.userData.dynamic ||
      texture.isRenderTargetTexture ||
      texture instanceof T.DataTexture ||
      texture instanceof T.CompressedTexture ||
      texture.flipY ||
      texture.premultiplyAlpha ||
      !isImage(texture.image) ||
      texture.image.width < 1 ||
      texture.image.height < 1
    )
      return;
    let asset = this.sources.get(texture.source);
    if (!asset) {
      const original = texture.source;
      asset = {
        original,
        owned: new T.Source(original.data),
        image: original.data as ImportedImage,
        textures: new Set(),
      };
      this.sources.set(original, asset);
      this.sources.set(asset.owned, asset);
      this.assets.add(asset);
    }
    this.registered.add(texture);
    asset.textures.add(texture);
    // Release the old upload before changing its source identity. The bitmap
    // itself belongs to the loader/renderer and must not be closed here.
    texture.dispose();
    texture.source = asset.owned;
    this.apply(asset);
  }

  configure(limit: number, anisotropy: number) {
    if (limit === this.limit && anisotropy === this.anisotropy) return;
    this.limit = limit;
    this.anisotropy = anisotropy;
    for (const asset of this.assets) this.apply(asset);
  }

  private apply(asset: ImportedAsset) {
    const factor = Math.min(1, this.limit / Math.max(asset.image.width, asset.image.height));
    const width = Math.max(1, Math.round(asset.image.width * factor));
    const height = Math.max(1, Math.round(asset.image.height * factor));
    const current = asset.owned.data as ImportedImage;
    if (
      current.width !== width ||
      current.height !== height ||
      (factor === 1 && current !== asset.image)
    ) {
      let image: ImportedImage = asset.image;
      if (factor < 1) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Imported texture resampling requires Canvas 2D');
        context.drawImage(asset.image, 0, 0, width, height);
        image = canvas;
      }
      // Storage dimensions cannot be changed in place on an allocated WebGL
      // texture. Dispose wrappers, not the immutable CPU image, before reupload.
      for (const texture of asset.textures) texture.dispose();
      asset.owned.data = image;
    }
    for (const texture of asset.textures) {
      texture.anisotropy = this.anisotropy;
      texture.generateMipmaps = true;
      texture.minFilter = T.LinearMipmapLinearFilter;
      texture.needsUpdate = true;
    }
  }

  dispose() {
    for (const asset of this.assets) {
      for (const texture of asset.textures) {
        texture.dispose();
        texture.source = asset.original;
        texture.needsUpdate = true;
      }
      asset.textures.clear();
    }
    this.registered.clear();
    this.sources.clear();
    this.assets.clear();
  }
}
