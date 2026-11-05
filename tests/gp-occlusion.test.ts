import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { BikeMaterials, BikeModel, BikeShells } from '../src/rendering/bike.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import {
  GP_OCCLUSION,
  acquireGpOcclusion,
  bindGpOcclusion,
  gpOcclusionCacheSize,
  gpOcclusionSources,
  gpOcclusionUniforms,
  installGpOcclusion,
  releaseGpOcclusion,
  setGpOcclusionStrength,
  voxelizeGpOcclusion,
} from '../src/rendering/gp-occlusion.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

const cell = (grid: ReturnType<typeof voxelizeGpOcclusion>, x: number, y: number, z: number) => {
  const [nx, ny] = grid.dims,
    i = Math.floor((x - grid.min.x) / grid.voxel),
    j = Math.floor((y - grid.min.y) / grid.voxel),
    k = Math.floor((z - grid.min.z) / grid.voxel);
  return grid.data[i + nx * (j + ny * k)];
};

describe('GP bike-space occlusion', () => {
  it('rasterises closed surfaces as a shell with an empty margin and hollow interior', () => {
    const box = new T.BoxGeometry(0.4, 0.3, 0.6);
    try {
      const grid = voxelizeGpOcclusion([{ geometry: box, matrix: new T.Matrix4() }], 0.02, 0.1);
      expect(grid.dims).toEqual([30, 25, 40]);
      expect(grid.min.x).toBeCloseTo(-0.3, 6);
      // Faces are closed cell layers; the interior and the margin stay open.
      // A face on a cell boundary may land in either neighbouring cell.
      const face = (x: number, y: number, z: number, axis: 0 | 1 | 2) => {
        const o = [0, 0, 0];
        o[axis] = 0.001;
        return Math.max(
          cell(grid, x - o[0], y - o[1], z - o[2]),
          cell(grid, x + o[0], y + o[1], z + o[2]),
        );
      };
      expect(face(0.2, 0, 0, 0)).toBe(255);
      expect(face(0, 0.15, 0.1, 1)).toBe(255);
      expect(face(0.05, -0.05, 0.3, 2)).toBe(255);
      expect(face(-0.2, 0.1, -0.2, 0)).toBe(255);
      expect(cell(grid, 0, 0, 0)).toBe(0);
      expect(cell(grid, 0.25, 0, 0)).toBe(0);
      const faces = 2 * (0.4 * 0.3 + 0.3 * 0.6 + 0.4 * 0.6);
      expect(grid.filled).toBeGreaterThan((faces / 0.02 ** 2) * 0.9);
      expect(grid.filled).toBeLessThan((faces / 0.02 ** 2) * 1.6);
    } finally {
      box.dispose();
    }
  });
  it('applies source matrices and refuses a grid beyond the machine envelope', () => {
    const plane = new T.PlaneGeometry(0.2, 0.2);
    try {
      const moved = new T.Matrix4().makeTranslation(1, 2, 3);
      const grid = voxelizeGpOcclusion([{ geometry: plane, matrix: moved }], 0.02, 0.06);
      expect(cell(grid, 1, 2, 3)).toBe(255);
      expect(grid.min.z).toBeCloseTo(2.94, 6);
      const far = new T.Matrix4().makeTranslation(9, 0, 0);
      expect(() =>
        voxelizeGpOcclusion(
          [
            { geometry: plane, matrix: moved },
            { geometry: plane, matrix: far },
          ],
          0.02,
          0.06,
        ),
      ).toThrow(RangeError);
      expect(() => voxelizeGpOcclusion([], 0.02, 0.06)).toThrow();
    } finally {
      plane.dispose();
    }
  });
  it('collects opaque visible meshes in the frame, expanding instances and skipping subtrees', () => {
    const root = new T.Group(),
      frame = new T.Group(),
      skip = new T.Group();
    frame.position.set(0, 1, 0);
    root.add(frame);
    const g = new T.BoxGeometry(0.1, 0.1, 0.1),
      opaque = new T.MeshStandardMaterial(),
      glass = new T.MeshStandardMaterial({ transparent: true, opacity: 0.3 });
    const a = new T.Mesh(g, opaque);
    a.position.set(0, 1, 0);
    const hidden = new T.Mesh(g, opaque);
    hidden.visible = false;
    const clear = new T.Mesh(g, glass);
    const skipped = new T.Mesh(g, opaque);
    skip.add(skipped);
    const many = new T.InstancedMesh(g, opaque, 3);
    for (let k = 0; k < 3; k++) many.setMatrixAt(k, new T.Matrix4().makeTranslation(k, 0, 0));
    root.add(a, hidden, clear, skip, many);
    try {
      const sources = gpOcclusionSources(root, frame, [skip]);
      expect(sources).toHaveLength(4);
      // Frame space: the frame sits 1 m up, the mesh 1 m up in the root.
      expect(new T.Vector3().applyMatrix4(sources[0].matrix).y).toBeCloseTo(0, 6);
      const xs = sources.slice(1).map((s) => new T.Vector3().applyMatrix4(s.matrix).x);
      expect(xs).toEqual([0, 1, 2]);
      // The root itself may be hidden (an unused LOD) and still bakes.
      root.visible = false;
      expect(gpOcclusionSources(root, frame, [skip])).toHaveLength(4);
    } finally {
      g.dispose();
      opaque.dispose();
      glass.dispose();
      many.dispose();
    }
  });
  it('patches lit materials once, sharing the entrant uniforms, and stays off until bound and enabled', () => {
    const uniforms = gpOcclusionUniforms();
    const material = new T.MeshPhysicalMaterial({ clearcoat: 1 });
    expect(() => installGpOcclusion(new T.MeshBasicMaterial(), uniforms)).toThrow(TypeError);
    expect(installGpOcclusion(material, uniforms)).toBe(true);
    expect(installGpOcclusion(material, uniforms)).toBe(false);
    expect(studioHookKeys(material)).toContain('gp-occlusion-v1');
    const shader = {
      vertexShader: T.ShaderLib.physical.vertexShader,
      fragmentShader: T.ShaderLib.physical.fragmentShader,
      uniforms: {},
    } as unknown as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    const frag = T.ShaderChunk.aomap_fragment;
    expect(frag).toBeTruthy();
    expect(shader.vertexShader).toContain('vGpOccPos = ( gpOccFromWorld');
    expect(shader.vertexShader.indexOf('vGpOccPos = (')).toBeGreaterThan(
      shader.vertexShader.indexOf('#include <project_vertex>'),
    );
    expect(shader.fragmentShader).toContain('uniform highp sampler3D gpOccVolume;');
    expect(
      shader.fragmentShader.indexOf('clearcoatSpecularIndirect *= gpOccMirror'),
    ).toBeGreaterThan(shader.fragmentShader.indexOf('#include <aomap_fragment>'));
    const bound = shader.uniforms as unknown as typeof uniforms;
    expect(bound.gpOccFromWorld).toBe(uniforms.gpOccFromWorld);
    expect(bound.gpOccParams).toBe(uniforms.gpOccParams);
    // No volume: enabling it is refused, so the shader branch stays skipped.
    setGpOcclusionStrength(uniforms, true);
    expect(uniforms.gpOccParams.value.x).toBe(0);
    material.dispose();
  });
  it('bakes one volume per definition, binds it and releases it with the last entrant', () => {
    const before = gpOcclusionCacheSize();
    const plane = new T.PlaneGeometry(0.3, 0.3);
    let bakes = 0;
    const bake = () => {
      bakes++;
      return voxelizeGpOcclusion([{ geometry: plane, matrix: new T.Matrix4() }], 0.02, 0.1);
    };
    const a = acquireGpOcclusion('test-def', bake),
      b = acquireGpOcclusion('test-def', bake);
    expect(bakes).toBe(1);
    expect(b).toBe(a);
    expect(gpOcclusionCacheSize()).toBe(before + 1);
    const uniforms = gpOcclusionUniforms();
    bindGpOcclusion(uniforms, a);
    expect(uniforms.gpOccVolume.value).toBe(a.texture);
    expect(uniforms.gpOccInvSize.value.x).toBeCloseTo(1 / (a.grid.dims[0] * 0.02), 9);
    setGpOcclusionStrength(uniforms, true);
    expect(uniforms.gpOccParams.value.x).toBe(GP_OCCLUSION.diffuse);
    expect(uniforms.gpOccParams.value.y).toBe(GP_OCCLUSION.specular);
    setGpOcclusionStrength(uniforms, false);
    expect(uniforms.gpOccParams.value.toArray()).toEqual([0, 0, 0.02]);
    const disposed = vi.fn();
    a.texture.addEventListener('dispose', disposed);
    releaseGpOcclusion('test-def');
    expect(disposed).not.toHaveBeenCalled();
    releaseGpOcclusion('test-def');
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(gpOcclusionCacheSize()).toBe(before);
    plane.dispose();
  });
  it.each(['gpr1', 'gpr2'])(
    '%s bakes a deterministic rider-free rest-pose volume inside the cell budget',
    (id) => {
      const m = new BikeMaterials(0),
        model = new BikeModel(VEHICLES[id], 0, 'high', m, true);
      try {
        const grid = model.occlusionGrid();
        expect(Math.max(...grid.dims)).toBeLessThanOrEqual(GP_OCCLUSION.maxCells);
        expect(grid.filled).toBeGreaterThan(10000);
        // The rider moves through the volume rather than being baked into it:
        // the cells around the helmet are open.
        const helmet = model.rider.root.getObjectByName('GP iridium race visor');
        if (helmet) {
          const p = helmet.getWorldPosition(new T.Vector3());
          model.sprung.updateWorldMatrix(true, false);
          p.applyMatrix4(model.sprung.matrixWorld.clone().invert());
          expect(cell(grid, p.x, p.y, p.z)).toBe(0);
        }
        const again = model.occlusionGrid();
        expect(again.filled).toBe(grid.filled);
        expect(again.data).toEqual(grid.data);
      } finally {
        model.dispose();
        m.dispose();
      }
    },
  );
  it('follows a presented GP entrant in BikeShells, on High only, and frees its volume with it', () => {
    const car = carBase(0),
      frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[H.CARS] = 1;
    frame[car + F.QW] = 1;
    frame[car + RACE_BASE + R.VEHICLE] = vehicleIndex('gpr1');
    frame[car + F.FRONT_HEALTH] = frame[car + F.REAR_HEALTH] = 1;
    frame[car + F.X] = 12;
    frame[car + BIKE_BASE + B.FORK] = frame[car + BIKE_BASE + B.SHOCK] = 0.03;
    frame[car + BIKE_BASE + B.LEAN] = 0.5;
    for (let i = 0; i < 4; i++) {
      const p = car + WHEEL_BASE + i * WHEEL_STRIDE;
      frame[p + W.LOAD] = 1000;
      frame[p + W.LENGTH] = 0.25;
      frame[p + W.RADIUS] = 0.335;
      frame[p + W.PRESSURE] = 160;
    }
    const before = gpOcclusionCacheSize(),
      shells = new BikeShells(),
      host = { root: new T.Object3D() },
      camera = new T.PerspectiveCamera(58, 16 / 9);
    try {
      shells.update(frame, frame, 1, [host], camera, 'high', 0);
      expect(gpOcclusionCacheSize()).toBe(before + 1);
      const entry = (
        shells as unknown as {
          entries: Map<number, { materials: BikeMaterials; levels: BikeModel[]; level: number }>;
        }
      ).entries.get(0)!;
      const model = entry.levels[entry.level];
      expect(shells.drawnRoot(0)).toBe(model.root);
      let livery: T.Material | undefined, leather: T.Material | undefined;
      model.root.traverse((o) => {
        if (!(o instanceof T.Mesh) || Array.isArray(o.material)) return;
        if (o.material.name === 'GP race shell livery (clear-coated)') livery = o.material;
        if (o.material.name === 'Rider leathers') leather = o.material;
      });
      expect(livery && studioHookKeys(livery)).toContain('gp-occlusion-v1');
      expect(leather && studioHookKeys(leather)).toContain('gp-occlusion-v1');
      // The uniforms carry the drawn sprung frame and are on for High/ULTRA.
      model.sprung.updateWorldMatrix(true, false);
      const inverse = model.sprung.matrixWorld.clone().invert();
      const occlusion = entry.materials.occlusion;
      expect(occlusion.gpOccFromWorld.value.equals(inverse)).toBe(true);
      expect(occlusion.gpOccParams.value.x).toBe(GP_OCCLUSION.diffuse);
      shells.update(frame, frame, 1, [host], camera, 'medium', 0);
      expect(occlusion.gpOccParams.value.x).toBe(0);
      expect(occlusion.gpOccParams.value.y).toBe(0);
    } finally {
      shells.disposeAll();
    }
    expect(gpOcclusionCacheSize()).toBe(before);
  });
});
