import * as T from 'three';

/**
 * Heat tint of the tailpipe. A titanium or nickel-alloy exhaust grows a thin
 * oxide film whose thickness follows the temperature it has seen; the film
 * colours the metal by thin-film interference (three's physical iridescence
 * lobe, oxide index ~2.2): blue at the outlet lip, where the hottest gas
 * leaves, through purple and bronze to straw and gold upstream. It is an
 * authored wear state of the part, not a live temperature or engine signal.
 *
 * The tint is position-gated inside the car's shared turned-alloy material:
 * only fragments inside the tailpipe envelope (car frame, metres: on the
 * centreline, below the crash structure, between the gearbox face and the
 * outlet) carry the film, so the exhaust needs no material or draw of its own
 * and every other alloy part keeps its plain metal response.
 */
export const EXHAUST_TINT = Object.freeze({
  /** Envelope: |x| below `halfWidth`, y in [yMin, yMax], z in [zTip, zUpstream]. */
  halfWidth: 0.075,
  yMin: -0.145,
  yMax: 0.035,
  zTip: -2.215,
  zUpstream: -1.88,
  /** Pipe axis (authored tailpipe centre) for the circumferential mottling. */
  axisY: -0.076,
  /** Oxide thickness (nm) at the outlet lip (hottest: blue) and fully
   * upstream (straw to gold). */
  tipNm: 82,
  upstreamNm: 30,
  /** Mottling amplitude (nm) around and along the pipe. */
  mottleNm: 9,
  /** Film strength and the oxide's refractive index. */
  strength: 1,
  ior: 2.2,
  /** Roughness added by the oxidised, heat-cycled surface. */
  roughness: 0.08,
});

const HOOK_KEY = 'exhaust-heat-tint-v1';
const installed = new WeakSet<T.MeshPhysicalMaterial>();
const f = (v: number, digits = 4) => v.toFixed(digits);

/** Give the shared alloy material its tailpipe oxide film. Idempotent. */
export function installExhaustHeatTint(material: T.MeshPhysicalMaterial) {
  if (installed.has(material)) return material;
  installed.add(material);
  const t = EXHAUST_TINT;
  // A non-zero iridescence compiles the thin-film path; the shader sets the
  // per-fragment strength to zero outside the tailpipe envelope.
  material.iridescence = t.strength;
  material.iridescenceIOR = t.ior;
  material.iridescenceThicknessRange = [
    Math.min(t.tipNm, t.upstreamNm) - t.mottleNm,
    Math.max(t.tipNm, t.upstreamNm) + t.mottleNm,
  ];
  const previous = material.onBeforeCompile,
    previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vExhaustLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvExhaustLocal=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vExhaustLocal;
        float apexExhaustMask() {
          vec3 p = vExhaustLocal;
          return (1.0 - smoothstep(${f(t.halfWidth - 0.012)}, ${f(t.halfWidth)}, abs(p.x)))
            * smoothstep(${f(t.yMin)}, ${f(t.yMin + 0.012)}, p.y)
            * (1.0 - smoothstep(${f(t.yMax - 0.012)}, ${f(t.yMax)}, p.y))
            * smoothstep(${f(t.zTip - 0.006)}, ${f(t.zTip + 0.006)}, p.z)
            * (1.0 - smoothstep(${f(t.zUpstream - 0.012)}, ${f(t.zUpstream)}, p.z));
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = min(1.0, roughnessFactor + ${f(t.roughness)} * apexExhaustMask());`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_IRIDESCENCE
        {
          float exhaustMask = apexExhaustMask();
          vec3 ep = vExhaustLocal;
          // 0 at the outlet lip, 1 upstream towards the gearbox face.
          float along = clamp((ep.z - (${f(t.zTip)})) / ${f(t.zUpstream - t.zTip)}, 0.0, 1.0);
          float around = atan(ep.y - (${f(t.axisY)}), ep.x);
          // Uneven cooling: broad bands around and along the pipe, filtered
          // to their mean once they are under a pixel.
          vec2 mottleP = vec2(around * 3.0 + ep.z * 23.0, ep.z * 61.0 - around * 1.3);
          float mottleResolved = 1.0 - smoothstep(0.6, 2.0, max(length(dFdx(mottleP)), length(dFdy(mottleP))));
          float mottle = (sin(mottleP.x) * 0.6 + sin(mottleP.y) * 0.4) * mottleResolved;
          material.iridescence *= exhaustMask;
          material.iridescenceThickness = mix(${f(t.tipNm, 1)}, ${f(t.upstreamNm, 1)}, along * along * (3.0 - 2.0 * along))
            + ${f(t.mottleNm, 1)} * mottle;
        }
        #endif`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey}|${HOOK_KEY}`;
  material.userData.exhaustHeatTint = true;
  return material;
}
