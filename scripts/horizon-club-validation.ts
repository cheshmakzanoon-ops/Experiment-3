/** Drive the actual Saltmarsh events through the production simulation.
 * These are assisted route checks, not human playtests or FPS benchmarks.
 * Run: node --experimental-transform-types scripts/horizon-club-validation.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { WeatherPreset } from '../src/simulation/config.ts';
import type { FestivalResult } from '../src/simulation/open-world/festival-result.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';

const output = resolve(process.env.HORIZON_CLUB_OUTPUT ?? 'test-results/horizon-club/physics.json');
const dt = 1 / 120;

function drive(vehicle: string, weather: WeatherPreset, eventId: string) {
  const sim = new OpenWorldSimulation({
    vehicle,
    weather,
    assist: 'sport',
    seed: 73021,
    traffic: false,
    tileBudget: 12,
    session: `club-validation-${vehicle}-${weather}-${eventId}`,
  });
  sim.command({ type: 'autopilot', value: true });
  sim.command({ type: 'start', event: eventId });
  const event = sim.events.find((event) => event.spec.id === eventId)!;
  const initial = sim.cars.slice();
  const start = event.graph.project(event.graph.spec.start, sim.player.body.position)!;
  const edges = event.graph.spec.edges;
  const lapDistance = edges.reduce((sum, edge) => sum + event.graph.length(edge.id), 0);
  const finish = event.graph.spec.checkpoints.at(-1)!;
  const distanceToFinish = edges
    .slice(
      0,
      edges.findIndex((edge) => edge.id === finish.edge),
    )
    .reduce((sum, edge) => sum + event.graph.length(edge.id), finish.s);
  // RouteProgress measures 3D graph arc from the real grid position. The
  // catalogue distance is plan-view length including the metres behind it.
  const expectedLegalDistanceM = lapDistance * (event.laps - 1) + distanceToFinish - start.s;
  const started = performance.now();
  let result: FestivalResult | null = null;
  let playerContacts = 0;
  let peakKmh = 0;
  let maxLateralM = 0;
  let minimumUpright = 1;
  let minSpeedKmh = Infinity;
  let previousStation = 0;
  let wasOffRoute = false;
  const routeTransitions: object[] = [];
  let worstExcursion: object | null = null;
  const sample = pathPoint();
  const impulse = sim.collisions.impulse.bind(sim.collisions);
  sim.collisions.impulse = (a, b, at, normal, penetration) => {
    if (a === sim.player || b === sim.player) playerContacts++;
    impulse(a, b, at, normal, penetration);
  };
  let replacements = 0;
  let player = sim.player;
  let ticks = 0;
  console.log(`Driving ${eventId}: ${vehicle}, ${weather}`);
  while (ticks < 480 / dt && !result) {
    sim.step(dt);
    ticks++;
    if (sim.player !== player) {
      replacements++;
      player = sim.player;
    }
    if (ticks % 12 === 0) {
      const p = player.body.position;
      previousStation = event.path.locate(p.x, p.z, previousStation, 150);
      event.path.at(previousStation, sample);
      const lateral = Math.abs((p.x - sample.x) * sample.nx + (p.z - sample.z) * sample.nz);
      const status = sim.status();
      const observation = () => ({
        seconds: sim.time,
        stationM: previousStation,
        x: p.x,
        z: p.z,
        lateralM: lateral,
        speedKmh: player.speed * 3.6,
        curvature: sample.curvature,
        input: { ...player.input },
        offRoute: status.event?.offRoute ?? false,
      });
      if (lateral > maxLateralM) worstExcursion = observation();
      maxLateralM = Math.max(maxLateralM, lateral);
      const offRoute = status.event?.offRoute ?? false;
      if (offRoute !== wasOffRoute && routeTransitions.length < 64)
        routeTransitions.push(observation());
      wasOffRoute = offRoute;
      peakKmh = Math.max(peakKmh, player.speed * 3.6);
      minimumUpright = Math.min(minimumUpright, player.up.y);
      if (sim.time > 12) minSpeedKmh = Math.min(minSpeedKmh, player.speed * 3.6);
    }
    result = sim.takeResult();
  }
  const checks = {
    completed: result?.completed === true && result.abandoned === false,
    correctDistance:
      !!result &&
      result.legalDistance >= expectedLegalDistanceM - 0.1 &&
      result.legalDistance - expectedLegalDistanceM <= Math.max(1, player.speed / 30 + 0.25),
    noOffRouteTime: result?.offRouteSeconds === 0,
    noPlayerContacts: playerContacts === 0,
    noPlayerRecovery: replacements === 0,
    noOpponentRecovery: initial.slice(1).every((car, index) => sim.cars[index + 1] === car),
    upright: minimumUpright > 0.8,
    honestAssistance: result?.assisted === true,
  };
  const summary = {
    vehicle,
    weather,
    eventId,
    laps: event.laps,
    distanceM: event.distance,
    expectedLegalDistanceM,
    peakKmh,
    minSpeedKmh,
    maxLateralM,
    minimumUpright,
    playerContacts,
    replacements,
    routeTransitions,
    worstExcursion,
    simulatedSeconds: ticks * dt,
    wallMilliseconds: performance.now() - started,
    result,
    checks,
  };
  console.log(
    JSON.stringify({ eventId, vehicle, weather, checks, time: result?.time, playerContacts }),
  );
  return summary;
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const sources = [...files('src/core'), ...files('src/simulation')].sort();
const sourceHashes = () =>
  Object.fromEntries(
    sources.map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
  );
const before = sourceHashes();
const cases = [
  { id: 'rh3-dry-race', vehicle: 'rh3', weather: 'clear', event: 'saltmarsh-club-race' },
  { id: 'sc7-dry-race', vehicle: 'sc7', weather: 'clear', event: 'saltmarsh-club-race' },
  { id: 'rh3-wet-practice', vehicle: 'rh3', weather: 'rain', event: 'saltmarsh-practice' },
] as const;
const requested = process.env.HORIZON_CLUB_CASE;
const selected = cases.filter((item) => !requested || item.id === requested);
assert(selected.length > 0, 'Unknown HORIZON_CLUB_CASE');
const runs = selected.map((item) => drive(item.vehicle, item.weather, item.event));
const stable = JSON.stringify(before) === JSON.stringify(sourceHashes());
const report = {
  generatedAt: new Date().toISOString(),
  sourceHashes: before,
  sourceStable: stable,
  selectedCases: selected.map((item) => item.id),
  method:
    'Ordinary start and autopilot commands, followed by actual 120 Hz OpenWorldSimulation steps. No forced position, velocity, road grip, rival speed, or reset after the event starts.',
  limitations: [
    'Assisted driving only',
    'No human handling acceptance',
    'No rendering or target-device FPS claim',
  ],
  runs,
  passed: stable && runs.every((run) => Object.values(run.checks).every(Boolean)),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, passed: report.passed }));
assert(report.passed, 'Saltmarsh physics acceptance failed; inspect the saved evidence');
