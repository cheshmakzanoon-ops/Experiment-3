import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { BikeMaterials } from '../src/rendering/bike.ts';
import { gpLiveryMaterial, gpReliefAtlasCount } from '../src/rendering/gp-race-bodywork.ts';
import {
  GP_PANEL_RELIEF,
  GP_PANEL_RELIEF_HOOK,
  setGpPanelRelief,
  type GpPanelReliefUniforms,
} from '../src/rendering/gp-panel-relief.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';

/** Every paint operation the relief pass issues: [operation, style]. */
const recorded: [string, string][] = [];
let recording = false;
beforeAll(() => {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => {
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'fill' || key === 'stroke' || key === 'fillRect')
        return () => {
          if (recording)
            recorded.push([key, String(key === 'stroke' ? target.strokeStyle : target.fillStyle)]);
        };
      return typeof target[key] === 'undefined' ? () => undefined : target[key];
    },
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('GP livery panel relief', () => {
  it('draws only the annotated seams, fasteners, gills and recesses into the height atlas', () => {
    const m = new BikeMaterials(5);
    const before = gpReliefAtlasCount();
    recording = true;
    recorded.length = 0;
    const paint = gpLiveryMaterial(m, 5, 'gpr1');
    recording = false;
    try {
      expect(gpReliefAtlasCount()).toBe(before + 1);
      const heights = recorded
        .map(([, style]) => /^rgb\((\d+), \1, \1\)$/.exec(style)?.[1])
        .filter((v): v is string => v !== undefined)
        .map(Number);
      // The flat base plus the annotated elements; nothing else is height data.
      const allowed = new Set<number>([
        GP_PANEL_RELIEF.flat,
        GP_PANEL_RELIEF.groove,
        GP_PANEL_RELIEF.recess,
        GP_PANEL_RELIEF.dome,
      ]);
      expect(heights.length).toBeGreaterThan(40);
      for (const h of heights) expect(allowed.has(h)).toBe(true);
      for (const wanted of [GP_PANEL_RELIEF.groove, GP_PANEL_RELIEF.recess, GP_PANEL_RELIEF.dome])
        expect(heights).toContain(wanted);
      expect(paint.userData.gpRelief).toBeTruthy();
    } finally {
      m.dispose();
    }
  });

  it('bends both normals through the house hook chain, on High only, and frees its atlas', () => {
    const before = gpReliefAtlasCount();
    const a = new BikeMaterials(1),
      b = new BikeMaterials(2);
    const pa = gpLiveryMaterial(a, 1, 'gpr1'),
      pb = gpLiveryMaterial(b, 2, 'gpr1'),
      pc = gpLiveryMaterial(b, 2, 'gpr2');
    try {
      // One atlas per shell variant, shared by every entrant on it.
      expect(gpReliefAtlasCount()).toBe(before + 2);
      expect(studioHookKeys(pa)).toContain(GP_PANEL_RELIEF_HOOK);
      const ua = pa.userData.gpRelief as GpPanelReliefUniforms,
        ub = pb.userData.gpRelief as GpPanelReliefUniforms;
      expect(ua.gpReliefMap.value).toBe(ub.gpReliefMap.value);
      expect(ua.gpReliefMap.value.colorSpace).toBe(T.NoColorSpace);
      expect(pc.userData.gpRelief.gpReliefMap.value).not.toBe(ua.gpReliefMap.value);
      expect(ua.gpReliefStrength.value).toBe(0);
      setGpPanelRelief(a, true);
      expect(ua.gpReliefStrength.value).toBe(1);
      expect(ub.gpReliefStrength.value).toBe(0);
      setGpPanelRelief(a, false);
      expect(ua.gpReliefStrength.value).toBe(0);

      const shader = {
        vertexShader: '',
        fragmentShader:
          '#include <common>\n#include <normal_fragment_maps>\n#include <clearcoat_normal_fragment_maps>\n',
        uniforms: {},
      } as unknown as T.WebGLProgramParametersWithUniforms;
      pa.onBeforeCompile(shader, {} as T.WebGLRenderer);
      const f = shader.fragmentShader;
      expect(f).toContain('uniform sampler2D gpReliefMap;');
      // Base normal first, then the clear-coat normal, both from the same gradient.
      const base = f.indexOf('normal = gpReliefBend( normal, gpReliefD )'),
        coat = f.indexOf('clearcoatNormal = gpReliefBend( clearcoatNormal, gpReliefD )');
      expect(base).toBeGreaterThan(f.indexOf('#include <normal_fragment_maps>'));
      expect(coat).toBeGreaterThan(f.indexOf('#include <clearcoat_normal_fragment_maps>'));
      expect(coat).toBeGreaterThan(base);
      expect(f).toContain(GP_PANEL_RELIEF.heightMetres.toFixed(5));
      expect((shader.uniforms as unknown as GpPanelReliefUniforms).gpReliefMap).toBe(
        ua.gpReliefMap,
      );

      // The shared atlas outlives one entrant and goes with the last.
      const disposed = vi.fn();
      ua.gpReliefMap.value.addEventListener('dispose', disposed);
      a.dispose();
      expect(disposed).not.toHaveBeenCalled();
      b.dispose();
      expect(disposed).toHaveBeenCalledTimes(1);
      expect(gpReliefAtlasCount()).toBe(before);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});
