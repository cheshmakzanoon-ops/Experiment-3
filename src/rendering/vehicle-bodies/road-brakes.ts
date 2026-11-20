import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { periodicCutGLSL } from './road-tyre-mould.ts';

/** The pad's swept annulus is polished steel; the vane edges and unworn
 * ridge keep their darker finish. The wear pattern turns with the disc. */
export function finishRoadRotor(
  material: T.MeshStandardMaterial,
  radius: number,
  slotted: boolean,
  mould: { value: T.Vector2 },
) {
  material.color.setHex(0x939391);
  chainShaderHook(material, `road-brake-${slotted ? 'slotted' : 'plain'}-v1`, (shader) => {
    shader.uniforms.rotorRadius = { value: radius };
    shader.uniforms.rotorMould = mould;
    injectDeclarations(shader, 'common', 'varying vec3 rotorLocal;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'rotorLocal=vec3(position.yz,abs(normal.x));', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `varying vec3 rotorLocal; uniform float rotorRadius; uniform vec2 rotorMould;
      ${slotted ? periodicCutGLSL : ''}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `
      float rotorR=length(rotorLocal.xy), track=rotorR/rotorRadius;
      float padBand=smoothstep(.59,.65,track)*(1.-smoothstep(.977,.997,track))*smoothstep(.77,.96,rotorLocal.z);
      float witness=cos(rotorR*3141.59)*(1.-smoothstep(.0003,.0011,fwidth(rotorR)));
      float transfer=.5+.5*sin(track*85.+.6*sin(track*23.));
      float rotorSlot=0.;
      ${
        slotted
          ? `float phase=atan(rotorLocal.y,rotorLocal.x)/6.2831853 + .064*(track-.78);
      vec2 tangent=vec2(-rotorLocal.y,rotorLocal.x)/(6.2831853*max(dot(rotorLocal.xy,rotorLocal.xy),.00001));
      float anglePixel=abs(dot(tangent,dFdx(rotorLocal.xy)))+abs(dot(tangent,dFdy(rotorLocal.xy)));
      rotorSlot=roadSipe(phase*8.,.008,8.*max(anglePixel,rotorMould.y))*smoothstep(.68,.72,track)*(1.-smoothstep(.915,.945,track));`
          : ''
      }
      diffuseColor.rgb*=mix(vec3(.53,.49,.44),vec3(.90+.08*transfer+.035*witness),padBand)*(1.-.56*rotorSlot*padBand);
    `,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor=mix(.64,.33+.11*transfer+.045*witness+.15*rotorSlot,padBand);',
      'fragment',
    );
    injectAfter(
      shader,
      'emissivemap_fragment',
      'totalEmissiveRadiance*=.18+.82*padBand;',
      'fragment',
    );
  });
}

/** The colour buffer keeps the cast paint, spring and retainers in one draw. */
export function caliperTint(g: T.BufferGeometry, hex: number) {
  const c = new T.Color(hex),
    data = new Uint16Array(g.getAttribute('position').count * 3);
  const r = Math.round(c.r * 65535),
    b = Math.round(c.b * 65535),
    green = Math.round(c.g * 65535);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = r;
    data[i + 1] = green;
    data[i + 2] = b;
  }
  g.setAttribute('color', new T.BufferAttribute(data, 3, true));
  return g;
}
