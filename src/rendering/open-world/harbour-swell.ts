import type * as T from 'three';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { useStudioUniforms } from '../studio/studio-frame.ts';

/** Two long waves passing through the sheltered harbour. The k vectors are
 * inverse metres, height is metres and the phases use simulation seconds. */
const trains = [
  { kx: 0.105, kz: 0.147, amplitude: 0.078, phase: 0.43 },
  { kx: -0.31, kz: 0.115, amplitude: 0.027, phase: 2.15 },
].map((w) => ({ ...w, omega: Math.sqrt(9.81 * Math.hypot(w.kx, w.kz)) }));
const centreX = 735,
  centreZ = -2980;

export function harbourWaveHeight(x: number, z: number, time: number) {
  let height = 0;
  for (const w of trains)
    height +=
      w.amplitude *
      Math.sin(w.kx * (x - centreX) + w.kz * (z - centreZ) - w.omega * time + w.phase);
  return height;
}

export interface HullAttitude {
  heave: number;
  pitch: number;
  roll: number;
}

/** Fit a support plane through four points distributed along the launch's
 * waterline. Averaging over the real footprint filters shorter waves. */
export function sampleLaunchAttitude(
  x: number,
  z: number,
  yaw: number,
  time: number,
  pose: HullAttitude,
) {
  const s = Math.sin(yaw),
    c = Math.cos(yaw);
  const halfLength = 3.24,
    halfBeam = 1.32;
  const bow = harbourWaveHeight(x + s * halfLength, z + c * halfLength, time),
    stern = harbourWaveHeight(x - s * halfLength, z - c * halfLength, time),
    port = harbourWaveHeight(x + c * halfBeam, z - s * halfBeam, time),
    starboard = harbourWaveHeight(x - c * halfBeam, z + s * halfBeam, time);
  pose.heave = (bow + stern + port + starboard) * 0.25;
  pose.pitch = -Math.atan2(bow - stern, 2 * halfLength);
  pose.roll = Math.atan2(port - starboard, 2 * halfBeam);
}

export function installHarbourSwell(material: T.MeshPhysicalMaterial) {
  return chainShaderHook(material, 'solvane-sheltered-swell-v1', (shader) => {
    useStudioUniforms(shader, ['studioTime'], 'fragment');
    // vViewPosition exists on the standard physical material. Recovering xz
    // also works for the world-space coastal ribbon without a new varying.
    const slopes = trains
      .map(
        (w) => `{
      vec2 k = vec2(${w.kx.toFixed(6)}, ${w.kz.toFixed(6)});
      slope += ${w.amplitude.toFixed(6)} * k * cos(dot(k, harbourXZ) - studioTime * ${w.omega.toFixed(8)} + ${w.phase.toFixed(6)});
    }`,
      )
      .join('\n');
    injectAfter(
      shader,
      'clearcoat_normal_fragment_maps',
      `{
      vec2 harbourXZ = cameraPosition.xz + (vec4(-vViewPosition, 0.0) * viewMatrix).xz - vec2(${centreX.toFixed(1)}, ${centreZ.toFixed(1)});
      vec2 fade = 1.0 - smoothstep(vec2(190.0, 410.0), vec2(330.0, 580.0), abs(harbourXZ));
      float sheltered = fade.x * fade.y;
      if (sheltered > 0.0) {
        vec2 slope = vec2(0.0);
        ${slopes}
        vec3 tilt = (viewMatrix * vec4(-slope.x, 0.0, -slope.y, 0.0)).xyz * sheltered;
        normal = normalize(normal + tilt);
        #ifdef USE_CLEARCOAT
          clearcoatNormal = normalize(clearcoatNormal + tilt);
        #endif
      }
    }`,
      'fragment',
    );
  });
}
