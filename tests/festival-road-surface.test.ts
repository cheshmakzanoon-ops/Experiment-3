import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { trackPoint } from '../src/simulation/track.ts';
import type { RoadEdge } from '../src/simulation/open-world/road-network.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { materials, surfaceWeather } from '../src/rendering/materials/index.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import {
  FestivalRoadFrame,
  festivalRoadProfile,
  installFestivalRoadSurface,
} from '../src/rendering/open-world/festival-road-surface.ts';
import { RoadMeshes } from '../src/rendering/open-world/roads.ts';

const world = openWorld();
const net = world.network;

function position(edge: RoadEdge, station: number, lateral: number, shoulder = false) {
  const p = trackPoint();
  net.at(edge.offset + station, p);
  const spec = edge.spec;
  let y = net.surfaceHeight(p, lateral, spec.halfWidth, spec.crown);
  if (shoulder)
    y -=
      0.005 +
      ((Math.abs(lateral) - spec.halfWidth) / spec.shoulder) * (0.055 + spec.shoulder * 0.03);
  return new T.Vector3(p.x + p.nx * lateral, y, p.z + p.nz * lateral);
}

describe('Festival road geometry frames', () => {
  it('lights grade, crown and changing bank perpendicular to the actual road surface', () => {
    let grades = 0,
      banks = 0;
    const p = trackPoint();
    for (const e of net.edges) {
      const frame = new FestivalRoadFrame(net, e);
      for (const fraction of [0.2, 0.5, 0.8]) {
        const s = e.length * fraction;
        net.at(e.offset + s, p);
        for (const side of [-1, 1]) {
          const l = e.spec.halfWidth * 0.63 * side;
          const n = frame.normal(p, l).clone();
          const along = position(e, s + 0.5, l)
            .sub(position(e, s - 0.5, l))
            .normalize();
          const across = position(e, s, l + 0.02)
            .sub(position(e, s, l - 0.02))
            .normalize();
          expect(n.length()).toBeCloseTo(1, 10);
          expect(n.y).toBeGreaterThan(0.8);
          expect(Math.abs(n.dot(along))).toBeLessThan(1e-6);
          expect(Math.abs(n.dot(across))).toBeLessThan(1e-6);
          if (Math.abs(p.gradient) > 0.035) grades++;
          if (Math.abs(p.bank) > 0.03) banks++;
        }
      }
    }
    // Ensure this exercises real climbs and banked turns, not flat fixtures.
    expect(grades).toBeGreaterThan(50);
    expect(banks).toBeGreaterThan(20);
  });

  it('gives falling shoulders their own normal and stays finite at edge endpoints', () => {
    const p = trackPoint();
    for (const road of ['town', 'mountain', 'highway', 'dirt', 'runway']) {
      const e = net.edges.find((edge) => edge.roadClass === road)!;
      const frame = new FestivalRoadFrame(net, e);
      const s = e.length * 0.42;
      net.at(e.offset + s, p);
      for (const side of [-1, 1]) {
        const l = side * (e.spec.halfWidth + e.spec.shoulder * 0.5);
        const n = frame.normal(p, l, true).clone();
        const along = position(e, s + 0.5, l, true)
          .sub(position(e, s - 0.5, l, true))
          .normalize();
        const across = position(e, s, l + 0.02, true)
          .sub(position(e, s, l - 0.02, true))
          .normalize();
        expect(Math.abs(n.dot(along))).toBeLessThan(1e-6);
        expect(Math.abs(n.dot(across))).toBeLessThan(1e-6);
        expect(n.y).toBeGreaterThan(0.8);
      }
      for (const [segment, t] of [
        [e.first, 0],
        [e.last - 1, 1],
      ]) {
        net.pointOnSegment(segment, t, p);
        const n = frame.normal(p, e.spec.halfWidth * 0.6);
        expect(n.toArray().every(Number.isFinite)).toBe(true);
        expect(n.length()).toBeCloseTo(1, 10);
        expect(n.y).toBeGreaterThan(0.8);
      }
    }
  });
});

describe('Festival lane and junction metadata', () => {
  it('uses real lane pitches, separates edge seeds and leaves the runway without road wheel paths', () => {
    const identities = new Set<number>();
    for (const edge of net.edges) {
      const a = festivalRoadProfile(net, edge, edge.length / 2);
      expect(a).toEqual(festivalRoadProfile(net, edge, edge.length / 2));
      expect(a[0]).toBe(edge.spec.halfWidth);
      expect(a[1]).toBe(
        edge.roadClass === 'runway' || edge.roadClass === 'circuit'
          ? 0
          : edge.spec.halfWidth / (edge.roadClass === 'highway' ? 2 : 1),
      );
      expect(a[3]).toBeGreaterThanOrEqual(0);
      expect(a[3]).toBeLessThanOrEqual(1);
      identities.add(a[2]);
    }
    expect(identities.size).toBe(net.edges.length);
  });

  it('removes lane wear from junction mouths with a continuous transition', () => {
    const edge = net.edges.find((e) => net.nodes[e.from].edges.length >= 3 && e.length > 100)!;
    const mouth = edge.spec.halfWidth + 9;
    const samples = [0, mouth, mouth + 1, mouth + 3, mouth + 5, mouth + 6].map(
      (s) => festivalRoadProfile(net, edge, s)[3],
    );
    expect(samples.slice(0, 2)).toEqual([0, 0]);
    expect(samples[3]).toBeCloseTo(0.5, 10);
    expect(samples.at(-1)).toBe(1);
    expect(samples).toEqual([...samples].sort((a, b) => a - b));
  });
});

describe('Festival surfacing integration', () => {
  it('retains existing weather and scan-compatible texture slots, with isolated per-material age', () => {
    const a = materials.asphalt({ variant: 'worn' });
    const b = materials.asphalt({ variant: 'fresh' });
    const maps = [a.map, a.normalMap, a.roughnessMap, a.aoMap];
    const compile = (material: T.Material) => {
      const shader = {
        uniforms: {},
        vertexShader: T.ShaderLib.physical.vertexShader,
        fragmentShader: T.ShaderLib.physical.fragmentShader,
      } as unknown as T.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as T.WebGLRenderer);
      return shader;
    };
    try {
      expect(installFestivalRoadSurface(a, 0.9)).toBe(true);
      expect(installFestivalRoadSurface(a, 0.9)).toBe(false);
      expect(installFestivalRoadSurface(b, 0.32)).toBe(true);
      expect([a.map, a.normalMap, a.roughnessMap, a.aoMap]).toEqual(maps);
      const sa = compile(a),
        sb = compile(b);
      expect(sa.uniforms.apexSurfaceWetness).toBe(surfaceWeather.apexSurfaceWetness);
      expect(sa.uniforms.festivalSurfaceAge.value).toBe(0.9);
      expect(sb.uniforms.festivalSurfaceAge.value).toBe(0.32);
      expect(sa.uniforms.festivalSurfaceAge).not.toBe(sb.uniforms.festivalSurfaceAge);
      expect(studioHookKeys(a).filter((key) => key === 'festival-road-surface-v1')).toHaveLength(1);
      expect(a.customProgramCacheKey()).toContain('library-wet-surface-v1');
      expect(a.customProgramCacheKey()).toContain('festival-road-surface-v1');
      // Clearcoat consumes the drainage-modified puddle after the original
      // weather sample. A reordering would silently detach it from rain.
      const f = sa.fragmentShader;
      expect(f.indexOf('apexPuddle *=')).toBeGreaterThan(f.indexOf('apexPuddle = wet'));
      expect(f.indexOf('apexPuddle *=')).toBeLessThan(f.indexOf('material.clearcoatRoughness'));
      expect(f).toContain('fwidth(q)');
      expect(sa.vertexShader).toContain('vFestivalRoadMetres = uv;');
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  it('rejects incomplete material contracts instead of producing a broken road shader', () => {
    const material = new T.MeshPhysicalMaterial();
    expect(() => installFestivalRoadSurface(material, NaN)).toThrow(RangeError);
    expect(() => installFestivalRoadSurface(material, 2)).toThrow(RangeError);
    expect(() => installFestivalRoadSurface(material, 0.5)).toThrow(/wet-surface/);
    material.dispose();
  });

  it('builds the real network with complete road data, finite normals and tilted paint', () => {
    const roads = new RoadMeshes(net, world.field);
    let roadVertices = 0,
      tilted = 0,
      tiltedPaint = 0,
      runwayVertices = 0,
      invalidWidths = 0,
      invalidNormals = 0,
      largestLengthError = 0,
      lowestUp = 1;
    try {
      roads.root.traverse((object) => {
        if (!(object instanceof T.Mesh) || object instanceof T.InstancedMesh) return;
        const geometry = object.geometry;
        const normal = geometry.getAttribute('normal');
        const data = geometry.getAttribute('festivalRoadData');
        const surface =
          object.material === roads.materials.asphalt ||
          object.material === roads.materials.asphaltMajor ||
          object.material === roads.materials.town;
        if (!surface && !object.name.startsWith('paint ') && !object.name.startsWith('yellow '))
          return;
        if (surface) {
          expect(data).toBeDefined();
          expect(data.count).toBe(geometry.getAttribute('position').count);
          roadVertices += data.count;
          for (let i = 0; i < data.count; i++) {
            if (!(data.getX(i) > 0)) invalidWidths++;
            if (data.getY(i) === 0) runwayVertices++;
          }
        }
        for (let i = 0; i < normal.count; i++) {
          const x = normal.getX(i),
            y = normal.getY(i),
            z = normal.getZ(i);
          if (!Number.isFinite(x + y + z)) invalidNormals++;
          largestLengthError = Math.max(largestLengthError, Math.abs(Math.hypot(x, y, z) - 1));
          lowestUp = Math.min(lowestUp, y);
          if (Math.hypot(x, z) > 0.025) {
            if (surface) tilted++;
            else tiltedPaint++;
          }
        }
      });
      expect(roadVertices).toBeGreaterThan(50000);
      expect(tilted).toBeGreaterThan(10000);
      expect(tiltedPaint).toBeGreaterThan(10000);
      expect(runwayVertices).toBeGreaterThan(1000);
      expect(invalidWidths).toBe(0);
      expect(invalidNormals).toBe(0);
      expect(largestLengthError).toBeLessThan(1e-6);
      expect(lowestUp).toBeGreaterThan(0.8);
    } finally {
      roads.dispose();
    }
  }, 30000);
});
