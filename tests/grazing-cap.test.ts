import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  GRAZING_CAP,
  GRAZING_CAP_KEY,
  grazingCapCeiling,
  grazingCapFactor,
  installGrazingCap,
} from '../src/rendering/studio/grazing-cap.ts';
import {
  installSpecularIBLMaterial,
  SPECULAR_IBL_GLSL,
} from '../src/rendering/studio/ibl-energy.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import { carbonMaterial } from '../src/rendering/materials.ts';
import { installTeamPaint } from '../src/rendering/car-livery.ts';
import { bodyPaint } from '../src/rendering/vehicle-bodies/materials.ts';

function compile(material: T.Material, kind: 'physical' | 'standard' = 'physical') {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib[kind].vertexShader,
    fragmentShader: T.ShaderLib[kind].fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

/** D8 (vehicle art 3): the cap is a hook, not a change of any pinned material value. It leaves
 * every lobe constant (clear coat 0.6 / roughness 0.08 of the owner-supplied look-dev,
 * `tests/supplied-lookdev.test.ts`) alone and only scales the IBL radiance in the shader. */
describe('grazing-Fresnel cap (D8)', () => {
  it('removes energy only from a glancing, up-facing glint', () => {
    // Flank (normal level with the horizon): untouched at every angle.
    for (const nv of [0, 0.2, 0.6, 1]) expect(grazingCapFactor(0, nv)).toBe(1);
    // Bonnet seen head on (N.V = 1): untouched even though it faces the sky.
    expect(grazingCapFactor(1, 1)).toBe(1);
    // Fully up-facing and fully grazing: the whole cap.
    expect(grazingCapFactor(1, 0)).toBeCloseTo(1 - GRAZING_CAP.strength, 12);
    // Monotone: more grazing or more up-facing only ever removes more.
    let previous = 1;
    for (const nv of [1, 0.8, 0.6, 0.4, 0.2, 0]) {
      const value = grazingCapFactor(1, nv);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
    expect(grazingCapFactor(0.5, 0.1)).toBeGreaterThan(grazingCapFactor(0.9, 0.1));
    // At a 5 degree view elevation over a flat splitter (N.V = sin 5) it takes most of the glint.
    expect(grazingCapFactor(1, Math.sin((5 * Math.PI) / 180))).toBeLessThan(0.45);
    expect(grazingCapFactor(1, Math.sin((5 * Math.PI) / 180))).toBeGreaterThan(
      1 - GRAZING_CAP.strength,
    );
    for (const bad of [NaN, Infinity])
      expect(() => grazingCapFactor(bad, 0)).toThrow('Invalid grazing cap');
    expect(() => grazingCapFactor(1, 0, 1.5)).toThrow('Invalid grazing cap');
  });
  it('bounds what is left: a ceiling that bites only near full weight and never raises anything', () => {
    // Head on or a flank: the ceiling is far above any sky radiance (no effect).
    expect(grazingCapCeiling(0, 0)).toBeGreaterThan(50);
    expect(grazingCapCeiling(1, 1)).toBeGreaterThan(50);
    // Fully glancing and up-facing: the configured limit.
    expect(grazingCapCeiling(1, 0)).toBeCloseTo(GRAZING_CAP.limit, 12);
    // It only tightens as the weight grows.
    let previous = Infinity;
    for (const nv of [1, 0.7, 0.4, 0.2, 0.1, 0]) {
      const value = grazingCapCeiling(1, nv);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
    // A sun-disc streak (tens of sky units) at 5 degrees is cut to a few; a sky tone survives.
    const ceiling = grazingCapCeiling(1, Math.sin((5 * Math.PI) / 180));
    expect(ceiling).toBeLessThan(2.5);
    expect(ceiling).toBeGreaterThan(1);
    expect(() => grazingCapCeiling(NaN, 0)).toThrow('Invalid grazing cap');
  });
  it('chains once on Physical/Standard materials and lands between the IBL fetch and its gain', () => {
    const physical = new T.MeshPhysicalMaterial({ clearcoat: 1 }),
      lambert = new T.MeshLambertMaterial();
    let previous = 0;
    physical.onBeforeCompile = () => void previous++;
    expect(installGrazingCap(physical)).toBe(true);
    expect(installGrazingCap(physical)).toBe(false);
    expect(installGrazingCap(lambert)).toBe(false);
    expect(installGrazingCap(new T.MeshStandardMaterial(), 0)).toBe(false);
    expect(() => installGrazingCap(physical, 2)).toThrow('Invalid grazing cap');
    expect(studioHookKeys(physical)).toEqual([GRAZING_CAP_KEY]);
    expect(physical.customProgramCacheKey()).toContain(`|${GRAZING_CAP_KEY}`);
    // A different strength is a different program.
    const softer = new T.MeshPhysicalMaterial();
    installGrazingCap(softer, 0.3);
    expect(softer.customProgramCacheKey()).not.toBe(physical.customProgramCacheKey());
    // With the specular IBL gain chained after it, the cap multiplies first (both multiplicative).
    expect(installSpecularIBLMaterial(physical)).toBe(true);
    const fragment = compile(physical).fragmentShader;
    expect(previous).toBe(1);
    const maps = fragment.indexOf('#include <lights_fragment_maps>');
    const cap = fragment.indexOf('apexGrazingCap = 1.0 - 0.850');
    const gain = fragment.indexOf(SPECULAR_IBL_GLSL);
    expect(maps).toBeGreaterThan(0);
    expect(cap).toBeGreaterThan(maps);
    expect(gain).toBeGreaterThan(cap);
    expect(gain).toBeLessThan(fragment.indexOf('#include <lights_fragment_end>'));
    expect(fragment).toContain('radiance = min( radiance * apexGrazingCap, apexCeiling );');
    // The sun's glancing glint is the other half of D8: the direct specular takes the same factor,
    // after every light is summed and before the totals are formed.
    const end = fragment.indexOf('#include <lights_fragment_end>');
    const direct = fragment.indexOf(
      'reflectedLight.directSpecular = min( reflectedLight.directSpecular * apexGrazingCap, apexDirectCeiling );',
    );
    expect(direct).toBeGreaterThan(end);
    expect(direct).toBeLessThan(fragment.indexOf('vec3 totalSpecular'));
    // The clear coat has its own direct accumulator (the sun's sharp glint on a lacquered flap).
    expect(fragment).toContain(
      'clearcoatSpecularDirect = min( clearcoatSpecularDirect * apexGrazingCap, apexDirectCeiling );',
    );
    expect(fragment).toContain(
      'clearcoatRadiance = min( clearcoatRadiance * apexGrazingCap, apexCeiling );',
    );
    // The standard shader has no clear coat: the clear-coat line is guarded.
    expect(compile(new T.MeshStandardMaterial(), 'standard').fragmentShader).not.toContain(
      'apexGrazingCap',
    );
    const standard = new T.MeshStandardMaterial();
    installGrazingCap(standard);
    expect(compile(standard, 'standard').fragmentShader).toContain('#ifdef USE_CLEARCOAT');
    for (const m of [physical, lambert, softer, standard]) m.dispose();
  });
  it('is on the car paint, the carbon and the catalogue body paint, and nowhere on a road material', () => {
    const carbon = carbonMaterial('satin'),
      lacquered = carbonMaterial(),
      team = installTeamPaint(new T.MeshPhysicalMaterial({ color: 0x5b2bd6 }), 0),
      body = bodyPaint(0x335577, 'metallic');
    for (const m of [carbon, lacquered, team, body]) {
      expect(studioHookKeys(m)).toContain(GRAZING_CAP_KEY);
      expect(compile(m).fragmentShader).toContain('apexGrazingCap');
    }
    // The carbon keeps its own program key (weave) and the hook rides on it.
    expect(carbon.customProgramCacheKey()).toContain('satin');
    expect(carbon.customProgramCacheKey()).toContain(GRAZING_CAP_KEY);
    // No lobe constant moved: the cap is shader-only.
    expect(team.clearcoat).toBe(1);
    expect(team.clearcoatRoughness).toBe(0.04);
    const road = new T.MeshStandardMaterial();
    expect(studioHookKeys(road)).not.toContain(GRAZING_CAP_KEY);
    for (const m of [carbon, lacquered, team, body, road]) m.dispose();
  });
});
