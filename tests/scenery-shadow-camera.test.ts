import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { decodeAurelVegetation } from '../src/rendering/aurel-vegetation.ts';
import { decodeAurelQuarry } from '../src/rendering/aurel-quarry.ts';
import { Track } from '../src/simulation/track.ts';
import { BuildQueue } from '../src/rendering/build-queue.ts';
import { serviceSitePlan } from '../src/rendering/venue-service-plan.ts';

const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)),
  }));
function renderTarget(width: number, height: number) {
  return {
    getCurrentViewport: (out: T.Vector4) => out.set(0, 0, width, height),
    getDrawingBufferSize: (out: T.Vector2) => out.set(1280, 720),
  } as T.WebGLRenderer;
}
for (const family of ['vegetation', 'quarry'] as const) {
  describe(`${family} pass-specific geometry detail`, () => {
    it('uses the actual shadow camera without changing the driving-view hysteresis', async () => {
      const data = new Uint8Array(readFileSync(`public/models/aurel-${family}.glb`));
      const kit =
        family === 'vegetation'
          ? await decodeAurelVegetation(data, loader())
          : await decodeAurelQuarry(data, loader());
      const track = new Track(),
        parent = new T.Group(),
        depth = new T.MeshDepthMaterial();
      try {
        if ('build' in kit) kit.build(track, parent);
        else {
          const queue = new BuildQueue();
          kit.enqueue(track, parent, serviceSitePlan(track), queue);
          queue.runSynchronously();
        }
        parent.updateMatrixWorld(true);
        const chunk = kit.chunks.find((c) => ('layer' in c ? c.layer === 'near' : !c.background))!;
        const meshes = 'meshes' in chunk ? chunk.meshes : [chunk.mesh];
        const camera = new T.PerspectiveCamera(58, 16 / 9, 0.1, 5000);
        camera.position
          .copy(chunk.sphere.center)
          .add(new T.Vector3(0, 0, chunk.sphere.radius + 12));
        camera.updateMatrixWorld(true);
        kit.update(camera, 'high');
        expect(chunk.level).toBe(0);
        const levels = kit.chunks.map((c) => c.level);
        const nearRanges = meshes.map((m) => ({ ...m.geometry.drawRange }));
        const target = renderTarget(2048, 2048);
        const shadow = new T.OrthographicCamera(-2000, 2000, 2000, -2000, 0.1, 5000);
        for (let i = 0; i < meshes.length; i++) {
          const m = meshes[i];
          m.onBeforeShadow(
            target,
            m as unknown as T.Scene,
            camera,
            shadow,
            m.geometry,
            m.customDepthMaterial ?? depth,
            null as unknown as T.Group,
          );
          const expected = 'templates' in chunk ? chunk.templates[i].ranges[2] : chunk.ranges[2];
          expect(m.geometry.drawRange).toEqual(expected);
        }
        expect(kit.chunks.map((c) => c.level)).toEqual(levels);
        // A tight, high-resolution near-car sun map retains the near silhouette.
        shadow.left = -10;
        shadow.right = 10;
        shadow.top = 10;
        shadow.bottom = -10;
        shadow.updateProjectionMatrix();
        for (let i = 0; i < meshes.length; i++) {
          const m = meshes[i];
          m.onBeforeShadow(
            target,
            m as unknown as T.Scene,
            camera,
            shadow,
            m.geometry,
            m.customDepthMaterial ?? depth,
            null as unknown as T.Group,
          );
          expect(m.geometry.drawRange).toEqual(nearRanges[i]);
        }
        kit.update(camera, 'high');
        expect(meshes.map((m) => m.geometry.drawRange)).toEqual(nearRanges);
      } finally {
        depth.dispose();
        kit.dispose();
      }
    });
    it('selects economical geometry for a small reflection without coarsening the main view', async () => {
      const data = new Uint8Array(readFileSync(`public/models/aurel-${family}.glb`));
      const kit =
        family === 'vegetation'
          ? await decodeAurelVegetation(data, loader())
          : await decodeAurelQuarry(data, loader());
      const track = new Track(),
        parent = new T.Group();
      try {
        if ('build' in kit) kit.build(track, parent);
        else {
          const q = new BuildQueue();
          kit.enqueue(track, parent, serviceSitePlan(track), q);
          q.runSynchronously();
        }
        parent.updateMatrixWorld(true);
        const chunk = kit.chunks.find((c) => ('layer' in c ? c.layer === 'near' : !c.background))!;
        const meshes = 'meshes' in chunk ? chunk.meshes : [chunk.mesh];
        const main = new T.PerspectiveCamera(58, 16 / 9, 0.1, 5000);
        main.position.copy(chunk.sphere.center).add(new T.Vector3(0, 0, chunk.sphere.radius + 12));
        main.updateMatrixWorld(true);
        kit.update(main, 'high');
        const primaryRanges = meshes.map((m) => ({ ...m.geometry.drawRange }));
        const ids = meshes.map((m) => [
          m.geometry,
          m.geometry.index,
          m.geometry.attributes.position,
        ]);
        const mirror = new T.PerspectiveCamera(58, 16 / 9, 0.1, 5000);
        mirror.position
          .copy(chunk.sphere.center)
          .add(new T.Vector3(0, 0, chunk.sphere.radius + 180));
        mirror.updateMatrixWorld(true);
        for (let i = 0; i < meshes.length; i++) {
          const m = meshes[i];
          m.onBeforeRender(
            renderTarget(512, 192),
            new T.Scene(),
            mirror,
            m.geometry,
            m.material as T.Material,
            null as unknown as T.Group,
          );
          expect(m.geometry.drawRange).toEqual(
            'templates' in chunk ? chunk.templates[i].ranges[2] : chunk.ranges[2],
          );
        }
        expect(chunk.level).toBe(0);
        kit.update(main, 'high');
        expect(meshes.map((m) => m.geometry.drawRange)).toEqual(primaryRanges);
        expect(
          meshes.map((m) => [m.geometry, m.geometry.index, m.geometry.attributes.position]),
        ).toEqual(ids);
      } finally {
        kit.dispose();
      }
    });
  });
}
