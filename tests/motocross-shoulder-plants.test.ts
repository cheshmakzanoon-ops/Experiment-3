import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import {
  MxShoulderView,
  mxShoulderPlantGeometry,
  MX_SHOULDER_WIND,
} from '../src/rendering/offroad/mx-shoulder-plants.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

const names = ['MX shoulder grass islands', 'MX shoulder fern fans', 'MX shoulder broadleaf scrub'];

describe('formed, rooted motocross shoulder vegetation', () => {
  it('supports every root on an actual rendered terrain triangle, including clipped inside turns', async () => {
    const track = rigTrack('valley-ridge-mx'),
      terrain = new TerrainView(track),
      dressing = new MxCourseDressing(track),
      matrix = new T.Matrix4(),
      root = new T.Vector3(),
      ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0), 0, 20);
    let checked = 0;
    try {
      terrain.group.updateMatrixWorld(true);
      for (const name of names) {
        const mesh = dressing.root.getObjectByName(name) as T.InstancedMesh;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          root.setFromMatrixPosition(matrix);
          ray.ray.origin.set(root.x, root.y + 10, root.z);
          // Three intersects the real indexed mesh after TerrainView removes
          // overlapping or curvature-clipped triangles. baseHeight alone still
          // supplies heights over those holes and cannot prove root support.
          const hit = ray.intersectObject(terrain.group, true)[0],
            label = `${name} ${i} rendered support`;
          expect(hit, label).toBeDefined();
          const burial = hit.point.y - root.y;
          expect(burial, label).toBeGreaterThanOrEqual(0);
          expect(burial, label).toBeLessThanOrEqual(0.08);
          checked++;
          // The complete indexed-terrain sweep is intentionally exhaustive.
          // Let Vitest flush worker messages between batches on slow CPUs.
          if (checked % 32 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      expect(checked).toBeGreaterThan(1500);
    } finally {
      dressing.dispose();
      terrain.dispose();
    }
  });

  it('grounds every clump outside riding lanes, boundary padding and the mechanics lane', () => {
    const track = rigTrack('valley-ridge-mx'),
      surface = Track.offroadOf(track) as TrackTerrainSurface,
      initial = surface.terrain.hash(),
      dressing = new MxCourseDressing(track),
      matrix = new T.Matrix4(),
      root = new T.Vector3(),
      vertex = new T.Vector3(),
      nearest = trackPoint();
    let triangles = 0;
    for (const name of names) {
      const mesh = dressing.root.getObjectByName(name) as T.InstancedMesh;
      expect(mesh, name).toBeInstanceOf(T.InstancedMesh);
      const geometry = mesh.geometry,
        box = geometry.boundingBox!;
      triangles +=
        ((geometry.index?.count ?? geometry.getAttribute('position').count) / 3) * mesh.count;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        root.setFromMatrixPosition(matrix);
        const lateral = track.nearest(root.x, root.z, nearest),
          side = Math.sign(lateral);
        // Projection onto the sampled polyline need not recover exactly the
        // source station; its error must stay within the 25 mm root burial.
        expect(
          Math.abs(root.y - surface.terrain.baseHeight(nearest.s, lateral) + 0.025),
          `${name} ${i} root`,
        ).toBeLessThan(0.025);
        expect(side === track.pit.side && track.isPitSection(nearest.s), `${name} ${i} pit`).toBe(
          false,
        );
        // The actual rotated bounding-box corners enclose every leaf, including
        // leaves bent downhill. Testing centres alone misses an overhanging fan.
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z]) {
              vertex.set(x, y, z).applyMatrix4(matrix);
              const l = track.nearest(vertex.x, vertex.z, nearest);
              expect(
                Math.abs(l) - surface.course.legalWidth(nearest.width, nearest.s, l),
                `${name} ${i} lane footprint`,
              ).toBeGreaterThan(0.12);
              expect(
                Math.abs(Math.abs(l) - track.boundaryAt(nearest, Math.sign(l))),
                `${name} ${i} padding footprint`,
              ).toBeGreaterThan(0.33);
            }
      }
    }
    console.info('MX foliage budget', JSON.stringify({ ...dressing.stats, triangles }));
    expect(dressing.stats.grassClumps).toBeGreaterThan(1000);
    expect(dressing.stats.fernClumps).toBeGreaterThan(20);
    expect(dressing.stats.shrubs).toBeGreaterThan(10);
    // High/Ultra verge density was deliberately doubled (about 150k
    // triangles, instanced, no extra draws, no shadow casting); Low/Medium
    // draw a 45% subset, which stays inside the earlier 90k budget.
    expect(triangles).toBeLessThan(160000);
    setMxQuality('medium');
    try {
      let reduced = 0;
      for (const name of names) {
        const mesh = dressing.root.getObjectByName(name) as T.InstancedMesh;
        reduced +=
          ((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3) *
          mesh.count;
      }
      expect(reduced).toBeLessThan(90000);
    } finally {
      setMxQuality('high');
    }
    expect(surface.terrain.hash()).toBe(initial);
    dressing.dispose();
  });

  it('uses finite leaf surfaces with fixed roots and bounded tip flexibility', () => {
    for (const kind of ['grass', 'fern', 'scrub'] as const) {
      const geometry = mxShoulderPlantGeometry(kind),
        positions = geometry.getAttribute('position'),
        normals = geometry.getAttribute('normal'),
        flex = geometry.getAttribute('mxPlantFlex');
      expect(positions.count).toBeLessThanOrEqual(450);
      for (let i = 0; i < positions.count; i++) {
        expect(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i))).toBe(
          true,
        );
        expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 5);
        expect(flex.getX(i)).toBeGreaterThanOrEqual(0);
        expect(flex.getX(i)).toBeLessThanOrEqual(1);
        if (positions.getY(i) === 0) expect(flex.getX(i)).toBe(0);
      }
      geometry.dispose();
    }
  });

  it('keeps shader-bent leaves inside their frustum-culling sphere at both wind extremes', () => {
    const tip = new T.Vector3();
    for (const kind of ['grass', 'fern', 'scrub'] as const) {
      const geometry = mxShoulderPlantGeometry(kind),
        positions = geometry.getAttribute('position'),
        flex = geometry.getAttribute('mxPlantFlex'),
        sphere = geometry.boundingSphere!;
      for (let i = 0; i < positions.count; i++) {
        for (const direction of [-1, 1]) {
          const displacement = direction * (1 + MX_SHOULDER_WIND.flutter) * flex.getX(i);
          tip.fromBufferAttribute(positions, i);
          tip.x += MX_SHOULDER_WIND.x * displacement;
          tip.z += MX_SHOULDER_WIND.z * displacement;
          expect(sphere.containsPoint(tip), `${kind} vertex ${i}`).toBe(true);
        }
      }
      geometry.dispose();
    }
  });

  it('reuses three meshes and one shader while pause and reverse seek reuse the same wind state', () => {
    const dressing = new MxCourseDressing(rigTrack('valley-ridge-mx')),
      meshes = names.map((name) => dressing.root.getObjectByName(name) as T.InstancedMesh),
      material = meshes[0].material as T.MeshStandardMaterial,
      source = T.ShaderLib.physical,
      shader = {
        vertexShader: source.vertexShader,
        fragmentShader: source.fragmentShader,
        uniforms: T.UniformsUtils.clone(source.uniforms),
      } as StudioShader,
      matrices = meshes.map((m) => m.instanceMatrix.array),
      versions = meshes.map((m) => m.instanceMatrix.version),
      counts = meshes.map((m) => m.count);
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    const clock = shader.uniforms.mxPlantTime;
    expect(meshes.every((m) => m.material === material && !m.castShadow)).toBe(true);
    expect(material.map).toBeNull();
    dressing.update(31.5);
    expect(clock.value).toBe(31.5);
    for (let i = 0; i < 1000; i++) dressing.update(31.5);
    expect(clock.value).toBe(31.5);
    dressing.update(4.25);
    expect(clock.value).toBe(4.25);
    dressing.update(NaN);
    expect(clock.value).toBe(4.25);
    meshes.forEach((m, i) => {
      expect(m.instanceMatrix.array).toBe(matrices[i]);
      expect(m.instanceMatrix.version).toBe(versions[i]);
      expect(m.count).toBe(counts[i]);
    });
    let materialDisposals = 0,
      geometryDisposals = 0,
      instanceDisposals = 0;
    material.addEventListener('dispose', () => materialDisposals++);
    meshes.forEach((m) => {
      m.geometry.addEventListener('dispose', () => geometryDisposals++);
      m.addEventListener('dispose', () => instanceDisposals++);
    });
    dressing.dispose();
    expect(materialDisposals).toBe(1);
    expect(geometryDisposals).toBe(3);
    expect(instanceDisposals).toBe(3);
  });

  it('reuses a surveyed colour buffer when the riding camera moves into its edge reserve', () => {
    const geometry = mxShoulderPlantGeometry('tuft'), material = new T.MeshStandardMaterial();
    const parent = new T.Group(), plants = new T.InstancedMesh(geometry, material, 3);
    const pose = new T.Matrix4();
    for (const [i, x] of [14, 17.5, 46].entries()) {
      plants.setMatrixAt(i, pose.makeTranslation(x, 0, -10));
      plants.setColorAt(i, new T.Color(0.3 + 0.1 * i, 0.6, 0.2));
    }
    parent.add(plants);
    plants.computeBoundingSphere();
    const family = new MxShoulderView(plants), camera = new T.PerspectiveCamera(60, 1, 0.1, 100);
    const view = () => {
      camera.updateMatrixWorld(true);
      family.begin(camera);
      const batch = parent.getObjectByName(plants.name + ' in camera') as T.InstancedMesh;
      const result = { count: batch.count, version: batch.instanceMatrix.version };
      family.end();
      return result;
    };
    try {
      camera.position.set(10.2, 0.3, 0);
      const start = view();
      expect(start.count).toBe(2);
      camera.position.x += 1.8;
      expect(view()).toEqual(start);
      camera.rotation.y = Math.PI;
      expect(view().count).toBe(0);
      camera.rotation.y = 0;
      expect(view().count).toBe(2);
    } finally {
      family.dispose();
      plants.dispose();
      material.dispose();
      geometry.dispose();
    }
  });

  it('keeps the venue world transform when the colour pass borrows plants after scene updates', () => {
    const scene = new T.Scene(), parent = new T.Group();
    const geometry = mxShoulderPlantGeometry('tuft'), material = new T.MeshStandardMaterial();
    const plants = new T.InstancedMesh(geometry, material, 1);
    plants.setMatrixAt(0, new T.Matrix4());
    plants.setColorAt(0, new T.Color(0x67a044));
    plants.computeBoundingSphere();
    plants.position.set(-2, 0.2, 4);
    plants.rotation.y = 0.28;
    parent.position.set(32, 3, -18);
    parent.rotation.set(0.08, -0.4, 0.03);
    parent.scale.set(0.9, 1.1, 1.2);
    parent.add(plants);
    scene.add(parent);
    scene.matrixWorldAutoUpdate = false;
    const family = new MxShoulderView(plants), camera = new T.PerspectiveCamera(65, 1.6, 0.1, 100);
    try {
      for (const x of [32, 43, 32]) {
        parent.position.x = x;
        scene.updateMatrixWorld(true);
        camera.position.set(0, 2, 7).applyMatrix4(plants.matrixWorld);
        camera.lookAt(new T.Vector3().setFromMatrixPosition(plants.matrixWorld));
        camera.updateMatrixWorld(true);
        family.begin(camera);
        const batch = parent.getObjectByName(plants.name + ' in camera') as T.InstancedMesh;
        expect(batch.count).toBe(1);
        expect(batch.matrixWorld.equals(plants.matrixWorld)).toBe(true);
        family.end();
      }
    } finally {
      family.dispose();
      plants.dispose();
      geometry.dispose();
      material.dispose();
    }
  });

  it('retains every in-frame wind envelope and tint across camera cuts and density changes', () => {
    const track = rigTrack('valley-ridge-mx'), dressing = new MxCourseDressing(track);
    const sources = [...dressing.root.children, ...dressing.turf.children].filter(
      (o): o is T.InstancedMesh => o instanceof T.InstancedMesh && o.material instanceof T.MeshStandardMaterial &&
        o.material.name === 'MX living shoulder foliage',
    );
    const camera = new T.PerspectiveCamera(55, 1.6, 0.1, 1500);
    const matrix = new T.Matrix4(), sphere = new T.Sphere(), frustum = new T.Frustum();
    const signature = (mesh: T.InstancedMesh, i: number) => {
      mesh.getMatrixAt(i, matrix);
      return matrix.elements.join(',') + '/' + new T.Color().fromBufferAttribute(mesh.instanceColor!, i).toArray().join(',');
    };
    const cameraBatches = new Set<T.InstancedMesh>();
    let checked = 0, submitted = 0, authored = 0;
    try {
      expect(sources).toHaveLength(4);
      for (const [s, offset, quality] of [[4, 15, 'high'], [170, -15, 'high'], [710, 15, 'low'],
          [170, -15, 'high'], [4, 15, 'high']] as const) {
        setMxQuality(quality);
        const eye = track.at(s, trackPoint()), target = track.at(s + offset, trackPoint());
        camera.position.set(eye.x, eye.y + 1.65, eye.z);
        camera.lookAt(target.x, target.y + 1.3, target.z);
        camera.updateMatrixWorld(true);
        frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        dressing.inCameraView(camera, () => {
          for (const source of sources) {
            const batch = source.parent!.getObjectByName(source.name + ' in camera') as T.InstancedMesh;
            cameraBatches.add(batch);
            expect(source.visible).toBe(false);
            expect(batch.geometry).toBe(source.geometry);
            expect(batch.material).toBe(source.material);
            const retained = new Set(Array.from({ length: batch.count }, (_, i) => signature(batch, i)));
            for (let i = 0; i < source.count; i++) {
              source.getMatrixAt(i, matrix);
              sphere.copy(source.geometry.boundingSphere!).applyMatrix4(matrix);
              if (frustum.intersectsSphere(sphere)) {
                checked++;
                if (!retained.has(signature(source, i))) throw new Error(source.name + ' clipped a visible plant');
              }
            }
            submitted += batch.count;
            authored += source.count;
          }
        });
        expect(sources.every((mesh) => mesh.visible && !mesh.parent!.getObjectByName(mesh.name + ' in camera'))).toBe(true);
      }
      expect(checked).toBeGreaterThan(1000);
      expect(submitted).toBeLessThan(authored / 2);
      const last = sources[0];
      last.visible = false;
      expect(() => dressing.inCameraView(camera, () => { throw new Error('interrupted colour pass'); })).toThrow();
      expect(last.visible).toBe(false);
      expect(sources.slice(1).every((m) => m.visible)).toBe(true);
      expect(cameraBatches.size).toBe(4);
      let releases = 0;
      for (const batch of cameraBatches) batch.addEventListener('dispose', () => releases++);
      dressing.dispose();
      dressing.dispose();
      expect(releases).toBe(4);
    } finally {
      setMxQuality('high');
      dressing.dispose();
    }
  });

  it('keeps the indoor supercross venue clear of outdoor plants', () => {
    const dressing = new MxCourseDressing(rigTrack('arena-nord-sx'));
    expect(dressing.stats.grassClumps + dressing.stats.fernClumps + dressing.stats.shrubs).toBe(0);
    expect(names.every((name) => !dressing.root.getObjectByName(name))).toBe(true);
    dressing.dispose();
  });
});
