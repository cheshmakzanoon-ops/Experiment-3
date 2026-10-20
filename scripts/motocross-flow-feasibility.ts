/** Optional, bounded Sport flow-section feasibility probe.
 *
 * Run: node --experimental-transform-types scripts/motocross-flow-feasibility.ts
 * Add --out report.json to save the JSON report instead of printing it.
 *
 * Each fresh production Simulation begins 12 m before its first jump face.
 * Initial placement, speed and gear are the only fixture writes. Thereafter,
 * public player inputs drive the real dirt bike continuously through every
 * jump, connecting turn and section exit. AI control remains disabled. Actual
 * Float32 snapshots feed the live landing assessment and both practice judges.
 *
 * The fixed controller demonstrates physical and scoring feasibility. It does
 * not measure human ease, test a whole lap from the gate or verify rendering.
 */
import { writeFileSync } from 'node:fs';
import { clamp, mod } from '../src/core/math.ts';
import { DEFAULT_OPTIONS, controls } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine } from '../src/simulation/offroad/jump-rig.ts';
import { OFFROAD_CIRCUITS, offroadCourse } from '../src/simulation/offroad/venues.ts';
import {
  LANDING_RULES,
  assessMotocrossLanding,
  motocrossAlignment,
  type MotocrossLandingFeedback,
} from '../src/simulation/offroad/riding-feedback.ts';
import {
  MotocrossLandingChallenge,
  type LandingChallengeResult,
} from '../src/simulation/offroad/landing-challenge.ts';
import {
  MotocrossFlowPractice,
  motocrossFlowSections,
} from '../src/simulation/offroad/flow-practice.ts';
import {
  carBase,
  H,
  F,
  O,
  B,
  R,
  OFFROAD_BASE,
  BIKE_BASE,
  RACE_BASE,
} from '../src/simulation/protocol.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { vehicleAt } from '../src/simulation/vehicles.ts';

const VENUES = ['valley-ridge-mx', 'arena-nord-sx'] as const;
const MACHINES = ['mx250', 'mx450'] as const;
type Venue = (typeof VENUES)[number];
type Machine = (typeof MACHINES)[number];

/** Centreline input-controller speeds in m/s, in MX250 / MX450 order.
 * These are fixed game inputs from the bounded 2026-10-20 continuous-route
 * check, based on the existing isolated-jump probe. Summit and Finish need
 * small corrections because suspension and terrain now carry through from
 * the preceding features. No speed search or physics tuning runs here. */
const APPROACH_SPEEDS: Readonly<Record<string, readonly [number, number]>> = {
  'RIDGE TABLE': [11.77010999927624, 11.77010999927624],
  'BARN DOUBLE': [13.914366993645539, 13.814366993645539],
  'SKY TRIPLE': [14.278589940140192, 13.878589940140191],
  'SUMMIT TABLE': [12.764305261357515 - 0.2, 12.664305261357516 - 0.2],
  'VALLEY DOUBLE': [14.12871040127835, 13.528710401278351],
  TRIPLE: [13.785179725737494, 13.485179725737494],
  'LANE DOUBLE': [11.733430927878059, 11.733430927878059],
  TABLETOP: [10.588741265344332, 9.988741265344332],
  'FINISH TRIPLE': [13.425018894942802 + 0.3, 13.325018894942803 - 0.3],
};
const DT = 1 / 120;
const MAX_SECONDS = 90;
const EXPECTED_RUNS = 8;

interface ProbeCase {
  venue: Venue;
  machine: Machine;
  sectionIndex: number;
  section: string;
}

interface Observation {
  time: number;
  s: number;
  speed: number;
  lateral: number;
  airborne: boolean;
  airTime: number;
  crashed: boolean;
  eligible: boolean;
  onCourse: boolean;
  halfWidth: number;
  legalHalfWidth: number;
  globalFlag: number;
  localFlag: number;
  grade: MotocrossLandingFeedback['kind'];
  bottom: number;
  pitchError: number;
  normalSpeed: number;
  landingLateralSpeed: number;
  links: number | null;
}

interface JudgedTarget {
  name: string;
  takeoff: number;
  at: number;
  kind: LandingChallengeResult['kind'];
  miss: number;
  takeoffSpeed: number;
}

type Event = Observation & {
  event: 'takeoff' | 'touchdown' | 'judged-target' | 'flow-entry' | 'flow-lost';
  target?: JudgedTarget;
};

function approachSpeed(name: string, machine: Machine) {
  const pair = APPROACH_SPEEDS[name];
  if (!pair) throw new Error(`Missing fixed approach speed: ${name}`);
  return pair[machine === 'mx250' ? 0 : 1];
}

function run(entry: ProbeCase) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    circuit: entry.venue,
    opponents: 0,
    laps: 1,
    vehicles: [entry.machine],
    assist: 'sport',
  });
  const bike = sim.cars[0];
  if (!(bike instanceof DirtBikeVehicle)) throw new Error('Expected production dirt bike');
  const track = sim.track;
  const course = offroadCourse(track.circuit)!;
  const sections = motocrossFlowSections(course);
  const section = sections[entry.sectionIndex];
  if (!section || section.name !== entry.section) throw new Error('Authored section changed');
  const first = section.jumps[0];
  sim.autoPlayer = false;
  bike.aiControlled(0);
  bike.place(track, first.start - 12, 0);
  bike.dynamics.speed = approachSpeed(first.name, entry.machine);
  const spec = bike.definition.spec;
  for (let gear = 1; gear < spec.gearRatios.length - 1; gear++) {
    bike.gear = gear;
    const rpm =
      ((bike.speed / spec.wheelRadius) * spec.gearRatios[gear + 1] * spec.finalDrive * 30) /
      Math.PI;
    if (rpm < spec.shiftRPM * 0.85) break;
  }
  const initial = {
    s: bike.s,
    speed: bike.speed,
    gear: bike.gear,
    aiControlledSteps: 0,
    autoPlayer: false,
  };
  const targets = new MotocrossLandingChallenge();
  const flow = new MotocrossFlowPractice();
  const point = trackPoint();
  const ahead = trackPoint();
  const base = carBase(0),
    o = base + OFFROAD_BASE;
  const state = {
    wasAirborne: false,
    landingAt: -Infinity,
    landingSideways: 0,
    lastTargetAt: -Infinity,
    entered: false,
    totalSamples: 0,
    offCourseSamples: 0,
    ineligibleSamples: 0,
    maxLateral: 0,
    flowLostAt: null as Observation | null,
  };
  const judged: JudgedTarget[] = [];
  const events: Event[] = [];

  function observe(): Observation {
    // Match the HUD's production assessment, including first-contact lateral
    // speed through settlement and actual flags, pit and retirement channels.
    const frame = sim.makeFrame();
    const time = frame[H.TIME],
      s = frame[base + F.S],
      speed = frame[base + F.SPEED];
    const airborne = frame[o + O.AIRBORNE] > 0.5;
    const crashed = frame[base + BIKE_BASE + B.STATE] > 0.5;
    const x = frame[base + F.QX],
      y = frame[base + F.QY],
      z = frame[base + F.QZ],
      w = frame[base + F.QW];
    const lateralSpeed = Math.abs(
      motocrossAlignment(
        2 * (x * z + w * y),
        1 - 2 * (x * x + y * y),
        frame[base + F.VX],
        frame[base + F.VZ],
      ).lateralSpeed,
    );
    if (state.wasAirborne && !airborne && frame[o + O.AIR_TIME] > 0.2) {
      state.landingAt = time;
      state.landingSideways = lateralSpeed;
    }
    if (
      !airborne &&
      time >= state.landingAt &&
      time - state.landingAt <= LANDING_RULES.settleSeconds
    )
      state.landingSideways = Math.max(state.landingSideways, lateralSpeed);
    const feedback = assessMotocrossLanding(
      frame[o + O.LANDING_PITCH],
      frame[o + O.LANDING_SPEED],
      frame[o + O.BOTTOM],
      crashed,
      vehicleAt(Math.round(frame[base + RACE_BASE + R.VEHICLE])).bike?.offroad,
      course.isRough(mod(s, track.length)),
      Number.isFinite(state.landingAt) ? state.landingSideways : 0,
    );
    const cautioned = [frame[H.FLAG], frame[base + F.LOCAL_FLAG]].some(
      (flag) => flag === FLAG.YELLOW || flag === FLAG.DOUBLE_YELLOW,
    );
    track.at(s, point);
    const eligible =
      !sim.autoPlayer &&
      !cautioned &&
      frame[base + F.IN_PIT] < 0.5 &&
      frame[base + F.RETIRED] < 0.5;
    const lateral = frame[base + F.LATERAL];
    const legalHalfWidth = Math.max(0, course.legalWidth(point.width, s, lateral) - 0.3);
    const onCourse = Math.abs(lateral) <= legalHalfWidth;
    const common = {
      course: track,
      machine: `${frame[base + RACE_BASE + R.VEHICLE]}:${sim.options.assist}`,
      length: track.length,
      time,
      s,
      speed,
      lateral,
      airborne,
      crashed,
      eligible,
    };
    targets.update({
      ...common,
      jumps: course.jumps,
      halfWidth: point.width,
      airTime: frame[o + O.AIR_TIME],
      landing: feedback,
    });
    flow.update({
      ...common,
      sections,
      legalHalfWidth,
      moisture: frame[o + O.MOISTURE],
      landing: targets.last,
    });
    state.totalSamples++;
    if (!eligible) state.ineligibleSamples++;
    if (!onCourse) state.offCourseSamples++;
    state.maxLateral = Math.max(state.maxLateral, Math.abs(lateral));
    const record: Observation = {
      time,
      s,
      speed,
      lateral,
      airborne,
      airTime: frame[o + O.AIR_TIME],
      crashed,
      eligible,
      onCourse,
      halfWidth: point.width,
      legalHalfWidth,
      globalFlag: frame[H.FLAG],
      localFlag: frame[base + F.LOCAL_FLAG],
      grade: feedback.kind,
      bottom: frame[o + O.BOTTOM],
      pitchError: frame[o + O.LANDING_PITCH],
      normalSpeed: frame[o + O.LANDING_SPEED],
      landingLateralSpeed: state.landingSideways,
      links: flow.active?.linked ?? null,
    };
    if (airborne !== state.wasAirborne)
      events.push({ event: airborne ? 'takeoff' : 'touchdown', ...record });
    if (targets.last && targets.last.at !== state.lastTargetAt) {
      state.lastTargetAt = targets.last.at;
      const result = targets.last;
      const target: JudgedTarget = {
        name: result.jump.name,
        takeoff: result.jump.takeoff,
        at: result.at,
        kind: result.kind,
        miss: result.miss,
        takeoffSpeed: result.takeoffSpeed,
      };
      judged.push(target);
      events.push({ event: 'judged-target', target, ...record });
    }
    if (flow.active && !state.entered) {
      events.push({ event: 'flow-entry', ...record });
      state.entered = true;
    }
    if (state.entered && !flow.active && !flow.last && !state.flowLostAt) {
      state.flowLostAt = record;
      events.push({ event: 'flow-lost', ...record });
    }
    state.wasAirborne = airborne;
    return record;
  }

  let last = observe(); // Establish ordinary player eligibility before entry.
  for (let step = 0; step < Math.ceil(MAX_SECONDS / DT); step++) {
    const jump = section.jumps.find((j) => bike.s < j.end + 3) ?? section.jumps.at(-1)!;
    const targetSpeed = approachSpeed(jump.name, entry.machine);
    if (bike.airborne) {
      const wanted =
        (bike.landingTarget + 0.1 - bike.pitch - bike.riderBody * 0.06) /
          Math.max(0.12, bike.landingIn) -
        bike.pitchRate;
      sim.setInput({
        ...controls(),
        throttle: clamp(wanted * 1.2, 0, 1),
        clutch: clamp(-wanted * 1.2, 0, 1),
      });
    } else {
      const onFace = bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1;
      let desired = bike.s < jump.start - 35 ? 8 : targetSpeed;
      if (!onFace && bike.s > first.end + 4) {
        // Slow before a connecting berm without braking on a jump face.
        for (const lead of [0, 5, 10]) {
          const curvature = Math.abs(track.at(bike.s + lead, ahead).curvature);
          desired = Math.min(desired, Math.sqrt(3.4 / Math.max(0.005, curvature)));
        }
      }
      rideLine(bike, track, onFace ? Math.max(targetSpeed, bike.dynamics.speed) : desired);
      if (
        bike.speed > 5 &&
        bike.s > first.end + 4 &&
        !(bike.s > jump.start - 18 && bike.s < jump.end + 2)
      ) {
        // A bounded preview/centering controller expresses only rider steer.
        // Jump corridors retain the existing straight-line approach helper.
        track.at(bike.s, point);
        const v = bike.speed;
        const heading =
          mod(Math.atan2(point.tx, point.tz) - bike.dynamics.heading + Math.PI, Math.PI * 2) -
          Math.PI;
        const curvature = track.at(bike.s + v * 0.3, ahead).curvature;
        const correction = clamp(
          (-1.44 * bike.lateral) / (v * v) + (2.16 * heading) / v,
          (-0.6 * 9.81) / (v * v),
          (0.6 * 9.81) / (v * v),
        );
        bike.input.steer = clamp(
          Math.atan((v * v * (curvature + correction)) / 9.81) /
            Math.max(0.1, bike.dynamics.leanLimit),
          -1,
          1,
        );
      }
      sim.setInput({ ...bike.input });
    }
    sim.step(DT); // Two real physics substeps per production world tick.
    last = observe();
    if (flow.last || !bike.riding || bike.s > section.to + 18) break;
  }

  const earnedInOrder =
    judged.length === section.jumps.length &&
    judged.every(
      (target, i) => target.kind === 'target' && target.takeoff === section.jumps[i].takeoff,
    );
  const completed = flow.last?.section.id === section.id;
  return {
    ...entry,
    assist: sim.options.assist,
    initial,
    approachSpeeds: section.jumps.map((jump) => ({
      name: jump.name,
      speed: approachSpeed(jump.name, entry.machine),
    })),
    from: section.from,
    to: section.to,
    length: section.length,
    flow: flow.last
      ? {
          section: flow.last.section.name,
          seconds: flow.last.seconds,
          soil: flow.last.soil,
          at: flow.last.at,
          exitSpeed: flow.last.exitSpeed,
        }
      : null,
    judged,
    earnedInOrder,
    totalSamples: state.totalSamples,
    offCourseSamples: state.offCourseSamples,
    ineligibleSamples: state.ineligibleSamples,
    maxLateral: state.maxLateral,
    crashes: bike.dynamics.crashes,
    flowLostAt: state.flowLostAt,
    last,
    events,
    passed:
      completed &&
      earnedInOrder &&
      state.entered &&
      state.flowLostAt === null &&
      state.offCourseSamples === 0 &&
      state.ineligibleSamples === 0 &&
      bike.dynamics.crashes === 0,
  };
}

function main() {
  const args = process.argv.slice(2);
  const usage =
    'Usage: node --experimental-transform-types scripts/motocross-flow-feasibility.ts [--out report.json]';
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(usage);
    return;
  }
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--out' && args[1])) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  const cases: ProbeCase[] = VENUES.flatMap((venue) =>
    MACHINES.flatMap((machine) =>
      motocrossFlowSections(offroadCourse(OFFROAD_CIRCUITS[venue])!).map((section, i) => ({
        venue,
        machine,
        sectionIndex: i,
        section: section.name,
      })),
    ),
  );
  const key = (entry: ProbeCase) => `${entry.venue}/${entry.machine}/${entry.section}`;
  const failures: string[] = [];
  if (cases.length !== EXPECTED_RUNS || new Set(cases.map(key)).size !== EXPECTED_RUNS)
    failures.push(`Expected ${EXPECTED_RUNS} distinct authored machine/section cases`);
  const rows: ReturnType<typeof run>[] = [];
  for (const entry of cases) {
    try {
      const row = run(entry);
      rows.push(row);
      if (!row.passed)
        failures.push(
          `${key(entry)}: finished ${!!row.flow}, targets in order ${row.earnedInOrder}, ineligible ${row.ineligibleSamples}, off-course ${row.offCourseSamples}, crashes ${row.crashes}`,
        );
    } catch (error) {
      failures.push(`${key(entry)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (rows.length !== EXPECTED_RUNS)
    failures.push(`Completed ${rows.length}/${EXPECTED_RUNS} runs`);
  const report = {
    generatedBy: 'node --experimental-transform-types scripts/motocross-flow-feasibility.ts',
    method:
      'Each of four linked sections on MX250 and MX450 in solo Sport practice, on fresh live deformable terrain. Manual eligibility begins 12 m before the first face with autoPlayer=false and aiControlled(0). After initial placement/speed/gear, only public ground/air controls are scripted continuously through all targets, connectors and the exit. Actual production Float32 snapshots feed the HUD landing assessment, MotocrossLandingChallenge and MotocrossFlowPractice. No mid-run resets, AI eligibility bypass, speed search or physical tuning. Scripted feasibility does not establish human ease, a full lap from the gate or visual quality.',
    dt: DT,
    substepDt: DT / 2,
    boundedSecondsPerRun: MAX_SECONDS,
    expected: EXPECTED_RUNS,
    total: rows.length,
    completed: rows.filter((row) => row.passed).length,
    passed: failures.length === 0,
    failures,
    rows,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args[0] === '--out') {
    writeFileSync(args[1], json);
    console.log(
      `${report.completed}/${EXPECTED_RUNS} continuous flow sections earned; ${failures.length} failure(s). Report: ${args[1]}`,
    );
  } else process.stdout.write(json);
  if (failures.length) process.exitCode = 1;
}

main();
