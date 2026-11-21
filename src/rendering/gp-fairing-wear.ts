import type * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';

/** A production bike retains at least 30% of its fairing. Blank legacy and
 * showroom frames have no recorded health. */
export function gpFairingWear(health?: number) {
  if (health === undefined || !Number.isFinite(health) || health <= 0) return 0;
  return Math.min(1, Math.max(0, (1 - health) / 0.7));
}

/** Scuff the exposed cheek and two forward shoulders of the painted shell.
 * The original side-view atlas follows the moulding through all three LODs.
 * A common damage channel cannot identify which side received an impact. */
export function installGpFairingWear(material: T.MeshPhysicalMaterial, wear: T.IUniform<number>) {
  chainShaderHook(material, 'gp-fairing-wear-v1', (shader) => {
    shader.uniforms.gpFairingWear = wear;
    injectDeclarations(shader, 'common', 'varying vec2 vGpWearPoint;', 'vertex');
    injectAfter(shader, 'uv_vertex', `
      // Decode the two halves of the shell atlas into longitudinal/vertical metres.
      vGpWearPoint = vec2((abs(uv.x * 2.0 - 1.0) - 0.5) * 2.04, (uv.y - 0.5) * 1.24);
    `, 'vertex');
    injectDeclarations(shader, 'common', `
      uniform float gpFairingWear;
      varying vec2 vGpWearPoint;
      float gpScuffPatch(vec2 offset, vec2 radius) {
        vec2 p = offset / radius;
        return 1.0 - smoothstep(0.10, 1.0, dot(p, p));
      }
    `, 'fragment');
    injectAfter(shader, 'color_fragment', `
      float gpScuff = 0.0;
      if (gpFairingWear > 0.0 && gl_FrontFacing) {
        vec2 p = vGpWearPoint;
        float cheek = gpScuffPatch(p - vec2(0.42, -0.11), vec2(0.24, 0.065));
        float lower = gpScuffPatch(p - vec2(0.25, -0.32), vec2(0.18, 0.042));
        float foil = gpScuffPatch(p - vec2(0.735, 0.063), vec2(0.11, 0.073));
        float band = p.y * 245.0 + p.x * 18.0 + 0.9 * sin(p.x * 14.0);
        float footprint = fwidth(band);
        float line = 1.0 - smoothstep(0.04, 0.17, abs(fract(band) - 0.5));
        // Narrow scratches converge on their coverage as they recede on a rival bike.
        line = mix(line, 0.21, smoothstep(0.12, 0.75, footprint));
        float edge = max(max(cheek, lower * 0.74), foil);
        gpScuff = smoothstep(1.0 - gpFairingWear, 1.12, edge) * (0.2 + 0.8 * line);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.043, 0.046, 0.048), gpScuff);
      }
    `, 'fragment');
    injectAfter(shader, 'roughnessmap_fragment',
      'roughnessFactor = mix(roughnessFactor, 0.74, gpScuff);', 'fragment');
    injectAfter(shader, 'metalnessmap_fragment',
      'metalnessFactor *= 1.0 - gpScuff;', 'fragment');
    injectAfter(shader, 'lights_physical_fragment', `
      #ifdef USE_CLEARCOAT
        material.clearcoat *= 1.0 - gpScuff;
        material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.65, gpScuff);
      #endif
    `, 'fragment');
  });
}
