import * as T from 'three';
import { ImportedTextureBudget } from './imported-texture-budget.ts';

interface CanvasSource {
  original: T.Source;
  image: HTMLCanvasElement;
  groups: Map<string, CanvasAsset>;
}
interface CanvasAsset {
  source: CanvasSource;
  owned: T.Source;
  scale: number;
  cpuReadback: boolean;
  textures: Set<T.CanvasTexture>;
}

/** Resample generated canvases and opted-in immutable supplied-player maps.
 * Dynamic cockpit displays,
 * simulation state textures and render targets must retain their own ownership.
 * Keep one source canvas so quality can be restored without accumulating copies. */
export class TextureBudget {
  private readonly imported = new ImportedTextureBudget();
  private readonly assets = new Map<T.CanvasTexture, CanvasAsset>();
  private readonly sources = new Map<T.Source, CanvasSource>();
  private readonly groups = new Set<CanvasAsset>();
  private detailData = new Set<T.DataTexture>();
  private limit = 512;
  private anisotropy = 8;
  register(root: T.Object3D) {
    const pending = new Set<CanvasAsset>();
    const imported = new Set<T.Texture>();
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) {
          if (
            value instanceof T.Texture &&
            (value.userData.suppliedPlayerTexture === true ||
              value.userData.immutableAssetTexture === true)
          ) {
            imported.add(value);
            continue;
          }
          // Tiny prefiltered fabric maps retain their fixed resolution but obey
          // the same user-selected filtering budget. Simulation data is excluded.
          if (value instanceof T.DataTexture && value.userData.surfaceDetail === true) {
            this.detailData.add(value);
            value.anisotropy = this.anisotropy;
            continue;
          }
          if (!(value instanceof T.CanvasTexture) || value.userData.dynamic) continue;
          if (this.assets.has(value)) continue;
          if (!(value.image instanceof HTMLCanvasElement)) continue;
          let source = this.sources.get(value.source);
          if (!source) {
            source = { original: value.source, image: value.image, groups: new Map() };
            this.sources.set(source.original, source);
          }
          const claim = value.userData.textureBudgetScale,
            scale = typeof claim === 'number' && claim > 1 ? Math.min(claim, 4) : 1,
            cpuReadback = value.userData.cpuReadback === true,
            key = `${scale}:${cpuReadback}`;
          let asset = source.groups.get(key);
          if (!asset) {
            asset = {
              source,
              owned: new T.Source(source.image),
              scale,
              cpuReadback,
              textures: new Set(),
            };
            source.groups.set(key, asset);
            this.sources.set(asset.owned, source);
            this.groups.add(asset);
          }
          this.assets.set(value, asset);
          asset.textures.add(value);
          // Texture.clone() shares Source. Keep the authored canvas untouched
          // and share budget storage only between compatible resolution claims.
          value.dispose();
          value.source = asset.owned;
          pending.add(asset);
        }
      }
    });
    // A traversal can contain many wrappers of one authored image. Repaint and
    // invalidate each group once, but do not reuse generated pixels across calls:
    // the authored canvas may have been painted before a later clone arrives.
    for (const asset of pending) this.apply(asset);
    this.imported.register(imported);
  }
  configure(limit: number, anisotropy: number) {
    if (limit === this.limit && anisotropy === this.anisotropy) return;
    this.limit = limit;
    this.anisotropy = anisotropy;
    this.imported.configure(limit, anisotropy);
    for (const asset of this.groups) this.apply(asset);
    for (const texture of this.detailData) {
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    }
  }
  /** A planting tier owns its maps exclusively. Forget them before disposing
   * that tier so later quality changes never resize or retain dead assets. */
  unregister(root: T.Object3D) {
    const textures = new Set<T.Texture>();
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        for (const value of Object.values(material))
          if (value instanceof T.Texture) textures.add(value);
    });
    for (const texture of textures) {
      this.imported.unregister(texture);
      if (texture instanceof T.DataTexture) this.detailData.delete(texture);
      if (texture instanceof T.CanvasTexture) {
        const asset = this.assets.get(texture);
        if (!asset) continue;
        texture.dispose();
        texture.source = asset.source.original;
        texture.needsUpdate = true;
        this.assets.delete(texture);
        asset.textures.delete(texture);
        if (!asset.textures.size) {
          this.groups.delete(asset);
          this.sources.delete(asset.owned);
          asset.source.groups.delete(`${asset.scale}:${asset.cpuReadback}`);
          if (!asset.source.groups.size) this.sources.delete(asset.source.original);
        }
      }
    }
  }
  /** Repaint every budget copy of an authored canvas, preserving each claim. */
  refresh(texture: T.Texture) {
    if (!(texture instanceof T.CanvasTexture)) return;
    const asset = this.assets.get(texture);
    if (!asset) return;
    for (const group of asset.source.groups.values()) this.apply(group);
  }
  private apply(asset: CanvasAsset) {
    // A hero atlas spread over a whole vehicle (the GP-R3 livery) may claim a
    // fixed multiple of the preset limit; every other canvas keeps the limit.
    const source = asset.source.image,
      limit = this.limit * asset.scale,
      factor = Math.min(1, limit / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * factor));
    const height = Math.max(1, Math.round(source.height * factor));
    const current = asset.owned.data as HTMLCanvasElement;
    if (
      current.width !== width ||
      current.height !== height ||
      (factor === 1 && current !== source)
    ) {
      let image = source;
      if (factor < 1) {
        image = document.createElement('canvas');
        image.width = width;
        image.height = height;
        // The presented copy of a skin that diagnostics read back stays
        // CPU-backed like its source (car-livery flankLivery): an accelerated
        // copy makes getImageData wait behind every queued GPU submission.
        const context = image.getContext(
          '2d',
          asset.cpuReadback ? { willReadFrequently: true } : undefined,
        );
        if (!context) throw new Error('Texture resampling requires Canvas 2D');
        context.drawImage(source, 0, 0, width, height);
      }
      // Every uploaded wrapper must release its immutable WebGL storage before
      // shared Source.data changes dimensions, including differently wrapped UVs.
      for (const texture of asset.textures) texture.dispose();
      asset.owned.data = image;
    } else if (current !== source) {
      // Only an existing copy needs clearing. A freshly resized image already
      // contains this print, including its transparent cutouts.
      const context = current.getContext('2d');
      if (!context) throw new Error('Texture repaint requires Canvas 2D');
      context.clearRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);
    }
    for (const texture of asset.textures) {
      texture.anisotropy = this.anisotropy;
      texture.generateMipmaps = true;
      texture.minFilter = T.LinearMipmapLinearFilter;
      texture.needsUpdate = true;
    }
  }
  dispose() {
    const assets = [...this.assets];
    // Reentrant disposal must not revisit wrappers whose old owner is closing.
    this.assets.clear();
    this.sources.clear();
    this.groups.clear();
    this.detailData.clear();
    let failed = false;
    let failure: unknown;
    const release = (dispose: () => void) => {
      try {
        dispose();
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    };
    release(() => this.imported.dispose());
    for (const [texture, asset] of assets)
      release(() => {
        try {
          texture.dispose();
        } finally {
          texture.source = asset.source.original;
          texture.needsUpdate = true;
        }
      });
    if (failed) throw failure;
  }
}
