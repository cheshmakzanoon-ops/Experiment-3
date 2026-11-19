import * as T from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  TERRAIN_EXTENT,
  TERRAIN_MORPH_SECONDS,
  TerrainStreamer,
  type TerrainBudget,
} from '../src/rendering/open-world/terrain.ts';
import { terrainParentMorph } from '../src/rendering/open-world/terrain-morph.ts';
import type {
  FromTileWorker,
  TileMeshData,
  TileRequest,
  ToTileWorker,
} from '../src/workers/open-world-protocol.ts';

function data(request: TileRequest, trees = false): TileMeshData {
  const side = request.res + 1,
    n = side * side,
    heights = new Float32Array(n),
    normals = new Float32Array(n * 3),
    splat = new Float32Array(n * 4),
    shade = new Float32Array(n * 4),
    step = request.size / request.res;
  let minY = Infinity,
    maxY = -Infinity;
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const v = j * side + i,
        x = request.x0 + i * step,
        z = request.z0 + j * step,
        h =
          30 + 0.000001 * x * x + 0.000002 * z * z + Math.sin(x / 270) * 8 + Math.cos(z / 190) * 5,
        nx = -(0.000002 * x + (Math.cos(x / 270) * 8) / 270),
        nz = -(0.000004 * z - (Math.sin(z / 190) * 5) / 190),
        length = Math.hypot(nx, 1, nz);
      heights[v] = h;
      normals.set([nx / length, 1 / length, nz / length], v * 3);
      splat[v * 4] = Math.min(1, h / 300);
      shade[v * 4 + 1] = 0.4;
      minY = Math.min(minY, h);
      maxY = Math.max(maxY, h);
    }
  return {
    type: 'tile',
    id: request.id,
    heights,
    normals,
    splat,
    shade,
    trees:
      trees && request.size <= 512
        ? new Float32Array([request.x0 + step, request.z0 + step, 10, 0, 0, 0.5, heights[side + 1]])
        : new Float32Array(),
    minY,
    maxY,
    ms: 1,
  };
}

function fixture(maxTiles = 5, withTrees = false) {
  let receive: (event: MessageEvent<FromTileWorker>) => void = () => {};
  const pending = new Map<number, TileRequest>(),
    cancelled: number[] = [],
    removed = vi.fn();
  const worker = {
    addEventListener: (_: string, listener: typeof receive) => {
      receive = listener;
    },
    removeEventListener: removed,
    postMessage: (message: ToTileWorker) => {
      if (message.type === 'tile') pending.set(message.id, message);
      else {
        cancelled.push(message.id);
        pending.delete(message.id);
      }
    },
  } as unknown as Worker;
  const budget: TerrainBudget = { split: 1.6, maxTiles, inFlight: 4, trees: 1 },
    terrain = new TerrainStreamer(worker, budget),
    camera = new T.PerspectiveCamera();
  camera.position.set(1200, 150, 900);
  camera.updateMatrixWorld();
  const deliver = (request: TileRequest) => {
    pending.delete(request.id);
    receive({ data: data(request, withTrees) } as MessageEvent<FromTileWorker>);
  };
  const deliverAll = () => [...pending.values()].forEach(deliver);
  const move = (x: number, z = 900) => {
    camera.position.set(x, 150, z);
    camera.updateMatrixWorld();
  };
  const load = (turns = 35) => {
    for (let i = 0; i < turns; i++) {
      terrain.update(camera);
      deliverAll();
    }
    terrain.update(camera);
  };
  return { terrain, camera, budget, pending, cancelled, removed, deliver, deliverAll, move, load };
}

const visible = (terrain: TerrainStreamer) =>
  terrain.root.children.filter((o) => o.visible) as T.Mesh[];

function expectCover(terrain: TerrainStreamer) {
  const boxes = visible(terrain).map((mesh) =>
    mesh.geometry.boundingBox!.clone().translate(mesh.position),
  );
  const area = boxes.reduce((sum, b) => sum + (b.max.x - b.min.x) * (b.max.z - b.min.z), 0);
  expect(area).toBe(TERRAIN_EXTENT ** 2);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x),
        overlapZ = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
      expect(overlapX > 0 && overlapZ > 0).toBe(false);
    }
}

function startMorph() {
  const f = fixture();
  f.terrain.update(f.camera, 0);
  f.deliverAll();
  f.terrain.update(f.camera, 0);
  f.deliverAll();
  f.terrain.update(f.camera, 0.04);
  return f;
}

describe('Festival terrain hierarchy transitions', () => {
  it('retains the complete parent until all four children arrive, then morphs without overlap or holes', () => {
    const f = fixture();
    f.terrain.update(f.camera, 0);
    f.deliverAll();
    f.terrain.update(f.camera, 0);
    const requests = [...f.pending.values()];
    expect(requests).toHaveLength(4);
    for (const request of requests.slice(0, 3)) f.deliver(request);
    f.terrain.update(f.camera, 0.02);
    expect(visible(f.terrain)).toHaveLength(1);
    expectCover(f.terrain);
    f.deliver(requests[3]);
    f.terrain.update(f.camera, 0.04);
    expect(visible(f.terrain)).toHaveLength(4);
    expectCover(f.terrain);
    for (const child of visible(f.terrain)) {
      expect(child.morphTargetInfluences![0]).toBeCloseTo(1 - 0.02 / TERRAIN_MORPH_SECONDS, 10);
      expect(child.geometry.morphAttributes.position).toHaveLength(1);
      expect(child.geometry.morphAttributes.normal).toHaveLength(1);
      expect(child.geometry.getAttribute('parentSplat').count).toBe(
        child.geometry.getAttribute('position').count,
      );
      expect(child.customDepthMaterial).toBeUndefined();
      expect(child.material).toBe(f.terrain.material);
    }
    expect(f.terrain.stats.transitioning).toBe(1);
    expect(f.terrain.stats.resident).toBe(5);
    expect(f.terrain.stats.morphBytes).toBeGreaterThan(0);
    f.terrain.dispose();
  });

  it('holds morphs and shadow revision on repeated presentation time, then reverses continuously', () => {
    const f = startMorph();
    const child = visible(f.terrain)[0],
      influence = child.morphTargetInfluences![0],
      revision = f.terrain.shadowRevision;
    for (let i = 0; i < 20; i++) f.terrain.update(f.camera, 0.04);
    expect(child.morphTargetInfluences![0]).toBe(influence);
    expect(f.terrain.shadowRevision).toBe(revision);
    f.move(80000);
    f.terrain.update(f.camera, 0.04);
    expect(child.morphTargetInfluences![0]).toBe(influence);
    f.terrain.update(f.camera, 0.06);
    expect(child.morphTargetInfluences![0]).toBeCloseTo(
      influence + 0.02 / TERRAIN_MORPH_SECONDS,
      10,
    );
    expect(f.terrain.shadowRevision).toBeGreaterThan(revision);
    expectCover(f.terrain);
    for (let i = 1; i <= 12; i++) f.terrain.update(f.camera, 0.06 + i / 30);
    expect(visible(f.terrain)).toHaveLength(1);
    expectCover(f.terrain);
    f.terrain.dispose();
  });

  it('settles a time seek deterministically and uses hysteresis at a split boundary', () => {
    const f = startMorph();
    f.terrain.update(f.camera, -1);
    expect(visible(f.terrain)).toHaveLength(4);
    for (const mesh of visible(f.terrain)) expect(mesh.morphTargetInfluences![0]).toBe(0);
    const revision = f.terrain.shadowRevision;
    f.move(TERRAIN_EXTENT / 2 + TERRAIN_EXTENT * f.budget.split * 1.06);
    f.terrain.update(f.camera, -0.95);
    expect(visible(f.terrain)).toHaveLength(4);
    expect(f.terrain.stats.transitioning).toBe(0);
    expect(f.terrain.shadowRevision).toBe(revision);
    f.terrain.dispose();
  });

  it('reserves whole quartets within budget, reaches the driving tile, and reports real residency while moving', () => {
    const f = fixture(29);
    f.load();
    expect(f.terrain.readyAround(1200, 900)).toBe(true);
    for (const x of [1200, -4500, 4600, -1500]) {
      f.move(x, x * 0.3);
      for (let i = 0; i < 35; i++) {
        f.terrain.update(f.camera);
        expect(f.terrain.stats.resident).toBe(f.terrain.root.children.length);
        expect(f.terrain.stats.resident + f.terrain.stats.reserved).toBeLessThanOrEqual(29);
        expect(f.pending.size).toBeLessThanOrEqual(4);
        expectCover(f.terrain);
        f.deliverAll();
      }
    }
    expect(f.terrain.stats.evicted).toBeGreaterThan(0);
    f.terrain.dispose();
  });

  it('retains transition parents during budget reduction and releases them as coarsening completes', () => {
    const f = fixture(29);
    f.load();
    const peak = f.terrain.root.children.length;
    f.budget.maxTiles = 9;
    for (let i = 0; i <= 120; i++) {
      f.terrain.update(f.camera, i / 60);
      expect(f.terrain.stats.resident).toBe(f.terrain.root.children.length);
      expect(f.terrain.stats.resident).toBeLessThanOrEqual(peak);
      expectCover(f.terrain);
      f.deliverAll();
    }
    expect(f.terrain.stats.resident).toBeLessThanOrEqual(9);
    expect(f.terrain.stats.transitioning).toBe(0);
    f.terrain.dispose();
  });

  it('ignores cancelled replies, keeps the live request cap, and releases geometry once on teardown', () => {
    const f = fixture();
    f.terrain.update(f.camera, 0);
    f.deliverAll();
    f.terrain.update(f.camera, 0);
    const stale = [...f.pending.values()][0];
    f.move(80000);
    f.terrain.update(f.camera, 0.02);
    expect(f.cancelled).toContain(stale.id);
    f.move(1200);
    f.terrain.update(f.camera, 0.04);
    expect(f.pending.size).toBe(4);
    f.deliver(stale);
    f.terrain.update(f.camera, 0.06);
    expect(f.pending.size).toBe(4);
    expect(f.terrain.stats.built).toBe(1);
    const geometry = (f.terrain.root.children[0] as T.Mesh).geometry,
      dispose = vi.spyOn(geometry, 'dispose'),
      late = [...f.pending.values()][0];
    f.terrain.dispose();
    f.terrain.dispose();
    f.deliver(late);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(f.removed).toHaveBeenCalledTimes(1);
    expect(f.terrain.root.children).toHaveLength(0);
    expect(f.terrain.stats.resident).toBe(0);
    expect(f.terrain.stats.morphBytes).toBe(0);
  });

  it('uses complete near-tree owners and exact fine geometry beside the driving camera', () => {
    const f = fixture(29, true);
    f.load();
    f.terrain.update(f.camera, 0);
    expect(f.terrain.treeTiles.size).toBeGreaterThan(0);
    for (const [key, owner] of f.terrain.treeTiles) {
      const mesh = f.terrain.root.children.find(
        (o) => o.name === `Terrain L${owner.level} ${owner.ix},${owner.iz}`,
      ) as T.Mesh;
      expect(key).toBeTypeOf('number');
      expect(mesh.visible).toBe(true);
      expect(mesh.morphTargetInfluences?.[0] ?? 0).toBe(0);
    }
    const driving = visible(f.terrain).filter((mesh) => {
      const box = mesh.geometry.boundingBox!.clone().translate(mesh.position);
      return (
        f.camera.position.x >= box.min.x &&
        f.camera.position.x <= box.max.x &&
        f.camera.position.z >= box.min.z &&
        f.camera.position.z <= box.max.z
      );
    });
    expect(driving).toHaveLength(1);
    expect(driving[0].name).toContain('Terrain L0');
    expect(driving[0].morphTargetInfluences![0]).toBe(0);
    f.terrain.dispose();
  });

  it('holds late near children while paused, then installs exact ground and tree bases together on resume', () => {
    const f = fixture(29, true);
    // Driving-camera height, rather than the aerial camera in the LOD tests.
    f.camera.position.y = 35;
    f.camera.updateMatrixWorld();
    // Finish the ancestors behind loading but deliberately delay fine tiles.
    for (let i = 0; i < 30; i++) {
      f.terrain.update(f.camera);
      for (const request of [...f.pending.values()]) if (request.size > 256) f.deliver(request);
    }
    f.terrain.update(f.camera, 0);
    const near = () =>
      visible(f.terrain).find((mesh) => {
        const box = mesh.geometry.boundingBox!.clone().translate(mesh.position);
        return (
          f.camera.position.x >= box.min.x &&
          f.camera.position.x <= box.max.x &&
          f.camera.position.z >= box.min.z &&
          f.camera.position.z <= box.max.z
        );
      })!;
    const parent = near();
    expect(parent.name).toContain('Terrain L1');
    for (let i = 0; i < 5; i++) {
      f.deliverAll();
      f.terrain.update(f.camera, 0);
    }
    expect(near()).toBe(parent);
    expect(f.terrain.readyAround(1200, 900)).toBe(false);
    expect(f.terrain.treeTiles.size).toBeGreaterThan(0);
    f.terrain.update(f.camera, 1 / 60);
    const fine = near();
    expect(fine.name).toContain('Terrain L0');
    expect(fine.morphTargetInfluences![0]).toBe(0);
    expect(f.terrain.readyAround(1200, 900)).toBe(true);
    const treeOwner = [...f.terrain.treeTiles.values()].find(
      (owner) => fine.name === `Terrain L${owner.level} ${owner.ix},${owner.iz}`,
    )!;
    expect(treeOwner).toBeDefined();
    const side = Math.sqrt(treeOwner.data.heights.length);
    expect(treeOwner.data.trees[6]).toBe(treeOwner.data.heights[side + 1]);
    expect(fine.geometry.getAttribute('position').getY(side + 1)).toBe(treeOwner.data.trees[6]);
    expectCover(f.terrain);
    f.terrain.dispose();
  });
});

describe('terrain parent surface correspondence', () => {
  it('uses the parent triangle, matches shared edges/normals, preserves skirts, and pins the carved road bed', () => {
    const request: TileRequest = { type: 'tile', id: 1, x0: 0, z0: 0, size: 4, res: 2, trees: 0 },
      parent = data(request),
      child = data({ ...request, size: 2, res: 4 }),
      r = 4,
      side = r + 1,
      count = side * side + 4 * side,
      positions = new Float32Array(count * 3),
      normals = new Float32Array(count * 3);
    parent.heights.set([0, 0, 0, 0, 10, 0, 0, 0, 0]);
    child.heights.fill(20);
    for (let j = 0; j < side; j++)
      for (let i = 0; i < side; i++) {
        const v = j * side + i;
        positions.set([i * 0.5, 20, j * 0.5], v * 3);
        normals.set([0, 1, 0], v * 3);
      }
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
        positions.set([positions[from * 3], 17, positions[from * 3 + 2]], to * 3);
      }
    });
    const a = terrainParentMorph(positions, normals, child, parent, 4, 2, 0, 0),
      b = terrainParentMorph(positions, normals, child, parent, 4, 2, 1, 0);
    expect(a.position[(side + 3) * 3 + 1]).toBeCloseTo(2.5, 8);
    for (let j = 0; j < side; j++) {
      const right = j * side + r,
        left = j * side;
      expect(a.position[right * 3 + 1]).toBe(b.position[left * 3 + 1]);
      expect(Array.from(a.normal.subarray(right * 3, right * 3 + 3))).toEqual(
        Array.from(b.normal.subarray(left * 3, left * 3 + 3)),
      );
      expect(Math.hypot(...a.normal.subarray(right * 3, right * 3 + 3))).toBeCloseTo(1, 6);
    }
    expect(a.position[1] - a.position[side * side * 3 + 1]).toBe(3);
    child.shade[(side + 3) * 4] = 1;
    const pinned = terrainParentMorph(positions, normals, child, parent, 4, 2, 0, 0);
    expect(pinned.position[(side + 3) * 3 + 1]).toBe(20);
    expect(pinned.shade[(side + 3) * 4]).toBe(1);
  });

  it('computes world shading coordinates after native morphing and blends terrain masks with its factor', () => {
    const f = fixture();
    const shader = {
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
      uniforms: {},
    };
    f.terrain.material.onBeforeCompile(
      shader as T.WebGLProgramParametersWithUniforms,
      {} as T.WebGLRenderer,
    );
    expect(shader.vertexShader.indexOf('vOwWorld =')).toBeGreaterThan(
      shader.vertexShader.indexOf('#include <morphtarget_vertex>'),
    );
    expect(shader.vertexShader).toContain('mix(splat, parentSplat, morphTargetInfluences[0])');
    expect(shader.vertexShader).toContain('mix(shade, parentShade, morphTargetInfluences[0])');
    expect(f.terrain.material.shadowSide).toBe(T.DoubleSide);
    f.terrain.dispose();
  });
});
