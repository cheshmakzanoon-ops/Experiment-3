// Seeded AI races for the WILDCARD SERIES (src/career/wildcard-series.ts):
// every event is loaded exactly as the player loads it (wildcardSession over
// the default options: its own machines, venue, ruleset, weather, laps, grid,
// AI skill and seed) and driven by the production simulation, AI and race
// control at 120 Hz. A time attack is driven by the AI as the "player" and
// must complete its laps. Asserts, per event: no exception and no non-finite
// rigid state, the race finishes inside its time limit with every entrant
// classified, nobody is parked longer than STUCK_SECONDS, no marshal recovery
// was needed, no machine strays more than MAX_STRAY_M beyond its road edge or
// spends more than MAX_OFF_SHARE of its racing time beyond it, lap times are
// plausible against the machine's own envelope, the field is coherent (half of
// it sets a valid lap; a time attack needs its laps valid), and riders stay inside the crash bounds the other bike suites use. Writes
// docs/wildcard-races.json (merging the events run into the existing
// evidence, each keyed to a hash of its definition so stale evidence is
// caught by tests/wildcard-series.test.ts); exits 1 when an assertion fails.
//   node --experimental-transform-types scripts/wildcard-races.ts [id,id...] [--no-write]
import { readFileSync, writeFileSync } from 'node:fs';
import {
  WILDCARD_SERIES,
  wildcardMedal,
  wildcardSession,
  type WildcardEntry,
} from '../src/career/wildcard-series.ts';
import { wildcardHash as entryHash } from '../src/career/wildcard-validation.ts';
import { vehicleFamily } from '../src/simulation/bike-definitions.ts';
import type { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { rulesetFor } from '../src/simulation/events.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;
/** A machine below 1 m/s while racing this long is stuck (s): four-wheel / riders
 * (a rider's fall, jog back, push and remount takes up to 20 s elsewhere). */
const STUCK_SECONDS = { car: 8, bike: 20 } as const;
/** Furthest a machine's centre may get beyond its road edge (m). */
const MAX_STRAY_M = 12;
/** Largest share of its racing time a machine may spend beyond the road edge. */
const MAX_OFF_SHARE = 0.2;
/** Best-lap average speed must lie in this share of the machine's AI top speed. */
const SPEED_BAND = [0.06, 1.05] as const;
/** The slowest entrant's best lap against the fastest's. */
const MAX_FIELD_SPREAD = 1.6;
/** Rider crashes per rider-lap (road racing bound of bike-race.ts is 6 in all). */
const MAX_CRASHES_PER_RIDER_LAP = 0.5;

const argv = process.argv.slice(2);
const write = !argv.includes('--no-write');
const requested = argv.find((a) => !a.startsWith('--'));
const entries: readonly WildcardEntry[] = requested
  ? requested.split(',').map((id) => {
      const found = WILDCARD_SERIES.find((e) => e.id === id);
      if (!found) throw new Error(`Unknown wildcard event ${id}`);
      return found;
    })
  : WILDCARD_SERIES;

function run(entry: WildcardEntry) {
  const started = performance.now();
  const options = wildcardSession(entry, DEFAULT_OPTIONS);
  const sim = new Simulation(options);
  sim.autoPlayer = true;
  const n = sim.cars.length,
    timeAttack = entry.rules.includes('time-attack'),
    length = sim.track.length;
  const family = vehicleFamily(sim.cars[0].definition) === 'bike' ? 'bike' : 'car';
  const stuck = new Float64Array(n),
    worstStuck = new Float64Array(n),
    off = new Float64Array(n),
    racing = new Float64Array(n),
    stray = new Float64Array(n);
  let maximumImpact = 0,
    airborne = 0,
    nonFinite = '';
  const failures: string[] = [];
  // 8 m/s is slower than the slowest dirt-bike lap in the suites; generous.
  const limit = Math.max(300, (length / 8) * (options.laps + 2));
  let t = 0;
  const done = () =>
    timeAttack ? sim.race.laps[0].completed >= options.laps : sim.race.phase === PHASE.FINISHED;
  for (; t < limit && !done(); t += DT) {
    sim.step(DT);
    for (const car of sim.cars) {
      if (!(car.body.position.finite() && car.body.omega.finite())) {
        nonFinite = `car ${car.id} at ${sim.race.raceTime.toFixed(1)} s`;
        break;
      }
      maximumImpact = Math.max(maximumImpact, car.impact);
      if (sim.race.phase === PHASE.RACING && car.tires.every((w) => w.compression <= 0))
        airborne += DT;
      const live = sim.race.phase === PHASE.RACING && !car.finishTime && !car.inPit;
      if (live && sim.race.time > sim.race.greenAt + 5 && car.speed < 1) {
        stuck[car.id] += DT;
        worstStuck[car.id] = Math.max(worstStuck[car.id], stuck[car.id]);
      } else stuck[car.id] = 0;
      if (live) {
        racing[car.id] += DT;
        const over = Math.abs(car.lateral) - car.trackPosition.width;
        if (over > 0) off[car.id] += DT;
        stray[car.id] = Math.max(stray[car.id], over);
      }
    }
    if (nonFinite) break;
  }
  if (nonFinite) failures.push(`non-finite rigid state: ${nonFinite}`);
  if (!done()) failures.push(`did not finish in ${limit.toFixed(0)} s of race time`);
  const cars = sim.cars.map((c, id) => {
    const lap = sim.race.laps[id],
      envelope = c.definition.ai.topSpeed,
      kmh = lap.best > 0 ? (length / lap.best) * 3.6 : 0;
    return {
      id,
      vehicle: c.definition.id,
      laps: lap.completed,
      bestLapS: lap.best > 0 ? +lap.best.toFixed(3) : null,
      averageKmh: +kmh.toFixed(1),
      finishTimeS: +c.finishTime.toFixed(2),
      retired: c.retired,
      worstStuckS: +worstStuck[id].toFixed(2),
      offRoadShare: racing[id] > 0 ? +(off[id] / racing[id]).toFixed(3) : 0,
      maxStrayM: +stray[id].toFixed(2),
      recoveries: sim.recoveries[id],
      trackLimitWarnings: lap.warnings,
      penaltyS: lap.penalty,
      crashes: (c as Partial<BikeVehicle>).dynamics?.crashes ?? null,
      envelopeKmh: +(envelope * 3.6).toFixed(0),
    };
  });
  for (const c of cars) {
    const at = `car ${c.id} (${c.vehicle})`;
    if (timeAttack ? c.laps < options.laps : !(c.finishTimeS > 0) || c.retired)
      failures.push(`${at} ${c.retired ? 'retired' : 'was not classified'} (${c.laps} laps)`);
    if (c.worstStuckS > STUCK_SECONDS[family]) failures.push(`${at} stuck ${c.worstStuckS} s`);
    if (c.recoveries) failures.push(`${at} needed ${c.recoveries} marshal recovery(ies)`);
    if (c.maxStrayM > MAX_STRAY_M) failures.push(`${at} strayed ${c.maxStrayM} m beyond the road`);
    if (c.offRoadShare > MAX_OFF_SHARE)
      failures.push(`${at} spent ${(c.offRoadShare * 100).toFixed(0)} % of the race off the road`);
    // A race is decided by finishing order: one track-limit warning voids a
    // lap, so only a time attack (whose medal is the lap) needs every lap
    // valid; a race needs a valid lap from at least half the field (below).
    if (!c.bestLapS) {
      if (timeAttack) failures.push(`${at} has no valid lap`);
    } else {
      const ratio = c.averageKmh / c.envelopeKmh;
      if (!(ratio >= SPEED_BAND[0] && ratio <= SPEED_BAND[1]))
        failures.push(`${at} best lap ${c.bestLapS} s (${c.averageKmh} km/h) implausible`);
    }
    if (c.crashes !== null && c.crashes > Math.max(1, Math.ceil(options.laps / 2)))
      failures.push(`${at} crashed ${c.crashes} times in ${options.laps} laps`);
  }
  const riders = cars.filter((c) => c.crashes !== null);
  const crashRate = riders.length
    ? riders.reduce((a, c) => a + (c.crashes ?? 0), 0) / (riders.length * options.laps)
    : null;
  if (crashRate !== null && crashRate > MAX_CRASHES_PER_RIDER_LAP)
    failures.push(
      `${crashRate.toFixed(2)} crashes per rider-lap (bound ${MAX_CRASHES_PER_RIDER_LAP})`,
    );
  const bests = cars.map((c) => c.bestLapS).filter((b): b is number => !!b);
  if (bests.length * 2 < cars.length)
    failures.push(`only ${bests.length} of ${cars.length} entrants set a valid lap`);
  if (bests.length > 1 && Math.max(...bests) > Math.min(...bests) * MAX_FIELD_SPREAD)
    failures.push(`field spread ${(Math.max(...bests) / Math.min(...bests)).toFixed(2)} x`);
  const fastest = bests.length ? Math.min(...bests) : null;
  const winner = sim.race.order[0] ?? 0;
  return {
    id: entry.id,
    hash: entryHash(entry),
    circuit: options.circuit,
    venue: CIRCUITS[options.circuit!].name,
    lapLengthM: Math.round(length),
    ruleset: options.ruleset,
    mode: options.mode,
    weather: options.weather,
    assist: options.assist,
    laps: options.laps,
    cars: n,
    aiSkill: options.aiSkill ?? null,
    seed: options.seed,
    vehicles: options.vehicles,
    passed: failures.length === 0,
    failures,
    raceSeconds: +sim.race.raceTime.toFixed(2),
    simulatedSeconds: +t.toFixed(1),
    wallSeconds: +((performance.now() - started) / 1000).toFixed(1),
    fastestLapS: fastest,
    slowestBestLapS: bests.length ? Math.max(...bests) : null,
    fastestAverageKmh: fastest ? +((length / fastest) * 3.6).toFixed(1) : null,
    maximumImpact: +maximumImpact.toFixed(3),
    airborneCarSeconds: +airborne.toFixed(2),
    riderCrashes: crashRate === null ? null : riders.map((c) => c.crashes),
    incidents: sim.race.control.events.filter((e) => e.kind === 'incident').length,
    safetyCarDeployments: sim.race.safetyCar.deployments,
    pointsPaidTo: rulesetFor(options).points.length,
    ladderCheck: {
      winnerMedal: timeAttack
        ? wildcardMedal(entry, { position: 1, classified: true, bestLap: fastest ?? 0 })
        : wildcardMedal(entry, {
            position: sim.race.order.indexOf(winner) + 1,
            classified: true,
            bestLap: 0,
          }),
    },
    classification: cars,
  };
}

const DOC = 'docs/wildcard-races.json';
/** Merge one report into the evidence document (series order, stale entries
 * dropped), so an interrupted run keeps every event finished so far. */
function persist(report: { id: string }) {
  if (!write) return;
  let existing: { events?: Record<string, unknown> } = {};
  try {
    existing = JSON.parse(readFileSync(DOC, 'utf8'));
  } catch {
    existing = {};
  }
  const events: Record<string, unknown> = { ...(existing.events ?? {}), [report.id]: report };
  const ordered = Object.fromEntries(
    WILDCARD_SERIES.filter((e) => events[e.id]).map((e) => [e.id, events[e.id]]),
  );
  writeFileSync(
    DOC,
    JSON.stringify(
      {
        description:
          'Seeded AI races for the Wildcard series (src/career/wildcard-series.ts): each event as the player loads it, production simulation and AI at 120 Hz. Lap times are AI pace, not reference records.',
        generatedBy: 'npm run test:wildcard',
        criteria: {
          stuckSecondsAtMost: STUCK_SECONDS,
          maximumStrayMetres: MAX_STRAY_M,
          maximumOffRoadShare: MAX_OFF_SHARE,
          averageSpeedShareOfEnvelope: SPEED_BAND,
          maximumFieldSpread: MAX_FIELD_SPREAD,
          maximumCrashesPerRiderLap: MAX_CRASHES_PER_RIDER_LAP,
        },
        events: ordered,
      },
      null,
      2,
    ) + '\n',
  );
}

const reports = entries.map((entry) => {
  let report;
  try {
    report = run(entry);
  } catch (error) {
    report = {
      id: entry.id,
      hash: entryHash(entry),
      passed: false,
      failures: [`exception: ${error instanceof Error ? (error.stack ?? error.message) : error}`],
    } as ReturnType<typeof run>;
  }
  const best = report.fastestLapS ?? 0;
  console.log(
    `${report.passed ? 'PASS' : 'FAIL'} ${entry.id.padEnd(30)} ${String(report.circuit).padEnd(18)} ` +
      `${report.lapLengthM ?? '?'} m x${report.laps ?? '?'} ${report.cars ?? '?'} cars best ${best.toFixed(2)} s ` +
      `(${report.fastestAverageKmh ?? '?'} km/h) impact ${report.maximumImpact} ${report.wallSeconds ?? '?'} s wall` +
      (report.failures.length ? `\n     ${report.failures.join('\n     ')}` : ''),
  );
  persist(report);
  return report;
});
if (reports.some((r) => !r.passed)) process.exit(1);
