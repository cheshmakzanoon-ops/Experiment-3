import type * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';

/** The UV stores wheel-plane metres before the two front discs and rear
 * stamping enter the rigid batches. The rear occupies the next UV tile. */
export function gpRotorCoordinates(geometry: T.BufferGeometry, rear: boolean) {
  const p = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, (rear ? 1 : 0) + p.getY(i), p.getZ(i));
  return geometry;
}

export function installGpRotorFinish(
  material: T.MeshStandardMaterial,
  rearGlow: { value: number },
) {
  return chainShaderHook(material, 'gp-swept-brake-tracks-v1', (shader) => {
    shader.uniforms.gpRearRotorGlow = rearGlow;
    injectDeclarations(
      shader,
      'common',
      'varying vec2 vGpRotorPlane; varying float vGpRearDisc;',
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      `
      vGpRearDisc = step(.5, uv.x);
      vGpRotorPlane = uv - vec2(vGpRearDisc, 0.);
    `,
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      `
      varying vec2 vGpRotorPlane; varying float vGpRearDisc;
      uniform float gpRearRotorGlow;
      float gpSweptBand; float gpPadBurnish;
    `,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `
      float gpR = length(vGpRotorPlane);
      float gpPixel = max(fwidth(gpR), .00003);
      float gpInner = mix(.115, .082, vGpRearDisc);
      float gpOuter = mix(.17, .11, vGpRearDisc);
      gpSweptBand = smoothstep(gpInner + .001 - gpPixel, gpInner + .003 + gpPixel, gpR) *
        (1. - smoothstep(gpOuter - .002 - gpPixel, gpOuter - .0004 + gpPixel, gpR));
      // Fine lapping rings average to zero once their pitch is below a pixel.
      float gpGroove = sin(gpR * 6283.) * (1. - smoothstep(.00020,.00076,gpPixel));
      float gpPath = (gpR - gpInner) / (gpOuter - gpInner);
      gpPadBurnish = .5 + .5 * sin(gpPath * 24. + sin(gpPath * 9.));
      vec3 gpCarbon = diffuseColor.rgb * mix(.92, 1.18 + .22*gpPadBurnish + .13*gpGroove, gpSweptBand);
      vec3 gpSteel = mix(vec3(.12,.134,.145), vec3(.23,.247,.25) * (1. + .10*gpGroove), gpSweptBand);
      diffuseColor.rgb = mix(gpCarbon, gpSteel, vGpRearDisc);
    `,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `
      roughnessFactor = mix(mix(.68,.49-.07*gpPadBurnish,gpSweptBand),
        mix(.49,.32-.035*gpPadBurnish,gpSweptBand), vGpRearDisc);
    `,
      'fragment',
    );
    injectAfter(
      shader,
      'metalnessmap_fragment',
      'metalnessFactor = mix(.15, .88, vGpRearDisc);',
      'fragment',
    );
    injectAfter(
      shader,
      'emissivemap_fragment',
      `
      totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(.55, .045, .012) * gpRearRotorGlow, vGpRearDisc) *
        gpSweptBand * (.78 + .22 * gpPadBurnish);
    `,
      'fragment',
    );
  });
}
