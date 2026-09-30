import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { filteredRoughness, installSpecularAntialiasing, SPECULAR_AA } from '../src/rendering/specular-aa.ts';

describe('normal-variance specular anti-aliasing', () => {
  it('leaves smooth normals unchanged and widens only varying ones', () => {
    for (const r of [0.05, 0.3, 0.7, 1]) expect(filteredRoughness(r, 0, 0)).toBeCloseTo(r, 12);
    const rough = filteredRoughness(0.1, 0.05, 0.05);
    expect(rough).toBeGreaterThan(0.1);
    // Monotonic in variance, bounded by the clamp.
    expect(filteredRoughness(0.1, 0.2, 0.2)).toBeGreaterThanOrEqual(rough);
    const capped = filteredRoughness(0, 50, 50);
    expect(capped).toBeCloseTo(Math.sqrt(Math.sqrt(SPECULAR_AA.threshold)), 12);
    expect(capped).toBeLessThan(1);
    expect(() => filteredRoughness(NaN, 0, 0)).toThrow();
  });
  it('patches the shared physical lighting chunk exactly once', () => {
    installSpecularAntialiasing();
    const once = T.ShaderChunk.lights_physical_fragment;
    expect(installSpecularAntialiasing()).toBe(false);
    expect(T.ShaderChunk.lights_physical_fragment).toBe(once);
    expect(once.match(/apexSpecularAA/g)).toHaveLength(1);
    // The Three.js geometric term is preserved; ours follows it.
    expect(once.indexOf('geometryRoughness')).toBeLessThan(once.indexOf('apexSpecularAA'));
  });
});
