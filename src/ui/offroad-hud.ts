import type { SessionOptions } from '../simulation/config.ts';
import { rulesetFor } from '../simulation/events.ts';
import { offroadCourse } from '../simulation/offroad/venues.ts';
import {
  carBase,
  H,
  F,
  R,
  RACE_BASE,
  B,
  BIKE_BASE,
  O,
  OFFROAD_BASE,
} from '../simulation/protocol.ts';
import { PHASE } from '../simulation/race.ts';
import { FLAG } from '../simulation/marshal.ts';
import { trackPoint, type Track } from '../simulation/track.ts';
import { clamp, mod } from '../core/math.ts';
import { DEFAULT_BINDINGS, keyName, type Bindings } from '../input/bindings.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import { motocrossApproachCue, MotocrossRhythm } from '../simulation/offroad/rhythm-coach.ts';
import {
  isMotocrossLandingTarget,
  MotocrossLandingChallenge,
  type LandingChallengeResult,
} from '../simulation/offroad/landing-challenge.ts';
import { motocrossBrakeHeldInFlight } from './motocross-brake-cue.ts';
import {
  motocrossBermSectors,
  motocrossBermSoil,
  MotocrossBermPractice,
  type BermPracticeResult,
  type BermPracticeSector,
} from '../simulation/offroad/berm-practice.ts';
import {
  motocrossFlowSections,
  MotocrossFlowPractice,
  type MotocrossFlowSection,
} from '../simulation/offroad/flow-practice.ts';
import {
  assessMotocrossLanding,
  LANDING_RULES,
  motocrossAlignment,
} from '../simulation/offroad/riding-feedback.ts';

function alignment(frame: Float32Array, base: number) {
  const x = frame[base + F.QX],
    y = frame[base + F.QY],
    z = frame[base + F.QZ],
    w = frame[base + F.QW];
  return motocrossAlignment(
    2 * (x * z + w * y),
    1 - 2 * (x * x + y * y),
    frame[base + F.VX],
    frame[base + F.VZ],
  );
}

function clock(seconds: number) {
  if (!(seconds >= 0)) return '—';
  const m = Math.floor(seconds / 60),
    s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function placement(result: LandingChallengeResult) {
  const distance = Math.abs(result.miss);
  const position =
    result.miss === 0
      ? 'in the target'
      : `${distance < 0.1 ? '<0.1' : distance.toFixed(1)} m ${result.miss < 0 ? 'short' : 'long'}`;
  return `${position}${result.kind === 'rough' ? ' · rough contact' : ''}`;
}

const LANDING_SEVERITY = {
  clean: 0,
  firm: 1,
  'nose-low': 2,
  'nose-high': 2,
  sideways: 2,
  hard: 3,
  crash: 4,
} as const;
const BERM_RESULT_QUEUE_SECONDS = 12;
const BERM_RESULT_SHOW_SECONDS = 2.6;
/** The off-road readout for the player's entrant (WP42): one compact line
 * over the race HUD on terrain venues. Motocross / supercross: the gate pick
 * while held, the release, a jump start, the holeshot and the last jump's
 * air time; rallycross: joker laps taken of those required; rally stage:
 * the countdown to this car's start (queued, then at the control), a jump
 * start and the running stage time. Hidden on paved circuits. */
export class OffroadHud {
  private element: HTMLElement | null = null;
  private ride: HTMLElement | null = null;
  private rideFields: HTMLElement[] = [];
  private readonly rhythm = new MotocrossRhythm();
  private readonly targets = new MotocrossLandingChallenge();
  private readonly berms = new MotocrossBermPractice();
  private readonly flow = new MotocrossFlowPractice();
  private flowSections: readonly MotocrossFlowSection[] = [];
  private bermSectors: readonly BermPracticeSector[] = [];
  private bermResult: BermPracticeResult | null = null;
  private bermResultShownAt: number | null = null;
  private bermResultDismissed = false;
  private readonly targetPoint = trackPoint();
  private airUntil = 0;
  private airTime = 0;
  private landedAirTime = 0;
  private wasAirborne = false;
  private lastTrack: Track | null = null;
  private lastMachine = '';
  private lastTime = -Infinity;
  private landingAt = -Infinity;
  private landingSettled = false;
  private landingRough = false;
  private previousEligible = false;
  private flightEligible = false;
  private flightYaw = 0;
  private landingWhip = false;
  private landingSideways = 0;
  private landing: ReturnType<typeof assessMotocrossLanding> | null = null;
  private bodyKeys = `${keyName(DEFAULT_BINDINGS.riderForward)} / ${keyName(DEFAULT_BINDINGS.riderBack)}`;
  constructor(private readonly hud: HTMLElement) {}
  setBindings(bindings: Bindings) {
    this.bodyKeys = `${keyName(bindings.riderForward)} / ${keyName(bindings.riderBack)}`;
  }
  private node() {
    if (!this.element) {
      this.element = document.createElement('div');
      this.element.className = 'offroad-readout';
      this.element.setAttribute('role', 'status');
      this.element.style.cssText =
        'position:absolute;top:64px;left:50%;transform:translateX(-50%);padding:4px 12px;' +
        'font:600 13px/1.4 var(--font-mono, monospace);letter-spacing:.08em;color:#f1efe8;' +
        'background:rgba(12,13,15,.62);border-left:3px solid #c98b3c;pointer-events:none;white-space:nowrap';
      this.hud.appendChild(this.element);
    }
    return this.element;
  }
  private rideNode() {
    if (!this.ride) {
      this.ride = document.createElement('section');
      this.ride.className = 'mx-ride-hud';
      this.ride.setAttribute('aria-label', 'Motocross riding and practice information');
      // The numeric airtime changes continuously, so this is deliberately not
      // a live region. Only the discrete start/holeshot line uses role=status.
      this.ride.innerHTML =
        '<div class="mx-ride-heading"><span></span><span></span></div><div class="mx-ride-main"><strong></strong><b></b></div><div class="mx-ride-note"></div><div class="mx-ride-progress"><i></i></div>';
      this.rideFields = Array.from(
        this.ride.querySelectorAll<HTMLElement>(
          '.mx-ride-heading span, .mx-ride-main strong, .mx-ride-main b, .mx-ride-note',
        ),
      );
      this.hud.append(this.ride);
    }
    return this.ride;
  }
  private presentableBermResult(time: number, safe: boolean) {
    const result = this.berms.last;
    if (result !== this.bermResult) {
      this.bermResult = result;
      this.bermResultShownAt = null;
      this.bermResultDismissed = false;
    }
    if (!result || this.bermResultDismissed) return null;
    const age = time - result.at;
    // A short exit often leads straight onto a jump. Hold the measured
    // result until the approach, flight and landing have had their turn.
    // Only the latest corner is queued; old results never build a backlog.
    if (
      age < 0 ||
      (this.bermResultShownAt === null && age >= BERM_RESULT_QUEUE_SECONDS) ||
      (this.bermResultShownAt !== null &&
        (time < this.bermResultShownAt ||
          time - this.bermResultShownAt >= BERM_RESULT_SHOW_SECONDS))
    ) {
      this.bermResultDismissed = true;
      return null;
    }
    if (!safe) return null;
    this.bermResultShownAt ??= time;
    return result;
  }
  private updateRide(
    frame: Float32Array,
    track: Track,
    options: SessionOptions,
    airborne: boolean,
    playerControlled: boolean,
  ) {
    const course = offroadCourse(track.circuit)!;
    const targetCount = course.jumps.filter(isMotocrossLandingTarget).length;
    const node = this.rideNode(),
      base = carBase(0),
      o = base + OFFROAD_BASE;
    const s = mod(frame[base + F.S], track.length),
      time = frame[H.TIME];
    const crashed = frame[base + BIKE_BASE + B.STATE] > 0.5;
    const globalFlag = frame[H.FLAG],
      localFlag = frame[base + F.LOCAL_FLAG];
    const doubleYellow = globalFlag === FLAG.DOUBLE_YELLOW || localFlag === FLAG.DOUBLE_YELLOW;
    const caution = doubleYellow || globalFlag === FLAG.YELLOW || localFlag === FLAG.YELLOW;
    let next = course.jumps[0],
      distance = Infinity;
    for (const jump of course.jumps) {
      const d = mod(jump.start - s, track.length);
      if (s >= jump.start && s <= jump.end) {
        next = jump;
        distance = 0;
        break;
      }
      if (d < distance) {
        next = jump;
        distance = d;
      }
    }
    let heading = course.kind === 'supercross' ? 'SUPERCROSS' : 'MOTOCROSS';
    let tag = frame[o + O.MOISTURE] > 0.58 ? 'WET SOIL' : 'TRACK FLOW';
    let title = next?.name ?? 'FIND YOUR LINE',
      metric = next ? `${Math.round(distance)} M` : '';
    let note =
      options.assist === 'raw'
        ? `${this.bodyKeys}: shift weight · throttle and brake control pitch.`
        : `${this.bodyKeys}: shift weight · line up with the landing slope.`;
    let tone = 'approach',
      progress = next ? Math.round(clamp(1 - distance / 100, 0, 1) * 100) : 0;
    if (next && distance <= 0.01) {
      tag = next.kind.toUpperCase();
      metric = 'ON COURSE';
    }
    if (next) {
      const approach = motocrossApproachCue(
        next,
        mod(next.takeoff - s, track.length),
        frame[base + F.SPEED],
        frame[o + O.MOISTURE] > 0.58,
      );
      if (approach) {
        tag = `LIP ~${approach.targetKph} KM/H`;
        note = approach.cue;
        tone = approach.kind === 'roll' || approach.kind === 'ease' ? 'heavy' : 'approach';
        // Recall only this feature's own measured attempt while there is time
        // to read it. The face, flight, landing and caution cues below retain
        // priority. The surveyed reference remains advisory, never replaced
        // by a supposed guaranteed speed derived from the previous attempt.
        const previous = this.targets.history.get(next.takeoff)?.last;
        if (
          options.mode === 'practice' &&
          playerControlled &&
          previous &&
          distance > Math.max(10, frame[base + F.SPEED]) &&
          approach.kind !== 'roll'
        ) {
          note = `Last takeoff ${Math.round(previous.takeoffSpeed * 3.6)} km/h · ${placement(previous)}. ${approach.cue}`;
        }
      }
    }
    if (next && distance > 160) {
      title = 'BUILD YOUR RHYTHM';
      note = `Next: ${next.name.toLowerCase()} · ${Math.round(distance)} m`;
      metric = '';
      progress = 0;
    }
    if (options.mode === 'practice' && playerControlled && this.rhythm.completed > 0)
      heading += ` · RUN ${this.rhythm.streak}/3`;
    if (options.mode === 'practice' && targetCount > 0 && playerControlled)
      heading = `PRACTICE · TARGETS ${this.targets.cleared.size}/${targetCount}`;
    const flow = this.flow.active;
    if (options.mode === 'practice' && playerControlled) {
      if (flow)
        heading = `FLOW ${flow.section.id + 1} · ${flow.linked}/${flow.section.jumps.length} LINKED`;
      else {
        const approaching = this.flowSections.find((section) => section.jumps[0] === next);
        if (approaching && distance > 0 && distance < 100)
          heading = `FLOW ${approaching.id + 1} · ${approaching.name}`;
      }
    }
    const speed = frame[base + F.SPEED];
    const imminentJump = !!next && distance <= Math.max(25, speed * 1.5);
    const active = this.berms.active;
    const result = this.presentableBermResult(
      time,
      options.mode === 'practice' &&
        playerControlled &&
        !crashed &&
        !caution &&
        !airborne &&
        (!this.landing || time >= this.airUntil) &&
        !imminentJump &&
        !active &&
        speed >= 0 &&
        frame[base + F.IN_PIT] < 0.5 &&
        frame[base + F.RETIRED] < 0.5,
    );
    if (options.mode === 'practice' && playerControlled) {
      // Corners share the existing card. A close jump, its flight/landing,
      // recovery and race control keep priority over a practice stopwatch.
      if (!imminentJump) {
        if (active) {
          heading = 'BERM PRACTICE';
          tag = `${active.line.toUpperCase()} LINE`;
          title = active.sector.name;
          metric = `${active.elapsed.toFixed(2)} S`;
          const record = this.berms.record(active.sector, active.soil);
          note = record
            ? `Your best ${record.best.seconds.toFixed(2)} s · ${record.best.line} line. Keep the exit smooth.`
            : 'Choose your arc and carry a smooth drive out of the bank.';
          if (record && active.delta !== null) {
            tag = 'LIVE · VS YOUR BEST';
            const ahead = active.delta < -0.005;
            metric = `${ahead ? '−' : '+'}${Math.abs(active.delta).toFixed(2)} S`;
            note = `${active.elapsed.toFixed(2)} s elapsed · ${active.line} line. Best ${record.best.seconds.toFixed(2)} s on ${record.best.line}.`;
            tone = ahead ? 'clean' : active.delta > 0.005 ? 'heavy' : 'approach';
          }
          progress = Math.round(active.progress * 100);
        } else if (result) {
          heading = 'BERM PRACTICE';
          tag = result.improved ? 'NEW PERSONAL BEST' : `${result.line.toUpperCase()} LINE`;
          title = result.sector.name;
          metric = `${result.seconds.toFixed(2)} S`;
          const comparison =
            result.delta === null
              ? 'First timed run'
              : `${result.delta < -0.005 ? '−' : '+'}${Math.abs(result.delta).toFixed(2)} s to your previous best`;
          note = `${comparison} · exit ${Math.round(result.exitSpeed * 3.6)} km/h · ${result.soil} soil.`;
          tone = result.improved ? 'clean' : 'approach';
          progress = Math.round(
            clamp(1 - (time - this.bermResultShownAt!) / BERM_RESULT_SHOW_SECONDS, 0, 1) * 100,
          );
        } else {
          let nearest: BermPracticeSector | null = null;
          let bermDistance = Infinity;
          for (const sector of this.bermSectors) {
            const d = mod(sector.from - s, track.length);
            if (d < bermDistance) {
              nearest = sector;
              bermDistance = d;
            }
          }
          if (nearest && bermDistance < Math.min(70, distance)) {
            heading = 'BERM PRACTICE';
            tag = 'COMPARE YOUR LINES';
            title = nearest.name;
            metric = `${Math.round(bermDistance)} M`;
            const record = this.berms.record(nearest, motocrossBermSoil(frame[o + O.MOISTURE]));
            note = record
              ? `Your best ${record.best.seconds.toFixed(2)} s · ${record.best.line} line. Try another arc.`
              : 'Try the inside or a wider arc. Compare your own time and exit speed.';
            progress = Math.round(clamp(1 - bermDistance / 70, 0, 1) * 100);
          }
        }
      }
    }
    if (options.mode === 'race' && frame[H.PHASE] < PHASE.RACING) {
      heading = 'START GATE';
      tag = 'READY';
      title = 'WAIT FOR THE DROP';
      metric = `GATE ${Math.max(1, Math.round(frame[o + O.SLOT]))}`;
      note = 'Settle the bike. Pick your line into the first berm.';
      progress = 0;
    } else if (crashed) {
      tag = 'RECOVERY';
      title = 'RESET YOUR RHYTHM';
      metric = '';
      tone = 'crash';
      note = 'The rider is recovering. Prepare a smooth restart.';
      progress = 0;
    } else if (caution) {
      // A surveyed lip speed is not permission to jump under race control.
      // Already-airborne riders cannot roll a face: finish that landing first.
      heading = 'TRACK CAUTION';
      tag = doubleYellow ? 'DOUBLE YELLOW' : 'YELLOW FLAG';
      title = airborne ? 'LAND THEN SLOW DOWN' : 'ROLL THE NEXT JUMP';
      metric = airborne ? `${this.airTime.toFixed(2)} S` : '';
      note = airborne
        ? 'Match the downslope, then reduce speed. No overtaking.'
        : 'Reduce speed · no overtaking or jumping. Follow the marshal.';
      tone = 'heavy';
      progress = 0;
    } else if (airborne) {
      heading = 'IN FLIGHT';
      tag = next?.name ?? 'AIR';
      title = 'MATCH THE LANDING';
      metric = `${this.airTime.toFixed(2)} S`;
      tone = 'air';
      const yaw = Math.abs(alignment(frame, base).yaw);
      title = yaw > 0.18 ? 'BRING IT BACK' : 'MATCH THE LANDING';
      note =
        yaw > 0.18
          ? 'Release steering to square the wheels · throttle and brake set pitch.'
          : `Steer to whip · ${this.bodyKeys}: shift weight · throttle lifts, brake lowers.`;
      if (playerControlled && yaw <= 0.18 && motocrossBrakeHeldInFlight(frame)) {
        title = 'RELEASE THE BRAKE';
        note = 'Let the wheels roll before touchdown. A held brake drags the landing.';
        tone = 'heavy';
      }
      progress = Math.round(clamp(this.airTime / 2, 0, 1) * 100);
    } else if (time < this.airUntil && this.landing) {
      heading = 'LAST JUMP';
      tag =
        options.mode === 'practice' && playerControlled && this.rhythm.streak > 0
          ? `${this.rhythm.streak} CLEAN IN A ROW`
          : 'TOUCHDOWN';
      title = this.landing.label.toUpperCase();
      metric = `${this.landedAirTime.toFixed(2)} S`;
      note = this.landing.cue;
      if (
        this.landingWhip &&
        playerControlled &&
        this.landing.kind === 'clean' &&
        Number.isFinite(this.landingAt) &&
        time - this.landingAt >= LANDING_RULES.settleSeconds
      ) {
        title = 'WHIP LANDED';
        note = 'Squared up for touchdown. Carry the drive into the next section.';
      }
      if (options.mode === 'practice' && playerControlled && this.rhythm.streak >= 3)
        note = `Rhythm target reached · best run ${this.rhythm.best}. Keep it flowing.`;
      tone =
        this.landing.tone === 'good'
          ? 'clean'
          : this.landing.tone === 'warning'
            ? 'heavy'
            : 'landing';
      if (this.landing.kind === 'clean' && !this.landingSettled) {
        // First contact is provisional. An early rebound must not keep a
        // clean grade while the practice judge correctly rejects that jump.
        const rebound = !Number.isFinite(this.landingAt);
        title = rebound ? 'LANDING BOUNCE' : 'SETTLING';
        note = rebound
          ? 'Let both wheels settle before loading the next jump.'
          : 'Keep a steady line while the suspension settles.';
        tone = rebound ? 'heavy' : 'landing';
      }
      const target = this.targets.last;
      if (options.mode === 'practice' && playerControlled && target?.at === this.landingAt) {
        const count = this.targets.cleared.size;
        if (target.kind === 'target') {
          if (title !== 'WHIP LANDED') title = 'TARGET LANDED';
          tag = `${count}/${targetCount} LANDING TARGETS`;
          note =
            count === targetCount
              ? 'Every landing target cleared. Link them into one flowing lap.'
              : `${target.improvedBy >= 0.1 ? `${target.improvedBy.toFixed(1)} m closer · ` : ''}${target.jump.name} ${target.first ? 'cleared' : 'confirmed'} · ${targetCount - count} targets left.`;
          if (flow && flow.linked > 0) {
            tag = `FLOW ${flow.section.id + 1} · ${flow.linked}/${flow.section.jumps.length} LINKED`;
            const nextTarget = flow.section.jumps[flow.linked];
            note = nextTarget
              ? `${flow.section.name}: next ${nextTarget.name.toLowerCase()}. Carry the drive between landings.`
              : `${flow.section.name}: every target linked. Carry a smooth drive through the exit.`;
          }
        } else if (target.kind === 'rough') {
          tag = 'TARGET NOT CLEARED';
          // O.BOTTOM decays after contact. The target keeps every observed
          // settling sample, so explain a rejected attempt even if the latest
          // instantaneous landing grade has recovered to clean.
          if (this.landing.kind === 'clean') {
            title = 'SETTLE THE LANDING';
          }
          // A short hard contact should not repeat the generic instruction to
          // reduce the approach speed. Preserve specific pitch/alignment help;
          // otherwise explain the actual placement before the next attempt.
          const correction =
            this.landing.kind === 'nose-low' ||
            this.landing.kind === 'nose-high' ||
            this.landing.kind === 'sideways'
              ? this.landing.cue
              : target.miss < 0
                ? 'Reach the downslope, then match its angle and settle.'
                : target.miss > 0
                  ? 'Ease before the face and match the downslope.'
                  : 'Match the downslope and settle smoothly to clear it.';
          note = `Takeoff ${Math.round(target.takeoffSpeed * 3.6)} km/h · ${placement(target)}. ${correction}`;
          tone = 'heavy';
        } else if (this.landing.kind === 'clean') {
          tag = target.kind === 'short' ? 'SHORT OF TARGET' : 'PAST THE TARGET';
          metric = `${Math.abs(target.miss) < 0.1 ? '<0.1' : Math.abs(target.miss).toFixed(1)} M`;
          if (target.improvedBy >= 0.1) title = 'CLOSER THIS TIME';
          const adjustment =
            target.kind === 'short'
              ? 'Build before the face to reach the downslope.'
              : 'Ease before the face to meet the downslope.';
          note = `${target.improvedBy >= 0.1 ? `${target.improvedBy.toFixed(1)} m closer · takeoff` : 'Takeoff'} ${Math.round(target.takeoffSpeed * 3.6)} km/h. ${adjustment}`;
        }
      }
      progress = Math.round(clamp((this.airUntil - time) / 2.8, 0, 1) * 100);
    }
    const completedFlow = this.flow.last;
    if (
      options.mode === 'practice' &&
      playerControlled &&
      completedFlow &&
      time >= completedFlow.at &&
      time - completedFlow.at < 4 &&
      !crashed &&
      !caution &&
      !airborne &&
      !imminentJump &&
      (!this.landing || (this.landingSettled && this.landing.kind === 'clean'))
    ) {
      heading = `FLOW ${completedFlow.section.id + 1} · ${completedFlow.section.name}`;
      tag = completedFlow.improved ? 'NEW PERSONAL BEST' : 'SECTION LINKED';
      title = `${completedFlow.section.jumps.length} CLEAN TARGETS`;
      metric = `${completedFlow.seconds.toFixed(2)} S`;
      const comparison =
        completedFlow.delta === null
          ? 'First complete run'
          : `${completedFlow.delta < -0.005 ? '−' : '+'}${Math.abs(completedFlow.delta).toFixed(2)} s to your previous best`;
      note = `${comparison} · exit ${Math.round(completedFlow.exitSpeed * 3.6)} km/h · ${completedFlow.soil} entry.`;
      tone = 'clean';
      progress = Math.round(clamp(1 - (time - completedFlow.at) / 4, 0, 1) * 100);
    }
    node.hidden = false;
    node.dataset.tone = tone;
    const values = [heading, tag, title, metric, note];
    for (let i = 0; i < this.rideFields.length; i++)
      if (this.rideFields[i].textContent !== values[i]) this.rideFields[i].textContent = values[i];
    const width = `${progress}%`;
    if (node.style.getPropertyValue('--mx-progress') !== width)
      node.style.setProperty('--mx-progress', width);
  }
  /** The off-road part of the results card (WP42): the holeshot, joker laps
   * against the requirement, or each car's stage time; empty elsewhere. */
  results(
    frame: Float32Array,
    track: Track,
    options: SessionOptions,
    name: (id: number) => string,
  ) {
    if (!offroadCourse(track.circuit) || options.mode !== 'race') return '';
    const format = rulesetFor(options).format;
    if (!format) return '';
    const cars = Math.round(frame[H.CARS]),
      at = (id: number, field: number) => frame[carBase(id) + OFFROAD_BASE + field],
      ids = Array.from({ length: cars }, (_, id) => id);
    const escape = (text: string) =>
      text.replace(
        /[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
      );
    const lines: string[] = [];
    if (format.start === 'gate') {
      const hole = ids.find((id) => at(id, O.FORMAT) > 0.5);
      lines.push(`Holeshot: ${hole === undefined ? '—' : escape(name(hole))}.`);
      const jumped = ids.filter((id) => at(id, O.START) > 2.5).map((id) => escape(name(id)));
      if (jumped.length) lines.push(`Jump start (penalised): ${jumped.join(', ')}.`);
    }
    if (format.kind === 'rallycross') {
      const required = format.joker?.required ?? 1;
      lines.push(
        `Joker laps (${required} required, ${format.joker?.penaltySeconds ?? 0} s per difference): ` +
          ids.map((id) => `${escape(name(id))} ${Math.round(at(id, O.JOKERS))}`).join(' · ') +
          '.',
      );
    }
    if (format.kind === 'stage')
      lines.push(
        'Stage times: ' +
          ids
            .map(
              (id) => `${escape(name(id))} ${at(id, O.FORMAT) > 0 ? clock(at(id, O.FORMAT)) : '—'}`,
            )
            .join(' · ') +
          '.',
      );
    return `<p class="offroad-results">${lines.join('<br>')}</p>`;
  }
  update(
    frame: Float32Array,
    track: Track,
    options: SessionOptions,
    playerControlled = true,
    replay = false,
  ) {
    const course = offroadCourse(track.circuit);
    if (!course) {
      if (this.element) this.element.hidden = true;
      if (this.ride) this.ride.hidden = true;
      this.lastTrack = null;
      this.rhythm.reset();
      this.targets.reset();
      this.berms.reset();
      this.flow.reset();
      this.flowSections = [];
      this.bermSectors = [];
      this.bermResult = null;
      this.bermResultShownAt = null;
      this.bermResultDismissed = false;
      return;
    }
    const format = rulesetFor(options).format,
      player = carBase(0),
      o = carBase(0) + OFFROAD_BASE,
      phase = frame[H.PHASE],
      time = frame[H.TIME],
      parts: string[] = [];
    const machine = `${frame[player + RACE_BASE + R.VEHICLE]}:${options.assist}`;
    track.at(frame[player + F.S], this.targetPoint);
    const crashed = frame[player + BIKE_BASE + B.STATE] > 0.5;
    const cautioned = [frame[H.FLAG], frame[player + F.LOCAL_FLAG]].some(
      (flag) => flag === FLAG.YELLOW || flag === FLAG.DOUBLE_YELLOW,
    );
    const controlEligible =
      playerControlled &&
      !replay &&
      !crashed &&
      !cautioned &&
      frame[player + F.IN_PIT] < 0.5 &&
      frame[player + F.RETIRED] < 0.5 &&
      frame[player + F.SPEED] >= 0;
    const eligible =
      controlEligible &&
      Math.abs(frame[player + F.LATERAL]) <= Math.max(0, this.targetPoint.width - 0.3);
    if (track !== this.lastTrack) {
      this.bermSectors = motocrossBermSectors(track, course);
      this.flowSections = motocrossFlowSections(course);
    }
    if (time < this.lastTime) this.bermResultDismissed = true;
    // Snapshot time is nondecreasing outside a seek. Even a short rewind
    // across a takeoff must not look like a new touchdown in this frame.
    if (
      track !== this.lastTrack ||
      machine !== this.lastMachine ||
      time < this.lastTime ||
      time > this.lastTime + 2
    ) {
      this.airTime = this.landedAirTime = this.airUntil = 0;
      this.wasAirborne = false;
      this.landing = null;
      this.landingAt = -Infinity;
      this.landingSettled = false;
      this.landingRough = false;
      this.previousEligible = this.flightEligible = false;
      this.flightYaw = this.landingSideways = 0;
      this.landingWhip = false;
    }
    this.lastTrack = track;
    this.lastMachine = machine;
    this.lastTime = time;
    if (!eligible) this.flightEligible = this.landingWhip = false;
    // Air time of the last real jump, held for two seconds after landing.
    const airborne = frame[o + O.AIRBORNE] > 0.5;
    if (airborne) {
      this.airTime = frame[o + O.AIR_TIME];
      // A new flight owns its own touchdown measurements, including a tiny
      // rebound. It must never regrade the previous qualifying jump.
      if (!this.wasAirborne) {
        this.flightEligible =
          this.previousEligible &&
          eligible &&
          (!Number.isFinite(this.landingAt) || this.landingSettled);
        this.landingAt = -Infinity;
        this.flightYaw = 0;
      }
      const yaw = Math.abs(alignment(frame, carBase(0)).yaw);
      if (Number.isFinite(yaw)) this.flightYaw = Math.max(this.flightYaw, yaw);
    }
    if (this.wasAirborne && !airborne) {
      // Physics retains completed airtime until the next takeoff. Prefer its
      // final value to the last airborne presentation sample.
      const completedAirTime = Math.max(this.airTime, frame[o + O.AIR_TIME]);
      if (completedAirTime > 0.2) {
        this.landedAirTime = completedAirTime;
        this.airUntil = time + 2.8;
        this.landingAt = time;
        this.landing = null;
        this.landingSettled = false;
        this.landingRough = course.isRough(mod(frame[carBase(0) + F.S], track.length));
        this.landingWhip = this.flightYaw > 0.18 && this.flightEligible;
        this.landingSideways = Math.abs(alignment(frame, carBase(0)).lateralSpeed);
      }
    }
    // The spring can bottom a few frames after the first tyre contact. Keep
    // grading that short settling window rather than promising a clean landing
    // before the measured suspension and crash state have arrived.
    if (
      !airborne &&
      Number.isFinite(this.landingAt) &&
      time >= this.landingAt &&
      !this.landingSettled
    ) {
      const b = carBase(0);
      const spec = vehicleAt(Math.round(frame[b + RACE_BASE + R.VEHICLE])).bike?.offroad;
      this.landingSideways = Math.max(
        this.landingSideways,
        Math.abs(alignment(frame, b).lateralSpeed),
      );
      const observed = assessMotocrossLanding(
        frame[o + O.LANDING_PITCH],
        frame[o + O.LANDING_SPEED],
        frame[o + O.BOTTOM],
        frame[b + BIKE_BASE + B.STATE] > 0.5,
        spec,
        this.landingRough,
        this.landingSideways,
      );
      if (!this.landing || LANDING_SEVERITY[observed.kind] >= LANDING_SEVERITY[this.landing.kind])
        this.landing = observed;
      this.landingSettled = time - this.landingAt >= LANDING_RULES.settleSeconds;
    }
    const riderSpec = vehicleAt(Math.round(frame[player + RACE_BASE + R.VEHICLE])).bike?.offroad;
    const feedback = assessMotocrossLanding(
      frame[o + O.LANDING_PITCH],
      frame[o + O.LANDING_SPEED],
      frame[o + O.BOTTOM],
      frame[player + BIKE_BASE + B.STATE] > 0.5,
      riderSpec,
      course.isRough(mod(frame[player + F.S], track.length)),
      Number.isFinite(this.landingAt) ? this.landingSideways : 0,
    );
    const motocross = course.kind === 'motocross' || course.kind === 'supercross';
    if (replay) {
      this.targets.suspend();
      this.rhythm.suspend();
      this.berms.suspend();
      this.flow.suspend();
    } else if (motocross && options.mode === 'practice') {
      const s = frame[player + F.S];
      this.rhythm.update({
        course: track,
        machine,
        time,
        airborne,
        airTime: frame[o + O.AIR_TIME],
        crashed,
        eligible,
        landing: feedback,
      });
      this.targets.update({
        course: track,
        machine,
        jumps: course.jumps,
        length: track.length,
        time,
        s,
        speed: frame[player + F.SPEED],
        lateral: frame[player + F.LATERAL],
        halfWidth: this.targetPoint.width,
        airborne,
        airTime: frame[o + O.AIR_TIME],
        crashed,
        eligible,
        landing: feedback,
      });
      this.berms.update({
        course: track,
        machine,
        sectors: this.bermSectors,
        length: track.length,
        time,
        s,
        speed: frame[player + F.SPEED],
        lateral: frame[player + F.LATERAL],
        legalHalfWidth: Math.max(
          0,
          course.legalWidth(this.targetPoint.width, s, frame[player + F.LATERAL]) - 0.3,
        ),
        moisture: frame[o + O.MOISTURE],
        airborne,
        crashed,
        eligible: controlEligible,
      });
      this.flow.update({
        course: track,
        machine,
        sections: this.flowSections,
        length: track.length,
        time,
        s,
        speed: frame[player + F.SPEED],
        lateral: frame[player + F.LATERAL],
        legalHalfWidth: Math.max(
          0,
          course.legalWidth(this.targetPoint.width, s, frame[player + F.LATERAL]) - 0.3,
        ),
        moisture: frame[o + O.MOISTURE],
        airborne,
        crashed,
        eligible: controlEligible,
        landing: this.targets.last,
      });
    } else {
      this.targets.reset();
      this.rhythm.reset();
      this.berms.reset();
      this.flow.reset();
    }
    this.wasAirborne = airborne;
    this.previousEligible = eligible && !airborne;
    if (motocross) this.updateRide(frame, track, options, airborne, playerControlled && !replay);
    else if (this.ride) this.ride.hidden = true;
    if (format?.start === 'gate' && options.mode !== 'practice') {
      if (frame[o + O.START] > 2.5) parts.push('JUMP START');
      else if (phase < PHASE.RACING) parts.push(`GATE ${Math.round(frame[o + O.SLOT])}`);
      else if (frame[H.RACE_TIME] < 2) parts.push('GATE DROP');
      if (frame[o + O.FORMAT] > 0.5) parts.push('HOLESHOT');
    }
    if (format?.kind === 'rallycross') {
      const taken = Math.round(frame[o + O.JOKERS]),
        required = format.joker?.required ?? 1;
      parts.push(taken >= required ? `JOKER ${taken}/${required} ✓` : `JOKER ${taken}/${required}`);
    }
    if (format?.kind === 'stage') {
      // Before this car's start the block carries the countdown (negative).
      const t = frame[o + O.FORMAT],
        start = frame[o + O.START];
      if (start > 2.5) parts.push('JUMP START');
      parts.push(
        t >= 0
          ? `STAGE ${clock(t)}`
          : `${start > 0.5 ? 'AT THE CONTROL' : 'QUEUED'} · START IN ${Math.ceil(-t)}`,
      );
    }
    if (!motocross && time < this.airUntil) parts.push(`AIR ${this.landedAirTime.toFixed(2)} S`);
    const node = this.node();
    node.hidden = parts.length === 0;
    const text = parts.join('  ·  ');
    if (node.textContent !== text) node.textContent = text;
  }
}
