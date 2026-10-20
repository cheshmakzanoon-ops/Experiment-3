import { mod, smooth } from '../../core/math.ts';

/** Prepared corner-entry chop, authored in lap metres and track lateral
 * metres. These shallow transverse ridges are actual ground, not a normal
 * map: a rider can choose the worn entry or the smoother parallel line.
 * Dimensions are game authoring values, not measurements from references. */
export interface BrakingBumpSpec {
  name: string;
  from: number;
  to: number;
  /** Centre and compact-support half width of the worked line (m). */
  centre: number;
  halfWidth: number;
  /** Maximum raised soil height and typical crest spacing (m). */
  height: number;
  spacing: number;
}

export interface BrakingBumpSample {
  h: number;
  ds: number;
  dl: number;
  /** Continuous worked-soil footprint, shared with the material. */
  work: number;
}

export const brakingBumpSample = (): BrakingBumpSample => ({ h: 0, ds: 0, dl: 0, work: 0 });

function derivative(a: number, b: number, x: number) {
  if (x <= a || x >= b) return 0;
  const t = (x - a) / (b - a);
  return (6 * t * (1 - t)) / (b - a);
}

/** Allocation-free, deterministic C1 relief with analytical derivatives.
 * Every footprint has a quiet run-in/run-out and fades to untouched ground
 * across the lane. The phase bends slightly across the track and the crest
 * height varies, avoiding identical full-width speed-bump stripes. */
export function sampleBrakingBumps(
  spans: readonly BrakingBumpSpec[],
  s: number,
  lateral: number,
  length: number,
  out: BrakingBumpSample,
) {
  out.h = out.ds = out.dl = out.work = 0;
  for (const span of spans) {
    const run = mod(span.to - span.from, length),
      into = mod(s - span.from, length),
      across = lateral - span.centre,
      distance = Math.abs(across);
    if (!(run > 0) || into >= run || distance >= span.halfWidth) continue;
    const ramp = Math.min(5, run / 4),
      entry = smooth(0, ramp, into),
      exit = 1 - smooth(run - ramp, run, into),
      along = entry * exit,
      dAlong = derivative(0, ramp, into) * exit - entry * derivative(run - ramp, run, into),
      core = span.halfWidth * 0.25,
      lane = 1 - smooth(core, span.halfWidth, distance),
      dLane = -derivative(core, span.halfWidth, distance) * Math.sign(across),
      envelope = along * lane,
      k = (Math.PI * 2) / span.spacing,
      phase = into * k + 0.22 * Math.sin(across * 0.8) + 0.11 * Math.sin(into * 0.47),
      phaseS = k + 0.0517 * Math.cos(into * 0.47),
      phaseL = 0.176 * Math.cos(across * 0.8),
      crest = (1 - Math.cos(phase)) * 0.5,
      crestSlope = Math.sin(phase) * 0.5,
      variation = 0.85 + 0.15 * Math.cos(into * 0.31 + across * 0.24),
      dVariation = -0.15 * Math.sin(into * 0.31 + across * 0.24),
      ridge = crest * variation,
      ridgeS = crestSlope * phaseS * variation + crest * dVariation * 0.31,
      ridgeL = crestSlope * phaseL * variation + crest * dVariation * 0.24;
    out.h += span.height * envelope * ridge;
    out.ds += span.height * lane * (dAlong * ridge + along * ridgeS);
    out.dl += span.height * along * (dLane * ridge + lane * ridgeL);
    out.work = Math.max(out.work, envelope);
  }
  return out;
}
