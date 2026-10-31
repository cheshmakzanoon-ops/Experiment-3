/* Colour transfer adapted from Three.js r180 ColorManagement.
The MIT License

Copyright © 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';

/** Original circuit-finish.ts paint construction algebra, applied to linear
 * albedo before lighting. No grounding/light pools, weather or asphalt port is
 * implied. World-space derivatives preserve chunk continuity and minification. */
export const CIRCUIT_PAINT_NOISE = `
float finishHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float finishNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(finishHash(i),finishHash(i+vec2(1,0)),f.x),
    mix(finishHash(i+vec2(0,1)),finishHash(i+vec2(1,1)),f.x),f.y);
}
float finishFilteredNoise(vec2 p) {
  float footprint=max(length(dFdx(p)),length(dFdy(p)));
  float weight=1.0-smoothstep(.35,1.25,footprint);
  return mix(.5,finishNoise(p),weight);
}
`;

/** Install only during caller-exclusive, idle material preparation. Material
 * owns the plugin; no textures, uniforms, timers or global shader state. */
export class CircuitPaintFinishPlugin extends MaterialPluginBase {
  constructor(material: PBRMaterial) {
    super(
      material,
      'OriginalCircuitPaintFinish',
      200,
      { ORIGINAL_CIRCUIT_PAINT_FINISH_V1: true },
      true,
      true,
    );
    this.doNotSerialize = true;
  }
  getClassName() {
    return 'CircuitPaintFinishPlugin';
  }
  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: CIRCUIT_PAINT_NOISE,
      CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
        float grit=finishFilteredNoise(vPositionW.xz*24.0);
        float wear=finishFilteredNoise(vPositionW.xz*.72);
        surfaceAlbedo.rgb *= .82+.16*grit+.05*wear;
      `,
    };
  }
}

/** Three r180 ColorManagement sRGB transfer (not Babylon's approximate pow).
 * Numeric constants and operation order match the authored colour boundary. */
export function circuitPaintLinearChannel(value: number) {
  return value < 0.04045
    ? value * 0.0773993808
    : Math.pow(value * 0.9478672986 + 0.0521327014, 2.4);
}
