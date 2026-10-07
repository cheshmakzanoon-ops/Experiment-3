import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  SUPPLIED_LOOKDEV,
  amplifySuppliedRelief,
  applySuppliedLookdev,
  setSuppliedLivery,
  suppliedLookdevReport,
  suppliedWeaveRepeat,
} from '../src/rendering/studio/supplied-lookdev.ts';
import { restoreSuppliedHeightMap } from '../src/rendering/supplied-player.ts';
import { configureSuppliedMaterial } from '../src/rendering/supplied-player-materials.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import {
  DEFAULT_LIVERY,
  LIVERY_PRESETS,
  liveryCustomised,
  validateLivery,
} from '../src/storage/livery.ts';

function canvasStub() {
  const context = new Proxy({} as Record<string, unknown>, {
    get: (t, key: string) => (key in t ? t[key] : () => undefined),
  });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
}
afterEach(() => vi.unstubAllGlobals());
const compile = (m: T.Material) => {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};
const physical = (name: string, options: T.MeshPhysicalMaterialParameters = {}) => {
  const m = new T.MeshPhysicalMaterial({ clearcoat: 0.045, clearcoatRoughness: 0.38, ...options });
  m.name = name;
  return m;
};
const sheet = (width: number, height: number) => {
  const texture = new T.Texture({ width, height } as unknown as HTMLImageElement);
  texture.flipY = false;
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
};

describe('supplied car look-dev (D06)', () => {
  it('turns the navy body family into one satin coat with sheen', () => {
    const root = new T.Group();
    const names = [
      'Paint | midnight blue satin',
      'Paint | midnight blue satin | curve-local',
      'Paint | nose yellow panel',
      'Paint | airbox roundel and authored charging bull',
    ];
    for (const name of names) {
      const m = physical(name, { color: 0x0a1021, roughness: 0.46 });
      expect(applySuppliedLookdev(m, root)).toBe(true);
      expect(applySuppliedLookdev(m, root)).toBe(false);
      expect(m.color.toArray().map((v) => +v.toFixed(4))).toEqual([0.0091, 0.0145, 0.068]);
      expect(m.roughness).toBe(0.36);
      expect(m.clearcoat).toBe(0.55);
      expect(m.clearcoatRoughness).toBe(0.1);
      expect(m.sheen).toBe(0.25);
      expect(m.sheenColor.getHexString()).toBe('23305e');
      expect(m.sheenRoughness).toBe(0.45);
    }
    expect(suppliedLookdevReport(root).overridden).toEqual(names);
  });
  it('coats accents and body decals but leaves tyre decals and unknown materials alone', () => {
    canvasStub();
    const root = new T.Group();
    for (const name of ['Paint | vermilion', 'Paint | warm yellow', 'Decal | race_number']) {
      const m = physical(name, { map: name.startsWith('Decal') ? sheet(350, 480) : null });
      applySuppliedLookdev(m, root);
      expect([m.clearcoat, m.clearcoatRoughness], name).toEqual([0.6, 0.08]);
    }
    const tyre = physical('Decal | tyre_barcode', { map: sheet(1024, 256) });
    const map = tyre.map;
    expect(applySuppliedLookdev(tyre, root)).toBe(false);
    expect([tyre.clearcoat, tyre.map]).toEqual([0.045, map]);
    const other = physical('Metal | black anodised');
    expect(applySuppliedLookdev(other, root)).toBe(false);
    expect(applySuppliedLookdev(new T.MeshBasicMaterial(), root)).toBe(false);
  });
  it('swaps each sponsor sheet for an original mark, keeping the decal flags and budget', () => {
    canvasStub();
    const root = new T.Group();
    const decal = physical('Decal | oracle', {
      map: sheet(1024, 141),
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    });
    configureSuppliedMaterial(decal);
    const source = decal.map!;
    expect(source.userData.suppliedPlayerTexture).toBe(true);
    applySuppliedLookdev(decal, root);
    expect(decal.map).not.toBe(source);
    expect(decal.map).toBeInstanceOf(T.CanvasTexture);
    expect(decal.map!.flipY).toBe(false);
    expect(decal.map!.colorSpace).toBe(T.SRGBColorSpace);
    expect(decal.map!.userData.suppliedPlayerTexture).toBe(true);
    expect([decal.transparent, decal.depthWrite, decal.forceSinglePass]).toEqual([
      true,
      false,
      true,
    ]);
    expect(compile(decal).fragmentShader).toContain('diffuseColor.a == 0.0');
    const tyre = physical('Decal | tyre_pirelli', { map: sheet(1024, 171) });
    applySuppliedLookdev(tyre, root);
    expect(tyre.map!.userData.fictionalMark).toBe('APEX CORSA');
    expect(tyre.clearcoat).toBe(0.045);
    expect(suppliedLookdevReport(root).swapped).toEqual([
      { material: 'Decal | oracle', mark: 'VOLTEX' },
      { material: 'Decal | tyre_pirelli', mark: 'APEX CORSA' },
    ]);
    const kept = physical('Decal | player', { map: sheet(1024, 512) });
    const keptMap = kept.map;
    applySuppliedLookdev(kept, root);
    expect(kept.map).toBe(keptMap);
  });
  it('amplifies twill relief in the shader without touching the restored bumpScale', () => {
    const root = new T.Group();
    const height = new T.Texture();
    height.name = 'carbon_twill_height';
    const roughness = new T.Texture();
    const m = physical('Composite | satin floor laminate', {
      normalMap: height,
      roughnessMap: roughness,
      metalnessMap: roughness,
    });
    let previous = 0;
    m.onBeforeCompile = () => void previous++;
    restoreSuppliedHeightMap(m);
    const scale = m.bumpScale;
    applySuppliedLookdev(m, root);
    expect(m.bumpScale).toBe(scale);
    expect(scale).toBeLessThan(0.001);
    expect(m.clearcoat).toBe(0.045);
    expect(studioHookKeys(m)).toEqual(['supplied-relief-4000-v1']);
    const shader = compile(m);
    expect(previous).toBe(1);
    expect(shader.fragmentShader).toContain('return vec2( dBx, dBy ) * 4000.0;');
    expect(shader.fragmentShader).not.toContain('#include <bumpmap_pars_fragment>');
    // Bump and packed roughness/metalness share one rescaled clone of each map.
    const repeat = suppliedWeaveRepeat('Composite | satin floor laminate');
    expect(repeat).toBeCloseTo(1.63 / (16 * SUPPLIED_LOOKDEV.twillBundle), 6);
    expect(m.bumpMap).not.toBe(height);
    expect(m.bumpMap!.source).toBe(height.source);
    expect(m.bumpMap!.repeat.x).toBeCloseTo(repeat, 6);
    expect(height.repeat.toArray()).toEqual([1, 1]);
    expect(m.roughnessMap).toBe(m.metalnessMap);
    expect(m.roughnessMap!.repeat.y).toBeCloseTo(repeat, 6);
    expect(suppliedLookdevReport(root).relief).toEqual(['carbon_twill_height']);
    const coated = physical('Composite | 2x2 twill / physical scale');
    applySuppliedLookdev(coated, root);
    expect([coated.clearcoat, coated.clearcoatRoughness]).toEqual([0.6, 0.08]);
    const tyre = new T.Texture();
    tyre.name = 'tyre_scrub_height_16bit';
    const rubber = physical('Tyre | lightly scrubbed slick', { normalMap: tyre });
    restoreSuppliedHeightMap(rubber);
    applySuppliedLookdev(rubber, root);
    expect(compile(rubber).fragmentShader).toContain('* 2000.0;');
    expect(rubber.bumpMap).toBe(tyre);
    expect(() => amplifySuppliedRelief(rubber, 0.5)).toThrow();
    expect(amplifySuppliedRelief(rubber, 2000)).toBe(false);
  });
  it('tints the supplied body only for a customised livery and restores the navy', () => {
    const root = new T.Group();
    const navy = physical('Paint | midnight blue satin');
    const red = physical('Paint | vermilion', { color: new T.Color(0.72, 0.018, 0.022) });
    applySuppliedLookdev(navy, root);
    applySuppliedLookdev(red, root);
    const original = [navy.color.clone(), red.color.clone()];
    expect(setSuppliedLivery(root, { primary: '#2266bb', accent: '#f5d54a' })).toBe(true);
    expect(navy.color.getHexString()).toBe('2266bb');
    expect(red.color.getHexString()).toBe('f5d54a');
    setSuppliedLivery(root, null);
    expect(navy.color.equals(original[0])).toBe(true);
    expect(red.color.equals(original[1])).toBe(true);
    expect(setSuppliedLivery(new T.Group(), null)).toBe(false);
    expect(liveryCustomised(DEFAULT_LIVERY)).toBe(false);
    expect(liveryCustomised(validateLivery({ ...DEFAULT_LIVERY, number: 42 }))).toBe(false);
    expect(liveryCustomised(LIVERY_PRESETS.nocturne)).toBe(true);
  });
});
