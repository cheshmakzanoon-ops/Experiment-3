import { H, F, carBase } from '../simulation/protocol.ts';

/** Small read-only observation for native QA and diagnostics. Never exposes a
 * live transferred buffer or introduces a second clock/physics calculation. */
export function motionReceipt(frame: Float32Array | null) {
  if (!frame) return null;
  const o = carBase(0);
  const value = {
    tick: frame[H.TICK],
    phase: frame[H.PHASE],
    time: frame[H.TIME],
    speed: frame[o + F.SPEED],
    throttle: frame[o + F.THROTTLE],
    x: frame[o + F.X],
    z: frame[o + F.Z],
  };
  return Object.values(value).every(Number.isFinite) ? value : null;
}
