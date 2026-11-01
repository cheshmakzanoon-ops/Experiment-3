import { Color } from 'three';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';

/** geometry.ts unprintedBack's original sRGB hex -> linear Three color. */
export const ORIGINAL_BANNER_BACKING = Object.freeze(new Color(0x2b3236).toArray());
/** One material-owned plugin; no custom UBO, integer precision, sampler or
 * per-mesh state. Native PBR owns texture decode and two-sided normal handling. */
export class OriginalBannerBackingPlugin extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    if (material.shaderLanguage !== 0) throw new Error('Original banner requires GLSL');
    super(material, 'OriginalBannerBacking', 200, { ORIGINAL_BANNER_BACKING_V1: true }, true, true);
    this.doNotSerialize = true;
  }
  getClassName() {
    return 'OriginalBannerBackingPlugin';
  }
  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
      if (!gl_FrontFacing) {
        surfaceAlbedo = vec3(${ORIGINAL_BANNER_BACKING.map((c) => c.toPrecision(17)).join(', ')});
      }
    `,
    };
  }
}
