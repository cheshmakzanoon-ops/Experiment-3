// Motocross ride-feel probe: the production simulation at 120 Hz, solo, on
// both dirt venues. The course AI supplies the control inputs, and the ridden
// machine is stepped once on the calibrated AI path and once on the player's
// own contact solver (the AI mark is withheld, so its inputs are integrated
// exactly as a player's would be). Nothing is written back to the simulation.
//
// It reports what a rider feels and a chase camera shows: completed laps and
// lap-time spread, falls, stalls, the vertical acceleration and jerk carried
// by the sprung chassis on the ground, pitch and yaw-rate chatter, suspension
// shaft-speed peaks, and each landing's impact speed, peak deceleration and
// outcome. `MX_PROBE_JSON=<path>` also writes the numbers as JSON.
//   node --experimental-transform-types scripts/motocross-feel-probe.ts
import { writeFileSync } from 'node:fs';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120,
  G = 9.81;
const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const rms = (values: number[]) =>
  values.length ? Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length) : 0;
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

interface Run {
  venue: string;
  machine: string;
  path: 'player-solver' | 'ai-core';
  laps: number;
  seconds: number;
}
function probe({ venue, machine, path, laps, seconds }: Run) {
  const options: SessionOptions = {
    ...DEFAULT_OPTIONS,
    circuit: venue as SessionOptions['circuit'],
    mode: 'race',
    weather: 'clear',
    ruleset: 'motocross-moto',
    laps,
    opponents: 0,
    vehicles: [machine],
    seed: 61007,
  };
  const sim = new Simulation(options);
  sim.autoPlayer = true;
  const bike = sim.cars[0] as DirtBikeVehicle;
  if (!(bike instanceof DirtBikeVehicle)) throw new Error('Not a dirt bike');
  // The player's solver: same inputs, without the AI mark on the machine.
  if (path === 'player-solver') bike.aiControlled = () => {};
  const groundAccel: number[] = [],
    groundJerk: number[] = [],
    pitchAccel: number[] = [],
    yawAccel: number[] = [],
    leanAccel: number[] = [],
    longitudinalJerk: number[] = [],
    shaft: number[] = [],
    landings: { speed: number; peakG: number; outcome: string; airTime: number }[] = [],
    lapTimes: number[] = [];
  let vy = bike.vy,
    accel = 0,
    pitchRate = bike.pitchRate,
    heading = bike.dynamics.heading,
    yawRate = 0,
    leanRate = 0,
    speed = bike.dynamics.speed,
    longitudinal = 0,
    front = bike.compressionFront,
    rear = bike.compressionRear,
    grounded = 0,
    stalled = 0,
    stalls = 0,
    falls = 0,
    wasRiding = true,
    wasAirborne = false,
    landingClock = 1,
    landingPeak = 0,
    lastLap = 0,
    lapStart = 0,
    t = 0,
    maxAir = 0,
    flights = 0;
  for (; t < seconds && sim.race.phase !== PHASE.FINISHED; t += DT) {
    sim.step(DT);
    if (sim.race.phase !== PHASE.RACING) {
      vy = bike.vy;
      pitchRate = bike.pitchRate;
      heading = bike.dynamics.heading;
      speed = bike.dynamics.speed;
      front = bike.compressionFront;
      rear = bike.compressionRear;
      lapStart = t;
      continue;
    }
    const riding = bike.riding;
    if (wasRiding && !riding) falls++;
    wasRiding = riding;
    const nextAccel = (bike.vy - vy) / DT,
      nextYawRate =
        (((bike.dynamics.heading - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / DT,
      nextLongitudinal = (bike.dynamics.speed - speed) / DT;
    grounded = riding && !bike.airborne && !wasAirborne ? grounded + 1 : 0;
    landingClock += DT;
    if (wasAirborne && !bike.airborne && riding) {
      landingClock = 0;
      landingPeak = 0;
      flights++;
    }
    if (landingClock < 0.35) landingPeak = Math.max(landingPeak, nextAccel);
    else if (landingClock - DT < 0.35 && bike.lastLanding) {
      landings.push({
        speed: bike.lastLanding.normalSpeed,
        peakG: landingPeak / G,
        outcome: bike.lastLanding.outcome,
        airTime: bike.lastLanding.airTime,
      });
      maxAir = Math.max(maxAir, bike.lastLanding.airTime);
    }
    // Settled ground riding only: a touchdown is reported with the landings.
    if (grounded > 42 && bike.dynamics.speed > 3) {
      groundAccel.push(nextAccel);
      groundJerk.push((nextAccel - accel) / DT);
      pitchAccel.push((bike.pitchRate - pitchRate) / DT);
      yawAccel.push((nextYawRate - yawRate) / DT);
      leanAccel.push((bike.dynamics.leanRate - leanRate) / DT);
      longitudinalJerk.push((nextLongitudinal - longitudinal) / DT);
      shaft.push(
        Math.max(
          Math.abs(bike.compressionFront - front),
          Math.abs(bike.compressionRear - rear),
        ) / DT,
      );
    }
    stalled = riding && bike.dynamics.speed < 1 ? stalled + DT : 0;
    if (stalled >= 2 && stalled - DT < 2) stalls++;
    const lap = sim.race.laps[0].completed;
    if (lap !== lastLap) {
      lapTimes.push(t - lapStart);
      lapStart = t;
      lastLap = lap;
    }
    vy = bike.vy;
    accel = nextAccel;
    pitchRate = bike.pitchRate;
    heading = bike.dynamics.heading;
    yawRate = nextYawRate;
    leanRate = bike.dynamics.leanRate;
    speed = bike.dynamics.speed;
    longitudinal = nextLongitudinal;
    front = bike.compressionFront;
    rear = bike.compressionRear;
    wasAirborne = bike.airborne;
  }
  const abs = (values: number[]) => values.map(Math.abs);
  const mean = lapTimes.reduce((a, b) => a + b, 0) / Math.max(1, lapTimes.length);
  return {
    venue,
    machine,
    path,
    simulatedSeconds: round(t, 1),
    lapsCompleted: lapTimes.length,
    lapTimes: lapTimes.map((v) => round(v)),
    lapSpread: lapTimes.length > 1 ? round(Math.max(...lapTimes) - Math.min(...lapTimes)) : 0,
    lapMean: round(mean),
    falls,
    fallCauses: bike.crashCauses.map((c) => `${c.cause}@${Math.round(c.s)}`),
    stalls,
    flights,
    longestAir: round(maxAir),
    ground: {
      verticalRmsG: round(rms(groundAccel) / G, 3),
      verticalP999G: round(percentile(abs(groundAccel), 0.999) / G, 2),
      verticalPeakG: round(Math.max(0, ...abs(groundAccel)) / G, 2),
      jerkRms: round(rms(groundJerk), 0),
      jerkP999: round(percentile(abs(groundJerk), 0.999), 0),
      pitchAccelRms: round(rms(pitchAccel), 2),
      pitchAccelP999: round(percentile(abs(pitchAccel), 0.999), 1),
      yawAccelRms: round(rms(yawAccel), 2),
      yawAccelP999: round(percentile(abs(yawAccel), 0.999), 1),
      leanAccelRms: round(rms(leanAccel), 2),
      leanAccelP999: round(percentile(abs(leanAccel), 0.999), 1),
      longitudinalJerkRms: round(rms(longitudinalJerk), 0),
      longitudinalJerkP999: round(percentile(abs(longitudinalJerk), 0.999), 0),
      shaftSpeedP999: round(percentile(shaft, 0.999), 2),
      shaftSpeedPeak: round(Math.max(0, ...shaft), 2),
    },
    landings: {
      count: landings.length,
      clean: landings.filter((l) => l.outcome === 'clean').length,
      bottomed: landings.filter((l) => l.outcome === 'bottomed').length,
      crashed: landings.filter((l) => l.outcome.startsWith('crash')).length,
      meanImpact: round(landings.reduce((a, l) => a + l.speed, 0) / Math.max(1, landings.length)),
      meanPeakG: round(landings.reduce((a, l) => a + l.peakG, 0) / Math.max(1, landings.length)),
      worstPeakG: round(Math.max(0, ...landings.map((l) => l.peakG))),
    },
  };
}

const only = process.env.MX_PROBE,
  laps = Number(process.env.MX_PROBE_LAPS ?? 4);
const runs: Run[] = [];
for (const venue of ['valley-ridge-mx', 'arena-nord-sx'])
  for (const machine of ['mx450', 'mx250'])
    for (const path of ['player-solver', 'ai-core'] as const)
      runs.push({ venue, machine, path, laps, seconds: 150 * laps });
const results = runs
  .filter((r) => !only || `${r.venue} ${r.machine} ${r.path}`.includes(only))
  .map((run) => {
    const result = probe(run);
    console.info(
      `${result.venue} ${result.machine} ${result.path}: laps ${result.lapsCompleted}/${run.laps} ` +
        `[${result.lapTimes.join(', ')}] spread ${result.lapSpread} s, falls ${result.falls} ` +
        `(${result.fallCauses.join(', ')}), stalls ${result.stalls}, flights ${result.flights}`,
    );
    console.info(`  ground ${JSON.stringify(result.ground)}`);
    console.info(`  landings ${JSON.stringify(result.landings)}`);
    return result;
  });
if (process.env.MX_PROBE_JSON) writeFileSync(process.env.MX_PROBE_JSON, JSON.stringify(results, null, 1));
