import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { SOLVANE } from '../src/simulation/open-world/region-data.ts';
import { TerrainField } from '../src/simulation/open-world/terrain-field.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { gridHeight } from '../src/simulation/open-world/terrain-tiles.ts';
import {
  buildCoastalWaterGeometry,
  CoastalWater,
  COASTAL_WATER,
  FESTIVAL_SEA,
} from '../src/rendering/open-world/coastal-water.ts';
import { Water } from '../src/rendering/open-world/water.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';

afterEach(() => vi.unstubAllGlobals());
const field = new TerrainField(SOLVANE);
const level = SOLVANE.seaLevel - 0.05;
const synthetic = (height: (x: number, z: number) => number) => ({
  region: {
    ...SOLVANE,
    coast: [
      [-200, 0],
      [200, 0],
    ] as const,
  },
  height,
});

describe('Festival coastal water geometry', () => {
  it('solves the actual sea-level contour and samples all shallow depths from Solvane terrain', () => {
    const built = buildCoastalWaterGeometry(field, level);
    expect(built.stats.profiles).toBeGreaterThan(500);
    expect(built.stats.maxRootError).toBeLessThan(0.002);
    expect(built.stats.chunks).toBeGreaterThan(0);
    expect(built.stats.chunks).toBeLessThanOrEqual(
      Math.ceil(COASTAL_WATER.maxSegments / COASTAL_WATER.chunkSegments),
    );
    expect(built.stats.triangles).toBeLessThanOrEqual(
      COASTAL_WATER.maxSegments * (COASTAL_WATER.offsets.length - 1) * 2,
    );
    let observed = 0;
    for (const g of built.geometries) {
      const p = g.getAttribute('position'),
        s = g.getAttribute('coastal'),
        uv = g.getAttribute('uv');
      expect(g.boundingSphere?.radius).toBeLessThan(600);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          z = p.getZ(i);
        expect(p.getY(i)).toBeCloseTo(level + COASTAL_WATER.surfaceOffset, 6);
        expect(s.getX(i)).toBeCloseTo(level - field.height(x, z), 2);
        expect(s.getZ(i)).toBeGreaterThanOrEqual(0);
        expect(s.getZ(i)).toBeLessThanOrEqual(1);
        expect(s.getW(i)).toBeGreaterThanOrEqual(0);
        expect(s.getW(i)).toBeLessThanOrEqual(1);
        expect(uv.getX(i)).toBeCloseTo((x + FESTIVAL_SEA.size / 2) / FESTIVAL_SEA.uvMetres, 5);
        expect(uv.getY(i)).toBeCloseTo((FESTIVAL_SEA.northEdge - z) / FESTIVAL_SEA.uvMetres, 5);
        if (i % COASTAL_WATER.offsets.length === 1) {
          expect(Math.abs(field.height(x, z) - level)).toBeLessThan(0.003);
          observed++;
        }
      }
      const indices = g.index!;
      for (let i = 0; i < indices.count; i += 3) {
        const a = indices.getX(i),
          b = indices.getX(i + 1),
          c = indices.getX(i + 2);
        const up =
          (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) -
          (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a));
        expect(up).toBeGreaterThan(0);
      }
      g.dispose();
    }
    expect(observed).toBeGreaterThan(450);
  });

  it('follows an offset real shore instead of treating the authored polyline as the beach', () => {
    const f = synthetic((x, z) => (z - 37 - Math.sin(x / 80) * 6) * 0.035);
    const built = buildCoastalWaterGeometry(f, 0);
    for (const g of built.geometries) {
      const p = g.getAttribute('position');
      for (let i = 1; i < p.count; i += COASTAL_WATER.offsets.length)
        expect(p.getZ(i)).toBeCloseTo(37 + Math.sin(p.getX(i) / 80) * 6, 3);
      g.dispose();
    }
    expect(built.stats.profiles).toBe(21);
  });

  it('leaves unresolved river mouths and abrupt terrain edges open', () => {
    const f = synthetic((x, z) => (Math.abs(x) < 31 ? -4 : (z - 20) * 0.04));
    const built = buildCoastalWaterGeometry(f, 0);
    expect(built.stats.rejectedSpans).toBeGreaterThan(0);
    for (const g of built.geometries) {
      const p = g.getAttribute('position'),
        index = g.index!;
      for (let i = 0; i < index.count; i += 3) {
        const xs = [0, 1, 2].map((j) => p.getX(index.getX(i + j)));
        expect(Math.min(...xs) >= 31 || Math.max(...xs) <= -31).toBe(true);
      }
      g.dispose();
    }
    const empty = buildCoastalWaterGeometry(
      synthetic(() => -10),
      0,
    );
    expect(empty.geometries).toHaveLength(0);
    expect(empty.stats.triangles).toBe(0);
  });

  it('suppresses breaking surf on steep quays without losing the depth field', () => {
    const inspect = (grade: number) => {
      const built = buildCoastalWaterGeometry(
        synthetic((_x, z) => (z - 20) * grade),
        0,
      );
      const values = built.geometries.flatMap((g) => {
        const s = g.getAttribute('coastal');
        const values = Array.from({ length: s.count }, (_, i) => s.getZ(i));
        g.dispose();
        return values;
      });
      return values;
    };
    expect(Math.min(...inspect(0.035))).toBeGreaterThan(0.95);
    expect(Math.max(...inspect(0.8))).toBe(0);
  });

  it('feathers the tint to zero at internal estuary cuts on both banks', () => {
    const built = buildCoastalWaterGeometry(
      synthetic((x, z) => (Math.abs(x) < 31 ? -4 : (z - 20) * 0.04)),
      0,
    );
    const opacity = new Map<number, number>();
    for (const g of built.geometries) {
      const p = g.getAttribute('position'),
        coastal = g.getAttribute('coastal');
      for (let i = 1; i < p.count; i += COASTAL_WATER.offsets.length)
        opacity.set(p.getX(i), coastal.getW(i));
      g.dispose();
    }
    for (const bank of [-1, 1]) {
      expect(opacity.get(bank * 40)).toBe(0);
      expect(opacity.get(bank * 60)).toBeCloseTo(0.5, 6);
      expect(opacity.get(bank * 80)).toBe(1);
    }
    expect(opacity.has(0)).toBe(false);
    expect(built.stats.rejectedSpans).toBeGreaterThan(0);
  });

  it('covers the visible coarse-tile shore while opaque terrain occludes the inland overlap', () => {
    const world = openWorld();
    const base = new T.MeshPhysicalMaterial();
    const shore = new CoastalWater(world.field, base, level);
    const groundMaterial = new T.MeshBasicMaterial();
    const tiles = new Map<string, Float32Array>();
    const sample = (x: number, z: number, lod: number) => {
      // Same carved samples and a-d diagonal as TerrainStreamer, including
      // the coarser noise filtering. This is the rendered surface, not the
      // analytic field used by the coastal profile builder.
      const size = 256 * 2 ** lod,
        res = lod <= 2 ? 64 : 32,
        step = size / res,
        x0 = Math.floor(x / size) * size,
        z0 = Math.floor(z / size) * size,
        key = `${lod}:${x0}:${z0}`;
      let heights = tiles.get(key);
      if (!heights) {
        heights = world.carver.build(x0, z0, step, res).heights;
        tiles.set(key, heights);
      }
      return { heights, side: res + 1, step, x0, z0 };
    };
    const height = (x: number, z: number, lod: number) => {
      const t = sample(x, z, lod);
      return gridHeight(t.heights, t.side, (x - t.x0) / t.step, (z - t.z0) / t.step, t.step);
    };
    const waterline = (x: number, at: (x: number, z: number) => number) => {
      let lo = -3200,
        hi = -2200;
      expect(at(x, lo)).toBeLessThan(level);
      expect(at(x, hi)).toBeGreaterThan(level);
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (at(x, mid) < level) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const cellMesh = (x: number, z: number, lod: number) => {
      const t = sample(x, z, lod),
        i = Math.floor((x - t.x0) / t.step),
        j = Math.floor((z - t.z0) / t.step);
      const points = [
        [i, j],
        [i + 1, j],
        [i, j + 1],
        [i + 1, j + 1],
      ].map(
        ([u, v]) => new T.Vector3(t.x0 + u * t.step, t.heights[v * t.side + u], t.z0 + v * t.step),
      );
      const geometry = new T.BufferGeometry().setFromPoints(points);
      geometry.setIndex([0, 3, 1, 0, 2, 3]);
      const mesh = new T.Mesh(geometry, groundMaterial);
      mesh.updateMatrixWorld();
      return mesh;
    };
    const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0));
    shore.root.updateMatrixWorld(true);
    expect(shore.material.depthTest).toBe(true);
    try {
      // First five reproduce the coast screenshot/nearby L3-L4 offsets;
      // the rest cover the largest sampled fallback-tile discrepancies.
      for (const [x, lod] of [
        [-1880, 4],
        [-1840, 3],
        [-1818, 3],
        [-1760, 3],
        [-1500, 4],
        [1160, 4],
        [1620, 5],
        [3900, 6],
      ]) {
        const raw = waterline(x, (xx, zz) => world.field.height(xx, zz));
        const rendered = waterline(x, (xx, zz) => height(xx, zz, lod));
        expect(rendered - raw).toBeGreaterThan(5);
        const wetZ = rendered - 1,
          dryZ = rendered + 5;
        // These visibly wet points are dry in the analytic field. The old
        // 0.6 m edge left only the unmodified blue sea beneath them.
        expect(world.field.height(x, wetZ)).toBeGreaterThan(level + 0.1);
        expect(height(x, wetZ, lod)).toBeLessThan(level);
        expect(height(x, dryZ, lod)).toBeGreaterThan(level + COASTAL_WATER.surfaceOffset);
        for (const [z, wet] of [
          [wetZ, true],
          [dryZ, false],
        ] as const) {
          const terrain = cellMesh(x, z, lod);
          ray.ray.origin.set(x, 100, z);
          const intersections = ray.intersectObjects([...shore.root.children, terrain], false);
          expect(intersections.length).toBeGreaterThan(1);
          expect(intersections[0].object === terrain).toBe(!wet);
          terrain.geometry.dispose();
        }
      }
    } finally {
      shore.dispose();
      base.dispose();
      groundMaterial.dispose();
    }
  });
});

describe('Festival coastal water materials and lifetime', () => {
  it('preserves physical sea waves, binds presented time and borrows the normal map', () => {
    const normal = new T.Texture();
    const base = new T.MeshPhysicalMaterial({ normalMap: normal, color: 0x0d3a4a, clearcoat: 0.6 });
    const baseKey = base.customProgramCacheKey();
    const shore = new CoastalWater(
      synthetic((_x, z) => z * 0.04),
      base,
      0,
    );
    expect(shore.material.normalMap).toBe(normal);
    expect(shore.material.transparent).toBe(true);
    expect(shore.material.depthWrite).toBe(false);
    expect(shore.material.emissive.getHex()).toBe(0);
    expect(studioHookKeys(shore.material)).toEqual(['sea-waves-v1', 'solvane-coastal-water-v1']);
    expect(base.customProgramCacheKey()).toBe(baseKey);
    const shader = {
      uniforms: T.UniformsUtils.clone(T.ShaderLib.physical.uniforms),
      vertexShader: T.ShaderLib.physical.vertexShader,
      fragmentShader: T.ShaderLib.physical.fragmentShader,
    } as StudioShader;
    shore.material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms.studioTime).toBe(studioUniforms.studioTime);
    expect(shader.vertexShader).toContain('attribute vec4 coastal');
    expect(shader.fragmentShader).toContain('seaSum');
    expect(shader.fragmentShader).toContain('coastalFoam');
    expect(shader.fragmentShader).toContain('material.clearcoat *= 1.0 - coastalFoam');
    expect(shader.fragmentShader).not.toContain('emissive =');
    const disposeNormal = vi.spyOn(normal, 'dispose'),
      disposeBase = vi.spyOn(base, 'dispose');
    const disposeMaterial = vi.spyOn(shore.material, 'dispose');
    const disposals = shore.root.children.map((m) => vi.spyOn((m as T.Mesh).geometry, 'dispose'));
    const scene = new T.Scene();
    scene.add(shore.root);
    shore.dispose();
    shore.dispose();
    expect(disposeNormal).not.toHaveBeenCalled();
    expect(disposeBase).not.toHaveBeenCalled();
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    disposals.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(scene.children).toHaveLength(0);
    base.dispose();
    normal.dispose();
  });

  it('disposes the actual generated sea texture exactly once across sea, river and shore', () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
          putImageData: () => {},
        }),
      }),
    });
    const water = new Water(field);
    const texture = (water.sea.material as T.MeshPhysicalMaterial).normalMap!;
    expect(texture).toBeInstanceOf(T.CanvasTexture);
    expect((water.river.material as T.MeshPhysicalMaterial).normalMap).toBe(texture);
    expect(water.coast.material.normalMap).toBe(texture);
    const disposeTexture = vi.spyOn(texture, 'dispose');
    const materials = [
      water.sea.material,
      water.river.material,
      water.coast.material,
    ] as T.Material[];
    const materialSpies = materials.map((m) => vi.spyOn(m, 'dispose'));
    const scene = new T.Scene();
    scene.add(water.root);
    water.dispose();
    water.dispose();
    expect(disposeTexture).toHaveBeenCalledTimes(1);
    materialSpies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(water.root.children).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
  });
});
