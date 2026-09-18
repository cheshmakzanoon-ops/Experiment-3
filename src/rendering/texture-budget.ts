import * as T from 'three';

/** Resample immutable generated canvas assets only. Dynamic cockpit displays,
 * simulation state textures and render targets must retain their own ownership.
 * Keep one source canvas so quality can be restored without accumulating copies. */
export class TextureBudget {
  private assets = new Map<T.CanvasTexture, HTMLCanvasElement>();
  private limit = 512;
  private anisotropy = 8;
  register(root: T.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) {
          if (!(value instanceof T.CanvasTexture) || value.userData.dynamic) continue;
          if (this.assets.has(value)) continue;
          const source = value.image as HTMLCanvasElement;
          if (!(source instanceof HTMLCanvasElement)) continue;
          this.assets.set(value, source);
          this.apply(value, source);
        }
      }
    });
  }
  configure(limit: number, anisotropy: number) {
    if (limit === this.limit && anisotropy === this.anisotropy) return;
    this.limit = limit;
    this.anisotropy = anisotropy;
    for (const [texture, source] of this.assets) this.apply(texture, source);
  }
  private apply(texture: T.CanvasTexture, source: HTMLCanvasElement) {
    const factor = Math.min(1, this.limit / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * factor));
    const height = Math.max(1, Math.round(source.height * factor));
    const current = texture.image as HTMLCanvasElement;
    if (current.width !== width || current.height !== height) {
      let image = source;
      if (factor < 1) {
        image = document.createElement('canvas');
        image.width = width;
        image.height = height;
        const context = image.getContext('2d');
        if (!context) throw new Error('Texture resampling requires Canvas 2D');
        context.drawImage(source, 0, 0, width, height);
      }
      texture.dispose();
      texture.image = image;
    }
    texture.anisotropy = this.anisotropy;
    texture.generateMipmaps = true;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
  }
  dispose() {
    this.assets.clear();
  }
}
