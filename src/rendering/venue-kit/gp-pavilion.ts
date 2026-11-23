import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

const roofColours: Record<string, number> = {
  'poggio-alto': 0x81746a,
  'cape-wrenna': 0x647479,
  haarveld: 0x708083,
  montejaral: 0x8a7c6d,
};

/** The GP pavilion shares the surveyed event hall and all three shell meshes.
 * Standing seams run down the roof to two occupied floors. Only the windows
 * emit, so the roof keeps its daylight reflections under the night exposure. */
export function gpPavilionMaterial(venue: string) {
  const cladding = new T.Color(roofColours[venue] ?? 0x758082);
  const material = new T.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.49,
    metalness: 0.48,
    emissive: 0xffffff,
    emissiveIntensity: 0.015,
  });
  material.name = 'GP pavilion standing-seam roof and glazed galleries';
  chainShaderHook(material, 'gp-pavilion-cladding-v1', (shader) => {
    shader.uniforms.gpRoofTint = { value: cladding };
    injectDeclarations(shader, 'common', 'varying vec2 vPavilion;', 'vertex');
    // Use local height in metres: the imported shell UV's vertical scale changes
    // with latitude. Azimuth stays continuous across all three geometry tiers.
    injectAfter(shader, 'begin_vertex', 'vPavilion = vec2(uv.x, position.y);', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `
      varying vec2 vPavilion;
      uniform vec3 gpRoofTint;
      // Pixel-area average of a repeating narrow metal fold. A subpixel row
      // converges to its covered area instead of breaking into moving bars.
      float gpPavilionSeam(float phase, float width, float footprint) {
        float edge = abs(fract(phase + 0.5) - 0.5);
        float halfPixel = max(0.001, 0.5 * footprint);
        float covered = smoothstep(-halfPixel, halfPixel, width - edge);
        return mix(covered, 2.0 * width, smoothstep(0.32, 0.95, footprint));
      }`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `
      float bay = vPavilion.x * 48.0;
      float height = vPavilion.y;
      float bayFootprint = fwidth(bay);
      float floorFootprint = max(fwidth(height), 0.001);
      float band = smoothstep(-6.9 - floorFootprint, -6.9 + floorFootprint, height)
                 * (1.0 - smoothstep(0.15 - floorFootprint, 0.15 + floorFootprint, height));
      float mullion = gpPavilionSeam(bay, 0.042, bayFootprint);
      float transom = gpPavilionSeam((height + 6.9) / 3.525, 0.065, floorFootprint / 3.525);
      float panes = band * (1.0 - mullion) * (1.0 - transom);
      float fold = gpPavilionSeam(bay * 3.0, 0.026, bayFootprint * 3.0);
      float lap = gpPavilionSeam(height / 3.4, 0.012, floorFootprint / 3.4);
      vec3 roof = gpRoofTint * (1.0 - 0.26 * fold - 0.12 * lap);
      vec3 glazing = mix(vec3(0.041, 0.049, 0.050), vec3(0.033, 0.061, 0.074), panes);
      diffuseColor.rgb *= mix(roof, glazing, band);
    `,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = mix(0.49 + fold * 0.12, 0.22, panes);',
      'fragment',
    );
    injectAfter(
      shader,
      'metalnessmap_fragment',
      'metalnessFactor = mix(0.48, 0.16, panes);',
      'fragment',
    );
    injectAfter(
      shader,
      'emissivemap_fragment',
      `
      // Fixed bay occupancy wraps at the UV seam. The floor plate breaks the
      // two storeys and the darker brise-soleil remains opaque in silhouette.
      float room = mod(floor(bay), 48.0);
      float upper = smoothstep(-3.375 - floorFootprint, -3.375 + floorFootprint, height);
      float phase = (room + 0.5) * 0.130899694;
      float occupied = smoothstep(-0.65, 0.55, sin(5.0 * phase + upper * 2.0)
                       + 0.58 * cos(9.0 * phase - upper));
      occupied = mix(occupied, 0.55, smoothstep(0.65, 1.6, bayFootprint));
      vec3 interior = mix(vec3(0.019, 0.026, 0.029), vec3(0.75, 0.39, 0.17), occupied);
      totalEmissiveRadiance *= interior * panes;
    `,
      'fragment',
    );
  });
  return material;
}
