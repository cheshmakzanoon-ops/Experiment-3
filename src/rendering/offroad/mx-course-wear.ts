import { clamp, mod, smooth } from '../../core/math.ts';
import type { OffroadCourse } from '../../simulation/offroad/course.ts';

/** Prepared-soil emphasis, not contact, grip or a recorded tyre trail.
 * Launch and landing use the surveyed faces; air is the less-trafficked
 * ground between them. Berm carries the actual wall's signed strength.
 * Values are independent of time, weather and the current terrain state. */
export interface MxCourseWearSample {
  launch: number;
  landing: number;
  air: number;
  berm: number;
}

export const mxCourseWearSample = (): MxCourseWearSample => ({
  launch: 0,
  landing: 0,
  air: 0,
  berm: 0,
});

/** One allocation-free sample per terrain row. The short shoulders of each
 * envelope survive the one-metre render grid without painting abrupt bars
 * across the course. A landing is tied to its downslope, not to an invented
 * speed/ballistic arc. Riders may still roll or case every feature. */
export function sampleMxCourseWear(
  course: OffroadCourse,
  station: number,
  curvature: number,
  out: MxCourseWearSample,
) {
  out.launch = out.landing = out.air = out.berm = 0;
  const length = course.length;
  for (const jump of course.jumps) {
    // Unwrap around this feature; the same source row at 0 and lap length
    // must produce identical attributes, including a feature near the seam.
    const centre = (jump.start + jump.end) / 2,
      s = centre + mod(station - centre + length / 2, length) - length / 2,
      takeoffRun = Math.max(0.5, jump.takeoff - jump.start),
      landingFrom = jump.landing - jump.landingLength / 2;
    const launch =
      smooth(jump.start - 4, jump.start + Math.min(2.5, takeoffRun * 0.45), s) *
      (1 - smooth(jump.takeoff - 0.1, jump.takeoff + 1.8, s));
    const landing =
      smooth(landingFrom - 1, jump.landing, s) *
      (1 - smooth(jump.landing + jump.landingLength * 0.25, jump.end + 6, s));
    out.launch = Math.max(out.launch, launch);
    out.landing = Math.max(out.landing, landing);
    // Only a surveyed clearable gap/deck has a quiet middle. Retain ridden
    // marks there for short/rolled jumps; this weight never erases session
    // deformation. A low crest is still predominantly ridden ground.
    const gapFrom = jump.takeoff + 1.8,
      gapTo = landingFrom - 0.6,
      gap = gapTo - gapFrom;
    if (gap > 2) {
      const edge = Math.min(3.6, gap * 0.4),
        flight = smooth(gapFrom, gapFrom + edge, s) * (1 - smooth(gapTo - edge, gapTo, s)),
        share = jump.kind === 'crest' ? 0.3 : jump.forgiving ? 0.7 : 1;
      out.air = Math.max(out.air, flight * share);
    }
  }
  for (const berm of course.spec.berms) {
    const span = mod(berm.to - berm.from, length),
      into = mod(station - berm.from, length);
    if (!(span > 0) || into >= span) continue;
    // Match the longitudinal wall ramp in OffroadCourse.relief exactly.
    const ramp = Math.min(7, span / 3),
      envelope = smooth(0, ramp, into) * (1 - smooth(span - ramp, span, into)),
      side = berm.side ?? (curvature > 0 ? -1 : 1),
      strength = envelope * clamp(berm.height / 1.2, 0, 1);
    if (strength > Math.abs(out.berm)) out.berm = side * strength;
  }
  return out;
}
