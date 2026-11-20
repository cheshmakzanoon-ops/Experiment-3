import type { Vector3 } from 'three';
import { MX_RAKE } from './motocross-axles.ts';

/** Swept slots around each SM450 tyre. The same mould determines the rubber
 * missing from the wheel and the clay left uncompressed at its contact patch. */
export const SM_TREAD_CHANNELS = { front: 20, rear: 24 } as const;

const rakeCos = Math.cos(MX_RAKE);
const rakeSin = Math.sin(MX_RAKE);

/** Ground-normal angle around a stationary wheel's axle, measured in its
 * local YZ plane. The even slot counts put the same phase at top and bottom. */
export function smRoadContactAngle(bodyNormal: Vector3, front: boolean, steer: number) {
  if (!front) return Math.atan2(bodyNormal.z, bodyNormal.y);
  // Undo the fork rake, then undo bar steering, as on the displayed hub.
  const y = rakeCos * bodyNormal.y - rakeSin * bodyNormal.z;
  const z =
    Math.sin(steer) * bodyNormal.x +
    Math.cos(steer) * (rakeSin * bodyNormal.y + rakeCos * bodyNormal.z);
  return Math.atan2(z, y);
}

export const SM_ROAD_GROOVE_GLSL = /* glsl */ `
float mxRoadGroove(float wheelPhase, float side, float pitch, float aa) {
  float across = abs(side);
  float phase = wheelPhase + across * (.24 + .40 * across) + .5 * step(0., side);
  float distanceToSlot = abs(fract(phase + .5) - .5) * pitch;
  return (1. - smoothstep(.0022 - aa, .0022 + aa, distanceToSlot)) *
    smoothstep(.10, .24, across) * (1. - smoothstep(.85, .99, across));
}`;
