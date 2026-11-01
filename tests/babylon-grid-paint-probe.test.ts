import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { clamp } from '../src/core/math.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { surfaceGridFor } from '../src/rendering/studio/road-detail.ts';
import { batchScene, box } from '../src/rendering/geometry.ts';
import * as T from 'three';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Track } from '../src/simulation/track.ts';
import { createFormulaSurfaceProbe } from '../src/engine/babylon/formula-surfaces.ts';
import {
  GRID_VIEWS,
  gridProbeTransaction,
  GRID_DEPTH_COUNTS,
  gridRoadRange,
  gridViewPose,
  originalGridReference,
  originalGridRoadReference,
  gridDepthSamples,
} from '../e2e/fixtures/babylon-grid-paint-reference.ts';

describe('Grid probe source-only depth oracle (not GPU evidence)', () => {
  it.each([null, false, undefined, 0, '', new Error('setup failed')])(
    'retains a partial report and drains independent setup ownership after %s',
    async (failure) => {
      const report: { failure: string | null; receipts: object[] } = {
          failure: null,
          receipts: [],
        },
        calls: string[] = [];
      await gridProbeTransaction(report, async (cleanup) => {
        cleanup.unshift(() => {
          calls.push('first');
        });
        cleanup.unshift(() => {
          calls.push('second');
          throw new Error('secondary cleanup');
        });
        report.receipts.push({ stage: 'partial-setup' });
        throw failure;
      });
      expect(calls).toEqual(['second', 'first']);
      expect(report.receipts).toEqual([{ stage: 'partial-setup' }]);
      expect(report.failure).toBe(failure instanceof Error ? failure.stack : String(failure));
    },
  );
  it('keeps reference cleanup idempotent when setup and GPU ledgers share owners', () => {
    const track = new Track(),
      grid = originalGridReference(track),
      road = originalGridRoadReference(track);
    const resources = [
      ...grid.meshes.map((mesh) => mesh.geometry),
      grid.material,
      ...road.meshes.flatMap((mesh) => [mesh.geometry, mesh.material]),
    ];
    const released = new Map<object, number>();
    for (const resource of resources)
      resource.addEventListener('dispose', () =>
        released.set(resource, (released.get(resource) ?? 0) + 1),
      );
    grid.dispose();
    road.dispose();
    grid.dispose();
    road.dispose();
    expect(released.size).toBe(resources.length);
    expect([...released.values()].every((n) => n === 1)).toBe(true);
  });
  it('rolls back every allocated original-road chunk when the second chunk fails', () => {
    const original = T.BufferGeometry.prototype.setIndex,
      geometries: T.BufferGeometry[] = [],
      released: T.BufferGeometry[] = [];
    const materialReleases: T.Material[] = [];
    const materialDispose = T.Material.prototype.dispose;
    const materialSpy = vi.spyOn(T.Material.prototype, 'dispose').mockImplementation(function (
      this: T.Material,
    ) {
      materialReleases.push(this);
      materialDispose.call(this);
    });
    const geometrySpy = vi
      .spyOn(T.BufferGeometry.prototype, 'setIndex')
      .mockImplementation(function (this: T.BufferGeometry, ...args) {
        geometries.push(this);
        this.addEventListener('dispose', () => released.push(this));
        original.apply(this, args);
        if (geometries.length === 2) throw false;
        return this;
      });
    let failed = false,
      primary: unknown;
    try {
      originalGridRoadReference(new Track());
    } catch (error) {
      failed = true;
      primary = error;
    } finally {
      geometrySpy.mockRestore();
      materialSpy.mockRestore();
    }
    expect(failed).toBe(true);
    expect(primary).toBe(false);
    expect(geometries).toHaveLength(2);
    expect(released).toEqual(geometries);
    expect(materialReleases).toHaveLength(1);
  });
  it('pins the original producer and compares reference batches to the independent frozen builder', () => {
    expect(
      createHash('sha256').update(readFileSync('src/rendering/grid-paint.ts')).digest('hex'),
    ).toBe('c40ed74cf2aa982ba94c38b9341aaf7f638c26dc3271cff4d245f5649af98f30');
    const text = readFileSync('tests/gp-grid-paint.test.ts', 'utf8'),
      start = text.indexOf('function originalGrid('),
      end = text.indexOf('\n\ndescribe(', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = text
      .slice(start, end)
      .replace('track: Track, material: T.MeshStandardMaterial', 'track, material');
    const build = new Function(
      'T',
      'surfaceGridFor',
      'trackPoint',
      'clamp',
      'box',
      'batchScene',
      `${body}; return originalGrid;`,
    )(T, surfaceGridFor, trackPoint, clamp, box, batchScene) as (
      track: Track,
      material: T.MeshStandardMaterial,
    ) => T.Group;
    const track = new Track(),
      reference = originalGridReference(track),
      frozen = build(track, reference.material),
      meshes: T.Mesh[] = [];
    frozen.updateMatrixWorld(true);
    frozen.traverse((node) => {
      if (node instanceof T.Mesh) meshes.push(node);
    });
    try {
      expect(reference.meshes).toHaveLength(meshes.length);
      for (let i = 0; i < meshes.length; i++) {
        const a = reference.meshes[i],
          b = meshes[i];
        expect(a.geometry.index!.array).toEqual(b.geometry.index!.array);
        for (const kind of ['position', 'normal', 'uv'])
          expect(a.geometry.getAttribute(kind).array).toEqual(b.geometry.getAttribute(kind).array);
        expect(a.matrixWorld.elements).toEqual(b.matrixWorld.elements);
        expect(a.visible).toBe(b.visible);
        expect(a.material.side).toBe(T.FrontSide);
      }
      expect(reference.material.customProgramCacheKey()).toContain('paint');
    } finally {
      reference.dispose();
      meshes.forEach((m) => m.geometry.dispose());
    }
  });
  it('retains exact full-source road chunk triangles in the bounded native subset', () => {
    const track = new Track(),
      reference = originalGridRoadReference(track),
      engine = new NullEngine();
    // CPU ownership/geometry only; this does not qualify real GL capabilities.
    Object.defineProperty(engine, 'webGLVersion', { value: 2 });
    Object.assign(engine.getCaps(), { supportSRGBBuffers: true, standardDerivatives: true });
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const native = createFormulaSurfaceProbe(
      scene,
      track,
      { discipline: 'formula', presentation: 'circuit', circuitId: 'aurel' },
      gridRoadRange(track),
    );
    try {
      expect(reference.meshes).toHaveLength(2);
      expect(native.roadMeshes).toHaveLength(reference.meshes.length);
      for (let i = 0; i < reference.meshes.length; i++) {
        expect(Array.from(native.roadMeshes[i].getIndices()!)).toEqual(
          Array.from(reference.meshes[i].geometry.index!.array),
        );
        expect(Array.from(native.roadMeshes[i].getVerticesData('position')!)).toEqual(
          Array.from(reference.meshes[i].geometry.getAttribute('position').array),
        );
      }
    } finally {
      native.dispose();
      reference.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
  it('keeps the GPU probe isolated with preregistered limits, actual finish hooks and unchanged deadline', () => {
    const fixture = readFileSync('e2e/fixtures/babylon-grid-paint.ts', 'utf8');
    expect(fixture).toContain('performance.now() + 120000');
    expect(fixture).toContain('await probe(forceStandalone, false, deadline)');
    expect(fixture).toContain('loseContext && report.failure === null');
    expect(fixture).toContain('previous.call(original.material, shader, renderer)');
    expect(fixture).toContain('gridDepthSamples(');
    expect(fixture).toContain('GRID_DEPTH_COUNTS');
    expect(fixture.indexOf('receipts.push(depth)')).toBeLessThan(
      fixture.indexOf("'Original grid composite/road-only reference failed repeat gate'"),
    );
    expect(fixture.indexOf('depth.pixels.push')).toBeLessThan(
      fixture.indexOf("check(opaque, 'Fixed grid depth pixel is not opaque')"),
    );
    expect(fixture).toContain('referenceGlErrors');
    expect(fixture).toContain('referenceFrontFaces');
    expect(fixture).toContain('gl.CCW');
    expect(fixture).toContain('gl.LEQUAL');
    expect(readFileSync('src/main.ts', 'utf8')).not.toContain('createBabylonGridPaint');
    expect(readFileSync('e2e/babylon-grid-paint.spec.ts', 'utf8')).not.toMatch(
      /setTimeout|test\.skip|test\.slow/,
    );
  });

  it('classifies every preregistered pixel from original triangles and shared Float32 camera matrices', () => {
    const track = new Track(),
      grid = originalGridReference(track),
      road = originalGridRoadReference(track);
    const engine = new NullEngine(),
      scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const camera = new UniversalCamera('fixed grid oracle', Vector3.Zero(), scene);
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.minZ = 0.1;
    camera.maxZ = 200;
    const three = new T.OrthographicCamera();
    three.matrixAutoUpdate = false;
    three.matrixWorldAutoUpdate = false;
    try {
      expect(grid.meshes.reduce((n, m) => n + m.geometry.index!.count / 3, 0)).toBe(432);
      const seen = new Set<T.Mesh>();
      for (const view of GRID_VIEWS) {
        const pose = gridViewPose(track, view.row, view.eye);
        camera.position.copyFromFloats(...pose.eye.toArray());
        camera.setTarget(Vector3.FromArray(pose.target.toArray()));
        camera.orthoLeft = -view.extent;
        camera.orthoRight = view.extent;
        camera.orthoTop = (view.extent * 384) / 1024;
        camera.orthoBottom = (-view.extent * 384) / 1024;
        camera.getViewMatrix(true);
        camera.getProjectionMatrix(true);
        three.near = camera.minZ;
        three.far = camera.maxZ;
        three.projectionMatrix.fromArray(camera.getProjectionMatrix().asArray());
        three.projectionMatrixInverse.copy(three.projectionMatrix).invert();
        three.matrixWorldInverse.fromArray(camera.getViewMatrix().asArray());
        three.matrixWorld.copy(three.matrixWorldInverse).invert();
        const frustum = new T.Frustum().setFromProjectionMatrix(
          new T.Matrix4().multiplyMatrices(three.projectionMatrix, three.matrixWorldInverse),
        );
        grid.meshes.forEach((mesh) => {
          if (frustum.intersectsObject(mesh)) seen.add(mesh);
        });
        if (!view.depth) continue;
        const samples = gridDepthSamples(track, view.row, three, grid.meshes, road.root, 1024, 384);
        expect({
          total: samples.length,
          visible: samples.filter((s) => s.visible).length,
          occluded: samples.filter((s) => !s.visible).length,
        }).toEqual(GRID_DEPTH_COUNTS[view.name as keyof typeof GRID_DEPTH_COUNTS]);
        expect(samples).toHaveLength(162);
        expect(samples.every((s) => Number.isFinite(s.gap) && Math.abs(s.gap) > 1e-5)).toBe(true);
        road.root.position.y = 0.1;
        road.root.updateMatrixWorld(true);
        expect(
          gridDepthSamples(track, view.row, three, grid.meshes, road.root, 1024, 384).every(
            (s) => !s.visible,
          ),
        ).toBe(true);
        road.root.position.y = -0.1;
        road.root.updateMatrixWorld(true);
        expect(
          gridDepthSamples(track, view.row, three, grid.meshes, road.root, 1024, 384).every(
            (s) => s.visible,
          ),
        ).toBe(true);
        road.root.position.y = 0;
        road.root.updateMatrixWorld(true);
      }
      expect(seen.size).toBe(grid.meshes.length);
    } finally {
      grid.dispose();
      road.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});
