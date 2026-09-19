import {
  APRON_COLUMNS,
  APRON_SEPARATION_M,
  grassApronLateral,
  grassApronOffset,
} from '../src/rendering/ground-profile.ts';
import { expect, it } from 'vitest';
import { CircuitScene } from '../src/rendering/circuit.ts';
import * as T from 'three';
import { Track, trackPoint, surfaceSample } from '../src/simulation/track.ts';
import {
  barrierGeometry,
  barrierMaterials,
  buildBarrierChunk,
} from '../src/rendering/circuit-barriers.ts';
import { GRANDSTANDS, inStandFootprint, standFrame } from '../src/rendering/grandstand.ts';
import { vegetationPlan } from '../src/rendering/landscape.ts';
import { installCircuitFinish, wireCoverage } from '../src/rendering/circuit-finish.ts';
import { installStableSurfaceBump, installWetRoad } from '../src/rendering/materials.ts';

it('analytically filters thin wires rather than aliasing large diamond cells', () => {
  expect(wireCoverage(0, 0.01)).toBeCloseTo(1, 8);
  expect(wireCoverage(0.5, 0.01)).toBe(0);
  for (const width of [1, 2, 10, 50])
    for (const x of [-8.7, -0.5, 0, 0.4, 12.2])
      expect(wireCoverage(x, width)).toBeCloseTo(0.032, 8);
  for (let i = -200; i <= 200; i++) {
    const x = i * 0.007,
      width = 0.0001 + Math.abs(i) * 0.007;
    expect(wireCoverage(x, width)).toBeGreaterThanOrEqual(0);
    expect(wireCoverage(x, width)).toBeLessThanOrEqual(1);
    expect(wireCoverage(x, width)).toBeCloseTo(wireCoverage(x + 1, width), 8);
  }
});
it.each([NaN, Infinity, 0, -1])('rejects invalid fence footprint %s', (footprint) => {
  expect(() => wireCoverage(0, footprint)).toThrow();
});
it.each([-1, 1])(
  'barrier side %s has outward normals and retains the collision envelope',
  (side) => {
    const track = new Track('clear', true),
      start = 30,
      end = 33.8;
    const g = barrierGeometry(track, start, end, side),
      p = g.getAttribute('position'),
      n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      expect(
        [p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i)].every(Number.isFinite),
      ).toBe(true);
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
      const at = trackPoint(),
        l = track.nearest(p.getX(i), p.getZ(i), at);
      expect(Math.abs(Math.abs(l) - track.boundary(at.s, side))).toBeLessThan(0.277);
      expect(p.getY(i)).toBeGreaterThanOrEqual(-APRON_SEPARATION_M - 0.016);
      expect(p.getY(i)).toBeLessThanOrEqual(0.941);
    }
    expect(n.getY(0)).toBeLessThan(-0.99);
    const outward = new T.Vector3(
      track.at(start, trackPoint()).nx,
      0,
      track.at(start, trackPoint()).nz,
    );
    expect(new T.Vector3(n.getX(4), n.getY(4), n.getZ(4)).dot(outward)).toBeGreaterThan(0.98);
    expect(() => barrierGeometry(track, 4, 3, side)).toThrow();
    g.dispose();
  },
);
it('retains sloping barrier footpoints at both segment endpoints', () => {
  const track = new Track('clear'),
    start = 715,
    end = 718;
  const g = barrierGeometry(track, start, end, 1),
    p = g.getAttribute('position');
  for (const [index, s] of [
    [0, start],
    [2, end],
  ]) {
    const point = track.at(s, trackPoint()),
      l = track.boundary(s, 1) - 0.275;
    expect(p.getY(index)).toBeCloseTo(
      point.y + point.bank * Math.max(-12, Math.min(12, l)) - APRON_SEPARATION_M - 0.015,
      5,
    );
  }
  g.dispose();
});
it('chunks both fences, never restores opaque shadows on transparent wire coverage', () => {
  const track = new Track('clear'),
    root = new T.Group(),
    m = barrierMaterials();
  buildBarrierChunk(track, root, 30, 70, m);
  expect(root.children).toHaveLength(3);
  for (const object of root.children) {
    const o = object as T.Mesh;
    o.geometry.computeBoundingSphere();
    expect(o.geometry.boundingSphere!.radius).toBeLessThan(40);
    if (o.material === m.fence) {
      expect(o.castShadow).toBe(false);
      expect(o.receiveShadow).toBe(false);
    }
    o.geometry.dispose();
  }
  expect(m.fence.depthWrite).toBe(false);
  Object.values(m).forEach((x) => x.dispose());
});
it('composes decorative finish, grazing bump safety and real water without clock uniforms', () => {
  const material = new T.MeshStandardMaterial(),
    state = new T.DataTexture();
  installStableSurfaceBump(material);
  installCircuitFinish(material, 'asphalt');
  installWetRoad(material, state, true);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as T.WebGLProgramParametersWithUniforms, {} as T.WebGLRenderer);
  expect(shader.fragmentShader).toContain('if (abs(fDet) < 1e-7) return surf_norm');
  expect(shader.fragmentShader).toContain('uniform sampler2D trackState');
  expect(shader.fragmentShader).toContain('vec4 roadState = texture2D(trackState, vTrackUV)');
  expect(shader.fragmentShader.match(/varying vec3 vFinishWorld;/g)).toHaveLength(1);
  expect(Object.keys(shader.uniforms)).toEqual(['trackState', 'surfaceDeposits']);
  material.dispose();
  state.dispose();
});
it('shares the structural footprint with vegetation and leaves racing and pit corridors clear', () => {
  const track = new Track('clear'),
    p = trackPoint();
  for (const site of GRANDSTANDS) {
    const frame = standFrame(track, site);
    expect([frame.x, frame.y, frame.z, frame.yaw].every(Number.isFinite)).toBe(true);
    expect(inStandFootprint(track, frame.x, frame.z)).toBe(true);
    for (const u of [-2, 5, 11])
      for (let v = -site.length / 2; v <= site.length / 2; v += 4) {
        const x = frame.x + Math.cos(frame.yaw) * site.side * u + Math.sin(frame.yaw) * v,
          z = frame.z - Math.sin(frame.yaw) * site.side * u + Math.cos(frame.yaw) * v;
        const l = track.nearest(x, z, p);
        expect(Math.abs(l) - track.boundary(p.s, l < 0 ? -1 : 1)).toBeGreaterThan(4);
      }
  }
  for (const tree of vegetationPlan(track))
    expect(inStandFootprint(track, tree.x, tree.z, 8)).toBe(false);
});

it('keeps all reachable apron strips on the contact plane and reserves falloff for beyond the wall', () => {
  const track = new Track('clear');
  for (let s = 0; s < track.length; s += 17)
    for (const side of [-1, 1]) {
      const boundary = track.boundary(s, side);
      for (const lateral of [0, side * (boundary - 0.5), side * (boundary + 0.99)])
        expect(grassApronOffset(track, s, lateral)).toBe(-APRON_SEPARATION_M);
      expect(grassApronOffset(track, s, side * (boundary + 3))).toBeCloseTo(
        -APRON_SEPARATION_M - 0.09,
        10,
      );
      const epsilon = 0.00001;
      expect(
        Math.abs(
          grassApronOffset(track, s, side * (boundary + 1 + epsilon)) -
            grassApronOffset(track, s, side * (boundary + 1 - epsilon)),
        ),
      ).toBeLessThan(0.000001);
    }
  expect(() => grassApronOffset(track, NaN, 1)).toThrow();
  expect(() => grassApronOffset(track, 1, Infinity)).toThrow();
});
it('agrees with sampled wheel-contact height on the reachable grass and embeds the barrier footing', () => {
  const track = new Track('clear'),
    contact = surfaceSample();
  for (const s of [30, 120, 715, 1000, 1500, 2100, 2800])
    for (const side of [-1, 1]) {
      const point = track.at(s, trackPoint()),
        lateral = side * (track.boundary(s, side) - 0.4);
      const x = point.x + point.nx * lateral,
        z = point.z + point.nz * lateral;
      track.sample(x, z, contact);
      const shown =
        point.y +
        point.bank * Math.max(-12, Math.min(12, lateral)) +
        grassApronOffset(track, s, lateral);
      expect(Math.abs(contact.height - shown)).toBeLessThan(0.047);
      const wall = barrierGeometry(track, s, s + 0.8, side),
        positions = wall.getAttribute('position');
      // Every bottom end of this profile is 15 mm below the displayed grass.
      for (const i of [0, 1, 2, 3]) {
        const near = trackPoint(),
          l = track.nearest(positions.getX(i), positions.getZ(i), near);
        const ground =
          near.y + near.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, near.s, l);
        expect(ground - positions.getY(i)).toBeGreaterThan(0.008);
        expect(ground - positions.getY(i)).toBeLessThan(0.023);
      }
      wall.dispose();
    }
});

it('keeps actual apron triangles beneath both barrier footings and below the gravel overlay', () => {
  const track = new Track('clear'),
    surface = surfaceSample();
  const scene = Object.assign(Object.create(CircuitScene.prototype), {
    track,
    group: new T.Group(),
  }) as CircuitScene;
  for (const start of [120, 715, 1500, 2100]) {
    const material = new T.MeshStandardMaterial({ side: T.DoubleSide });
    const strip = scene.ribbon(material, {
      start,
      end: start + 4,
      step: 1,
      columns: APRON_COLUMNS,
      offset: (s, t) => grassApronLateral(track, s, t, track.at(s, trackPoint()).width),
      height: (s, l) => grassApronOffset(track, s, l),
    });
    strip.updateMatrixWorld(true);
    for (const s of [start + 0.31, start + 1.7, start + 3.8])
      for (const side of [-1, 1]) {
        const p = track.at(s, trackPoint());
        for (const lateral of [
          side * 12.7,
          side * (track.boundary(s, side) - 0.3),
          side * (track.boundary(s, side) + 0.3),
        ]) {
          const x = p.x + p.nx * lateral,
            z = p.z + p.nz * lateral;
          track.sample(x, z, surface);
          const ray = new T.Raycaster(
            new T.Vector3(x, surface.height + 10, z),
            new T.Vector3(0, -1, 0),
          );
          const hits = ray.intersectObject(strip);
          expect(hits.length).toBeGreaterThan(0);
          const shown = hits[0].point.y;
          expect(surface.height - shown).toBeLessThan(0.047);
          expect(surface.height - shown).toBeGreaterThan(0.028);
        }
      }
    strip.geometry.dispose();
    material.dispose();
    scene.group.remove(strip);
  }
});
