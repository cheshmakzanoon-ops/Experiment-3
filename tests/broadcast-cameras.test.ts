import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  BROADCAST_CAMERAS as M,
  CAMERA_VARIANTS,
  broadcastCameraDocument,
  decodeBroadcastCameras,
  loadBroadcastCameras,
} from '../src/rendering/broadcast-cameras.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import {
  trackInfrastructurePlan,
  buildTrackInfrastructure,
} from '../src/rendering/track-infrastructure.ts';
import { grassApronOffset } from '../src/rendering/ground-profile.ts';
import {
  cameraHardwareMatrix,
  cameraHardwareHeight,
  conformCameraHead,
  conformCameraTower,
} from '../src/rendering/broadcast-camera-placement.ts';
import { tracksideRigs, tracksideFraming } from '../src/rendering/trackside.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';
const bytes = () => new Uint8Array(readFileSync('public/' + M.url));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
const decode = () => decodeBroadcastCameras(bytes(), loader());
function disposeTree(root: T.Object3D) {
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>();
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      gs.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) ms.add(m);
    }
  });
  gs.forEach((g) => g.dispose());
  ms.forEach((m) => m.dispose());
}
function visibleTriangleInFrustum(g: T.BufferGeometry, camera: T.PerspectiveCamera) {
  const frustum = new T.Frustum().setFromProjectionMatrix(
      new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    ),
    p = g.getAttribute('position'),
    index = g.index!;
  for (let i = 0; i < index.count; i += 3) {
    let polygon = [0, 1, 2].map((j) => new T.Vector3().fromBufferAttribute(p, index.getX(i + j)));
    const normal = new T.Vector3()
      .subVectors(polygon[1], polygon[0])
      .cross(new T.Vector3().subVectors(polygon[2], polygon[0]));
    if (normal.dot(camera.position.clone().sub(polygon[0])) <= 0) continue;
    if (frustum.planes.some((plane) => polygon.every((v) => plane.distanceToPoint(v) < 0)))
      continue;
    for (const plane of frustum.planes) {
      const next: T.Vector3[] = [];
      for (let j = 0; j < polygon.length; j++) {
        const a = polygon[j],
          b = polygon[(j + 1) % polygon.length],
          da = plane.distanceToPoint(a),
          db = plane.distanceToPoint(b);
        if (da >= 0) next.push(a);
        if (da >= 0 !== db >= 0) next.push(a.clone().lerp(b, da / (da - db)));
      }
      polygon = next;
      if (polygon.length < 3) break;
    }
    if (polygon.length >= 3) return true;
  }
  return false;
}
function intersects(g: T.BufferGeometry, box: T.Box3) {
  const p = g.getAttribute('position'),
    idx = g.index!,
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    triangle = new T.Triangle(a, b, c);
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i));
    b.fromBufferAttribute(p, idx.getX(i + 1));
    c.fromBufferAttribute(p, idx.getX(i + 2));
    if (box.intersectsTriangle(triangle)) return true;
  }
  return false;
}
describe('A10 authored broadcast cameras and retained optical positions', () => {
  it('retains exact original source/export, packed atlas, twenty-two sockets and bounded LODs', () => {
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(readFileSync(M.editable).length).toBeGreaterThan(10000);
    expect(hash(bytes())).toBe(M.sha256);
    const d = broadcastCameraDocument(bytes());
    expect(d.materials).toHaveLength(1);
    expect(d.images).toHaveLength(3);
    expect(Object.keys(M.sockets)).toHaveLength(22);
    for (const c of Object.values(M.triangles)) {
      expect(c[0]).toBeLessThan(10000);
      expect(c[0]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[2]);
    }
  });
  it('rejects malformed and changed payloads before resource decoding', async () => {
    expect(() => broadcastCameraDocument(bytes().slice(0, -1))).toThrow('byte');
    const h = bytes();
    h[0] = 0;
    expect(() => broadcastCameraDocument(h)).toThrow('header');
    const c = bytes();
    c[c.length - 1] ^= 1;
    await expect(decodeBroadcastCameras(c)).rejects.toThrow('integrity');
  });
  it('retains finite indexed geometry, normalized normals and padded atlas coordinates in all variants and every tier', async () => {
    const kit = await decode();
    try {
      for (const v of CAMERA_VARIANTS)
        for (const l of [0, 1, 2]) {
          const ps = kit.templates.get(`${v}:${l}`)!;
          expect(ps).toHaveLength(1);
          const g = ps[0].geometry;
          expect(g.index!.count / 3).toBe(M.triangles[v][l]);
          for (const k of ['position', 'normal', 'uv'])
            expect(Array.from(g.getAttribute(k).array).every(Number.isFinite)).toBe(true);
          const n = g.getAttribute('normal'),
            uv = g.getAttribute('uv');
          for (let i = 0; i < n.count; i++)
            expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
          for (let i = 0; i < uv.count; i++) {
            const u = uv.getX(i) * 4,
              v = (1 - uv.getY(i)) * 2;
            expect(u - Math.floor(u)).toBeGreaterThanOrEqual(8 / 128 - 1e-5);
            expect(u - Math.floor(u)).toBeLessThanOrEqual(120 / 128 + 1e-5);
            expect(v - Math.floor(v)).toBeGreaterThanOrEqual(8 / 256 - 1e-5);
            expect(v - Math.floor(v)).toBeLessThanOrEqual(248 / 256 + 1e-5);
          }
        }
    } finally {
      kit.dispose();
    }
  });
  it('keeps body/tripod vertices behind the optical plane and platform working/entry spaces clear', async () => {
    const kit = await decode();
    try {
      for (const v of ['dry', 'rain'])
        for (const l of [0, 1, 2]) {
          const p = kit.templates.get(`${v}:${l}`)![0].geometry.getAttribute('position');
          for (let i = 0; i < p.count; i++) expect(p.getZ(i)).toBeGreaterThan(0.17);
        }
      for (const v of ['tower_low', 'tower_high'] as const) {
        const deck = M.towerHeights[v] - M.deckBelowOptical,
          clear = [
            new T.Box3(
              new T.Vector3(0.38, deck + 0.025, 0.42),
              new T.Vector3(1.17, deck + 1.8, 0.93),
            ),
            new T.Box3(
              new T.Vector3(1.17, deck + 0.025, 0.41),
              new T.Vector3(1.28, deck + 1.8, 0.89),
            ),
          ];
        for (const l of [0, 1, 2])
          for (const box of clear)
            expect(intersects(kit.templates.get(`${v}:${l}`)![0].geometry, box)).toBe(false);
      }
    } finally {
      kit.dispose();
    }
  });
  it('retains all twenty optical coordinates and protected footprints while grounding supports on both sides', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      plan = trackInfrastructurePlan(track),
      rigs = tracksideRigs(track),
      before = JSON.stringify(plan),
      water = track.water.slice(),
      root = new T.Group();
    try {
      for (const site of plan.cameras) {
        const h = cameraHardwareHeight(site),
          tower = h > 5.3 ? 'tower_high' : 'tower_low';
        expect(
          new T.Vector3()
            .applyMatrix4(cameraHardwareMatrix(site))
            .distanceTo(rigs[site.rigId!].position),
        ).toBeLessThan(1e-7);
        const template = kit.templates.get(`${tower}:0`)![0].geometry,
          copy = Array.from(template.getAttribute('position').array),
          g = conformCameraTower(template, track, site, M.towerHeights[tower]),
          p = g.getAttribute('position'),
          src = template.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const q = trackPoint(),
            l = track.nearest(p.getX(i), p.getZ(i), q);
          expect(Math.abs(l) - track.boundary(q.s, l < 0 ? -1 : 1)).toBeGreaterThan(2.0);
          expect(inStandFootprint(track, p.getX(i), p.getZ(i), 0.02)).toBe(false);
          if (src.getY(i) < 0) {
            const ground =
              q.y + q.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, q.s, l);
            expect(p.getY(i)).toBeLessThanOrEqual(ground - 0.024);
          }
        }
        expect(Array.from(template.getAttribute('position').array)).toEqual(copy);
        g.dispose();
        kit.buildCamera(track, root, site);
      }
      expect(JSON.stringify(plan)).toBe(before);
      expect(track.water).toEqual(water);
      expect(kit.diagnostics()).toMatchObject({
        modules: 20,
        rainCovers: 7,
        platforms: 20,
        opticalPositionsRetained: true,
        cameraDirectorChanged: false,
        physicsChanged: false,
      });
      expect(() => kit.buildCamera(track, root, plan.cameras[0])).toThrow('Duplicate');
      for (const c of kit.chunks) {
        expect(c.sphere.radius).toBeLessThan(4.2);
        expect(c.levels.filter((l) => l.visible)).toHaveLength(1);
        expect(c.levels.every((l) => l.children.length === 1)).toBe(true);
      }
      const camera = new T.PerspectiveCamera(58, 16 / 9);
      camera.position.copy(kit.chunks[0].sphere.center);
      kit.update(camera, 'high');
      expect(kit.chunks[0].level).toBe(0);
      camera.position.addScalar(10000);
      kit.update(camera, 'high');
      expect(kit.chunks.every((c) => c.level === 2)).toBe(true);
    } finally {
      kit.dispose();
    }
  });
  it('does not obscure its own original optical rays across each rig coverage window', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      sites = trackInfrastructurePlan(track).cameras,
      rigs = tracksideRigs(track),
      root = new T.Group();
    try {
      for (const site of sites) kit.buildCamera(track, root, site);
      root.updateMatrixWorld(true);
      for (const [i, site] of sites.entries()) {
        const rig = rigs[site.rigId!];
        for (const fraction of [-0.4, 0, 0.4])
          for (const lane of [-2.2, 2.2]) {
            const p = track.at(rig.centerS + rig.coverageM * fraction, trackPoint()),
              target = new T.Vector3(p.x + p.nx * lane, p.y + 0.75, p.z + p.nz * lane),
              d = target.sub(rig.position),
              distance = d.length(),
              ray = new T.Raycaster(rig.position, d.normalize(), 0.02, distance - 0.01);
            for (const l of kit.chunks[i].levels)
              expect(
                ray.intersectObject(l.children[0], false).length,
                `rig ${site.rigId}, ${fraction}, ${lane}`,
              ).toBe(0);
          }
      }
    } finally {
      kit.dispose();
    }
  });
  it('keeps central and peripheral optical views free across common aspects with real framing FOVs', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      sites = trackInfrastructurePlan(track).cameras,
      rigs = tracksideRigs(track),
      root = new T.Group();
    try {
      for (const site of sites) kit.buildCamera(track, root, site);
      root.updateMatrixWorld(true);
      for (const [i, site] of sites.entries())
        for (const fraction of [-0.4, 0, 0.4])
          for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
            const rig = rigs[site.rigId!],
              p = track.at(rig.centerS + rig.coverageM * fraction, trackPoint()),
              target = new T.Vector3(p.x, p.y + 0.75, p.z),
              distance = target.distanceTo(rig.position),
              camera = new T.PerspectiveCamera(
                tracksideFraming(distance, rig.baseFov, aspect).fov,
                aspect,
                0.08,
                3000,
              );
            camera.position.copy(rig.position);
            camera.lookAt(target);
            camera.updateMatrixWorld(true);
            for (const x of [-0.9, 0, 0.9])
              for (const y of [-0.9, 0, 0.9]) {
                const ray = new T.Raycaster();
                ray.setFromCamera(new T.Vector2(x, y), camera);
                ray.near = 0.02;
                ray.far = distance;
                for (const level of kit.chunks[i].levels)
                  expect(
                    ray.intersectObject(level.children[0], false).length,
                    `rig ${site.rigId} aspect ${aspect} pixel ${x}/${y}`,
                  ).toBe(0);
              }
          }
    } finally {
      kit.dispose();
    }
  });
  it('keeps all front-facing hardware triangles outside the wide optical frustum through the coverage interval', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      sites = trackInfrastructurePlan(track).cameras,
      rigs = tracksideRigs(track),
      root = new T.Group();
    try {
      for (const site of sites) kit.buildCamera(track, root, site);
      for (const [i, site] of sites.entries())
        for (const fraction of [-0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45]) {
          const rig = rigs[site.rigId!],
            p = track.at(rig.centerS + rig.coverageM * fraction, trackPoint()),
            target = new T.Vector3(p.x, p.y + 0.75, p.z),
            camera = new T.PerspectiveCamera(
              tracksideFraming(target.distanceTo(rig.position), rig.baseFov, 21 / 9).fov,
              21 / 9,
              0.08,
              3000,
            );
          camera.position.copy(rig.position);
          camera.lookAt(target);
          camera.updateMatrixWorld(true);
          for (const level of kit.chunks[i].levels)
            expect(
              visibleTriangleInFrustum((level.children[0] as T.Mesh).geometry, camera),
              `rig ${site.rigId} at ${fraction}`,
            ).toBe(false);
        }
    } finally {
      kit.dispose();
    }
  });
  it('retains the original infrastructure plan and unrelated marshals/drains while replacing only camera hardware', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      plan = trackInfrastructurePlan(track),
      old = new T.Group(),
      next = new T.Group(),
      panel = new T.MeshStandardMaterial();
    try {
      buildTrackInfrastructure(track, old, panel, plan);
      buildTrackInfrastructure(track, next, panel, plan, null, null, kit);
      for (const site of plan.cameras) {
        const a = old.getObjectByName(`Replay camera infrastructure ${site.rigId}`)!,
          b = next.getObjectByName(a.name)!;
        expect(a.position.toArray()).toEqual(b.position.toArray());
        expect(a.rotation.toArray()).toEqual(b.rotation.toArray());
        expect(b.children).toHaveLength(0);
      }
      for (const o of old.children.filter((o) => !o.name.startsWith('Replay camera'))) {
        const n = next.getObjectByName(o.name)!;
        expect(n).toBeDefined();
        expect(n.position.toArray()).toEqual(o.position.toArray());
        expect(n.children.length).toBe(o.children.length);
      }
      const head = kit.templates.get('dry:0')![0].geometry,
        moved = conformCameraHead(head, plan.cameras[0]);
      expect(moved.boundingSphere!.radius).toBeLessThan(1.1);
      moved.dispose();
      let disposed = 0;
      panel.addEventListener('dispose', () => disposed++);
      kit.dispose();
      expect(disposed).toBe(0);
    } finally {
      kit.dispose();
      disposeTree(old);
      disposeTree(next);
    }
  });
  it('retains a head-only path for an unsupported site and releases all resources once', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      site = { ...trackInfrastructurePlan(track).cameras[0], supported: false },
      root = new T.Group();
    kit.buildCamera(track, root, site);
    expect(kit.diagnostics().platforms).toBe(0);
    expect(kit.chunks[0].sphere.radius).toBeLessThan(1.1);
    const gs = new Set<T.BufferGeometry>();
    kit.templates.forEach((ps) => ps.forEach((p) => gs.add(p.geometry)));
    kit.root.traverse((o) => {
      if (o instanceof T.Mesh) gs.add(o.geometry);
    });
    let count = 0;
    gs.forEach((g) => g.addEventListener('dispose', () => count++));
    kit.dispose();
    kit.dispose();
    expect(count).toBe(gs.size);
    expect(kit.root.parent).toBeNull();
  });
  it('cancels and rejects missing, truncated and oversized transport', async () => {
    const f = vi.fn();
    await expect(
      loadBroadcastCameras(() => true, 'https://example.invalid', f),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(f).not.toHaveBeenCalled();
    await expect(
      loadBroadcastCameras(
        () => false,
        'https://example.invalid',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('Unable');
    await expect(
      loadBroadcastCameras(
        () => false,
        'https://example.invalid',
        async () => new Response(bytes().slice(0, -1)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadBroadcastCameras(
        () => false,
        'https://example.invalid',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
  });
});
