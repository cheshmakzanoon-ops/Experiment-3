import { clamp } from '../core/math.ts';
import { F, carBase } from '../simulation/protocol.ts';

/** Rev-limiter and pit-limiter flutter. A combustion engine on its limiter cuts
 * fuel in bursts: the note bounces. The first rig run found nothing of the kind:
 * the voice simply held its top note, so the player had no audible cue to shift
 * and the pit limiter (the HUD's PIT LIMITER state) was silent. Both are pure
 * functions of the recorded snapshot, so a replay bounces on the same frames. */
export interface LimiterFlutter {
  /** 0 (steady) to 1: how deep the gain bounces. */
  depth: number;
  /** Bounce rate (Hz). */
  rateHz: number;
}

/** Revs within this of the limiter count as "on the limiter". */
export const LIMITER_BAND_RPM = 60;
export const REV_LIMITER_RATE_HZ = 12;
export const PIT_LIMITER_RATE_HZ = 6;
/** Deepest bounce (fraction of the voice gain the cut removes). */
export const REV_LIMITER_DEPTH = 0.6;
export const PIT_LIMITER_DEPTH = 0.45;

/** The pit-lane limiter is on in the entry and exit phases (the HUD's rule, ui/interface.ts). */
export function pitLimiterOn(frame: Float32Array, car: number): boolean {
  const o = carBase(car),
    phase = frame[o + F.PIT_PHASE];
  return frame[o + F.IN_PIT] > 0 && (phase === 1 || phase === 6);
}

export function limiterFlutter(
  frame: Float32Array,
  car: number,
  limiterRPM: number,
  out: LimiterFlutter = { depth: 0, rateHz: REV_LIMITER_RATE_HZ },
): LimiterFlutter {
  const o = carBase(car),
    rpm = frame[o + F.RPM],
    throttle = frame[o + F.THROTTLE],
    gear = frame[o + F.GEAR];
  out.depth = 0;
  out.rateHz = REV_LIMITER_RATE_HZ;
  if (!Number.isFinite(rpm + throttle + gear)) return out;
  if (pitLimiterOn(frame, car) && frame[o + F.SPEED] > 4) {
    out.depth = PIT_LIMITER_DEPTH;
    out.rateHz = PIT_LIMITER_RATE_HZ;
  }
  // On the rev limiter with the throttle down: the cut flutters harder than the pit limiter.
  if (limiterRPM > 0 && rpm >= limiterRPM - LIMITER_BAND_RPM && throttle > 0.6 && gear > 0) {
    const into = clamp((rpm - (limiterRPM - LIMITER_BAND_RPM)) / LIMITER_BAND_RPM, 0, 1);
    out.depth = Math.max(out.depth, REV_LIMITER_DEPTH * (0.6 + 0.4 * into));
    out.rateHz = REV_LIMITER_RATE_HZ;
  }
  return out;
}
