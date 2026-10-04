import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { decodeAurelVegetation } from '../src/rendering/aurel-vegetation.ts';
import { decodeAurelQuarry } from '../src/rendering/aurel-quarry.ts';
import { cameraDetailDistance } from '../src/rendering/camera-detail.ts';
import { detailDistance } from '../src/rendering/view-detail.ts';
import { Track } from '../src/simulation/track.ts';
import { serviceSitePlan } from '../src/rendering/venue-service-plan.ts';
import { BuildQueue } from '../src/rendering/build-queue.ts';

const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () => Promise.resolve(new T.DataTexture(new Uint8Array([96, 128, 72, 255]), 1, 1)),
  }));

describe('real cubemap cameras in the production scenery callbacks', () => {
  for (const family of ['vegetation', 'quarry'] as const) {
    it(`${family} draws all six signed cube lenses without changing main-view LOD or resources`, async () => {
      const bytes = new Uint8Array(readFileSync(`public/models/aurel-${family}.glb`));
      const kit =
        family === 'vegetation'
          ? await decodeAurelVegetation(bytes, loader())
          : await decodeAurelQuarry(bytes, loader());
      const track = new Track(),
        parent = new T.Group(),
        scene = new T.Scene();
      const target = new T.WebGLCubeRenderTarget(16),
        cube = new T.CubeCamera(0.1, 1600, target);
      try {
        if ('build' in kit) kit.build(track, parent, serviceSitePlan(track));
        else {
          const q = new BuildQueue();
          kit.enqueue(track, parent, serviceSitePlan(track), q);
          q.runSynchronously();
        }
        scene.add(parent, cube);
        cube.coordinateSystem = T.WebGLCoordinateSystem;
        cube.updateCoordinateSystem();
        scene.updateMatrixWorld(true);
        const camera = new T.PerspectiveCamera(18, 16 / 9, 0.1, 4000);
        camera.position.set(400, 3, 500);
        camera.updateMatrixWorld(true);
        kit.update(camera, 'high');
        const levels = kit.chunks.map((c) => c.level);
        const meshes: T.Mesh[] = [];
        kit.root.traverse((o) => {
          if (o instanceof T.Mesh) meshes.push(o);
        });
        const identities = meshes.map((m) => [
          m.geometry,
          m.geometry.index,
          m.geometry.getAttribute('position'),
        ]);
        const ranges = meshes.map((m) => ({ ...m.geometry.drawRange }));
        expect(cube.children).toHaveLength(6);
        for (const face of cube.children) {
          expect(face).toBeInstanceOf(T.PerspectiveCamera);
          expect((face as T.PerspectiveCamera).fov).toBe(-90);
          for (const mesh of meshes) {
            // Execute the exact callbacks Three invokes for a real reflection.
            mesh.onBeforeRender(
              null as unknown as T.WebGLRenderer,
              scene,
              face as T.Camera,
              mesh.geometry,
              mesh.material as T.Material,
              null as unknown as T.Group,
            );
            expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
          }
        }
        expect(kit.chunks.map((c) => c.level)).toEqual(levels);
        kit.update(camera, 'high');
        expect(
          meshes.map((m) => [m.geometry, m.geometry.index, m.geometry.getAttribute('position')]),
        ).toEqual(identities);
        expect(meshes.map((m) => m.geometry.drawRange)).toEqual(ranges);
      } finally {
        kit.dispose();
        target.dispose();
      }
    });
  }
  it('preserves strict user-lens validation and only adapts actual cube face cameras', () => {
    const target = new T.WebGLCubeRenderTarget(16),
      cube = new T.CubeCamera(0.1, 1600, target);
    try {
      const face = cube.children[0] as T.PerspectiveCamera;
      expect(cameraDetailDistance(100, face)).toBe(detailDistance(100, 90, 1));
      expect(() => detailDistance(100, -90, 1)).toThrow('Invalid detail lens');
      expect(() => cameraDetailDistance(100, new T.PerspectiveCamera(-90, 1))).toThrow(
        'Invalid detail lens',
      );
      const normal = new T.PerspectiveCamera(18, 0.6);
      expect(cameraDetailDistance(100, normal)).toBe(detailDistance(100, 18, 0.6));
      face.fov = -30;
      expect(() => cameraDetailDistance(100, face)).toThrow('Invalid detail lens');
      face.fov = -90;
      face.aspect = 0;
      expect(() => cameraDetailDistance(100, face)).toThrow('Invalid detail lens');
    } finally {
      target.dispose();
    }
  });
});
