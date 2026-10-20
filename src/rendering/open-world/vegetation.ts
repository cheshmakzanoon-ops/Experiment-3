import * as T from 'three';
import { TREE_SPECIES } from '../../simulation/open-world/placement.ts';
import { foliageAtlas, installFoliageAtlas, treeGeometry } from '../landscape.ts';
import {
  foliageSwayAmplitude,
  installFoliageShading,
  installFoliageWind,
} from '../studio/foliage-shading.ts';
import type { TileMeshData } from '../../workers/open-world-protocol.ts';
import { TILE_TREE_STRIDE } from './tile-data.ts';
import { FESTIVAL_PALETTE } from '../assets/sky-catalogue.ts';
import type { QualityPreset } from '../options.ts';
import { PhotoForest, type PhotoPlant } from '../vegetation/forest.ts';
import type { VegetationLibrary } from '../vegetation/library.ts';
import { photoPlants } from '../vegetation/planting.ts';
import { plantHash, plantTint, SPECIES, treeRole } from '../vegetation/species.ts';

/** Each card represents many leaves with different orientations. Strong
 * horizontal radial normals lit the crossing planes as separate slabs.
 * Favour the aggregate crown's upward leaf lighting; the atlas and existing
 * crown occlusion still shade its interior, base and individual leaf clusters.
 * Keep this grade local to Festival fallback geometry. */
function canopyNormals(geometry: T.BufferGeometry) {
  const positions = geometry.getAttribute('position'),
    normals = geometry.getAttribute('normal'),
    direction = new T.Vector3();
  for (let i = 0; i < positions.count; i++) {
    direction
      .set(
        positions.getX(i) * 0.48,
        Math.max(0.48, 0.48 + (positions.getY(i) - 0.42) * 0.55),
        positions.getZ(i) * 0.48,
      )
      .normalize();
    normals.setXYZ(i, direction.x, direction.y, direction.z);
  }
}

/** Root the porous multi-card crown at soil level. The tree shader's crown
 * reshaping is disabled for these low cards: a shrub has no clear trunk. */
function shrubGeometry(crown: T.BufferGeometry) {
  const g = crown.clone();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, Math.max(0, p.getY(i) - 0.19) * 0.86);
  g.getAttribute('cardCentre').array.fill(0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

interface TileTrees {
  group: T.Group;
  forest: PhotoForest | null;
}
/**
 * Instanced vegetation on the near terrain tiles: broadleaf trees from the
 * shared foliage-card crowns and atlas (the same crowns as the circuit
 * planting), porous conifer branches and leaf-card shrubs; full trees with
 * shadows on the finest tiles, cheap three-card impostor crowns on the next
 * level, nothing beyond (the terrain's forest tint carries the far woods).
 * Instances come from the deterministic placement the physics colliders use.
 */
export class Vegetation {
  readonly root = new T.Group();
  private readonly tiles = new Map<number, TileTrees>();
  private readonly foliage: T.MeshStandardMaterial;
  private readonly depth: T.MeshDepthMaterial;
  private readonly bark: T.MeshStandardMaterial;
  private readonly geometry: {
    leaf: T.BufferGeometry;
    trunk: T.BufferGeometry;
    distant: T.BufferGeometry;
    coniferTrunk: T.BufferGeometry;
    shrub: T.BufferGeometry;
  };
  stats = { tiles: 0, instances: 0 };
  /** Photographic trees and shrubs (null: the procedural crowns). */
  private photo: VegetationLibrary | null = null;
  constructor() {
    this.root.name = 'Festival vegetation';
    const { leafGeometry, trunkGeometry, distantLeafGeometry } = treeGeometry();
    this.geometry = {
      leaf: leafGeometry,
      trunk: trunkGeometry,
      distant: distantLeafGeometry,
      coniferTrunk: new T.CylinderGeometry(0.014, 0.03, 0.3, 6).translate(0, 0.15, 0),
      shrub: shrubGeometry(leafGeometry),
    };
    for (const geometry of [this.geometry.leaf, this.geometry.distant, this.geometry.shrub])
      canopyNormals(geometry);
    this.foliage = new T.MeshStandardMaterial({
      map: foliageAtlas(),
      side: T.DoubleSide,
      alphaTest: 0.45,
      roughness: 1,
    });
    this.foliage.name = 'Festival broadleaf foliage';
    installFoliageAtlas(this.foliage);
    installFoliageShading(this.foliage);
    installFoliageWind(this.foliage);
    this.depth = new T.MeshDepthMaterial({
      depthPacking: T.RGBADepthPacking,
      map: this.foliage.map,
      alphaTest: 0.45,
      side: T.DoubleSide,
    });
    installFoliageAtlas(this.depth);
    installFoliageWind(this.depth);
    this.bark = new T.MeshStandardMaterial({ color: 0x5b5242, roughness: 1 });
  }
  /** Use the photographic plants for every tile built from now on (set
   * before streaming starts; null returns to the procedural crowns). */
  setPhotoLibrary(library: VegetationLibrary | null, ground?: (x: number, z: number) => number) {
    this.photo = library;
    this.ground = ground;
  }
  private ground: ((x: number, z: number) => number) | undefined;
  get photographic() {
    return !!this.photo;
  }
  /** Per frame: near-LOD switching of photographic tiles. */
  update(camera: T.Camera, preset: QualityPreset) {
    for (const tile of this.tiles.values()) tile.forest?.update(camera, preset);
  }
  /** Bring the instanced tiles in line with the terrain's near tiles. */
  sync(near: ReadonlyMap<number, { data: TileMeshData; level: number }>) {
    for (const [key, tile] of this.tiles)
      if (!near.has(key)) {
        this.root.remove(tile.group);
        tile.forest?.dispose();
        tile.group.traverse((o) => {
          if (o instanceof T.InstancedMesh) o.dispose();
        });
        this.tiles.delete(key);
      }
    for (const [key, entry] of near)
      if (!this.tiles.has(key)) {
        if (this.photo) {
          const forest = this.buildPhoto(entry.data);
          this.tiles.set(key, { group: forest.root, forest });
        } else this.tiles.set(key, { group: this.build(entry.data, entry.level), forest: null });
      }
    let instances = 0;
    for (const t of this.tiles.values()) instances += t.group.userData.instances as number;
    this.stats = { tiles: this.tiles.size, instances };
  }
  /** One tile's trees and shrubs as photographic plants (all levels: the
   * shader crossfades leaf cards and impostors per plant). */
  private buildPhoto(data: TileMeshData) {
    const library = this.photo!,
      trees = data.trees,
      forest = new PhotoForest(library);
    const planned: {
      x: number;
      y: number;
      z: number;
      height: number;
      width: number;
      yaw: number;
      conifer: boolean;
    }[] = [];
    const shrubs: PhotoPlant[] = [];
    const shrub = library.get(SPECIES.shrub);
    for (let i = 0; i < trees.length; i += TILE_TREE_STRIDE) {
      const kind = trees[i + 3],
        h = trees[i + 2];
      const x = trees[i],
        z = trees[i + 1],
        y = trees[i + 6];
      if (kind === TREE_SPECIES.SHRUB) {
        if (shrub)
          shrubs.push({
            species: SPECIES.shrub,
            x,
            y: y - 0.1,
            z,
            scale: Math.min(2.4, Math.max(0.8, h / Math.max(0.3, shrub.info.height))),
            yaw: trees[i + 4],
            tint: plantTint(plantHash(x, z, 41), FESTIVAL_PALETTE),
          });
        continue;
      }
      const conifer = kind === TREE_SPECIES.CONIFER;
      planned.push({
        x,
        y,
        z,
        height: h,
        width: conifer ? h * 0.5 : h * 0.8,
        yaw: trees[i + 4],
        conifer,
      });
    }
    forest.add(
      photoPlants(planned, library, FESTIVAL_PALETTE, (t) =>
        (t as (typeof planned)[number]).conifer ? 'conifer' : treeRole(t.height, t.width),
      ),
      { label: 'Festival', shadows: true, chunk: 128, ground: this.ground },
    );
    forest.add(shrubs, { label: 'Festival shrubs', shadows: false, chunk: 128 });
    forest.root.userData.instances = forest.plants;
    forest.root.name = 'Photographic vegetation tile';
    this.root.add(forest.root);
    return forest;
  }
  private build(data: TileMeshData, level: number) {
    const group = new T.Group(),
      trees = data.trees,
      near = level === 0,
      buckets: number[][] = [[], [], []];
    for (let i = 0; i < trees.length; i += TILE_TREE_STRIDE) buckets[trees[i + 3]]?.push(i);
    const transform = new T.Object3D(),
      color = new T.Color();
    const add = (
      indices: number[],
      geometry: T.BufferGeometry,
      material: T.Material,
      kind: number,
      shadows: boolean,
    ) => {
      if (!indices.length) return;
      const mesh = new T.InstancedMesh(geometry, material, indices.length);
      let maximumHeight = 0;
      indices.forEach((i, k) => {
        const h = trees[i + 2],
          tint = trees[i + 5],
          // The atlas derives species from width/height. The former .62
          // broadleaf ratio silently selected the conifer tile (< .73).
          // Preserve bark dimensions/collision anchors while correcting crowns.
          w =
            kind === TREE_SPECIES.CONIFER
              ? h * 0.5
              : kind === TREE_SPECIES.SHRUB
                ? h * 1.3
                : h * (material === this.bark ? 0.62 : 0.82 + tint * 0.31);
        maximumHeight = Math.max(maximumHeight, h);
        transform.position.set(
          trees[i],
          trees[i + 6] - (kind === TREE_SPECIES.SHRUB ? 0.045 : 0.15),
          trees[i + 1],
        );
        transform.rotation.set(0, trees[i + 4], 0);
        transform.scale.set(w, h, w);
        transform.updateMatrix();
        mesh.setMatrixAt(k, transform.matrix);
        if (kind === TREE_SPECIES.BROADLEAF)
          color.setRGB(0.78 + 0.25 * tint, 0.85 + 0.15 * tint, 0.68 + 0.12 * tint);
        else color.setRGB(0.85 + 0.2 * tint, 0.9 + 0.12 * tint, 0.85 + 0.1 * tint);
        mesh.setColorAt(k, color);
      });
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      if (material === this.foliage) mesh.customDepthMaterial = this.depth;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      if (material === this.foliage) {
        // The shared shader caps wind strength at 1.5 and normalised height
        // at 1.2. Cover its maximum sway/flutter, including tight shrub cards,
        // so animation cannot disappear at a frustum or shadow boundary.
        const windMargin = foliageSwayAmplitude(maximumHeight, 12, 1) * 1.44;
        mesh.boundingBox!.expandByScalar(windMargin);
        mesh.boundingSphere!.radius += windMargin;
      }
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    };
    const [broadleaf, conifer, shrubs] = buckets;
    if (near) {
      add(broadleaf, this.geometry.leaf, this.foliage, TREE_SPECIES.BROADLEAF, true);
      add(broadleaf, this.geometry.trunk, this.bark, TREE_SPECIES.BROADLEAF, true);
      add(conifer, this.geometry.leaf, this.foliage, TREE_SPECIES.CONIFER, true);
      add(conifer, this.geometry.coniferTrunk, this.bark, TREE_SPECIES.CONIFER, true);
      add(shrubs, this.geometry.shrub, this.foliage, TREE_SPECIES.SHRUB, false);
    } else {
      add(broadleaf, this.geometry.distant, this.foliage, TREE_SPECIES.BROADLEAF, false);
      add(conifer, this.geometry.distant, this.foliage, TREE_SPECIES.CONIFER, false);
    }
    group.userData.instances = broadleaf.length + conifer.length + (near ? shrubs.length : 0);
    group.name = `Vegetation L${level}`;
    this.root.add(group);
    return group;
  }
  dispose() {
    this.sync(new Map());
    for (const g of Object.values(this.geometry)) g.dispose();
    this.foliage.map?.dispose();
    for (const m of [this.foliage, this.depth, this.bark]) m.dispose();
  }
}
