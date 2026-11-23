import {
  BufferAttribute,
  Color,
  MeshStandardMaterial,
  Vector2,
  Vector3,
  Vector4,
  type BufferGeometry,
} from 'three';
import {
  TYRE_ART,
  TYRE_SIDEWALL_GLSL,
  tyreLetteringAtlas,
  wheelBlur,
} from './studio/tyre-letters.ts';
import { chainShaderHook } from './studio/shader-hooks.ts';
import { COMPOUNDS } from '../simulation/config.ts';
import { W } from '../simulation/protocol.ts';
import { wheelPhase, wheelValue } from './wheel-pose.ts';
import { PERIODIC_COVERAGE_GLSL } from './periodic-coverage.ts';
import treadShader from '../shaders/tread.frag?raw';

/** Immutable rubber coordinates, independent of glTF UV layout and live carcass
 * deflection. The reduced mesh's local Y axle is rotated to the same X convention.
 * Never change position/normal/UV/index data or the collision/contact geometry. */
export function bindTireSurface(geometry: BufferGeometry, axle: 'x' | 'y' = 'x') {
  if (geometry.hasAttribute('tireBind')) return geometry;
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Missing tyre positions');
  const values = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    if (!Number.isFinite(x + y + z)) throw new Error('Nonfinite tyre coordinates');
    values[i * 3] = axle === 'x' ? x : -y;
    values[i * 3 + 1] = axle === 'x' ? y : x;
    values[i * 3 + 2] = z;
  }
  geometry.setAttribute('tireBind', new BufferAttribute(values, 3));
  return geometry;
}

/** A bounded, instantaneous appearance observation, not a new fluid simulation.
 * Contact water is ignored for unloaded tyres. No wall clock, state accumulation
 * or hidden drying timer: a replay seek reproduces the same material. */
export function tireWetAppearance(rain: number, water: number, load: number, speed: number) {
  if (
    !Number.isFinite(rain) ||
    !Number.isFinite(water) ||
    !Number.isFinite(load) ||
    !Number.isFinite(speed)
  )
    return 0;
  return Math.max(
    0,
    Math.min(
      1,
      Math.max(rain / 14, load > 20 ? (Math.max(0, water) * Math.max(2, Math.abs(speed))) / 25 : 0),
    ),
  );
}

/** Tread surface temperature (deg C) to its appearance: 0 at or below 45 C
 * (cold, matte), 1 at 95 C and above (in the window, tacky). Bounded, and a
 * non-finite reading is treated as cold. */
export function tireHeatAppearance(surfaceTemp: number) {
  if (!Number.isFinite(surfaceTemp)) return 0;
  const t = Math.max(0, Math.min(1, (surfaceTemp - 45) / 50));
  return t * t * (3 - 2 * t);
}

const compoundStyles = Object.values(COMPOUNDS);

/** One live tyre set per car corner. All levels see the same compound and
 * condition, including the first image drawn by a new rear-view feed. */
export function formulaTreadState(halfWidth: number) {
  if (!Number.isFinite(halfWidth) || halfWidth < 0.1 || halfWidth > 0.25)
    throw new Error('Invalid tyre material width');
  const condition = { value: new Vector4() };
  // wet appearance, drainage style (0 slick / 1 intermediate / 2 wet), half-width
  const surface = { value: new Vector3(0, 0, halfWidth) };
  // Sidewall (D12): compound band colour, rotational blur 0..1 and lettering on/off.
  const band = { value: new Color(0xf5c400) };
  const side = { value: new Vector2(0, 0) };
  const lettering = { value: tyreLetteringAtlas() };
  side.value.y = lettering.value ? 1 : 0;
  const sidewall = { value: new Color(TYRE_ART.sidewall.color) };
  // Tread temperature appearance, 0 cold (matte, greyer) to 1 in the window (darker, tacky sheen).
  const heat = { value: 0 };
  const flat = { value: 0 };
  const roll = { value: new Vector2(1, 0) };
  return { condition, surface, band, side, lettering, sidewall, heat, flat, roll };
}
export type FormulaTreadState = ReturnType<typeof formulaTreadState>;

export function sampleFormulaTread(
  state: FormulaTreadState,
  a: Float32Array,
  b: Float32Array,
  o: number,
  wheel: number,
  t: number,
  compound: number,
  rain: number,
  speed: number,
  nonSpinning = false,
) {
  state.band.value.setHex((compoundStyles[compound] ?? COMPOUNDS.medium).color);
  state.side.value.x = wheelBlur(wheelValue(a, b, o, wheel, W.OMEGA, t));
  state.condition.value.set(
    wheelValue(a, b, o, wheel, W.DIRT, t),
    wheelValue(a, b, o, wheel, W.WEAR, t),
    wheelValue(a, b, o, wheel, W.BLISTERING, t),
    wheelValue(a, b, o, wheel, W.GRAINING, t),
  );
  state.surface.value.x = tireWetAppearance(
    rain,
    wheelValue(a, b, o, wheel, W.WATER, t),
    wheelValue(a, b, o, wheel, W.LOAD, t),
    speed,
  );
  state.surface.value.y = compound === 3 ? 1 : compound === 4 ? 2 : 0;
  state.heat.value = tireHeatAppearance(wheelValue(a, b, o, wheel, W.SURFACE_TEMP, t));
  state.flat.value = wheelValue(a, b, o, wheel, W.FLAT, t);
  if (nonSpinning) {
    const phase = wheelPhase(a, b, o, wheel, t);
    state.roll.value.set(Math.cos(phase), Math.sin(phase));
  }
}

/** APX rubber has rotating bind coordinates. The other Formula cars have
 * axle-fixed tyre meshes, so rotate only their optical footprint into tyre
 * space; the load and shear deformation stays anchored to the ground. */
export function treadMaterial(
  halfWidth = 0.155,
  axle?: {
    material: MeshStandardMaterial;
    radius: number;
    state: FormulaTreadState;
  },
) {
  const state = axle?.state ?? formulaTreadState(halfWidth);
  const { condition, surface, band, side, lettering, sidewall, heat, flat, roll } = state;
  const material = axle?.material ?? new MeshStandardMaterial();
  material.color.setHex(TYRE_ART.tread.color);
  material.roughness = TYRE_ART.tread.roughness;
  const size = { value: 0.335 / (axle?.radius ?? 0.335) };
  chainShaderHook(
    material,
    'formula-tread-sidewall-' + (axle ? 'axle' : 'spin') + '-v5',
    (shader) => {
      shader.uniforms.treadFlat = flat;
      if (axle) {
        shader.uniforms.treadRoll = roll;
        shader.uniforms.treadSize = size;
      }
      shader.uniforms.treadCondition = condition;
      shader.uniforms.treadSurface = surface;
      shader.uniforms.treadBandColor = band;
      shader.uniforms.treadSide = side;
      shader.uniforms.tireLettering = lettering;
      shader.uniforms.treadSidewallColor = sidewall;
      shader.uniforms.treadHeat = heat;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vTireBind;\n' +
            (axle
              ? 'uniform vec2 treadRoll; uniform float treadSize;'
              : 'attribute vec3 tireBind;'),
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n' +
            (axle
              ? `vTireBind = vec3(position.x, treadSize * vec2(
          dot(treadRoll,position.yz), dot(vec2(-treadRoll.y,treadRoll.x),position.yz)));`
              : 'vTireBind=tireBind;'),
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
        uniform vec4 treadCondition; uniform vec3 treadSurface;
        uniform vec3 treadBandColor; uniform vec2 treadSide; uniform vec3 treadSidewallColor;
        uniform sampler2D tireLettering;
        uniform float treadHeat; uniform float treadFlat;
        varying vec3 vTireBind;
        ${PERIODIC_COVERAGE_GLSL}`,
        )
        .replace(
          '#include <map_fragment>',
          '#include <map_fragment>\n' +
            treadShader +
            TYRE_SIDEWALL_GLSL +
            // A cold slick reads matte and a touch grey; in its window the
            // compound darkens and goes tacky. Crown only, wet film unchanged.
            '\ndiffuseColor.rgb *= mix(1.0, mix(1.07, 0.86, treadHeat), tireCrown * (1. - tireGroove));',
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
        // Material relief only. The tyre silhouette/contact geometry is unchanged.
        float tireHeight = -.0015 * tireGroove + tireWearRelief;
        vec3 tireSigmaX = dFdx(-vViewPosition), tireSigmaY = dFdy(-vViewPosition);
        vec3 tireR1 = cross(tireSigmaY, normal), tireR2 = cross(normal, tireSigmaX);
        float tireDet = dot(tireSigmaX, tireR1);
        vec3 tireGradient = sign(tireDet) * (dFdx(tireHeight) * tireR1 + dFdy(tireHeight) * tireR2);
        normal = normalize(max(abs(tireDet), 1.e-10) * normal - tireGradient);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
        // D12: fresh slick .75 rising to .82 scrubbed; sidewall .58; ink a touch glossier.
        roughnessFactor = mix(${TYRE_ART.sidewall.roughness.toFixed(2)}, roughnessFactor + ${(TYRE_ART.tread.scrubbed - TYRE_ART.tread.roughness).toFixed(2)} * clamp(treadCondition.y * 2., 0., 1.), tireCrown) - .08 * tireInk;
        roughnessFactor -= .1 * treadHeat * tireCrown * (1. - tireGroove);
        roughnessFactor = clamp(roughnessFactor - .32 * tireWet * (1. - tireGroove)
          + .07 * tireGroove + .06 * clamp(treadCondition.x, 0., 1.), .4, 1.);`,
        );
    },
  );
  return { material, ...state };
}
