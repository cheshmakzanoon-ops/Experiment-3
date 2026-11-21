import * as T from 'three';
import { TILE_SIZE } from '../../simulation/open-world/terrain-tiles.ts';
import type {
  FromTileWorker,
  TileMeshData,
  ToTileWorker,
} from '../../workers/open-world-protocol.ts';
import { terrainMaterial } from './terrain-material.ts';
import { terrainPatchIndex } from './terrain-topology.ts';
import { terrainParentMorph } from './terrain-morph.ts';

/** Quadtree levels: level L tiles are TILE_SIZE·2^L wide. Level 6 tiles
 * (16.4 km) cover the drivable region and the horizon ranges around it. */
export const TERRAIN_LEVELS = 6;
export const TERRAIN_EXTENT = TILE_SIZE * 2 ** TERRAIN_LEVELS;
const ORIGIN = -TERRAIN_EXTENT / 2;
export const TERRAIN_MORPH_SECONDS = 0.28;
/** Late arrivals under the car must restore the exact drivable heightfield
 * before nearby vegetation is activated. Ordinary refinement starts far ahead. */
export const TERRAIN_CONTACT_RADIUS = 64;

export interface TerrainBudget {
  /** Split distance as a multiple of the tile edge (detail falloff). */
  split: number;
  /** Resident GPU tiles (LRU beyond this). */
  maxTiles: number;
  /** Tile requests in flight to the worker. */
  inFlight: number;
  /** Tree planting density for the near levels (0..1): it thins the far
   * level and, on the finest level, only trees without a trunk collider. */
  trees: number;
}
export const TERRAIN_BUDGETS: Readonly<Record<'low' | 'medium' | 'high', TerrainBudget>> =
  Object.freeze({
    low: { split: 1.25, maxTiles: 110, inFlight: 3, trees: 0.45 },
    medium: { split: 1.6, maxTiles: 150, inFlight: 4, trees: 0.7 },
    high: { split: 2.1, maxTiles: 220, inFlight: 6, trees: 1 },
  });

interface Tile {
  key: number;
  level: number;
  ix: number;
  iz: number;
  mesh: T.Mesh | null;
  data: TileMeshData | null;
  requested: boolean;
  id: number;
  used: number;
  /** 0 draws this tile; 0..1 draws its complete child quartet; 1 may refine further. */
  refinement: number;
  morphBytes: number;
}
const res = (level: number) => (level <= 2 ? 64 : 32);
const key = (level: number, ix: number, iz: number) => (level * 4096 + ix) * 4096 + iz;

/** Keep the worker samples at full precision for topology and future children.
 * Store presentation weights in normalized vertex attributes. The fourth shade
 * channel distinguishes urban paving from village greens and can be negative. */
function terrainMaskAttributes(splat: Float32Array, shade: Float32Array) {
  const layers = new Uint8Array(splat.length);
  const region = new Int16Array(shade.length);
  for (let i = 0; i < layers.length; i++) {
    layers[i] = Math.round(Math.min(1, Math.max(0, splat[i])) * 255);
    region[i] = Math.round(Math.min(1, Math.max(-1, shade[i])) * 32767);
  }
  return {
    splat: new T.BufferAttribute(layers, 4, true),
    shade: new T.BufferAttribute(region, 4, true),
  };
}

/**
 * Streamed terrain with level of detail: a quadtree of carved height tiles
 * built in the tile worker, drawn with the layered PBR terrain material.
 * Each frame the tree is refined around the camera (split while closer than
 * `split` tile edges); a node whose children are not all resident keeps
 * drawing itself, so there are never holes, only coarser ground for a few
 * frames. Complete child quartets inherit their parent's surface and morph
 * to fine detail on the presentation clock; coarsening reverses this process.
 * Skirts hide the cracks between neighbouring levels. Ancestors and active
 * transitions are owned together; spare cached tiles are evicted first.
 */
export class TerrainStreamer {
  readonly root = new T.Group();
  readonly material = terrainMaterial();
  private readonly tiles = new Map<number, Tile>();
  private readonly byId = new Map<number, Tile>();
  private nextId = 1;
  private frame = 0;
  private inFlight = 0;
  private clock = NaN;
  private disposed = false;
  private readonly indices = new Map<number, T.BufferAttribute>();
  private drawnTiles = new Set<number>();
  /** Changes when the displayed covering set or its morph silhouette changes.
   * Far shadows coalesce these streaming updates. */
  shadowRevision = 0;
  /** Diagnostics. */
  stats = {
    resident: 0,
    drawn: 0,
    requested: 0,
    built: 0,
    evicted: 0,
    workerMs: 0,
    transitioning: 0,
    reserved: 0,
    /** CPU morph/parent-mask attribute payload; excludes driver texture padding. */
    morphBytes: 0,
  };
  /** Tree data of drawn near tiles changed (vegetation rebuilds instances). */
  readonly treeTiles = new Map<
    number,
    { data: TileMeshData; level: number; ix: number; iz: number }
  >();
  treesChanged = false;
  private readonly camera = new T.Vector3();
  constructor(
    private readonly worker: Worker,
    public budget: TerrainBudget = TERRAIN_BUDGETS.medium,
  ) {
    this.root.name = 'Festival terrain';
    // A heightfield has no closed underside. Three's PCF default flips a
    // FrontSide material to BackSide in the shadow pass, dropping sun-facing
    // slopes. Cast both faces into the far map; visible terrain stays FrontSide.
    this.material.shadowSide = T.DoubleSide;
    worker.addEventListener('message', this.receive);
  }
  private receive = (event: MessageEvent<FromTileWorker>) => {
    if (this.disposed) return;
    const msg = event.data;
    const tile = this.byId.get(msg.id);
    // A cancelled worker reply must not decrement a different live request.
    if (!tile) return;
    this.byId.delete(msg.id);
    this.inFlight = Math.max(0, this.inFlight - 1);
    tile.requested = false;
    if (msg.type === 'error') return;
    tile.data = msg;
    tile.mesh = this.build(tile, msg);
    this.stats.resident++;
    this.stats.built++;
    this.stats.workerMs = this.stats.workerMs * 0.9 + msg.ms * 0.1;
  };
  private indexFor(r: number) {
    let index = this.indices.get(r);
    if (index) return index;
    const side = r + 1,
      list: number[] = [];
    for (let j = 0; j < r; j++)
      for (let i = 0; i < r; i++) {
        const a = j * side + i,
          b = a + 1,
          c = a + side,
          d = c + 1;
        // Diagonal a-d: the physics triangulation (terrain-tiles gridHeight).
        list.push(a, d, b, a, c, d);
      }
    // Skirts: edge vertex k of side e has its dropped twin at side² + e·side + k.
    const base = side * side;
    const edges = [
      (k: number) => k, // z = 0 row
      (k: number) => r * side + k, // z = max row
      (k: number) => k * side, // x = 0 column
      (k: number) => k * side + r, // x = max column
    ];
    edges.forEach((edge, e) => {
      for (let k = 0; k < r; k++) {
        const a = edge(k),
          b = edge(k + 1),
          a2 = base + e * side + k,
          b2 = a2 + 1;
        // Both windings: skirts are seen from either side.
        list.push(a, b, a2, b, b2, a2, a, a2, b, b, a2, b2);
      }
    });
    index = new T.BufferAttribute(new Uint16Array(list), 1);
    this.indices.set(r, index);
    return index;
  }
  private build(tile: Tile, data: TileMeshData) {
    const r = res(tile.level),
      side = r + 1,
      size = TILE_SIZE * 2 ** tile.level,
      step = size / r,
      count = side * side + 4 * side,
      skirt = 2 + step * 0.6;
    const position = new Float32Array(count * 3),
      normal = new Float32Array(count * 3),
      splat = new Float32Array(count * 4),
      shade = new Float32Array(count * 4);
    for (let j = 0; j < side; j++)
      for (let i = 0; i < side; i++) {
        const v = j * side + i;
        position[v * 3] = i * step;
        position[v * 3 + 1] = data.heights[v];
        position[v * 3 + 2] = j * step;
      }
    normal.set(data.normals);
    splat.set(data.splat);
    shade.set(data.shade);
    const edges = [
      (k: number) => k,
      (k: number) => r * side + k,
      (k: number) => k * side,
      (k: number) => k * side + r,
    ];
    edges.forEach((edge, e) => {
      for (let k = 0; k < side; k++) {
        const from = edge(k),
          to = side * side + e * side + k;
        position[to * 3] = position[from * 3];
        position[to * 3 + 1] = position[from * 3 + 1] - skirt;
        position[to * 3 + 2] = position[from * 3 + 2];
        for (let c = 0; c < 3; c++) normal[to * 3 + c] = normal[from * 3 + c];
        for (let c = 0; c < 4; c++) {
          splat[to * 4 + c] = splat[from * 4 + c];
          shade[to * 4 + c] = shade[from * 4 + c];
        }
      }
    });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new T.BufferAttribute(normal, 3));
    const masks = terrainMaskAttributes(splat, shade);
    geometry.setAttribute('splat', masks.splat);
    geometry.setAttribute('shade', masks.shade);
    let parentSurface: ReturnType<typeof terrainParentMorph> | undefined;
    const parent = this.tiles.get(key(tile.level + 1, tile.ix >> 1, tile.iz >> 1));
    if (parent?.data) {
      const morph = terrainParentMorph(
        position,
        normal,
        data,
        parent.data,
        r,
        res(parent.level),
        tile.ix & 1,
        tile.iz & 1,
      );
      parentSurface = morph;
      geometry.morphAttributes.position = [new T.BufferAttribute(morph.position, 3)];
      geometry.morphAttributes.normal = [new T.BufferAttribute(morph.normal, 3)];
      const parentMasks = terrainMaskAttributes(morph.splat, morph.shade);
      geometry.setAttribute('parentSplat', parentMasks.splat);
      geometry.setAttribute('parentShade', parentMasks.shade);
      tile.morphBytes =
        morph.position.byteLength +
        morph.normal.byteLength +
        parentMasks.splat.array.byteLength +
        parentMasks.shade.array.byteLength;
      this.stats.morphBytes += tile.morphBytes;
    }
    const grid = this.indexFor(r);
    const full = grid.array as Uint16Array;
    const optimized = terrainPatchIndex(r, full, { position, normal, splat, shade }, parentSurface);
    geometry.setIndex(optimized === full ? grid : new T.BufferAttribute(optimized, 1));
    // Include both fine and parent targets; a partially morphed mountain must
    // not be culled using only the fine surface's bounds.
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, this.material);
    mesh.name = `Terrain L${tile.level} ${tile.ix},${tile.iz}`;
    mesh.position.set(ORIGIN + tile.ix * size, 0, ORIGIN + tile.iz * size);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    this.root.add(mesh);
    return mesh;
  }
  private tile(level: number, ix: number, iz: number) {
    const k = key(level, ix, iz);
    let t = this.tiles.get(k);
    if (!t) {
      t = {
        key: k,
        level,
        ix,
        iz,
        mesh: null,
        data: null,
        requested: false,
        id: 0,
        used: 0,
        refinement: 0,
        morphBytes: 0,
      };
      this.tiles.set(k, t);
    }
    return t;
  }
  private request(t: Tile, priority: number) {
    if (t.requested || t.mesh) return false;
    if (this.inFlight >= this.budget.inFlight && priority > 0) return false;
    const size = TILE_SIZE * 2 ** t.level;
    t.requested = true;
    t.id = this.nextId++;
    this.byId.set(t.id, t);
    this.inFlight++;
    this.stats.requested++;
    const message: ToTileWorker = {
      type: 'tile',
      id: t.id,
      x0: ORIGIN + t.ix * size,
      z0: ORIGIN + t.iz * size,
      size,
      res: res(t.level),
      trees: t.level <= 1 ? this.budget.trees : t.level === 2 ? 0.25 * this.budget.trees : 0,
      // The finest level carries every collider tree (density thins the
      // shrubs and the far level only).
      colliders: t.level === 0,
    };
    this.worker.postMessage(message);
    return true;
  }
  private distanceToTile(t: Tile) {
    const size = TILE_SIZE * 2 ** t.level,
      x0 = ORIGIN + t.ix * size,
      z0 = ORIGIN + t.iz * size,
      c = this.camera;
    const dx = Math.max(x0 - c.x, 0, c.x - (x0 + size)),
      dz = Math.max(z0 - c.z, 0, c.z - (z0 + size));
    const dy = t.data ? Math.max(0, c.y - t.data.maxY) : 0;
    return Math.hypot(dx, dz, dy * 0.6);
  }
  private children(t: Tile) {
    const children: Tile[] = [];
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) children.push(this.tile(t.level - 1, t.ix * 2 + i, t.iz * 2 + j));
    return children;
  }
  /** Budget the hierarchy, including its retained ancestors. Admitting whole
   * quartets prevents incomplete siblings from exhausting the cache forever. */
  private plan() {
    const split = new Set<number>(),
      root = this.tile(TERRAIN_LEVELS, 0, 0),
      queue = [{ tile: root, distance: this.distance(root) }],
      limit = Math.max(1, Math.floor(this.budget.maxTiles));
    let allocated = 1;
    while (queue.length) {
      // At most maxTiles entries; cache each distance once rather than
      // recomputing square roots inside repeated sort comparisons.
      queue.sort(
        (a, b) => a.distance - b.distance || a.tile.level - b.tile.level || a.tile.key - b.tile.key,
      );
      const t = queue.shift()!.tile;
      if (t.level === 0 || allocated + 4 > limit) continue;
      const reach = TILE_SIZE * 2 ** t.level * this.budget.split * (t.refinement > 0 ? 1.12 : 1);
      if (this.distanceToTile(t) >= reach) continue;
      split.add(t.key);
      allocated += 4;
      for (const child of this.children(t))
        queue.push({ tile: child, distance: this.distance(child) });
    }
    return split;
  }
  private collapse(t: Tile) {
    if (t.refinement > 0) {
      for (const child of this.children(t)) this.collapse(child);
      t.refinement = 0;
    }
  }
  /** Refine around the camera on presentation time. Omitting time is the
   * loading/prestream path: settle complete levels before GPU preparation.
   * Repeated times hold morphs; a seek settles the newly selected cover. */
  update(camera: T.Camera, time?: number) {
    if (this.disposed) return;
    camera.getWorldPosition(this.camera);
    this.frame++;
    const timed = time !== undefined && Number.isFinite(time),
      seek = timed && Number.isFinite(this.clock) && (time < this.clock || time - this.clock > 0.5),
      elapsed =
        timed && Number.isFinite(this.clock) ? Math.max(0, Math.min(0.1, time - this.clock)) : 0,
      settle = !timed || seek,
      plan = this.plan();
    this.clock = timed ? time : NaN;
    for (const t of this.tiles.values()) if (t.mesh) t.mesh.visible = false;
    let silhouetteChanged = false;
    const drawnTiles = new Set<number>(),
      protectedTiles = new Set<Tile>(),
      treeOwners = new Set<Tile>(),
      wanted: { parent: Tile; children: Tile[] }[] = [];
    this.stats.transitioning = 0;
    const keep = (t: Tile) => {
      t.used = this.frame;
      protectedTiles.add(t);
    };
    const trees = (t: Tile) => {
      if (t.level <= 2 && t.data?.trees.length) treeOwners.add(t);
    };
    const show = (t: Tile, coarse = 0, includeTrees = true) => {
      keep(t);
      if (!t.mesh) return;
      t.mesh.visible = true;
      drawnTiles.add(t.key);
      if (t.mesh.morphTargetInfluences) {
        silhouetteChanged ||= t.mesh.morphTargetInfluences[0] !== coarse;
        t.mesh.morphTargetInfluences[0] = coarse;
      }
      if (includeTrees) trees(t);
    };
    const visit = (t: Tile, allowRefine = true) => {
      keep(t);
      const refine = allowRefine && plan.has(t.key);
      if (!t.mesh || t.level === 0 || (!refine && t.refinement === 0)) {
        show(t);
        return;
      }
      const kids = this.children(t),
        ready = kids.every((child) => child.mesh),
        step =
          settle || (elapsed > 0 && t.level <= 2 && this.distanceToTile(t) < TERRAIN_CONTACT_RADIUS)
            ? 1
            : elapsed / TERRAIN_MORPH_SECONDS;
      if (!refine && settle) this.collapse(t);
      else if (!refine && kids.some((child) => child.refinement > 0)) {
        // Collapse one complete descendant covering set before moving its
        // parent. A grandchild never needs two simultaneous morph targets.
        for (const child of kids) visit(child, false);
        return;
      } else if (ready)
        t.refinement = Math.min(1, Math.max(0, t.refinement + (refine ? step : -step)));
      else t.refinement = 0;
      if (t.refinement === 1) {
        for (const child of kids) visit(child, refine);
      } else if (t.refinement > 0) {
        this.stats.transitioning++;
        for (const child of kids) show(child, 1 - t.refinement, false);
        // Do not anchor new trees to the final child height while its ground
        // is still morphing. Near-camera transitions settle before this branch.
        if (t.level <= 2) trees(t);
        else if (!refine && t.level === 3) for (const child of kids) trees(child);
      } else {
        show(t);
        if (refine) wanted.push({ parent: t, children: kids });
      }
    };
    visit(this.tile(TERRAIN_LEVELS, 0, 0));
    // Reserve complete desired quartets, then retire stale requests/cache
    // entries before issuing replacements. Current covering sets are retained
    // during a quality-budget downgrade and release as their morphs complete.
    const limit = Math.max(1, Math.floor(this.budget.maxTiles));
    wanted.sort(
      (a, b) => this.distance(a.parent) - this.distance(b.parent) || a.parent.key - b.parent.key,
    );
    for (const group of wanted) {
      const extra = group.children.filter((child) => !protectedTiles.has(child)).length;
      if (protectedTiles.size + extra <= limit) for (const child of group.children) keep(child);
    }
    for (const t of this.tiles.values())
      if (t.requested && !protectedTiles.has(t)) {
        this.worker.postMessage({ type: 'cancel', id: t.id } satisfies ToTileWorker);
        this.byId.delete(t.id);
        this.inFlight--;
        t.requested = false;
      }
    this.evict(protectedTiles);
    const requests = [...protectedTiles].filter((t) => !t.mesh && !t.requested);
    requests.sort(
      (a, b) => b.level - a.level || this.distance(a) - this.distance(b) || a.key - b.key,
    );
    for (const t of requests) if (!this.request(t, t.level === TERRAIN_LEVELS ? 0 : 1)) break;
    this.stats.drawn = drawnTiles.size;
    if (
      silhouetteChanged ||
      drawnTiles.size !== this.drawnTiles.size ||
      [...drawnTiles].some((key) => !this.drawnTiles.has(key))
    )
      this.shadowRevision++;
    this.drawnTiles = drawnTiles;
    // Trees of the drawn near tiles.
    let changed = false;
    for (const t of this.tiles.values()) {
      if (treeOwners.has(t) && this.treeTiles.get(t.key)?.data !== t.data) {
        this.treeTiles.set(t.key, { data: t.data!, level: t.level, ix: t.ix, iz: t.iz });
        changed = true;
      } else if (!treeOwners.has(t) && this.treeTiles.has(t.key)) {
        this.treeTiles.delete(t.key);
        changed = true;
      }
    }
    if (changed) this.treesChanged = true;
  }
  private distance(t: Tile) {
    const size = TILE_SIZE * 2 ** t.level;
    return Math.hypot(
      ORIGIN + (t.ix + 0.5) * size - this.camera.x,
      ORIGIN + (t.iz + 0.5) * size - this.camera.z,
    );
  }
  private evict(protectedTiles: ReadonlySet<Tile>) {
    const resident = [...this.tiles.values()].filter((t) => t.mesh);
    const missing = [...protectedTiles].filter((t) => !t.mesh).length;
    this.stats.reserved = missing;
    const target = Math.max(0, Math.floor(this.budget.maxTiles) - missing);
    let count = resident.length;
    resident
      .filter((t) => !protectedTiles.has(t) && t.level < TERRAIN_LEVELS)
      .sort((a, b) => a.used - b.used || a.key - b.key)
      .slice(0, Math.max(0, resident.length - target))
      .forEach((t) => {
        this.root.remove(t.mesh!);
        t.mesh!.geometry.dispose();
        t.mesh = null;
        t.data = null;
        t.requested = false;
        this.stats.morphBytes -= t.morphBytes;
        t.morphBytes = 0;
        this.tiles.delete(t.key);
        this.treeTiles.delete(t.key);
        this.stats.evicted++;
        count--;
      });
    this.stats.resident = count;
    for (const t of this.tiles.values())
      if (!t.mesh && !t.requested && !protectedTiles.has(t) && t.used < this.frame - 2)
        this.tiles.delete(t.key);
  }
  /** Ready for GPU preparation only once exact ground under `at` is visible.
   * A received but hidden child must not skip its first real shader warm-up. */
  readyAround(x: number, z: number) {
    const top = this.tiles.get(key(TERRAIN_LEVELS, 0, 0));
    if (!top?.mesh) return false;
    const ix = Math.floor((x - ORIGIN) / TILE_SIZE),
      iz = Math.floor((z - ORIGIN) / TILE_SIZE);
    const mesh = this.tiles.get(key(0, ix, iz))?.mesh;
    return !!mesh?.visible && (mesh.morphTargetInfluences?.[0] ?? 0) === 0;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener('message', this.receive);
    for (const t of this.byId.values())
      this.worker.postMessage({ type: 'cancel', id: t.id } satisfies ToTileWorker);
    for (const t of this.tiles.values()) t.mesh?.geometry.dispose();
    this.tiles.clear();
    this.byId.clear();
    this.indices.clear();
    this.drawnTiles.clear();
    this.treeTiles.clear();
    this.root.clear();
    this.inFlight =
      this.stats.resident =
      this.stats.drawn =
      this.stats.reserved =
      this.stats.morphBytes =
        0;
    this.stats.transitioning = 0;
    this.material.dispose();
  }
}
