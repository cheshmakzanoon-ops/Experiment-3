// Headless festival QA harness (Gameplay QA - Festival).
//
// Drives every festival activity through the PRODUCTION session logic with no
// renderer: OpenWorldSimulation (the open-world worker's session), an AI route
// driver standing in for the player (src/simulation/open-world/route-driver.ts,
// feeding setInput like a human would), the career's settlement
// (src/career/festival.ts) and the festival save (src/session/festival-save.ts).
// Per activity it records: completed, time, score, rewards, stuck time, NaN,
// resets, traffic collisions, result consistency and save round-trip equality.
//
//   node --no-warnings --experimental-transform-types scripts/studio/tools/festival-qa.ts \
//     --events valley-sprint,coast-trap --vehicles eh3,rh3 --weathers clear,rain --out run.ndjson
//   ... --tour                       one session: every activity in unlock order, driving between markers
//   ... --leaks 6                    consecutive sessions in one process: determinism + heap growth
//   ... --summarize a.ndjson b.ndjson   markdown matrix from recorded runs
//
// Every record carries the seed and the exact repro command. Importable: the
// edge-case tests (tests/festival-qa-edge.test.ts) reuse Pilot / runActivity.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buyVehicle } from '../../../src/career/economy.ts';
import { festivalKey, settleFestival, FESTIVAL_RULES } from '../../../src/career/festival.ts';
import { liveRegistry } from '../../../src/career/registry.ts';
import { newCareer, type CareerSave } from '../../../src/career/save.ts';
import { clamp } from '../../../src/core/math.ts';
import {
  recordFestivalBest,
  validateFestivalSave,
  type FestivalSave,
} from '../../../src/session/festival-save.ts';
import { type WeatherPreset } from '../../../src/simulation/config.ts';
import { BikeVehicle } from '../../../src/simulation/bike-vehicle.ts';
import { approachRoute, RUN_UP_METRES, starsFor, type FestivalEvent } from '../../../src/simulation/open-world/festival-events.ts';
import { festivalDefaultVehicle } from '../../../src/simulation/open-world/festival-machines.ts';
import { isRace, type FestivalResult } from '../../../src/simulation/open-world/festival-result.ts';
import { RouteDriver, type RouteObstacle } from '../../../src/simulation/open-world/route-driver.ts';
import { pathPoint, planRoute, RoutePath } from '../../../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation, type FestivalMode } from '../../../src/simulation/open-world/session.ts';
import { openWorld } from '../../../src/simulation/open-world/world.ts';
import { vehicleDefinition } from '../../../src/simulation/vehicles.ts';
import { WEATHER_IDS } from '../../../src/simulation/weather-catalogue.ts';

export const DT = 1 / 120;
/** The three machine archetypes of the matrix. */
export const QA_MACHINES = Object.freeze({
  hypercar: 'eh3',
  hatchback: 'rh3',
  truck: 'rp6',
});
export const DEFAULT_SEED = 73021;
const SCRIPT = 'node --no-warnings --experimental-transform-types scripts/studio/tools/festival-qa.ts';

/** travel: fast travel (skill events from their run-up). drive: the pilot drives there. */
export type Approach = 'travel' | 'drive';
export type Verdict = 'pass' | 'warn' | 'fail';
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
export interface RunOptions {
  event: string;
  vehicle: string;
  weather: WeatherPreset;
  seed: number;
  /** travel: fast travel as the HUD does, run-up placed for skill events.
   * drive: the pilot drives there from where the car is. */
  approach: Approach;
  /** Pilot skill (fraction of the AI envelope). */
  skill: number;
  /** Ambient traffic while free roaming (off during events in any case). */
  traffic: boolean;
  /** Drift zones: hold a slide with slideAssist (otherwise the pilot grips). */
  slide?: boolean;
  /** Print the pilot's state every 0.25 s between these event times (s). */
  trace?: [number, number];
}
export const defaultRun = (event: string, patch: Partial<RunOptions> = {}): RunOptions => ({
  event,
  vehicle: festivalDefaultVehicle(),
  weather: 'clear',
  seed: DEFAULT_SEED,
  approach: 'travel',
  skill: 0.92,
  traffic: false,
  ...patch,
});
export interface ActivityReport {
  event: string;
  kind: string;
  vehicle: string;
  weather: string;
  seed: number;
  approach: Approach;
  verdict: Verdict;
  outcome: 'completed' | 'failed' | 'timeout' | 'no-start' | 'error';
  notes: string[];
  startedBy: 'card' | 'gate' | 'none';
  simSeconds: number;
  wallMs: number;
  arrivalSeconds: number;
  time: number | null;
  position: number | null;
  entrants: number;
  stars: number;
  score: number | null;
  scoreLabel: string;
  topKmh: number;
  legalDistance: number;
  eventDistance: number;
  offRouteSeconds: number;
  longestStuckS: number;
  longestStallS: number;
  nan: string[];
  pilotResets: number;
  autoResets: number;
  rivalResets: number;
  contacts: number;
  maxImpact: number;
  falls: number;
  trafficCollisions: number;
  incidents: string[];
  field: string;
  checks: Check[];
  reward: { paid: boolean; total: number; reputation: number; lines: number; reason: string | null } | null;
  save: { roundTrip: boolean; discovered: number; reloadDiscovered: boolean; best: boolean } | null;
  error?: string;
  repro: string;
}

// --- The player stand-in ----------------------------------------------------
/** An AI route driver standing in for the player: it writes the pedals and
 * steering of whichever car the session says is the player's, through
 * `setInput` (the worker's input path), and presses reset like a person
 * when stuck. After a reset or a new machine it re-binds to the new car. */
export class Pilot {
  private driver: RouteDriver;
  /** Provoke and hold a slide in corners (drift zones): see slideAssist. */
  slide = false;
  /** Reset presses (the driver was stuck or lost). */
  resets = 0;
  private limit = Infinity;
  /** Route distance past which no braking is planned (see RouteDriver.horizon). */
  get horizon() {
    return this.limit;
  }
  set horizon(value: number) {
    this.limit = value;
    this.driver.horizon = value;
  }
  private readonly obstacles: RouteObstacle[] = [];
  constructor(
    readonly sim: OpenWorldSimulation,
    public path: RoutePath,
    readonly skill = 0.92,
    readonly laneOffset = 0,
    readonly speedCap = Infinity,
  ) {
    this.driver = new RouteDriver(sim.player, path, skill, laneOffset, speedCap);
    this.driver.horizon = this.limit;
  }
  retarget(path: RoutePath, laneOffset = this.laneOffset) {
    this.path = path;
    this.driver = new RouteDriver(this.sim.player, path, this.skill, laneOffset, this.speedCap);
    this.driver.horizon = this.limit;
  }
  get decision() {
    return this.driver.decision;
  }
  get trouble() {
    return this.driver.trouble;
  }
  get lateral() {
    return this.driver.lateral;
  }
  /** Distance of the car along the pilot's path. */
  get d() {
    return this.driver.d;
  }
  step(dt: number, hold = false, finished = false) {
    const sim = this.sim;
    if (this.driver.car !== sim.player) this.retarget(this.path);
    const list = this.obstacles;
    list.length = 0;
    for (const c of sim.cars) list.push(c);
    if (sim.trafficEnabled) for (const c of sim.traffic.cars) list.push(c);
    this.driver.update(dt, list, hold, finished);
    if (this.slide && sim.mode === 'running') slideAssist(sim.player.input, sim.player);
    sim.setInput(sim.player.input);
    if (this.driver.wantsReset) {
      this.resets++;
      sim.command({ type: 'reset' });
    }
  }
}

/** A crude closed-loop slide controller for drift zones. Where the route driver
 * steers into a corner, it floors the throttle, adds lock and then steers on
 * the measured slip angle toward a target of ~26 degrees on the outside, so a
 * rear-driven car holds a slide for the DriftMeter to score. Tuned by hand on
 * the RM-8 and GT-8F: other cars spin or do not slide, so a zero score from
 * a car that is not one of those is the pilot's limit, not the game's. */
export function slideAssist(input: { throttle: number; brake: number; steer: number }, car: { localVelocity: { x: number; z: number } }) {
  const base = input.steer,
    v = car.localVelocity,
    speed = Math.hypot(v.x, v.z);
  if (Math.abs(base) <= 0.12 || speed <= 12) return;
  const beta = Math.atan2(v.x, Math.max(0.1, v.z)),
    target = -Math.sign(base) * 0.45;
  input.throttle = 1;
  input.brake = 0;
  input.steer = clamp(base * 1.6 + (beta - target) * 1.2, -1, 1);
}

// --- Route helpers ----------------------------------------------------------
/** The run-up route to a skill challenge's gate: the production planner
 * (festival-events.ts approachRoute) that places TRY AGAIN. */
export function approachPath(event: FestivalEvent, back = RUN_UP_METRES) {
  return approachRoute(openWorld(), event.spec, event.path, back);
}
/** A road route from a world point to the marker of an event. */
export function routeTo(from: { x: number; z: number }, x: number, z: number): RoutePath {
  const world = openWorld();
  return new RoutePath(world.network, planRoute(world.network, [[from.x, from.z], [x, z]], false), false);
}

// --- Monitoring -------------------------------------------------------------
/** Per-step health probe: NaN, stuck time, stalls, contacts, falls, resets. */
export class Monitor {
  nan: string[] = [];
  longestStuck = 0;
  longestStall = 0;
  contacts = 0;
  maxImpact = 0;
  falls = 0;
  topSpeed = 0;
  /** Times the session replaced the player's car (reset presses included). */
  playerChanges = 0;
  rivalResets = 0;
  private stuck = 0;
  private stall = 0;
  private lastProgress = 0;
  private clock = 0;
  private lastX = 0;
  private lastZ = 0;
  private player: unknown;
  private riding = true;
  private rivals: unknown[] = [];
  private readonly trafficBase: number;
  constructor(readonly sim: OpenWorldSimulation) {
    this.player = sim.player;
    this.rivals = [...sim.cars];
    this.trafficBase = sim.traffic.collisions;
    this.lastX = sim.player.body.position.x;
    this.lastZ = sim.player.body.position.z;
  }
  get trafficCollisions() {
    return this.sim.traffic.collisions - this.trafficBase;
  }
  private where = 0;
  private note(what: string) {
    if (this.incidents.length < 16)
      this.incidents.push(`t=${this.sim.time.toFixed(1)} route m=${Math.round(this.where)} (${Math.round(this.sim.player.body.position.x)},${Math.round(this.sim.player.body.position.z)}) ${what}`);
  }
  /** A command (travel, start, reset) replaced cars on purpose: not a recovery. */
  rebind() {
    this.player = this.sim.player;
    this.rivals = [...this.sim.cars];
  }
  /** Notable moments (resets, leaving the route) with where they happened. */
  incidents: string[] = [];
  private wasOff = false;
  offEpisodes = 0;
  /** Call after every sim step. `look` is read four times a second: the legal
   * route distance of a running event and whether it is off its route. */
  sample(dt: number, look: (() => { progress: number; offRoute: boolean; d: number } | null) | null) {
    const sim = this.sim,
      p = sim.player,
      b = p.body;
    if (!Number.isFinite(b.position.x + b.position.y + b.position.z + b.velocity.x + b.velocity.z + p.speed)) {
      if (this.nan.length < 8) this.nan.push(`player pose/speed at t=${sim.time.toFixed(2)}`);
    }
    if (p !== this.player) {
      this.player = p;
      this.playerChanges++;
      this.note(`player car replaced (${p.speed.toFixed(0)} m/s)`);
    }
    if (sim.cars.length === this.rivals.length) {
      for (let i = 1; i < sim.cars.length; i++)
        if (this.rivals[i] !== sim.cars[i]) {
          this.rivalResets++;
          this.rivals[i] = sim.cars[i];
          this.note(`rival ${i} reset`);
        }
    } else this.rivals = [...sim.cars];
    this.topSpeed = Math.max(this.topSpeed, Number.isFinite(p.speed) ? p.speed : 0);
    this.maxImpact = Math.max(this.maxImpact, Number.isFinite(p.impact) ? p.impact : 0);
    if (p instanceof BikeVehicle) {
      if (this.riding && !p.riding) this.falls++;
      this.riding = p.riding;
    }
    if ((sim.collisions.touched & 1) !== 0) this.contacts++;
    this.clock += dt;
    if (this.clock >= 0.25) {
      const moved = Math.hypot(b.position.x - this.lastX, b.position.z - this.lastZ);
      this.lastX = b.position.x;
      this.lastZ = b.position.z;
      this.stuck = sim.mode === 'running' && moved < 0.2 && p.speed < 0.8 ? this.stuck + this.clock : 0;
      this.longestStuck = Math.max(this.longestStuck, this.stuck);
      const seen = look && sim.mode === 'running' ? look() : null;
      if (seen) {
        this.stall = seen.progress - this.lastProgress < 0.5 * this.clock ? this.stall + this.clock : 0;
        this.longestStall = Math.max(this.longestStall, this.stall);
        this.lastProgress = seen.progress;
        this.where = seen.d;
        if (seen.offRoute && !this.wasOff) {
          this.offEpisodes++;
          this.note('left the route');
        }
        this.wasOff = seen.offRoute;
      } else this.stall = 0;
      this.clock = 0;
    }
  }
}

// --- Result audit -----------------------------------------------------------
function numbersOf(value: unknown, path: string, out: string[]) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(path);
  } else if (Array.isArray(value)) value.forEach((v, i) => numbersOf(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) numbersOf(v, `${path}.${k}`, out);
}
/** Result consistency: the typed result must agree with itself, with the
 * event it names and with physics (position vs time, speeds, distances). */
export function auditResult(
  event: FestivalEvent,
  result: FestivalResult,
  vehicleId: string,
  previousRuns: readonly FestivalResult[],
): Check[] {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail: ok ? '' : detail });
  const bad: string[] = [];
  numbersOf(result, 'result', bad);
  check('no NaN/Infinity in the result', bad.length === 0, bad.join(', '));
  check('result names the event and machine', result.eventId === event.spec.id && result.eventKind === event.spec.kind && result.vehicleId === vehicleId, `${result.eventId}/${result.eventKind}/${result.vehicleId}`);
  check('run id is unique and well formed', /^.+:\d+$/.test(result.runId) && !previousRuns.some((r) => r.runId === result.runId), result.runId);
  check('stars within 0..3 and equal to the star rule', Number.isInteger(result.stars) && result.stars >= 0 && result.stars <= 3 && result.stars === starsFor(event.spec, result), `stars ${result.stars}, rule ${starsFor(event.spec, result)}`);
  check('off-route time within the run', result.offRouteSeconds >= 0 && (result.time === null || result.offRouteSeconds <= result.time + 0.5), `${result.offRouteSeconds} s off in ${result.time} s`);
  const top = vehicleDefinition(vehicleId).ai.topSpeed * 3.6;
  if (!result.completed) {
    check('an unfinished run has no stars and no time', result.stars === 0 && result.time === null, `stars ${result.stars}, time ${result.time}`);
    return checks;
  }
  const distance = event.distance;
  check('completed run covers the route', result.legalDistance >= distance * 0.9 && result.legalDistance <= distance * 1.02 + 60, `legal ${result.legalDistance.toFixed(0)} m of ${distance.toFixed(0)} m`);
  if (result.eventKind !== 'speed-trap') {
    check('time is positive and physically possible', result.time !== null && result.time > 0 && result.time >= (distance * 0.5) / (top / 3.6) , `time ${result.time} for ${distance.toFixed(0)} m at top ${top.toFixed(0)} km/h`);
  }
  if (isRace(result.eventKind)) {
    const finishers = result.standings.filter((s) => s.time !== null);
    const me = result.standings.findIndex((s) => s.car === 0);
    check('field size matches entrants', result.standings.length === result.entrants && result.entrants === 1 + (event.spec.kind === 'showcase' ? 1 : (event.spec.rivals ?? 0)), `${result.standings.length}/${result.entrants}`);
    check('position is the player\'s rank in the standings', result.position === me + 1, `position ${result.position}, standings index ${me}`);
    const times = finishers.map((s) => s.time!);
    check('standings are ordered by finish time, finishers first', times.every((t, i) => i === 0 || t >= times[i - 1]) && result.standings.slice(0, finishers.length).every((s) => s.time !== null), JSON.stringify(result.standings.map((s) => s.time && +s.time.toFixed(1))));
    const mine = result.standings[me];
    check('player time equals the standings time', mine?.time !== null && Math.abs((mine?.time ?? -1) - (result.time ?? -2)) < 1e-6, `${mine?.time} vs ${result.time}`);
    const ahead = finishers.filter((s) => s.car !== 0 && s.time! < (result.time ?? Infinity)).length;
    check('position equals 1 + rivals that finished earlier', result.position === 1 + ahead, `position ${result.position}, earlier finishers ${ahead}`);
    check('race pays stars by position', result.stars === (result.position === 1 ? 3 : result.position! <= 3 ? 2 : 1) || event.spec.kind === 'showcase', `stars ${result.stars} at P${result.position}`);
  }
  if (result.eventKind === 'speed-trap')
    check('trap speed is finite, positive and below top speed', result.trapKmh !== null && result.trapKmh > 5 && result.trapKmh <= top * 1.05, `${result.trapKmh} km/h (top ${top.toFixed(0)})`);
  if (result.eventKind === 'speed-zone') {
    const avg = result.averageKmh ?? -1;
    check('zone average is consistent with its time and distance', avg > 0 && avg <= top * 1.02 && (avg / 3.6) * (result.time ?? 0) <= distance + 1 && Math.abs(avg - (result.legalDistance / (result.time ?? 1)) * 3.6) < 3 + 0.02 * avg, `avg ${avg.toFixed(1)} km/h, legal ${result.legalDistance.toFixed(0)} m in ${result.time}`);
  }
  if (result.eventKind === 'drift-zone')
    check('drift score is a non-negative number', result.driftScore !== null && result.driftScore >= 0, `${result.driftScore}`);
  return checks;
}

// --- One activity -----------------------------------------------------------
function budgetSeconds(event: FestivalEvent) {
  return clamp(event.distance / 9 + 150, 200, 1800);
}
export function reproOf(o: RunOptions) {
  return `${SCRIPT} --events ${o.event} --vehicles ${o.vehicle} --weathers ${o.weather} --seed ${o.seed}${o.approach !== 'travel' ? ` --approach ${o.approach}` : ''}${o.traffic ? ' --traffic' : ''}${o.slide ? ' --slide' : ''}`;
}
export function newSim(o: Pick<RunOptions, 'vehicle' | 'weather' | 'seed' | 'traffic'>, extra: { discovered?: readonly string[]; session?: string } = {}) {
  return new OpenWorldSimulation({
    vehicle: o.vehicle,
    weather: o.weather,
    seed: o.seed,
    traffic: o.traffic,
    tileBudget: 24,
    session: extra.session ?? `qa-${o.seed}`,
    discovered: extra.discovered,
  });
}
/** A career that owns the machine with enough festival reputation for every
 * event, so the reward of each activity can be computed on its own. */
export function richCareer(vehicle: string): CareerSave {
  let save = newCareer();
  save.credits = 5_000_000;
  const registry = liveRegistry();
  try {
    save = buyVehicle(save, registry, vehicle);
  } catch {
    /* a machine the career will not sell: the run is a loaner */
  }
  return { ...save, reputation: { ...save.reputation, festival: 100 } };
}
export interface Shared {
  sim?: OpenWorldSimulation;
  career?: CareerSave;
  save?: FestivalSave;
  results?: FestivalResult[];
}
const blankSave = (vehicle: string): FestivalSave => ({ version: 1, discovered: [], best: {}, vehicle, traffic: true });

/** Run one activity from arrival to reward and save, on a fresh session or on
 * the shared one (tours). Never throws: an exception is a recorded failure. */
export function runActivity(o: RunOptions, shared: Shared = {}): ActivityReport {
  const wall = performance.now();
  const notes: string[] = [];
  const report: ActivityReport = {
    event: o.event,
    kind: '',
    vehicle: o.vehicle,
    weather: o.weather,
    seed: o.seed,
    approach: o.approach,
    verdict: 'fail',
    outcome: 'error',
    notes,
    startedBy: 'none',
    simSeconds: 0,
    wallMs: 0,
    arrivalSeconds: 0,
    time: null,
    position: null,
    entrants: 0,
    stars: 0,
    score: null,
    scoreLabel: '',
    topKmh: 0,
    legalDistance: 0,
    eventDistance: 0,
    offRouteSeconds: 0,
    longestStuckS: 0,
    longestStallS: 0,
    nan: [],
    pilotResets: 0,
    autoResets: 0,
    rivalResets: 0,
    contacts: 0,
    maxImpact: 0,
    falls: 0,
    trafficCollisions: 0,
    incidents: [],
    field: '',
    checks: [],
    reward: null,
    save: null,
    repro: reproOf(o),
  };
  try {
    const sim = shared.sim ?? newSim(o);
    const event = sim.events.find((e) => e.spec.id === o.event);
    if (!event) throw new Error(`Unknown event ${o.event}`);
    report.kind = event.spec.kind;
    report.eventDistance = event.distance;
    const race = isRace(event.spec.kind);
    const start = sim.time;
    const monitor = new Monitor(sim);
    const previous = [...sim.results];
    let pilot: Pilot;
    const progressOf = () => {
      const e = sim.status().event;
      return e ? { progress: e.progress * event.distance, offRoute: e.offRoute, d: pilot.d } : null;
    };
    const modeNow = (): FestivalMode => sim.mode;
    const held: { result: FestivalResult | null } = { result: null };
    const advance = (hold = false, finished = false, progress = false) => {
      pilot.step(DT, hold, finished);
      sim.step(DT);
      monitor.sample(DT, progress ? progressOf : null);
      if (o.trace && sim.time - start >= o.trace[0] && sim.time - start <= o.trace[1] && sim.tick % Number(process.env.QA_TRACE_EVERY ?? 30) === 0) {
        const c = sim.player;
        console.log(`  trace t=${(sim.time - start).toFixed(1)} m=${pilot.d.toFixed(0)} lat=${pilot.lateral.toFixed(1)} v=${c.speed.toFixed(1)} up=${c.up.y.toFixed(2)} gear=${c.gear} thr=${c.input.throttle.toFixed(2)} brk=${c.input.brake.toFixed(2)} str=${c.input.steer.toFixed(2)} ${pilot.decision} trouble=${pilot.trouble.toFixed(1)} imp=${c.impact.toFixed(2)} load=${c.tires.map((t) => Math.round(t.load / 100)).join('/')} roll=${(Math.atan2(2 * (c.body.orientation.x * c.body.orientation.y + c.body.orientation.w * c.body.orientation.z), c.up.y) * 57.3).toFixed(0)} wz=${c.body.omega.z.toFixed(2)} vy=${c.body.velocity.y.toFixed(1)} (${c.body.position.x.toFixed(0)},${c.body.position.z.toFixed(0)},${c.body.position.y.toFixed(1)})`);
      }
      const r = sim.takeResult();
      if (r) held.result = r;
    };

    // 1. Arrive: fast travel as the HUD does, or drive there.
    const runUp = race ? null : approachPath(event);
    if (o.approach !== 'drive') {
      // As the HUD's travel / TRY AGAIN: a skill challenge arrives on its run-up.
      sim.command({ type: 'travel', event: o.event, runUp: true });
      monitor.rebind();
      pilot = new Pilot(sim, race || !runUp ? event.path : runUp.path, o.skill);
      if (!race) pilot.horizon = (runUp ? runUp.entry : 0) + event.distance;
      pilot.slide = !!o.slide && event.spec.kind === 'drift-zone';
    } else {
      const here = sim.player.body.position;
      let path: RoutePath;
      if (race || !runUp) path = routeTo(here, event.marker.x, event.marker.z);
      else {
        const world = openWorld(),
          p = runUp.path.at(0, pathPoint());
        path = new RoutePath(
          world.network,
          planRoute(world.network, [[here.x, here.z], [p.x, p.z], ...event.spec.waypoints], false),
          false,
        );
      }
      pilot = new Pilot(sim, path, o.skill, o.traffic ? -1.9 : 0);
      if (!race) pilot.horizon = path.length - (event.path.length - event.distance);
      pilot.slide = !!o.slide && event.spec.kind === 'drift-zone';
    }
    const arrive = sim.time;
    const arrivalLimit = o.approach === 'drive' ? 120 + pilot.path.length / 8 : 30;
    if (race) {
      // A race card opens at the marker once the car has stopped there.
      while (sim.mode !== 'card' && sim.time - arrive < arrivalLimit) advance();
      if (sim.mode !== 'card') {
        notes.push(`no race card after ${(sim.time - arrive).toFixed(0)} s (mode ${sim.mode})`);
        report.outcome = 'no-start';
      } else {
        report.startedBy = 'card';
        const status = sim.status();
        if (status.card?.id !== o.event) notes.push(`card names ${status.card?.id}`);
        report.arrivalSeconds = sim.time - arrive;
        sim.command({ type: 'start', event: o.event });
        monitor.rebind();
        pilot.retarget(event.path);
        if (modeNow() !== 'countdown') notes.push(`mode ${sim.mode} after start`);
        const field = 1 + (event.spec.kind === 'showcase' ? 1 : (event.spec.rivals ?? 0));
        if (sim.cars.length !== field) notes.push(`${sim.cars.length} cars on the grid, expected ${field}`);
        const grid = { x: sim.player.body.position.x, z: sim.player.body.position.z };
        let rolled = 0;
        while (modeNow() === 'countdown' && sim.time - arrive < arrivalLimit + 20) {
          advance(true);
          // Settling onto the suspension is not rolling: measure the last second.
          if (sim.status().event!.countdown > 1) {
            grid.x = sim.player.body.position.x;
            grid.z = sim.player.body.position.z;
          } else rolled = Math.hypot(sim.player.body.position.x - grid.x, sim.player.body.position.z - grid.z);
        }
        if (rolled > 0.5) notes.push(`player rolled ${rolled.toFixed(2)} m in the last second of the countdown`);
      }
    } else {
      while (sim.mode !== 'running' && sim.mode !== 'finished' && sim.time - arrive < arrivalLimit && !held.result) advance();
      if (sim.mode !== 'running' && !held.result) {
        notes.push(`the gate did not start the challenge after ${(sim.time - arrive).toFixed(0)} s (mode ${sim.mode})`);
        report.outcome = 'no-start';
      } else {
        report.startedBy = 'gate';
        report.arrivalSeconds = sim.time - arrive;
        if (sim.status().event?.id !== o.event) notes.push(`started ${sim.status().event?.id}`);
      }
    }

    // 2. Run until a result, a failed challenge, or the time budget.
    if (report.outcome !== 'no-start') {
      const limit = sim.time + budgetSeconds(event);
      while (!held.result && sim.time < limit && (sim.mode === 'running' || sim.mode === 'countdown')) advance(false, false, true);
      // A rival can finish after the player: let the player keep driving.
      if (!held.result && sim.mode === 'free') notes.push('challenge ended without a result (failed)');
    }
    report.simSeconds = sim.time - start;
    report.nan = monitor.nan;
    report.longestStuckS = round(monitor.longestStuck);
    report.longestStallS = round(monitor.longestStall);
    report.pilotResets = pilot.resets;
    report.autoResets = Math.max(0, monitor.playerChanges - pilot.resets);
    report.rivalResets = monitor.rivalResets;
    report.contacts = monitor.contacts;
    report.maxImpact = round(monitor.maxImpact);
    report.falls = monitor.falls;
    report.topKmh = round(monitor.topSpeed * 3.6);
    report.trafficCollisions = monitor.trafficCollisions;
    report.incidents = monitor.incidents;

    // 3. Result, reward, save, reload.
    const result = held.result;
    if (result) {
      const r: FestivalResult = result;
      report.outcome = r.completed ? 'completed' : 'failed';
      report.time = r.time === null ? null : round(r.time, 2);
      report.position = r.position;
      report.entrants = r.entrants;
      report.stars = r.stars;
      report.legalDistance = round(r.legalDistance);
      report.field = r.standings.map((x) => `${x.name.replace(/ .*/, '')}${x.car === 0 ? '*' : ''}:${x.time === null ? 'DNF' + Math.round(x.progress * 100) + '%' : x.time.toFixed(1)}`).join(' ');
      report.offRouteSeconds = round(r.offRouteSeconds);
      const score = r.trapKmh ?? r.averageKmh ?? r.driftScore;
      report.score = score === null ? null : round(score, 1);
      report.scoreLabel = r.trapKmh !== null ? 'km/h trap' : r.averageKmh !== null ? 'km/h avg' : r.driftScore !== null ? 'drift pts' : '';
      report.checks.push(...auditResult(event, r, o.vehicle, [...previous, ...(shared.results ?? [])]));
      if (sim.takeResult() !== null) report.checks.push({ name: 'a result is delivered once', ok: false, detail: 'takeResult returned it again' });
      const afterRace = isRace(event.spec.kind);
      if (afterRace) {
        // The results card holds the field until Continue; then free roam alone.
        report.checks.push({ name: 'race shows its results card', ok: sim.mode === 'finished', detail: `mode ${sim.mode}` });
        sim.command({ type: 'continue' });
        for (let i = 0; i < 4; i++) advance(false, true);
      } else for (let i = 0; i < 4; i++) advance();
      report.checks.push({ name: 'back to free roam with the player alone', ok: sim.mode === 'free' && sim.cars.length === 1, detail: `mode ${sim.mode}, ${sim.cars.length} cars` });
      shared.results?.push(r);

      const registry = liveRegistry();
      const career = shared.career ?? richCareer(o.vehicle);
      const settled = settleFestival(career, registry, r, { loaner: null, career: true });
      shared.career = settled.save;
      report.reward = {
        paid: settled.payout.paid,
        total: settled.payout.total,
        reputation: settled.payout.reputation,
        lines: settled.payout.lines.length,
        reason: settled.payout.reason,
      };
      if (r.completed && !r.assisted) {
        const sum = settled.payout.lines.reduce((a, l) => a + l.amount, 0);
        report.checks.push({ name: 'completed run is paid, lines sum to the total', ok: settled.payout.paid ? sum === settled.payout.total && settled.payout.total > 0 : /locked|not a festival machine/i.test(settled.payout.reason ?? ''), detail: `paid ${settled.payout.paid}, total ${settled.payout.total}, lines ${sum}, ${settled.payout.reason}` });
        const again = settleFestival(settled.save, registry, structuredClone(r), { loaner: null, career: true });
        report.checks.push({ name: 'the same run is never paid twice', ok: again.save === settled.save && !again.payout.paid, detail: again.payout.reason ?? '' });
        if (settled.payout.paid) {
          const rec = settled.save.festival[festivalKey(registry.festival![0].id, o.event)];
          report.checks.push({ name: 'career records the run', ok: !!rec && rec.runs >= 1 && rec.stars >= r.stars, detail: JSON.stringify(rec) });
        }
      }

      const save = shared.save ?? blankSave(o.vehicle);
      for (const id of sim.discovered) if (!save.discovered.includes(id)) save.discovered.push(id);
      const changed = recordFestivalBest(save, r);
      const back = validateFestivalSave(JSON.parse(JSON.stringify(save)));
      const equal = back !== null && JSON.stringify(back) === JSON.stringify({ ...save, traffic: save.traffic ?? true });
      const reload = newSim(o, { discovered: back?.discovered ?? [], session: `qa-reload-${o.seed}` });
      const reloaded = [...sim.discovered].every((id) => reload.discovered.has(id)) && reload.status().discovered.length === sim.discovered.size;
      shared.save = save;
      report.save = { roundTrip: equal, discovered: save.discovered.length, reloadDiscovered: reloaded, best: !!save.best[o.event] && (changed || r.assisted || !r.completed || true) };
      if (r.completed && !r.assisted) {
        const b = save.best[o.event];
        report.checks.push({ name: 'festival save keeps the best result', ok: !!b && b.stars >= r.stars, detail: JSON.stringify(b) });
      }
      report.checks.push({ name: 'save survives JSON and validation unchanged', ok: equal, detail: JSON.stringify(save).slice(0, 160) });
      report.checks.push({ name: 'a reloaded session knows the discovered events', ok: reloaded, detail: `${reload.discovered.size} vs ${sim.discovered.size}` });
    } else if (report.outcome !== 'no-start') report.outcome = sim.time - start >= budgetSeconds(event) ? 'timeout' : 'failed';
    report.verdict = verdictOf(report, race);
  } catch (error) {
    report.outcome = 'error';
    report.error = error instanceof Error ? (error.stack ?? error.message).split('\n').slice(0, 4).join(' | ') : String(error);
    report.verdict = 'fail';
  }
  report.wallMs = Math.round(performance.now() - wall);
  return report;
}
const round = (v: number, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
function verdictOf(r: ActivityReport, race: boolean): Verdict {
  const failed = r.checks.filter((c) => !c.ok);
  if (r.outcome !== 'completed' || r.nan.length || failed.length || r.startedBy === 'none') return 'fail';
  const warn: string[] = [];
  if (r.pilotResets || r.autoResets) warn.push(`${r.pilotResets + r.autoResets} reset(s)`);
  if (r.rivalResets) warn.push(`${r.rivalResets} rival reset(s)`);
  if (r.longestStuckS > 5) warn.push(`stuck ${r.longestStuckS} s`);
  if (r.longestStallS > 15) warn.push(`stalled ${r.longestStallS} s`);
  if (r.offRouteSeconds > 5) warn.push(`${r.offRouteSeconds} s off route`);
  if (r.falls) warn.push(`${r.falls} fall(s)`);
  if (r.notes.length) warn.push(...r.notes);
  if (!race && r.kind === 'drift-zone' && (r.score ?? 0) === 0) warn.push(r.repro.includes('--slide') ? 'slide pilot scored 0 drift points' : 'pilot grips: 0 drift points (cannot drift)');
  r.notes.splice(0, r.notes.length, ...warn);
  return warn.length ? 'warn' : 'pass';
}

// --- Tour: every activity in one session ------------------------------------
/** Unlock order: reputation needed first (skill events, sprints, road race,
 * circuits, showcase), then distance from where the car stands. */
export function tourOrder(sim: OpenWorldSimulation) {
  return [...sim.events].sort(
    (a, b) =>
      FESTIVAL_RULES[a.spec.kind].reputation - FESTIVAL_RULES[b.spec.kind].reputation ||
      a.index - b.index,
  );
}
export interface TourReport {
  vehicle: string;
  weather: string;
  seed: number;
  steps: ActivityReport[];
  credits: number;
  reputation: number;
  locked: string[];
  saveReloads: number;
  repro: string;
  wallMs: number;
}
/** One session, one career: drive between markers with traffic on, run each
 * activity, settle it in a natural-reputation career, save and reload the
 * session every `reloadEvery` events. */
export function runTour(o: { vehicle: string; weather: WeatherPreset; seed: number; skill?: number; reloadEvery?: number; only?: string[]; onStep?: (r: ActivityReport) => void }): TourReport {
  const wall = performance.now();
  const base: RunOptions = defaultRun('', { vehicle: o.vehicle, weather: o.weather, seed: o.seed, approach: 'drive', traffic: true, skill: o.skill ?? 0.92 });
  let sim = newSim(base);
  const shared: Shared = { sim, career: richCareer(o.vehicle), save: blankSave(o.vehicle), results: [] };
  // A natural career: start with no reputation and only what the runs earn.
  shared.career = { ...shared.career!, reputation: { ...shared.career!.reputation, festival: 0 } };
  const steps: ActivityReport[] = [];
  let reloads = 0;
  const order = tourOrder(sim).filter((e) => !o.only || o.only.includes(e.spec.id));
  const locked: string[] = [];
  order.forEach((e, i) => {
    const rep = shared.career!.reputation.festival;
    if (rep < FESTIVAL_RULES[e.spec.kind].reputation) locked.push(`${e.spec.id} (needs ${FESTIVAL_RULES[e.spec.kind].reputation}, has ${rep})`);
    const step = runActivity({ ...base, event: e.spec.id }, shared);
    steps.push(step);
    o.onStep?.(step);
    if (o.reloadEvery && (i + 1) % o.reloadEvery === 0 && i + 1 < order.length) {
      // Quit to the menu and come back: a new session from the saved state.
      const saved = validateFestivalSave(JSON.parse(JSON.stringify(shared.save)))!;
      sim = newSim(base, { discovered: saved.discovered, session: `qa-${o.seed}-reload${++reloads}` });
      shared.sim = sim;
      shared.results = [];
    }
  });
  return {
    vehicle: o.vehicle,
    weather: o.weather,
    seed: o.seed,
    steps,
    credits: shared.career!.credits,
    reputation: shared.career!.reputation.festival,
    locked,
    saveReloads: reloads,
    repro: `${SCRIPT} --tour --vehicles ${o.vehicle} --weathers ${o.weather} --seed ${o.seed}`,
    wallMs: Math.round(performance.now() - wall),
  };
}

// --- Leaks: consecutive sessions in one process ------------------------------
export interface LeakReport {
  sessions: number;
  digests: string[];
  deterministic: boolean;
  heapMb: number[];
  growthMbPerSession: number;
  worldCached: boolean;
  retained: { tilesResident: number[]; resultsPerSession: number[] };
}
export function runLeaks(n: number, events = ['coast-trap', 'harbour-welcome']): LeakReport {
  const gc = (globalThis as { gc?: () => void }).gc;
  const heap: number[] = [],
    digests: string[] = [],
    resident: number[] = [],
    resultCounts: number[] = [];
  for (let i = 0; i < n; i++) {
    let sim: OpenWorldSimulation | null = newSim(defaultRun('', { traffic: true }), { session: `qa-leak` });
    const parts: string[] = [];
    for (const id of events) {
      const shared: Shared = { sim, career: richCareer(sim.player.definition.id), save: blankSave(sim.player.definition.id), results: [] };
      const r = runActivity(defaultRun(id), shared);
      parts.push(`${id}:${r.time}:${r.score}:${r.position}:${r.stars}`);
      // Free roam with traffic between events (state a long session builds up).
      for (let t = 0; t < 120 * 10; t++) sim.step(DT);
    }
    digests.push(`${parts.join('|')}|traffic:${sim.traffic.digest()}`);
    resident.push(sim.status().streaming.resident);
    resultCounts.push(sim.results.length);
    sim = null;
    gc?.();
    heap.push(round(process.memoryUsage().heapUsed / 1048576, 1));
  }
  const tail = heap.slice(Math.floor(n / 2));
  return {
    sessions: n,
    digests,
    deterministic: new Set(digests.map((d) => d.replace(/\|traffic:.*/, ''))).size === 1,
    heapMb: heap,
    growthMbPerSession: n > 2 ? round((tail[tail.length - 1] - tail[0]) / Math.max(1, tail.length - 1), 2) : 0,
    worldCached: openWorld() === openWorld(),
    retained: { tilesResident: resident, resultsPerSession: resultCounts },
  };
}

// --- Summary ------------------------------------------------------------------
export function summarize(reports: ActivityReport[]) {
  const events = [...new Set(reports.map((r) => r.event))];
  const conditions = [...new Set(reports.map((r) => `${r.vehicle}/${r.weather}`))];
  const result = (r: ActivityReport) =>
    r.outcome !== 'completed'
      ? r.outcome
      : r.kind === 'speed-trap'
        ? `${Math.round(r.score ?? 0)} km/h ${r.stars}*`
        : r.kind === 'speed-zone'
          ? `${Math.round(r.score ?? 0)} km/h avg ${r.stars}*`
          : r.kind === 'drift-zone'
            ? `${Math.round(r.score ?? 0)} pts ${r.stars}*`
            : `P${r.position}/${r.entrants} ${r.time}s ${r.stars}*`;
  const cell = (r: ActivityReport | undefined) =>
    !r ? '' : `${r.verdict === 'pass' ? 'pass' : r.verdict === 'warn' ? 'warn' : 'FAIL'} ${result(r)}`;
  const lines = [`| event | ${conditions.join(' | ')} |`, `|---|${conditions.map(() => '---').join('|')}|`];
  for (const e of events)
    lines.push(`| ${e} | ${conditions.map((c) => cell(reports.find((r) => r.event === e && `${r.vehicle}/${r.weather}` === c))).join(' | ')} |`);
  const flagged = reports.filter((r) => r.verdict !== 'pass');
  if (flagged.length) {
    lines.push('', 'Flagged runs:');
    for (const r of flagged)
      lines.push(`- ${r.verdict.toUpperCase()} ${r.event} ${r.vehicle}/${r.weather}: ${[...r.notes, ...r.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`), ...(r.error ? [r.error] : [])].join('; ') || r.outcome}${r.incidents.length ? ` [${r.incidents.slice(0, 3).join(' | ')}]` : ''}`);
  }
  const wall = reports.reduce((a, r) => a + r.wallMs, 0);
  lines.push('', `${reports.length} runs, ${reports.filter((r) => r.verdict === 'pass').length} pass, ${reports.filter((r) => r.verdict === 'warn').length} warn, ${reports.filter((r) => r.verdict === 'fail').length} FAIL, ${Math.round(wall / 1000)} s of wall time.`);
  return lines.join('\n');
}
export function readRuns(...files: string[]): ActivityReport[] {
  const out: ActivityReport[] = [];
  for (const f of files)
    if (existsSync(f))
      for (const line of readFileSync(f, 'utf8').split('\n'))
        if (line.trim()) {
          const r = JSON.parse(line);
          if (r.event && r.verdict) out.push(r);
        }
  return out;
}

// --- CLI ----------------------------------------------------------------------
function argv(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function line(r: ActivityReport) {
  const score = r.score === null ? '' : ` ${r.score} ${r.scoreLabel}`;
  const pos = r.position ? ` P${r.position}/${r.entrants}` : '';
  return `${r.verdict.toUpperCase().padEnd(4)} ${r.event.padEnd(20)} ${r.vehicle.padEnd(6)} ${r.weather.padEnd(10)} ${r.outcome}${r.time !== null ? ` ${r.time}s` : ''}${pos}${score} ${r.stars}*  resets ${r.pilotResets}+${r.autoResets}  stuck ${r.longestStuckS}s  off ${r.offRouteSeconds}s  wall ${(r.wallMs / 1000).toFixed(0)}s${r.notes.length ? '  [' + r.notes.join('; ') + ']' : ''}${r.error ? '  ERR ' + r.error : ''}`;
}
function main() {
  const out = argv('out');
  const seed = Number(argv('seed', String(DEFAULT_SEED)));
  const approach = argv('approach', 'travel') as Approach;
  const skill = Number(argv('skill', '0.92'));
  const vehicles = argv('vehicles', festivalDefaultVehicle()).split(',');
  const weathers = argv('weathers', 'clear').split(',') as WeatherPreset[];
  for (const w of weathers) if (!(WEATHER_IDS as readonly string[]).includes(w)) throw new Error(`Unknown weather ${w}`);
  if (flag('summarize')) {
    const files = process.argv.slice(process.argv.indexOf('--summarize') + 1).filter((a) => !a.startsWith('--'));
    console.log(summarize(readRuns(...files)));
    return;
  }
  if (flag('leaks')) {
    const report = runLeaks(Number(argv('leaks', '5')));
    console.log(JSON.stringify(report, null, 2));
    if (out) appendFileSync(out, JSON.stringify({ leaks: report }) + '\n');
    if (!report.deterministic) process.exitCode = 1;
    return;
  }
  if (flag('tour')) {
    const only = argv('events') ? argv('events').split(',') : undefined;
    for (const vehicle of vehicles)
      for (const weather of weathers) {
        const tour = runTour({ vehicle, weather, seed, skill, reloadEvery: Number(argv('reload-every', '6')), only, onStep: (r) => console.log(line(r)) });
        console.log(`tour ${vehicle}/${weather}: ${tour.steps.filter((s) => s.verdict !== 'fail').length}/${tour.steps.length} ok, credits ${tour.credits}, reputation ${tour.reputation}, ${tour.saveReloads} reloads, wall ${(tour.wallMs / 1000).toFixed(0)} s; locked at start: ${tour.locked.join('; ') || 'none'}`);
        if (out) appendFileSync(out, JSON.stringify({ tour }) + '\n');
        if (tour.steps.some((s) => s.verdict === 'fail')) process.exitCode = 1;
      }
    return;
  }
  const probe = openWorld();
  const all = probe.region.events.map((e) => e.id);
  const events = argv('events', 'all') === 'all' ? all : argv('events').split(',');
  const done = new Set(readRuns(out).map((r) => `${r.event}|${r.vehicle}|${r.weather}|${r.seed}|${r.approach}`));
  let failed = 0;
  for (const weather of weathers)
    for (const vehicle of vehicles)
      for (const event of events) {
        const o = defaultRun(event, { vehicle, weather, seed, approach, skill, traffic: flag('traffic'), slide: flag('slide'), trace: argv('trace') ? (argv('trace').split(',').map(Number) as [number, number]) : undefined });
        if (flag('resume') && done.has(`${event}|${vehicle}|${weather}|${seed}|${approach}`)) continue;
        const r = runActivity(o);
        console.log(line(r));
        if (r.verdict !== 'pass') for (const i of r.incidents) console.log(`     ${i}`);
        if (r.verdict === 'fail') {
          failed++;
          for (const c of r.checks.filter((x) => !x.ok)) console.log(`     check failed: ${c.name} - ${c.detail}`);
          console.log(`     repro: ${r.repro}`);
        }
        if (out) appendFileSync(out, JSON.stringify(r) + '\n');
      }
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
