import { clamp, lerp, mod } from '../../core/math.ts';
import { motocrossBermSoil, type BermSoil } from './berm-practice.ts';
import type { OffroadCourse } from './course.ts';
import { isMotocrossLandingTarget, type LandingChallengeResult } from './landing-challenge.ts';
import type { JumpSurvey } from './profile.ts';
import { LANDING_RULES } from './riding-feedback.ts';

export interface MotocrossFlowSection {
  readonly id: number;
  readonly name: string;
  readonly jumps: readonly JumpSurvey[];
  readonly from: number;
  readonly to: number;
  readonly length: number;
}

/** Linked sections use the production jump survey, including the corner or
 * rollers between faces. The sequence names do not create another racing
 * line, target speed, terrain profile or reward for clearing unsafe gaps. */
export function motocrossFlowSections(course: OffroadCourse): MotocrossFlowSection[] {
  const plans =
    course.kind === 'motocross'
      ? ([
          ['RIDGE TO BARN', ['RIDGE TABLE', 'BARN DOUBLE']],
          ['SKY TO VALLEY', ['SKY TRIPLE', 'SUMMIT TABLE', 'VALLEY DOUBLE']],
        ] as const)
      : course.kind === 'supercross'
        ? ([
            ['RHYTHM LANE', ['TRIPLE', 'LANE DOUBLE']],
            ['FINISH RUN', ['TABLETOP', 'FINISH TRIPLE']],
          ] as const)
        : [];
  const sections: MotocrossFlowSection[] = [];
  for (const [name, names] of plans) {
    const jumps = names.map((name) => course.jumps.find((jump) => jump.name === name));
    if (jumps.some((jump) => !jump || !isMotocrossLandingTarget(jump))) continue;
    const surveyed = jumps as JumpSurvey[];
    const from = mod(surveyed[0].start - 8, course.length);
    const last = surveyed[surveyed.length - 1];
    const to = mod(Math.max(last.end, last.landing + last.landingLength / 2) + 8, course.length);
    sections.push({
      id: sections.length,
      name,
      jumps: surveyed,
      from,
      to,
      length: mod(to - from, course.length),
    });
  }
  return sections;
}

export interface MotocrossFlowSample {
  course: object;
  machine: string;
  sections: readonly MotocrossFlowSection[];
  length: number;
  time: number;
  s: number;
  speed: number;
  lateral: number;
  legalHalfWidth: number;
  moisture: number;
  airborne: boolean;
  crashed: boolean;
  /** Human control outside replay, cautions, the pits and retirement. */
  eligible: boolean;
  /** The existing landing judge owns placement and suspension settlement. */
  landing: LandingChallengeResult | null;
}

export interface MotocrossFlowResult {
  section: MotocrossFlowSection;
  at: number;
  seconds: number;
  soil: BermSoil;
  exitSpeed: number;
  delta: number | null;
  improved: boolean;
}

export interface MotocrossFlowAttempt {
  section: MotocrossFlowSection;
  startedAt: number;
  elapsed: number;
  progress: number;
  linked: number;
  soil: BermSoil;
  exitAt: number | null;
  exitSpeed: number;
  /** Deduplicate only this traversal, including after a presentation seek. */
  lastLandingAt: number;
}

/** A clean sequence, not an arbitrary string of hops. All named features
 * must be landed in order on one observed forward passage. The stopwatch
 * includes the connecting corner, rollers and stops. A section is finished
 * at its surveyed exit; delayed presentation of settlement cannot alter the
 * measured exit time. Records are local to this machine/assist/session. */
export class MotocrossFlowPractice {
  readonly history = new Map<
    number,
    { attempts: number; best: MotocrossFlowResult; last: MotocrossFlowResult }
  >();
  active: MotocrossFlowAttempt | null = null;
  last: MotocrossFlowResult | null = null;
  private course: object | null = null;
  private machine = '';
  private time = -Infinity;
  private s = 0;
  private speed = 0;
  private moisture = 0;
  private airborne = false;
  private ready = false;

  record(section: MotocrossFlowSection, soil: BermSoil) {
    return this.history.get(section.id * 3 + (soil === 'wet' ? 2 : soil === 'damp' ? 1 : 0));
  }

  reset() {
    this.history.clear();
    this.last = null;
    this.course = null;
    this.machine = '';
    this.time = -Infinity;
    this.suspend();
  }

  suspend() {
    this.active = null;
    this.last = null;
    this.ready = false;
  }

  update(sample: MotocrossFlowSample) {
    if (
      ![
        sample.time,
        sample.s,
        sample.speed,
        sample.lateral,
        sample.legalHalfWidth,
        sample.moisture,
        sample.length,
      ].every(Number.isFinite) ||
      sample.length <= 0 ||
      sample.legalHalfWidth <= 0
    ) {
      this.reset();
      return;
    }
    if (sample.course !== this.course || sample.machine !== this.machine) this.reset();
    const valid =
      sample.eligible &&
      !sample.crashed &&
      sample.speed >= 0 &&
      Math.abs(sample.lateral) <= sample.legalHalfWidth;
    if (sample.time === this.time) {
      if (!valid) this.suspend();
      return;
    }
    const dt = sample.time - this.time;
    const s = mod(sample.s, sample.length);
    const step = mod(s - this.s + sample.length / 2, sample.length) - sample.length / 2;
    const continuous =
      this.ready &&
      valid &&
      dt > 0 &&
      dt <= 2 &&
      step >= -0.03 &&
      step <= Math.max(3, (this.speed + sample.speed) * 0.5 * dt * 1.8 + 1);
    if (!continuous) this.suspend();
    if (continuous && step > 0 && !this.active && !this.airborne && !sample.airborne) {
      for (const section of sample.sections) {
        const distance = mod(section.from - this.s, sample.length);
        // Modular subtraction can differ by a few ulps when a packet lands
        // exactly on the surveyed station. Do not lose that observed entry.
        if (distance === 0 || distance > step + 1e-7) continue;
        const fraction = clamp(distance / step, 0, 1);
        this.active = {
          section,
          startedAt: lerp(this.time, sample.time, fraction),
          elapsed: 0,
          progress: 0,
          linked: 0,
          soil: motocrossBermSoil(lerp(this.moisture, sample.moisture, fraction)),
          exitAt: null,
          exitSpeed: 0,
          lastLandingAt: -Infinity,
        };
        break;
      }
    }
    const active = this.active;
    if (active) {
      const travelled = mod(s - active.section.from, sample.length);
      active.elapsed = sample.time - active.startedAt;
      active.progress = clamp(travelled / active.section.length, 0, 1);
      const landing = sample.landing;
      if (
        landing &&
        landing.at > active.lastLandingAt &&
        landing.at >= active.startedAt &&
        landing.at <= sample.time
      ) {
        active.lastLandingAt = landing.at;
        const expected = active.section.jumps[active.linked];
        if (landing.kind === 'target' && expected?.takeoff === landing.jump.takeoff)
          active.linked++;
        else this.active = null;
      }
      const expected = active.section.jumps[active.linked];
      // A rolled, missed or unobserved target cannot be skipped. Give the
      // existing judge time to observe its settling window before rejecting.
      if (
        expected &&
        travelled >
          mod(expected.end - active.section.from, sample.length) +
            Math.max(8, sample.speed * (LANDING_RULES.settleSeconds + 0.2))
      )
        this.active = null;
      if (this.active && active.exitAt === null && step > 0) {
        const distance = mod(active.section.to - this.s, sample.length);
        if (distance <= step + 1e-7) {
          const fraction = clamp(distance / step, 0, 1);
          active.exitAt = lerp(this.time, sample.time, fraction);
          active.exitSpeed = lerp(this.speed, sample.speed, fraction);
        }
      }
      if (this.active && active.exitAt !== null && active.linked === active.section.jumps.length) {
        const previous = this.record(active.section, active.soil);
        const seconds = active.exitAt - active.startedAt;
        const delta = previous ? seconds - previous.best.seconds : null;
        const result: MotocrossFlowResult = {
          section: active.section,
          at: active.exitAt,
          seconds,
          soil: active.soil,
          exitSpeed: active.exitSpeed,
          delta,
          improved: delta !== null && delta < -0.005,
        };
        const key =
          active.section.id * 3 + (active.soil === 'wet' ? 2 : active.soil === 'damp' ? 1 : 0);
        this.history.set(key, {
          attempts: (previous?.attempts ?? 0) + 1,
          best: !previous || seconds < previous.best.seconds ? result : previous.best,
          last: result,
        });
        this.last = result;
        this.active = null;
      }
    }
    this.course = sample.course;
    this.machine = sample.machine;
    this.time = sample.time;
    this.s = s;
    this.speed = sample.speed;
    this.moisture = sample.moisture;
    this.airborne = sample.airborne;
    this.ready = valid;
  }
}
