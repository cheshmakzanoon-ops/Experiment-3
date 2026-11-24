import type * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** The survey gives the height of placed earth above the original hillside
 * and the grade falling away from the track. These select exposed fill on a
 * built jump or the back of a berm, independent of the venue's elevation. */
export function installMxCutBank(material: T.MeshPhysicalMaterial) {
  return chainShaderHook(material, 'mx-cut-bank-v1', shader => {
    injectDeclarations(shader, 'common', 'varying vec2 vMxFill;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vMxFill = mxSoilTopo.yz;', 'vertex');
    injectDeclarations(shader, 'common',
      'varying vec2 vMxFill;\nfloat mxBankHeight = 0.;\nfloat mxBankPacking = 0.;', 'fragment');
    injectAfter(shader, 'color_fragment', /* glsl */ `{
      float edge = abs(vMxCourse.x) - vMxCourseWidth;
      float cut = smoothstep(-.25, .8, edge) * smoothstep(.11, .48, vMxFill.x)
        * smoothstep(.10, .45, vMxFill.y);
      vec2 footprint = fwidth(vApexWorld.xz);
      float heightPixel = fwidth(vMxFill.x);
      if (cut > .001) {
        vec2 ground = vApexWorld.xz;
        float broad = mxSoilNoise(ground * .29);
        float fracture = mxSoilNoise(ground * 2.6 + vec2(7., 19.));
        // A succession of irregular lifts, measured from the natural soil.
        // Their damp beds follow the hillside and feather out at the crest.
        float height = vMxFill.x + .18 * (broad - .5) + .035 * (fracture - .5);
        float lifts = height * 3.68 + .24 * sin(height * 4.2 + broad * 2.);
        float layer = .5 + .5 * cos(6.2831853 * lifts);
        float shelf = smoothstep(.55, .96, layer) * (1. - smoothstep(.035,.16,heightPixel));
        float lens = smoothstep(.34,.76,broad * .7 + fracture * .3) * shelf;
        // Runoff cuts across the flank, down the slope. Variable spacing
        // and broken ends keep the channels local to the exposed bank.
        float phase = vMxCourse.y * floor(mxCourseLength * 1.37) / mxCourseLength
          + .55 * broad + .17 * sin(height * 2.3 + 7. * broad);
        float groove = (1. - smoothstep(.025,.13,abs(fract(phase)-.5)))
          * smoothstep(.30,.68,fracture * .34 + broad * .66)
          * (1. - smoothstep(.06,.26,length(footprint)));
        float damp = (1. - smoothstep(.12,.66,vMxFill.x)) * (.45 + .55 * broad);
        diffuseColor.rgb *= mix(vec3(1.), vec3(.85,.78,.71) +
          vec3(.21,.215,.20) * broad + vec3(.25,.23,.185) * lens
          - vec3(.14,.115,.085) * (groove + damp), cut);
        mxBankHeight = cut * (.012 * lens - .020 * groove);
        mxBankPacking = cut * (.04 * lens + .09 * damp);
      }
    }`, 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', 'roughnessFactor *= 1. - mxBankPacking;', 'fragment');
    injectAfter(shader, 'normal_fragment_maps', /* glsl */ `{
      vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
      vec3 r1 = cross(dy, normal), r2 = cross(normal, dx);
      float det = dot(dx, r1);
      normal = normalize(max(abs(det), 1e-8) * normal - sign(det) *
        (dFdx(mxBankHeight) * r1 + dFdy(mxBankHeight) * r2));
    }`, 'fragment');
  });
}
