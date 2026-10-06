import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { SecondaryGrandstands } from '../src/rendering/secondary-grandstands.ts';
import {
  secondaryStandGeometry,
  SECONDARY_ROLES,
  SECONDARY_TIERS,
} from '../src/rendering/secondary-grandstand-assets.ts';
import {
  packSecondaryStandRole,
  secondaryStandTier,
} from '../src/rendering/secondary-grandstand-detail.ts';
import { buildGrandstand, standFrame } from '../src/rendering/grandstand.ts';
import { StartFinishVenue } from '../src/rendering/start-finish-venue.ts';
import { AUREL_VENUE, VELLAMAR_VENUE } from '../src/rendering/venue-plan.ts';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { Track } from '../src/simulation/track.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { CrowdCluster } from '../src/rendering/crowd.ts';

function materials() {
  return Object.fromEntries(
    ['concrete', 'steel', 'roof', 'underside', 'seats', 'people', 'sign'].map((name) => [
      name,
      new T.MeshStandardMaterial(),
    ]),
  ) as ReturnType<typeof import('../src/rendering/grandstand.ts').standMaterials>;
}
function release(root: T.Object3D) {
  const geometry = new Set<T.BufferGeometry>(),
    mats = new Set<T.Material>();
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      geometry.add(o.geometry);
      [o.material].flat().forEach((m) => mats.add(m));
      if (o instanceof T.InstancedMesh) o.dispose();
    }
  });
  geometry.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  root.clear();
}
function meshes(root: T.Object3D) {
  const result: T.InstancedMesh[] = [];
  root.traverse((o) => {
    if (o instanceof T.InstancedMesh) result.push(o);
  });
  return result;
}

describe('A12 retained-site integration', () => {
  it('preserves all six seat buffers, crowd cohorts, aisles, clearance and canopy sightlines', () => {
    const track = new Track('clear'),
      kit = new SecondaryGrandstands(track),
      m = materials();
    const props = new T.Group(),
      audience = new T.Group(),
      oldProps = new T.Group(),
      oldAudience = new T.Group();
    const currentClusters: CrowdCluster[] = [],
      originalClusters: CrowdCluster[] = [];
    try {
      for (const site of AUREL_VENUE.grandstands.slice(2)) {
        const actualSight = new BroadcastSightlines(),
          originalSight = new BroadcastSightlines();
        const original = buildGrandstand(
          track,
          oldProps,
          oldAudience,
          site,
          m,
          originalClusters,
          originalSight,
        );
        const current = buildGrandstand(
          track,
          props,
          audience,
          site,
          m,
          currentClusters,
          actualSight,
          undefined,
          kit,
        );
        const oldSeats = original.getObjectByName(`Seats ${site.s}m`) as T.InstancedMesh;
        const newSeats = current.getObjectByName(`A12 / ${site.s}m / seat`) as T.InstancedMesh;
        expect(newSeats.count).toBe(552);
        expect(newSeats.instanceMatrix.array).toEqual(oldSeats.instanceMatrix.array);
        expect(newSeats.instanceColor!.array).toEqual(oldSeats.instanceColor!.array);
        expect(current.userData.corridorClearance).toBe(original.userData.corridorClearance);
        expect(current.userData.corridorClearance).toBeGreaterThan(2.5);
        expect(current.position).toEqual(original.position);
        expect(current.rotation.toArray()).toEqual(original.rotation.toArray());
        const matrix = new T.Matrix4();
        for (let i = 0; i < newSeats.count; i++) {
          newSeats.getMatrixAt(i, matrix);
          const z = matrix.elements[14];
          expect(Math.abs(z - 12)).toBeGreaterThanOrEqual(0.7);
          expect(Math.abs(z + 12)).toBeGreaterThanOrEqual(0.7);
          expect(matrix.determinant()).toBeCloseTo(1, 6);
        }
        expect(actualSight.count).toBe(originalSight.count);
        current.updateWorldMatrix(true, true);
        for (const y of [1, 4, 5.4, 6, 6.6, 7.5, 9]) {
          const a = current.localToWorld(new T.Vector3(-20, y, 0));
          const b = current.localToWorld(new T.Vector3(20, y, 0));
          expect(actualSight.blocked(a, b)).toBe(originalSight.blocked(a, b));
        }
        const foot = current.getObjectByName(`A12 / ${site.s}m / foot`) as T.InstancedMesh;
        const frame = standFrame(track, site);
        expect(foot.count).toBe(14);
        const post = current.getObjectByName(`A12 / ${site.s}m / post`) as T.InstancedMesh;
        for (let i = 0; i < post.count; i++) {
          post.getMatrixAt(i, matrix);
          const top = new T.Vector3(0, 1, 0).applyMatrix4(matrix);
          expect(top.y).toBeCloseTo(Math.abs(top.x) < 3 ? 6.07 : 7.36, 5);
        }
        for (let i = 0; i < foot.count; i++) {
          foot.getMatrixAt(i, matrix);
          const base = new T.Vector3().setFromMatrixPosition(matrix).applyMatrix4(foot.matrixWorld);
          expect(base.y).toBeCloseTo(frame.ground(base.x, base.z) - 0.12, 4);
          expect(matrix.determinant()).toBeGreaterThan(0);
        }
      }
      const before = meshes(oldAudience),
        after = meshes(audience);
      expect(after.length).toBe(before.length);
      after.forEach((a, i) => {
        expect(a.instanceMatrix.array).toEqual(before[i].instanceMatrix.array);
        expect(a.instanceColor?.array).toEqual(before[i].instanceColor?.array);
      });
      expect(currentClusters.length).toBe(originalClusters.length);
      const data = kit.diagnostics();
      expect(data.sites.map((s) => s.s)).toEqual([450, 780, 1220, 1670, 2210, 2600]);
      expect(data.sites.every((s) => s.batches === 9 && s.seats === 552)).toBe(true);
      expect(data.geometryBuffers).toBe(15);
      expect(data.allocatedTriangles).toBeLessThan(7000);
      expect(data.finalArtApproved).toBe(false);
    } finally {
      kit.dispose();
      [props, audience, oldProps, oldAudience].forEach(release);
      Object.values(m).forEach((m) => m.dispose());
    }
  });
  it('leaves both hero sites and every Vellamar site outside A12', () => {
    const track = new Track('clear'),
      kit = new SecondaryGrandstands(track),
      hero = new StartFinishVenue(track);
    const coast = new SecondaryGrandstands(
      new Track('clear', false, undefined, circuitDefinition('vellamar')),
    );
    for (const site of AUREL_VENUE.grandstands) {
      expect(kit.accepts(site)).toBe(site.s >= 450);
      expect(hero.accepts(site)).toBe(site.s < 450);
      expect(coast.accepts(site)).toBe(false);
    }
    VELLAMAR_VENUE.grandstands.forEach((s) => expect(coast.accepts(s)).toBe(false));
    expect(coast.diagnostics().geometryBuffers).toBe(0);
    kit.dispose();
    coast.dispose();
  });
  it('rejects changed footprints, duplicate sites and invalid terrain before graph mutation', () => {
    const track = new Track('clear'),
      kit = new SecondaryGrandstands(track),
      parent = new T.Group();
    const site = AUREL_VENUE.grandstands[2],
      frame = standFrame(track, site);
    for (const bad of [
      { ...site, s: 451 },
      { ...site, side: 1 },
      { ...site, length: 56 },
    ]) {
      expect(kit.accepts(bad)).toBe(false);
      expect(() => kit.architecture(parent, bad, frame)).toThrow();
    }
    for (const height of [NaN, Infinity, 100]) {
      expect(() => kit.architecture(parent, site, { ...frame, ground: () => height })).toThrow();
      expect(parent.children).toHaveLength(0);
      expect(kit.diagnostics().geometryBuffers).toBe(0);
    }
    kit.architecture(parent, site, frame);
    expect(() => kit.architecture(parent, site, frame)).toThrow();
    const other = new T.Group();
    expect(() => kit.architecture(other, site, frame)).toThrow();
    expect(other.children).toHaveLength(0);
    expect(() =>
      kit.seats(parent, site, [new T.Matrix4().makeScale(-1, 1, 1)], [new T.Color()]),
    ).toThrow();
    expect(kit.diagnostics().sites[0].seats).toBe(0);
    kit.dispose();
    expect(() => kit.architecture(parent, site, frame)).toThrow();
  });
  it('owns each scene allocation and disposes shared buffers and callbacks exactly once', () => {
    const track = new Track('clear'),
      a = new SecondaryGrandstands(track),
      b = new SecondaryGrandstands(track);
    const p = new T.Group(),
      q = new T.Group(),
      site = AUREL_VENUE.grandstands[2],
      frame = standFrame(track, site);
    a.architecture(p, site, frame);
    b.architecture(q, site, frame);
    const am = meshes(p),
      bm = meshes(q);
    const buffers = new Set(am.map((m) => m.geometry));
    let disposed = 0;
    buffers.forEach((g) => g.addEventListener('dispose', () => disposed++));
    am.forEach((m, i) => {
      expect(m.geometry).not.toBe(bm[i].geometry);
      expect(m.geometry.getAttribute('position').array).not.toBe(
        bm[i].geometry.getAttribute('position').array,
      );
    });
    a.dispose();
    a.dispose();
    expect(disposed).toBe(buffers.size);
    expect(p.children).toHaveLength(0);
    expect(meshes(q)).toHaveLength(8);
    expect(a.diagnostics().geometryBuffers).toBe(0);
    b.dispose();
  });
});

describe('A12 authored shape and camera-specific detail', () => {
  it('retains winding, normal correspondence and geometry ownership when mirrored', () => {
    for (const role of SECONDARY_ROLES)
      for (const tier of SECONDARY_TIERS) {
        const a = secondaryStandGeometry(`${role}_${tier}`),
          b = secondaryStandGeometry(`${role}_${tier}`, true);
        const pos = a.getAttribute('position'),
          n = a.getAttribute('normal'),
          index = a.index!;
        const bp = b.getAttribute('position'),
          bn = b.getAttribute('normal'),
          bi = b.index!;
        expect(b.boundingBox!.min.x).toBeCloseTo(-a.boundingBox!.max.x, 5);
        for (let i = 0; i < pos.count; i++) {
          expect(bp.getX(i)).toBeCloseTo(-pos.getX(i), 6);
          expect(bn.getX(i)).toBeCloseTo(-n.getX(i), 6);
        }
        for (let i = 0; i < index.count; i += 3) {
          expect(bi.getX(i)).toBe(index.getX(i));
          expect(bi.getX(i + 1)).toBe(index.getX(i + 2));
          expect(bi.getX(i + 2)).toBe(index.getX(i + 1));
        }
        a.dispose();
        b.dispose();
      }
  });
  it('changes only bounded index ranges and retains real geometry at all three levels', () => {
    for (const role of SECONDARY_ROLES) {
      const p = packSecondaryStandRole(role),
        g = p.geometry,
        index = g.index!.array,
        pos = g.getAttribute('position').array;
      for (const tier of [0, 1, 2, 0, 2, 1, 0] as const) {
        p.select(tier);
        expect(g.drawRange).toEqual(p.ranges[tier]);
        expect(g.drawRange.count).toBeGreaterThan(0);
        expect(g.index!.array).toBe(index);
        expect(g.getAttribute('position').array).toBe(pos);
      }
      expect(p.ranges[2].count).toBeLessThanOrEqual(p.ranges[0].count);
      expect(() => p.select(3 as 0)).toThrow();
      g.dispose();
    }
  });
  it('holds hysteresis and resolves teleports without accepting invalid distances', () => {
    expect(secondaryStandTier(139)).toBe(0);
    expect(secondaryStandTier(150, 0)).toBe(0);
    expect(secondaryStandTier(155, 0)).toBe(1);
    expect(secondaryStandTier(130, 1)).toBe(1);
    expect(secondaryStandTier(125, 1)).toBe(0);
    expect(secondaryStandTier(350, 1)).toBe(1);
    expect(secondaryStandTier(360, 1)).toBe(2);
    expect(secondaryStandTier(10, 2)).toBe(0);
    for (const distance of [-1, NaN, Infinity])
      expect(() => secondaryStandTier(distance)).toThrow();
  });
  it('isolates main, zoom, reflection and shadow histories and restores callbacks', () => {
    const p = packSecondaryStandRole('roof'),
      m = new T.InstancedMesh(p.geometry, new T.MeshStandardMaterial(), 1);
    m.setMatrixAt(0, new T.Matrix4());
    m.computeBoundingBox();
    m.computeBoundingSphere();
    m.updateMatrixWorld(true);
    const original = m.onBeforeRender,
      detach = p.bind(m);
    let height = 720;
    const renderer = {
      getCurrentViewport: (o: T.Vector4) => o.set(0, 0, height === 720 ? 1280 : height, height),
      getDrawingBufferSize: (o: T.Vector2) => o.set(1280, 720),
    } as T.WebGLRenderer;
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(58, 16 / 9, 0.1, 2000);
    camera.position.z = 500;
    camera.updateMatrixWorld(true);
    const observe = (cam: T.Camera, shadow = false) => {
      if (shadow)
        m.onBeforeShadow(renderer, scene, camera, cam, m.geometry, m.material, new T.Group());
      else m.onBeforeRender(renderer, scene, cam, m.geometry, m.material, new T.Group());
      const result = { ...m.geometry.drawRange };
      if (shadow)
        m.onAfterShadow(renderer, scene, camera, cam, m.geometry, m.material, new T.Group());
      else m.onAfterRender(renderer, scene, cam, m.geometry, m.material, new T.Group());
      expect(m.geometry.drawRange).toEqual(p.ranges[0]);
      return result;
    };
    expect(observe(camera)).toEqual(p.ranges[2]);
    const zoom = camera.clone();
    zoom.fov = 10;
    zoom.updateProjectionMatrix();
    expect(observe(zoom)).toEqual(p.ranges[0]);
    const cube = new T.CubeCamera(0.1, 2000, new T.WebGLCubeRenderTarget(64));
    cube.updateMatrixWorld(true);
    height = 64;
    expect(observe(cube.children[0] as T.PerspectiveCamera)).toEqual(p.ranges[0]);
    const shadow = new T.OrthographicCamera(-300, 300, 300, -300, 0.1, 2000);
    shadow.position.z = 500;
    shadow.updateMatrixWorld(true);
    height = 512;
    expect(observe(shadow, true)).toEqual(p.ranges[2]);
    height = 720;
    expect(observe(camera)).toEqual(p.ranges[2]);
    expect(observe(zoom)).toEqual(p.ranges[0]);
    detach();
    expect(m.onBeforeRender).toBe(original);
    cube.renderTarget.dispose();
    m.dispose();
    m.geometry.dispose();
    (m.material as T.Material).dispose();
  });
});
