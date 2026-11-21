import * as T from 'three';
import type { GpTyreAppearance } from '../gp-tyre-finish.ts';
import { retainMxTyreLettering } from './mx-tyre-lettering.ts';
import type { MudUniforms } from './mud.ts';
import { SM_ROAD_GROOVE_GLSL, SM_TREAD_CHANNELS } from './motocross-road-tread.ts';
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
#ifdef MX_STAMPED_SIDEWALL
uniform sampler2D mxTyreLettering;
#endif
// This entrant's deposited coat and its moisture (the bike's mud uniforms).
uniform float mxTyreMudCoat, mxTyreMudWet;
float mxTyreHeight, mxTyreRoughness;
`;
const SAMPLE = /* glsl */ `
{
  vec3 p = vMxTyreBind.xyz;
  float axle = step(.5, vMxTyreBind.w);
  vec2 condition = mix(mxTyreFront, mxTyreRear, axle);
  vec2 dimensions = mix(mxTyreDimensions.xy, mxTyreDimensions.zw, axle);
#ifdef MX_SUPERMOTO_TYRE
  float halfWidth = mix(.060, .085, axle);
#else
  float halfWidth = mix(.042, .06, axle);
#endif
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
#ifdef MX_STAMPED_SIDEWALL
  // Bound the radial strip between bead and crown on each carcass. Sample
  // the opposite side in its own reading direction. Analytic derivatives
  // keep the mip stable as the atan seam rotates through the contact patch.
  float ringSpan = mix(.027, .032, axle);
  float ring = (radial - dimensions.y - mix(.025, .036, axle)) / ringSpan;
  float turn = -sign(p.x) / 6.2831853;
  vec2 printUv = vec2(.5 + angle * turn, 1. - (axle * 64. + 57. - ring * 50.) / 128.);
  vec2 tangent = vec2(-p.z, p.y) * (turn / max(radial * radial, .0001));
  vec2 gradX = vec2(dot(tangent, dFdx(p.yz)), dFdx(radial) * 50. / (128. * ringSpan));
  vec2 gradY = vec2(dot(tangent, dFdy(p.yz)), dFdy(radial) * 50. / (128. * ringSpan));
  if (detail > .0 && ring > .0 && ring < 1. && across > .54) {
    vec2 ink = textureGrad(mxTyreLettering, printUv, gradX, gradY).rg * detail *
      smoothstep(.54, .76, across);
    mxTyreHeight += .00055 * ink.r;
    diffuseColor.rgb *= 1. + .46 * ink.r;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.39,.24,.062) * (1. - .4 * water), ink.g * .82);
    mxTyreRoughness -= ink.r * .045;
  }
#endif
#ifdef MX_SUPERMOTO_TYRE
  // Staggered channels sweep outwards from the uncut centre strip. Keep
  // integer repeats at the angular seam and fade sub-pixel rubber relief.
  float repeats = mix(${SM_TREAD_CHANNELS.front.toFixed(1)}, ${SM_TREAD_CHANNELS.rear.toFixed(1)}, axle);
  float pitch = dimensions.x * (6.2831853 / repeats);
  float antialias = clamp(pixel * .7, .00025, .003);
  float channel = mxRoadGroove(angle * (repeats / 6.2831853), p.x / halfWidth, pitch, antialias) *
    smoothstep(dimensions.x - halfWidth * .7, dimensions.x - halfWidth * .48, radial) * detail;
  mxTyreHeight -= .0018 * channel * (1. - .58 * wear);
  diffuseColor.rgb *= 1. - .24 * channel;
  mxTyreRoughness = mix(mxTyreRoughness, .83 - .24 * water, channel);
#else
  // Packed tread: clay fills the block roots between the knobs from the
  // carcass up, while knob tops scrub clean on the ground. The fill level
  // rises with this entrant's coat (wet clay packs higher than dry crumbs),
  // so worn knob edges stand proud of a lumpy, darker band of soil.
  float coat = clamp(mxTyreMudCoat, 0., 1.);
  if (coat > .01) {
    float wetClay = clamp(mxTyreMudWet, 0., 1.);
    float lumps = sin(angle * 37. + p.x * 211.) * sin(angle * 23. - p.x * 157.);
    float crumbs = sin(angle * 151. + p.x * 613.) * sin(angle * 97. - p.x * 887.);
    float root = dimensions.x - .016;
    float level = root + .016 * coat * mix(.18, .82, wetClay) * (.78 + .22 * lumps);
    // Only the tread band and its shoulders: the sidewall below stays rubber
    // (the splatter layer still reaches it).
    float band = (1. - smoothstep(.92, 1.22, across)) *
      smoothstep(root - .024, root - .009, radial);
    float edge = max(pixel * .7, .0004);
    // Dry fines settle patchily; wet clay packs every void.
    float patchy = mix(.5 + .5 * smoothstep(-.45, .55, lumps + .35 * crumbs), 1., wetClay);
    float packed = band * smoothstep(.01, .16, coat) * patchy *
      (1. - smoothstep(level - edge, level + edge, radial));
    vec3 clay = mix(vec3(.205, .15, .092), vec3(.06, .041, .025), mix(.35, 1., wetClay));
    diffuseColor.rgb = mix(diffuseColor.rgb, clay * (1. + .1 * lumps + .06 * crumbs * detail), packed);
    mxTyreRoughness = mix(mxTyreRoughness, mix(.95, .4, wetClay) + .04 * crumbs, packed);
    mxTyreHeight += packed * ((.0004 + .00035 * lumps) * detail +
      .00012 * crumbs * fine * (1. - wetClay));
  }
#endif
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
  mud?: MudUniforms,
  tread: 'knobby' | 'road' = 'knobby',
  stamped = false,
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
  const road = tread === 'road';
  const stamp = stamped && !road ? retainMxTyreLettering(material) : undefined;
  chainShaderHook(
    material,
    road ? 'supermoto-tyre-finish-v1' : stamp ? 'motocross-stamped-tyre-v1' : 'motocross-tyre-finish-v1',
    (shader) => {
      if (stamp) shader.uniforms.mxTyreLettering = { value: stamp };
      shader.uniforms.mxTyreFront = front;
      shader.uniforms.mxTyreRear = rear;
      shader.uniforms.mxTyreDimensions = {
        value: new T.Vector4(frontRadius, frontRim, rearRadius, rearRim),
      };
      // The same uniform objects as the mud layer: one coat state per entrant.
      shader.uniforms.mxTyreMudCoat = mud?.offroadMud ?? { value: 0 };
      shader.uniforms.mxTyreMudWet = mud?.offroadMudWet ?? { value: 0 };
      injectDeclarations(
        shader,
        'common',
        'attribute vec4 mxTyreBind; varying vec4 vMxTyreBind;',
        'vertex',
      );
      injectAfter(shader, 'begin_vertex', 'vMxTyreBind = mxTyreBind;', 'vertex');
      injectDeclarations(
        shader,
        'common',
        (road ? '#define MX_SUPERMOTO_TYRE\n' + SM_ROAD_GROOVE_GLSL : '') +
          (stamp ? '#define MX_STAMPED_SIDEWALL\n' : '') + DECLARATIONS,
        'fragment',
      );
      injectBefore(shader, 'color_fragment', SAMPLE, 'fragment');
      injectDeclarations(
        shader,
        'roughnessmap_fragment',
        'roughnessFactor = mxTyreRoughness;',
        'fragment',
      );
      injectDeclarations(shader, 'normal_fragment_maps', NORMAL, 'fragment');
    },
  );
  return finish;
}
