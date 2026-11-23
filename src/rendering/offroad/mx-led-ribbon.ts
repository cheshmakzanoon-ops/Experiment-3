import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Local metres survive turns and atlas wrapping on all four stadium walls.
 * A negative coordinate identifies the printed panel on the finish bridge. */
export function mxLedPanel(width: number, height: number) {
  const panel = new T.PlaneGeometry(width, height);
  const uv = panel.getAttribute('uv');
  const metres = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) {
    metres[2 * i] = uv.getX(i) * width;
    metres[2 * i + 1] = uv.getY(i) * height;
  }
  panel.setAttribute('mxDisplayMetres', new T.BufferAttribute(metres, 2));
  return panel;
}

export function mxPrintedPanel(panel: T.BufferGeometry) {
  const metres = new Float32Array(panel.getAttribute('position').count * 2).fill(-1);
  panel.setAttribute('mxDisplayMetres', new T.BufferAttribute(metres, 2));
  return panel;
}

/** Aperture, dark louvres and cabinet joints share the existing ink texture
 * and batch. Integrate a rectangular emitter over the projected pixel so its
 * apparent luminance holds as the camera pans across distant rows. */
export function installMxLedRibbon(material: T.MeshStandardMaterial) {
  chainShaderHook(material, 'mx-led-cabinets-v1', shader => {
    injectDeclarations(shader, 'common',
      'attribute vec2 mxDisplayMetres; varying vec2 vMxDisplayMetres;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vMxDisplayMetres = mxDisplayMetres;', 'vertex');
    injectDeclarations(shader, 'common', /* glsl */ `
      varying vec2 vMxDisplayMetres;
      float mxStripIntegral(float x, float fill) {
        return floor(x) * fill + min(fract(x), fill);
      }
      float mxStripAverage(float x, float period, float fill, float footprint) {
        float span = max(0.0001, footprint / period);
        if (span >= 2.0) return fill;
        float centre = x / period + 0.5 * fill;
        return clamp((mxStripIntegral(centre + 0.5 * span, fill) -
          mxStripIntegral(centre - 0.5 * span, fill)) / span, 0.0, 1.0);
      }
    `, 'fragment');
    injectAfter(shader, 'emissivemap_fragment', /* glsl */ `
      vec2 mxPanelPixel = fwidth(vMxDisplayMetres);
      if (vMxDisplayMetres.x >= 0.0) {
        vec2 xy = vMxDisplayMetres;
        // Light travels through the black mask and under the upper lip of
        // each emitter. Distant cabinets retain their average open area.
        float cell = mxStripAverage(xy.x, 0.009, 0.67, mxPanelPixel.x)
                   * mxStripAverage(xy.y, 0.009, 0.71, mxPanelPixel.y);
        float joint = (1.0 - mxStripAverage(xy.x, 0.96, 0.0065, mxPanelPixel.x))
                    * (1.0 - mxStripAverage(xy.y, 0.32, 0.012, mxPanelPixel.y));
        float facing = saturate(abs(dot(normalize(vViewPosition), normal)));
        float louvre = mix(0.34, 1.0, smoothstep(0.05, 0.76, facing));
        totalEmissiveRadiance *= (0.16 + 1.84 * cell) * joint * louvre;
        diffuseColor.rgb = mix(vec3(0.014, 0.018, 0.021), diffuseColor.rgb, 0.19 * joint);
      } else {
        totalEmissiveRadiance = vec3(0.0);
      }
    `, 'fragment');
  });
}
