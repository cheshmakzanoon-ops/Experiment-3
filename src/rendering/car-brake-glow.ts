import * as T from 'three';

/**
 * Planckian colour of an incandescent carbon brake rotor: linear sRGB with the
 * red channel at 1 (the out-of-gamut deep red of a blackbody below ~1000 K is
 * clipped onto the sRGB red primary), tabulated against a D65 white. A rotor
 * that has just begun to glow is a dull cherry red, one at race temperature is
 * orange and an overheated one tends towards yellow. Only the hue is derived
 * here; the brightness remains the recorded-temperature ramp in car.ts.
 */
export const ROTOR_BLACKBODY = Object.freeze({
  kelvin: Object.freeze([800, 1000, 1200, 1400, 1600, 1800, 2000] as const),
  green: Object.freeze([0.012, 0.0395, 0.0865, 0.1301, 0.1714, 0.2086, 0.2542] as const),
  blue: Object.freeze([0, 0, 0, 0, 0, 0, 0.006] as const),
});

/** Write the blackbody hue of a rotor at `celsius` into `out` (linear sRGB). A
 * non-finite reading is treated as the coolest tabulated (darkest red) hue. */
export function rotorGlowColour(celsius: number, out: T.Color) {
  const knots = ROTOR_BLACKBODY.kelvin;
  const kelvin = Number.isFinite(celsius) ? celsius + 273.15 : knots[0];
  const x = Math.max(knots[0], Math.min(knots[knots.length - 1], kelvin));
  let i = 0;
  while (i < knots.length - 2 && x > knots[i + 1]) i++;
  const t = (x - knots[i]) / (knots[i + 1] - knots[i]);
  const g = ROTOR_BLACKBODY.green,
    b = ROTOR_BLACKBODY.blue;
  return out.setRGB(
    1,
    g[i] + (g[i + 1] - g[i]) * t,
    b[i] + (b[i + 1] - b[i]) * t,
    T.LinearSRGBColorSpace,
  );
}

/**
 * Where a rotor glows. The pads sweep the outer friction band, so it carries
 * the heat; the bore and the inner rim run cooler, and the vent and drilled
 * holes read hotter (a cavity radiates closer to a blackbody than the open
 * face). Radii are fractions of the rotor's own outer radius measured about its
 * spin (local X) axis, so the authored hero rotor and the procedural one share
 * the profile. Emission only: no light, uniform, texture or render pass.
 */
export const ROTOR_GLOW_PROFILE = Object.freeze({
  /** Glow rises from this fraction of the outer radius... */
  inner: 0.52,
  /** ...and is full from here outwards. */
  band: 0.72,
  /** Brightening of a face fragment seen at grazing incidence (hot rim edge). */
  rim: 0.35,
});

const ROTOR_GLOW_HOOK = 'rotor-incandescence-v1';
const installed = new WeakSet<T.MeshStandardMaterial>();

/** Concentrate the rotor's emissive glow on its friction band. `outerRadius` is
 * the rotor's outer radius in its local metres. */
export function installRotorGlow(material: T.MeshStandardMaterial, outerRadius: number) {
  if (!Number.isFinite(outerRadius) || outerRadius <= 0.02 || outerRadius > 0.5)
    throw new Error('Invalid rotor radius');
  if (installed.has(material)) return material;
  installed.add(material);
  const previous = material.onBeforeCompile,
    previousKey = material.customProgramCacheKey();
  const inner = (ROTOR_GLOW_PROFILE.inner * outerRadius).toFixed(5),
    band = (ROTOR_GLOW_PROFILE.band * outerRadius).toFixed(5);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRotorLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRotorLocal=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRotorLocal;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // Friction band (pads) hot, bore cooler; filtered radial ramp.
          float rotorR = length(vRotorLocal.yz);
          float rotorBand = smoothstep(${inner}, ${band}, rotorR);
          // Vent/drill walls and the outer rim face sideways to the spin axis:
          // seen edge-on, the cavity-like surfaces glow brighter.
          float rotorRim = 1.0 - abs(dot(normal, normalize(vViewPosition)));
          totalEmissiveRadiance *= rotorBand * (1.0 + ${ROTOR_GLOW_PROFILE.rim.toFixed(3)} * rotorRim * rotorRim);
        }`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey}|${ROTOR_GLOW_HOOK}`;
  return material;
}
