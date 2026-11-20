import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { LocalAtmosphere } from '../src/rendering/local-atmosphere.ts';
import {
  AERIAL_PERSPECTIVE_FRAGMENT,
  AERIAL_PERSPECTIVE_PARS,
} from '../src/rendering/studio/aerial-perspective.ts';
import { H, HEADER } from '../src/simulation/protocol.ts';
import { Track } from '../src/simulation/track.ts';
import { programHarness } from './helpers/three-program-harness.ts';

type DefinedMaterial = T.Material & { defines?: Record<string, unknown> };
const defines = (material: T.Material) => (material as DefinedMaterial).defines;
function shaderFor(material: T.Material) {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

describe('configured local-fog shader variants', () => {
  it('retains aerial perspective and cloud shadows when pocket integration is disabled', () => {
    const fog = new LocalAtmosphere(new Track());
    fog.setEnabled(false);
    const material = new T.MeshStandardMaterial();
    (material as DefinedMaterial).defines = { STANDARD: '', OTHER_FEATURE: 2 };
    fog.installMaterial(material);
    const shader = shaderFor(material);
    expect(defines(material)).toEqual({
      STANDARD: '',
      OTHER_FEATURE: 2,
      APEX_LOCAL_FOG_DISABLED: 1,
    });
    expect(shader.fragmentShader).toContain(AERIAL_PERSPECTIVE_PARS);
    expect(shader.fragmentShader).toContain(AERIAL_PERSPECTIVE_FRAGMENT);
    expect(shader.vertexShader).toContain('vApexFogWorld =');
    expect(shader.fragmentShader).toContain('float apexCloudShadowAt(vec3 viewPosition)');
    expect(shader.fragmentShader).toContain(
      'directLight.color *= apexCloudShadowAt( geometryPosition );',
    );
    expect(shader.uniforms.apexAerialExtinction).toBeDefined();
    expect(shader.uniforms.apexCloudField).toBeDefined();
    material.dispose();
  });

  it('selects and reuses two installed native programs despite a later frozen hook key', () => {
    const fog = new LocalAtmosphere(new Track());
    const material = new T.MeshStandardMaterial();
    fog.installMaterial(material);
    // Existing surface hooks can snapshot an earlier custom key. Three must
    // still select the configured variant from defines before invoking hooks.
    const frozenKey = material.customProgramCacheKey();
    material.customProgramCacheKey = () => frozenKey;
    const harness = programHarness();
    const geometry = new T.BoxGeometry();
    const scene = new T.Scene().add(new T.Mesh(geometry, material));
    const camera = new T.PerspectiveCamera();
    harness.renderer.compile(scene, camera);
    const original = [...harness.owners.get(material)!.values()][0];
    expect(harness.created).toHaveLength(1);
    const initialVersion = material.version;
    fog.setEnabled(false);
    expect(material.version).toBe(initialVersion + 1);
    harness.renderer.compile(scene, camera);
    expect(harness.created).toHaveLength(2);
    const disabledVersion = material.version;
    fog.setEnabled(false);
    fog.installMaterial(material);
    expect(material.version).toBe(disabledVersion);
    fog.setEnabled(true);
    harness.renderer.compile(scene, camera);
    expect(harness.created).toHaveLength(2);
    expect([...harness.owners.get(material)!.values()][0]).toBe(original);
    expect(defines(material)?.APEX_LOCAL_FOG_DISABLED).toBeUndefined();
    expect(material.customProgramCacheKey()).toBe(frozenKey);
    material.dispose();
    geometry.dispose();
    expect(harness.deleted).toHaveLength(2);
  });

  it('keeps weather and photo suppression uniform-only without changing configured identity', () => {
    const fog = new LocalAtmosphere(new Track());
    const material = new T.MeshStandardMaterial();
    fog.installMaterial(material);
    const frame = new Float32Array(HEADER);
    frame[H.CLOUD] = 1;
    frame[H.RAIN] = 20;
    const version = material.version;
    fog.update(frame, true);
    expect(fog.sigma.value).toBeGreaterThan(0);
    fog.update(frame, false);
    expect(fog.sigma.value).toBe(0);
    fog.update(frame, true);
    expect(fog.sigma.value).toBeGreaterThan(0);
    frame[H.CLOUD] = frame[H.RAIN] = 0;
    fog.update(frame, true);
    expect(fog.sigma.value).toBe(0);
    expect(material.version).toBe(version);
    expect(defines(material)?.APEX_LOCAL_FOG_DISABLED).toBeUndefined();
    fog.setEnabled(false);
    const disabledVersion = material.version;
    frame[H.CLOUD] = 1;
    frame[H.RAIN] = 20;
    fog.update(frame, true);
    expect(fog.sigma.value).toBe(0);
    expect(material.version).toBe(disabledVersion);
    expect(defines(material)?.APEX_LOCAL_FOG_DISABLED).toBe(1);
    material.dispose();
  });

  it('lets only the latest scene configure shared material uniforms and programs', () => {
    const prior = new LocalAtmosphere(new Track());
    const current = new LocalAtmosphere(new Track());
    current.setEnabled(false);
    const material = new T.MeshStandardMaterial();
    prior.installMaterial(material);
    current.installMaterial(material);
    const version = material.version;
    prior.setEnabled(false);
    prior.setEnabled(true);
    expect(material.version).toBe(version);
    expect(defines(material)?.APEX_LOCAL_FOG_DISABLED).toBe(1);
    const shader = shaderFor(material);
    expect(shader.uniforms.apexLocalSigma).toBe(current.sigma);
    expect(shader.fragmentShader.match(/float apexPocketIntegral\(/g)).toHaveLength(1);
    expect(shader.vertexShader.match(/varying vec3 vApexFogWorld;/g)).toHaveLength(1);
    current.setEnabled(true);
    expect(defines(material)?.APEX_LOCAL_FOG_DISABLED).toBeUndefined();
    // Repeated installation remains idempotent even in a former scene. It
    // cannot reclaim the current owner's native program or uniform bindings.
    prior.setEnabled(false);
    prior.installMaterial(material);
    expect(defines(material)?.APEX_LOCAL_FOG_DISABLED).toBeUndefined();
    expect(shaderFor(material).uniforms.apexLocalSigma).toBe(current.sigma);
    material.dispose();
  });

  it('retires disposed materials and applies the current variant to newly installed ones', () => {
    const fog = new LocalAtmosphere(new Track());
    const retired = new T.MeshStandardMaterial();
    fog.installMaterial(retired);
    retired.dispose();
    const version = retired.version;
    fog.setEnabled(false);
    expect(retired.version).toBe(version);
    expect(defines(retired)?.APEX_LOCAL_FOG_DISABLED).toBeUndefined();
    const replacement = new T.MeshStandardMaterial();
    fog.installMaterial(replacement);
    expect(defines(replacement)?.APEX_LOCAL_FOG_DISABLED).toBe(1);
    fog.setEnabled(true);
    expect(retired.version).toBe(version);
    expect(defines(replacement)?.APEX_LOCAL_FOG_DISABLED).toBeUndefined();
    replacement.dispose();
  });
});
