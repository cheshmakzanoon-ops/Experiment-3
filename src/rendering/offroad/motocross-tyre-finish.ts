import * as T from 'three';
import type { GpTyreAppearance } from '../gp-tyre-finish.ts';
import {
  chainShaderHook,
  injectAfter,
  injectBefore,
  injectDeclarations,
} from '../studio/shader-hooks.ts';

/** Immutable wheel-local metres survive batching and wheel rotation. The last
 * component identifies the axle, so both tyres can retain one material and
 * still use their own recorded wear/water. No per-frame vertex uploads. */
export function bindMotocrossTyre<G extends T.BufferGeometry>(geometry: G, front: boolean): G {
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Missing motocross tyre positions');
  const values = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    if (![x, y, z].every(Number.isFinite)) throw new Error('Non-finite motocross tyre geometry');
    values.set([x, y, z, front ? 0 : 1], i * 4);
  }
  // tyreGeometry is shared with the road bikes. MX needs only its own binding;
  // matching carcass/tread attributes also lets the two become one rigid draw.
  geometry.deleteAttribute('gpTyreBind');
  geometry.setAttribute('mxTyreBind', new T.BufferAttribute(values, 4));
  return geometry;
}

export interface MotocrossTyreFinish {
  front: T.IUniform<T.Vector2>;
  rear: T.IUniform<T.Vector2>;
  update(state: GpTyreAppearance): void;
}
const finishes = new WeakMap<T.Material, MotocrossTyreFinish>();
const finite = (value: number | undefined, maximum: number) =>
  Number.isFinite(value) ? T.MathUtils.clamp(value!, 0, maximum) : 0;

const DECLARATIONS = /* glsl */ `
varying vec4 vMxTyreBind;
uniform vec2 mxTyreFront, mxTyreRear;
// Radius and rim radius of each axle, in metres.
uniform vec4 mxTyreDimensions;
float mxTyreHeight, mxTyreRoughness;
`;
const SAMPLE = /* glsl */ `
{
  vec3 p = vMxTyreBind.xyz;
  float axle = step(.5, vMxTyreBind.w);
  vec2 condition = mix(mxTyreFront, mxTyreRear, axle);
  vec2 dimensions = mix(mxTyreDimensions.xy, mxTyreDimensions.zw, axle);
  float halfWidth = mix(.042, .06, axle);
  float radial = length(p.yz), across = abs(p.x) / halfWidth;
  float crown = (1. - smoothstep(.7, 1.12, across)) *
    smoothstep(dimensions.x - .035, dimensions.x - .009, radial);
  float sidewall = smoothstep(.65, .94, across) *
    (1. - smoothstep(dimensions.x - .032, dimensions.x - .015, radial));
  float pixel = length(fwidth(p));
  float fine = 1. - smoothstep(.0007, .003, pixel);
  float detail = 1. - smoothstep(.003, .012, pixel);
  // Integer harmonics close at the angular seam. Broad abrasion stays visible
  // on block faces, while millimetre grain fades before it starts sparkling.
  float angle = atan(p.z, p.y);
  float streak = sin(angle * 67. + p.x * 370. + sin(angle * 11.) * .6);
  float grain = sin(p.x * 1771. + p.y * 1291.) * sin(p.z * 1489. - p.y * 797.);
  float wear = sqrt(condition.x);
  float water = 1. - exp(-condition.y * 1.65);
  float scuff = wear * crown * detail;
  // Two shallow moulding bands around the bead and restrained radial ribs.
  // They are rubber relief, without painted lighting or a licensed wordmark.
  float bands = exp(-pow((radial - dimensions.y - .012) / .0015, 2.)) +
    .65 * exp(-pow((radial - dimensions.y - .023) / .0012, 2.));
  float rib = pow(.5 + .5 * cos(angle * 84.), 8.) *
    smoothstep(dimensions.y + .028, dimensions.y + .035, radial) *
    (1. - smoothstep(dimensions.x - .044, dimensions.x - .034, radial));
  mxTyreHeight = (.00024 * bands + .00009 * rib) * sidewall * detail +
    .000035 * streak * scuff + .000014 * grain * fine * crown;
  diffuseColor.rgb *= (1. + scuff * (.13 + streak * .055) + grain * .025 * fine) *
    mix(1., .6, water);
  mxTyreRoughness = clamp(mix(.77, .92 - wear * .14, crown) +
    .035 * streak * scuff - .24 * water, .46, .96);
}
`;
const NORMAL = /* glsl */ `
{
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 r1 = cross(dy, normal), r2 = cross(normal, dx);
  float determinant = dot(dx, r1);
  vec3 gradient = sign(determinant) *
    (dFdx(mxTyreHeight) * r1 + dFdy(mxTyreHeight) * r2);
  normal = normalize(max(abs(determinant), 1.e-10) * normal - gradient);
}
`;

/** References 005/009/014 distinguish dull sidewalls, open block roots and
 * worked crown faces. This authored material interpretation reads existing
 * wheel observations; it neither invents a wear clock nor alters tyre grip,
 * radius or suspension. Mud is applied after the rubber finish. */
export function installMotocrossTyreFinish(
  material: T.MeshStandardMaterial,
  frontRadius: number,
  frontRim: number,
  rearRadius: number,
  rearRim: number,
): MotocrossTyreFinish {
  const existing = finishes.get(material);
  if (existing) return existing;
  const front = { value: new T.Vector2() },
    rear = { value: new T.Vector2() };
  const finish: MotocrossTyreFinish = {
    front,
    rear,
    update(state) {
      front.value.set(finite(state.frontWear, 1), finite(state.frontWater, 5));
      rear.value.set(finite(state.rearWear, 1), finite(state.rearWater, 5));
    },
  };
  finishes.set(material, finish);
  chainShaderHook(material, 'motocross-tyre-finish-v1', (shader) => {
    shader.uniforms.mxTyreFront = front;
    shader.uniforms.mxTyreRear = rear;
    shader.uniforms.mxTyreDimensions = {
      value: new T.Vector4(frontRadius, frontRim, rearRadius, rearRim),
    };
    injectDeclarations(
      shader,
      'common',
      'attribute vec4 mxTyreBind; varying vec4 vMxTyreBind;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'vMxTyreBind = mxTyreBind;', 'vertex');
    injectDeclarations(shader, 'common', DECLARATIONS, 'fragment');
    injectBefore(shader, 'color_fragment', SAMPLE, 'fragment');
    injectDeclarations(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = mxTyreRoughness;',
      'fragment',
    );
    injectDeclarations(shader, 'normal_fragment_maps', NORMAL, 'fragment');
  });
  return finish;
}
