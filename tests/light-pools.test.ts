import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Track } from '../src/simulation/track.ts';
import {
  LIGHT_POOLS,
  LIGHT_POOL_HOOK,
  LightPools,
  POOL_STRENGTH,
  RIBBON_KEY_SHARE,
  installLightPools,
  lightPoolUniforms,
  poolIrradiance,
  poolLampSites,
} from '../src/rendering/studio/light-pools.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';

const compile = (m: T.Material) => {
  const shader = {
    uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  } as unknown as StudioShader;
  m.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};

describe('night floodlight pools', () => {
  it('lights the racing surface in pools: min/max 0.3-0.45 across a lamp period', () => {
    let min = Infinity,
      max = 0;
    for (let s = 0; s < LIGHT_POOLS.spacing; s += 0.5)
      for (let lateral = -7; lateral <= 7; lateral += 0.5) {
        const e = poolIrradiance(lateral, s);
        min = Math.min(min, e);
        max = Math.max(max, e);
      }
    // TEST-UPDATE (night review): pools with darker asphalt between them, not
    // an even >= 0.6 wash that read as daytime grey.
    expect(min / max).toBeGreaterThanOrEqual(0.3);
    expect(min / max).toBeLessThanOrEqual(0.45);
    // Pools: brighter under a lamp than between lamps along the same edge.
    expect(poolIrradiance(LIGHT_POOLS.lateral - 5, 0)).toBeGreaterThan(
      poolIrradiance(LIGHT_POOLS.lateral - 5, LIGHT_POOLS.spacing / 2),
    );
    // Periodic in lap distance (any number of lamps at no cost).
    expect(poolIrradiance(2, 3)).toBeCloseTo(poolIrradiance(2, 3 + 10 * LIGHT_POOLS.spacing), 10);
    // Falls away beyond the lamp rows (the surroundings stay dark).
    expect(poolIrradiance(60, 0)).toBeLessThan(0.1 * poolIrradiance(0, 0));
  });

  it('installs one fragment loop of 8 lamps after the lights on track ribbons', () => {
    const road = new T.MeshStandardMaterial();
    expect(installLightPools(road)).toBe(true);
    expect(installLightPools(road)).toBe(false);
    expect(studioHookKeys(road)).toEqual([LIGHT_POOL_HOOK]);
    const shader = compile(road);
    expect(shader.vertexShader).toContain('vPoolLap = uv * 5.0;');
    const f = shader.fragmentShader;
    expect(f).toContain('for ( int k = - 1; k <= 2; k ++ )');
    expect(f.indexOf('D28 floodlight pools')).toBeGreaterThan(
      f.indexOf('#include <lights_fragment_end>'),
    );
    expect(shader.uniforms.lightPoolStrength).toBe(lightPoolUniforms.lightPoolStrength);
    expect(shader.uniforms.lightPoolKeyShare).toBe(lightPoolUniforms.lightPoolKeyShare);
    expect(f).toContain('reflectedLight.directDiffuse *= lightPoolKeyShare;');
  });

  it('stands the poles outside the track every 40 m per side, two draws at night only', () => {
    const track = new Track();
    const sites = poolLampSites(track);
    // TEST-UPDATE (night review): lamps every 40 m, not 32 m (150 * 32 / 40).
    expect(sites.length).toBeGreaterThan(120);
    for (const site of sites) {
      expect(site.s % (LIGHT_POOLS.spacing / 2)).toBeCloseTo(0, 6);
      if (site.side > 0) expect(site.s > track.length - 260 || site.s < 360).toBe(false);
    }
    const pools = new LightPools(track);
    const meshes: T.Mesh[] = [];
    pools.root.traverse((o) => {
      if ((o as T.Mesh).isMesh) meshes.push(o as T.Mesh);
    });
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => m instanceof T.InstancedMesh && m.count === sites.length)).toBe(
      true,
    );
    pools.update('day');
    expect(pools.root.visible).toBe(false);
    expect(lightPoolUniforms.lightPoolStrength.value).toBe(POOL_STRENGTH.day);
    pools.update('sunset');
    expect(lightPoolUniforms.lightPoolStrength.value).toBe(POOL_STRENGTH.sunset);
    pools.update('night');
    expect(pools.root.visible).toBe(true);
    expect(lightPoolUniforms.lightPoolStrength.value).toBe(1);
    // The lamp heads are unlit HDR white for the bloom halo.
    const head = pools.heads.material as T.MeshBasicMaterial;
    expect(head.toneMapped).toBe(false);
    expect(head.color.r).toBeGreaterThan(1);
    pools.update('day');
  });
});

describe('night key on track ribbons (night review)', () => {
  it('keeps the full key by day and at golden hour, 30 % at night', () => {
    const pools = { root: { visible: false } } as unknown as LightPools;
    for (const [mode, share] of [
      ['day', 1],
      ['sunset', 1],
      ['night', 0.3],
    ] as const) {
      LightPools.prototype.update.call(pools, mode);
      expect(lightPoolUniforms.lightPoolKeyShare.value).toBe(share);
      expect(RIBBON_KEY_SHARE[mode]).toBe(share);
    }
    LightPools.prototype.update.call(pools, 'day');
  });
});
