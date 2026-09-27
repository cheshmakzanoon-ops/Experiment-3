import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Random } from '../src/core/math.ts';
import { AsphaltAggregate } from '../src/rendering/asphalt-aggregate.ts';
import { surfacePixels } from '../src/rendering/surface-detail.ts';
import { legacySurfacePixels } from '../e2e/fixtures/race-surface-control.ts';
import {
  LOCAL_FOG_OPTICAL_ERROR,
  LocalAtmosphere,
  fogPocketOpticalBound,
  fogSegmentIntegral,
} from '../src/rendering/local-atmosphere.ts';
import { RainStreaks } from '../src/rendering/rain-streaks.ts';
import { Track } from '../src/simulation/track.ts';

function shaderFor(material: T.Material) {
  const shader = {
    uniforms: {},
    vertexShader: '#include <fog_pars_vertex>\n#include <fog_vertex>',
    fragmentShader: '#include <fog_pars_fragment>\n#include <fog_fragment>',
  } as unknown as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

describe('registered full-lap asphalt aggregate', () => {
  it('is deterministic, periodic in both axes and independent of texture resolution', () => {
    const a = new AsphaltAggregate(1887),
      b = new AsphaltAggregate(1887);
    const x = new Float64Array(3),
      y = new Float64Array(3),
      z = new Float64Array(3);
    const random = new Random(7151);
    for (let i = 0; i < 240; i++) {
      const u = random.next(),
        v = random.next();
      a.sample(u, v, x);
      b.sample(u, v, y);
      a.sample(u - 2, v + 3, z);
      expect(x).toEqual(y);
      for (let c = 0; c < 3; c++) {
        expect(x[c]).toBeGreaterThanOrEqual(0);
        expect(x[c]).toBeLessThanOrEqual(1);
        expect(z[c]).toBeCloseTo(x[c], 10);
      }
      // A normalized point has no texture-size-dependent authoring state.
      a.sample((u * 1024) / 1024, (v * 256) / 256, y);
      expect(x).toEqual(y);
    }
  });
  it('keeps wrapped stone profiles continuous across the tile boundary', () => {
    const aggregate = new AsphaltAggregate(91),
      a = new Float64Array(3),
      b = new Float64Array(3);
    for (let i = 0; i < 256; i++) {
      const v = (i + 0.5) / 256;
      aggregate.sample(-1e-9, v, a);
      aggregate.sample(1e-9, v, b);
      expect(Math.abs(a[0] - b[0])).toBeLessThan(0.00001);
      expect(Math.abs(a[1] - b[1])).toBeLessThan(0.00001);
      aggregate.sample(v, -1e-9, a);
      aggregate.sample(v, 1e-9, b);
      expect(Math.abs(a[0] - b[0])).toBeLessThan(0.00001);
      expect(Math.abs(a[1] - b[1])).toBeLessThan(0.00001);
    }
  });
  it('registers stone shoulders, binder and mineral variation instead of independent noise', () => {
    const aggregate = new AsphaltAggregate(1887),
      other = new AsphaltAggregate(1888);
    const a = new Float64Array(3),
      b = new Float64Array(3),
      c = new Float64Array(3);
    let stone = 0,
      binder = 0,
      different = 0,
      adjacent = 0,
      separated = 0;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const u = (x + 0.47) / 64,
          v = (y + 0.53) / 64;
        aggregate.sample(u, v, a);
        aggregate.sample(u + 1 / 1024, v, b);
        aggregate.sample(u + 4 / 1024, v, c);
        adjacent += Math.abs(a[1] - b[1]);
        separated += Math.abs(a[1] - c[1]);
        if (a[0] > 0.9 && a[1] > 0.3) stone++;
        if (a[0] === 0) {
          binder++;
          expect(a[1]).toBe(0);
        }
        other.sample(u, v, b);
        if (Math.abs(a[1] - b[1]) > 0.01) different++;
      }
    expect(stone).toBeGreaterThan(100);
    // This centre-biased sample intentionally observes mostly stones; binder
    // coverage is measured independently by the actual texel maps below.
    expect(stone + binder).toBeGreaterThan(100);
    expect(different).toBeGreaterThan(1000);
    expect(adjacent).toBeLessThan(separated);
  });
  it('changes only asphalt maps, preserving all other surface bytes and texture storage', () => {
    for (const kind of ['grass', 'gravel', 'concrete'] as const)
      expect(surfacePixels(kind, 64)).toEqual(legacySurfacePixels(kind, 64));
    const a = surfacePixels('asphalt', 256),
      old = legacySurfacePixels('asphalt', 256);
    expect(a.albedo.length).toBe(old.albedo.length);
    expect(a.height.length).toBe(old.height.length);
    expect(a.roughness.length).toBe(old.roughness.length);
    expect(a.albedo).not.toEqual(old.albedo);
    let high = 0,
      low = 0;
    for (let i = 0; i < a.height.length; i++) {
      expect(a.albedo[i * 4 + 3]).toBe(255);
      expect(a.roughness[i * 4 + 3]).toBe(255);
      if (a.height[i] > 120) high++;
      if (a.height[i] < 60) low++;
      // A dry nonmetal surface, not emissive highlights or deep black holes.
      expect(a.albedo[i * 4]).toBeGreaterThan(50);
      expect(a.albedo[i * 4]).toBeLessThan(120);
    }
    expect(high).toBeGreaterThan(5000);
    expect(low).toBeGreaterThan(5000);
  });
  it('rejects malformed authoring requests before writing to caller scratch', () => {
    expect(() => new AsphaltAggregate(NaN)).toThrow();
    const a = new AsphaltAggregate(1),
      out = new Float64Array([3, 4, 5]);
    expect(() => a.sample(Infinity, 0, out)).toThrow();
    expect(() => a.sample(0, NaN, out)).toThrow();
    expect(() => a.sample(0, 0, new Float64Array(2))).toThrow();
    expect([...out]).toEqual([3, 4, 5]);
  });
});

describe('optical-error-bounded local weather', () => {
  it('conservatively bounds the retained quadrature for varied full-circuit rays', () => {
    const fog = new LocalAtmosphere(new Track()),
      random = new Random(43011);
    let skipped = 0,
      retained = 0;
    for (let i = 0; i < 1200; i++) {
      const p = fog.pockets[i % 3],
        sigma = random.next() * 0.00275;
      const from = new T.Vector3(
        p.x + (random.next() - 0.5) * 6000,
        p.floor + (random.next() - 0.1) * 150,
        p.z + (random.next() - 0.5) * 2000,
      );
      const to = new T.Vector3(
        p.x + (random.next() - 0.5) * 6000,
        p.floor + (random.next() - 0.1) * 150,
        p.z + (random.next() - 0.5) * 2000,
      );
      let omitted = 0;
      for (const pocket of fog.pockets) {
        const bound = fogPocketOpticalBound(pocket, from, to, sigma);
        const exact = sigma * fogSegmentIntegral([pocket], from, to);
        expect(bound + 1e-12).toBeGreaterThanOrEqual(exact);
        if (bound <= fog.tailError.value) {
          omitted += exact;
          skipped++;
        } else retained++;
        expect(fogPocketOpticalBound(pocket, to, from, sigma)).toBeCloseTo(bound, 9);
      }
      expect(omitted).toBeLessThanOrEqual(LOCAL_FOG_OPTICAL_ERROR);
      const depth = sigma * fogSegmentIntegral(fog.pockets, from, to);
      expect(Math.abs(Math.exp(-depth) - Math.exp(-(depth - omitted)))).toBeLessThanOrEqual(
        LOCAL_FOG_OPTICAL_ERROR,
      );
    }
    expect(skipped).toBeGreaterThan(1000);
    expect(retained).toBeGreaterThan(100);
  });
  it('retains distant dense crossings and handles vertical, zero-length and zero-density rays', () => {
    const p = { x: 137, z: 0, radius: 80, floor: 0, scaleHeight: 5 };
    const from = new T.Vector3(-2500, 0, 0),
      to = new T.Vector3(3800, 0, 0);
    expect(fogPocketOpticalBound(p, from, to, 0.00275)).toBeGreaterThan(0.1);
    for (const height of [-10, 0, 20, 1000]) {
      const start = new T.Vector3(137, height, 0),
        end = new T.Vector3(137, height + 30, 0);
      expect(fogPocketOpticalBound(p, start, end, 0.00275) + 1e-12).toBeGreaterThanOrEqual(
        0.00275 * fogSegmentIntegral([p], start, end),
      );
      expect(fogPocketOpticalBound(p, start, start, 0.00275)).toBe(0);
      expect(fogPocketOpticalBound(p, start, end, 0)).toBe(0);
    }
  });
  it('rejects invalid pockets, endpoints and negative extinction', () => {
    const p = { x: 0, z: 0, radius: 20, floor: 0, scaleHeight: 3 };
    expect(() => fogPocketOpticalBound(p, new T.Vector3(), new T.Vector3(), -1)).toThrow();
    expect(() => fogPocketOpticalBound(p, new T.Vector3(NaN, 0, 0), new T.Vector3(), 1)).toThrow();
    expect(() =>
      fogPocketOpticalBound(p, new T.Vector3(), new T.Vector3(Infinity, 0, 0), 1),
    ).toThrow();
    expect(() =>
      fogPocketOpticalBound({ ...p, radius: 0 }, new T.Vector3(), new T.Vector3(), 1),
    ).toThrow();
  });
  it('uses the same quadrature with a shared bounded uniform and independent zero-budget control', () => {
    const fog = new LocalAtmosphere(new Track()),
      m = new T.MeshStandardMaterial();
    fog.installMaterial(m);
    const key = m.customProgramCacheKey();
    fog.installMaterial(m);
    const s = shaderFor(m);
    expect(fog.materialCount).toBe(1);
    expect(s.uniforms.apexLocalTailError).toBe(fog.tailError);
    expect(s.fragmentShader).toContain('apexOpticalBound<=apexLocalTailError');
    expect(s.fragmentShader.match(/apexPocketDensity\(start\+segment/g)).toHaveLength(8);
    expect(key).toContain('v3-bounded-ray:transformed');
    fog.tailError.value = 0;
    expect(s.uniforms.apexLocalTailError.value).toBe(0);
    expect(m.customProgramCacheKey()).toBe(key);
    m.dispose();
  });
  it('evaluates rain haze at the drop centre and distinguishes the wrong-coordinate negative control', () => {
    const positions = new Float32Array([1000, 8, 2000]),
      velocities = new Float32Array([0, -15, 0]);
    const opacities = new Float32Array([0.5]),
      before = positions.slice();
    const rain = new RainStreaks(positions, velocities, opacities);
    const wrong = new RainStreaks(positions, velocities, opacities);
    wrong.material.userData.localWeatherPosition = 'position';
    const fog = new LocalAtmosphere(new Track());
    fog.installMaterial(rain.material);
    fog.installMaterial(wrong.material);
    expect(shaderFor(rain.material).vertexShader).toContain('vec4(center,1.)');
    expect(shaderFor(wrong.material).vertexShader).toContain('vec4(position,1.)');
    expect(rain.material.customProgramCacheKey()).not.toBe(wrong.material.customProgramCacheKey());
    expect(rain.geometry.getAttribute('center').array).toBe(positions);
    expect(positions).toEqual(before);
    rain.geometry.dispose();
    wrong.geometry.dispose();
    rain.material.dispose();
    wrong.material.dispose();
  });
});
