import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { sculptedLoft } from '../src/rendering/bodywork.ts';
import {
  POD_SECTIONS,
  POD_OPENINGS,
  NOSE_SECTIONS,
  ENGINE_SECTIONS,
  bodySurface,
  bodySurfacePatch,
  suspensionMount,
} from '../src/rendering/car-surfaces.ts';
import { harnessRibbon } from '../src/rendering/driver-anatomy.ts';
import { installPaintFinish } from '../src/rendering/paint-finish.ts';
import { RearSignalField, rearSignalIntensity } from '../src/rendering/rear-signal.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { circuitLightState, daylightState } from '../src/rendering/daylight.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { serviceSitePlan, inServiceFootprint } from '../src/rendering/venue-service-plan.ts';
import { buildServiceAreas, serviceAccessGeometry } from '../src/rendering/venue-service.ts';
import {
  broadcastRadius,
  TracksideDirector,
  tracksideRigs,
  BROADCAST_STYLES,
} from '../src/rendering/trackside.ts';
const track = new Track();
function frame(cars = 2) {
  const f = new Float32Array(HEADER + cars * CAR_STRIDE);
  f[H.CARS] = cars;
  f[H.TIME] = 10;
  for (let i = 0; i < cars; i++) f[carBase(i) + F.QW] = 1;
  return f;
}
describe('Phase 27E original close-distance surfaces', () => {
  it('builds eight real open cooling slots with explicit edges, not a black decal', () => {
    const g = sculptedLoft(POD_SECTIONS, 0.58, 0.65, POD_OPENINGS);
    const p = g.getAttribute('position'),
      uv = g.getAttribute('uv'),
      idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const ids = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
      const z = ids.reduce((sum, n) => sum + p.getZ(n), 0) / 3;
      if (z <= POD_SECTIONS[0][0] + 1e-6 || z >= POD_SECTIONS.at(-1)![0] - 1e-6) continue;
      const u = ids.reduce((sum, n) => sum + uv.getX(n), 0) / 3;
      expect(
        POD_OPENINGS.some(
          (h) => z > h.z0 + 1e-6 && z < h.z1 - 1e-6 && u > h.u0 + 1e-6 && u < h.u1 - 1e-6,
        ),
      ).toBe(false);
    }
    for (const h of POD_OPENINGS)
      for (const z of [h.z0, h.z1])
        expect(
          Array.from({ length: p.count }, (_, i) => p.getZ(i)).some((v) => Math.abs(v - z) < 1e-6),
        ).toBe(true);
    expect(POD_OPENINGS).toHaveLength(8);
    expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
    g.dispose();
  });
  it('conformal patch vertices and inboard suspension mounts follow the actual shell', () => {
    const area = { z0: 0.7, z1: 0.815, u0: 0.365, u1: 0.635 },
      g = bodySurfacePatch(NOSE_SECTIONS, area, 0, 0.32, 0.0015);
    const p = g.getAttribute('position'),
      uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      const expected = bodySurface(
        NOSE_SECTIONS,
        area.z0 + (area.z1 - area.z0) * uv.getY(i),
        area.u0 + (area.u1 - area.u0) * (1 - uv.getX(i)),
        0,
        0.32,
        0.0015,
      );
      expect(new T.Vector3().fromBufferAttribute(p, i).distanceTo(expected)).toBeLessThan(1e-6);
    }
    for (const x of [-0.83, 0.83])
      for (const z of [-1.62, 1.82])
        for (const dy of [-0.1, 0.1])
          for (const dz of [-0.25, 0.25]) {
            const mount = suspensionMount(x, z, dy, dz),
              u = x > 0 ? (dy > 0 ? 0.29 : 0.22) : dy > 0 ? 0.71 : 0.78;
            expect(
              mount.distanceTo(
                bodySurface(
                  z > 0 ? NOSE_SECTIONS : ENGINE_SECTIONS,
                  z + dz,
                  u,
                  0,
                  z > 0 ? 0.32 : 0.18,
                  0.002,
                ),
              ),
            ).toBe(0);
            expect(Math.sign(mount.x)).toBe(Math.sign(x));
          }
    g.dispose();
  });
  it('shares authored envelopes through near, mid and far body tessellation', () => {
    for (const [sections, undercut, flatten] of [
      [NOSE_SECTIONS, 0, 0.32],
      [POD_SECTIONS, 0.58, 0.65],
      [ENGINE_SECTIONS, 0, 0.18],
    ] as const) {
      const levels = ['high', 'mid', 'far'].map((detail) =>
        sculptedLoft(sections, undercut, flatten, [], detail as 'high' | 'mid' | 'far'),
      );
      for (const geometry of levels) {
        const positions = geometry.getAttribute('position');
        for (const section of sections)
          for (const u of [0, 0.25, 0.5, 0.75]) {
            const target = bodySurface(sections, section[0], u, undercut, flatten);
            expect(
              Array.from({ length: positions.count }, (_, i) =>
                new T.Vector3().fromBufferAttribute(positions, i).distanceTo(target),
              ).some((distance) => distance < 1e-6),
            ).toBe(true);
          }
      }
      expect(levels[2].index!.count).toBeLessThan(levels[1].index!.count);
      expect(levels[1].index!.count).toBeLessThan(levels[0].index!.count);
      levels.forEach((geometry) => geometry.dispose());
    }
  });
  it('rejects invalid openings, surface coordinates and excessive subdivisions', () => {
    expect(() => sculptedLoft(POD_SECTIONS, 0, 0, [{ z0: -2, z1: 0, u0: 0.4, u1: 0.6 }])).toThrow();
    expect(() => bodySurface(NOSE_SECTIONS, 1, NaN)).toThrow();
    expect(() =>
      bodySurfacePatch(NOSE_SECTIONS, { z0: 1, z1: 2, u0: 0.4, u1: 0.6 }, 0, 0, 0, 1000),
    ).toThrow();
  });
  it('makes closed thin webbing that stays finite even along a horizontal tangent', () => {
    for (const points of [
      [new T.Vector3(0, 0, 0), new T.Vector3(1, 0, 0)],
      [new T.Vector3(0, 1, 0), new T.Vector3(0.02, 0.5, 0.1), new T.Vector3(0.05, 0, 0)],
    ]) {
      const g = harnessRibbon(points, 0.044);
      g.computeBoundingBox();
      expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      expect(g.index!.count).toBeGreaterThan(100);
      expect(g.boundingBox!.isEmpty()).toBe(false);
      g.dispose();
    }
    expect(() => harnessRibbon([new T.Vector3(), new T.Vector3(0, 1, 0)], -1)).toThrow();
  });
  it('chains the existing material compiler once and adds no texture or time uniforms', () => {
    const material = new T.MeshPhysicalMaterial();
    let called = 0;
    material.onBeforeCompile = () => {
      called++;
    };
    installPaintFinish(material);
    const key = material.customProgramCacheKey();
    installPaintFinish(material);
    expect(material.customProgramCacheKey()).toBe(key);
    const shader = {
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <roughnessmap_fragment>',
      uniforms: {},
    };
    material.onBeforeCompile(shader as T.WebGLProgramParametersWithUniforms, {} as T.WebGLRenderer);
    expect(called).toBe(1);
    expect(shader.fragmentShader).toContain('dFdx');
    expect(shader.uniforms).toEqual({});
    expect(material.map).toBeNull();
    material.dispose();
  });
});
describe('Phase 27E snapshot-connected lights and broadcast', () => {
  it('rear spray lighting is tied to actual lamp positions, brake signal and simulation time', () => {
    const f = frame(),
      before = f.slice(),
      field = new RearSignalField();
    field.update(f);
    expect(field.count.value).toBe(2);
    expect(field.positions[0].toArray()).toEqual([0, -0.23, -2.28, rearSignalIntensity(0, 10)]);
    expect(field.directions[0].toArray()).toEqual([0, 0, -1]);
    const held = field.positions.map((p) => p.toArray());
    field.update(f);
    expect(field.positions.map((p) => p.toArray())).toEqual(held);
    expect(f).toEqual(before);
    f[carBase(1) + F.X] = 30;
    f[carBase(1) + F.BRAKE] = 0.8;
    field.update(f);
    expect(field.positions[1].x).toBe(30);
    expect(field.positions[1].w).toBe(2.5);
    field.update(f, false);
    expect(field.count.value).toBe(0);
    field.update(before);
    expect(field.positions.map((p) => p.toArray())).toEqual(held);
  });
  it('resets light count before rejecting an invalid pose', () => {
    const field = new RearSignalField(),
      f = frame();
    field.update(f);
    f[carBase(0) + F.QW] = 0;
    expect(() => field.update(f)).toThrow(/orientation/);
    expect(field.count.value).toBe(0);
    expect(() => field.update(new Float32Array(2))).toThrow();
    expect(rearSignalIntensity(NaN, 1)).toBe(0);
  });
  it('widens smoothly for nearby cars and preserves the existing fixed camera sites', () => {
    const f = frame();
    f[carBase(1) + F.X] = 8;
    expect(broadcastRadius(f, 0)).toBeCloseTo(11.1);
    f[carBase(1) + F.X] = 15.99;
    const near = broadcastRadius(f, 0);
    f[carBase(1) + F.X] = 16.01;
    expect(Math.abs(near - broadcastRadius(f, 0))).toBeLessThan(0.001);
    f[carBase(1) + F.X] = 8;
    f[carBase(1) + F.IN_PIT] = 1;
    expect(broadcastRadius(f, 0)).toBe(3.1);
    for (const rig of tracksideRigs(track)) {
      expect(rig.trackingHz).toBe(BROADCAST_STYLES[rig.shot].panHz);
      expect(rig.zoomHz).toBe(BROADCAST_STYLES[rig.shot].zoomHz);
    }
    const d = new TracksideDirector(track),
      p = track.at(0, trackPoint()),
      target = new T.Vector3(p.x, p.y + 0.5, p.z);
    d.update(0, target, new T.Vector3(0, 0, 20), 1 / 60, 16 / 9, 11.1);
    const held = {
      position: d.position.toArray(),
      gaze: d.gaze.toArray(),
      fov: d.fov,
      cuts: d.cuts,
    };
    d.update(0, target, new T.Vector3(0, 0, 20), 0, 16 / 9, 11.1);
    expect({
      position: d.position.toArray(),
      gaze: d.gaze.toArray(),
      fov: d.fov,
      cuts: d.cuts,
    }).toEqual(held);
  });
  it('leaves daylight identical and bounds continuous wet-night grading', () => {
    for (let i = 0; i <= 100; i++) {
      const cloud = i / 100,
        rain = cloud * 60;
      expect(circuitLightState(cloud, rain, false)).toEqual(daylightState(cloud, rain));
      const a = circuitLightState(cloud, rain, true),
        b = circuitLightState(cloud, Math.min(60, rain + 0.001), true);
      expect(a.exposure).toBeGreaterThanOrEqual(1);
      expect(a.fill).toBeLessThan(0.25);
      expect(Math.abs(a.exposure - b.exposure)).toBeLessThanOrEqual(0.00000101);
    }
  });
});
describe('Phase 27E venue access remains inside the original budgets', () => {
  it('grounds six full-width spurs and batches their detail without increasing the gates', () => {
    const sites = serviceSitePlan(track),
      root = new T.Group();
    expect(sites).toHaveLength(6);
    buildServiceAreas(root, sites);
    let triangles = 0,
      meshes = 0;
    root.traverse((o) => {
      if (o instanceof T.Mesh) {
        meshes++;
        triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3;
      }
    });
    expect(meshes).toBeLessThanOrEqual(48);
    expect(triangles).toBeLessThanOrEqual(28000);
    for (const site of sites) {
      expect(site.access).toHaveLength(17);
      const g = serviceAccessGeometry(site),
        n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeGreaterThan(0.99);
      for (let i = 0; i < site.access!.length; i++) {
        const p = site.access![i];
        expect(inServiceFootprint(sites, p.x, p.z)).toBe(true);
        if (i) expect(Math.abs(p.y - site.access![i - 1].y)).toBeLessThanOrEqual(0.120001);
        for (const offset of [-1.7, 0, 1.7]) {
          const t = trackPoint(),
            x = p.x + Math.cos(site.yaw) * offset,
            z = p.z - Math.sin(site.yaw) * offset;
          const lateral = track.nearest(x, z, t);
          expect(
            Math.abs(lateral) - track.boundary(t.s, lateral < 0 ? -1 : 1),
          ).toBeGreaterThanOrEqual(6);
        }
      }
      g.dispose();
    }
    root.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  });
});
