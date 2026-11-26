import { cpus, platform, arch } from 'node:os';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEFAULT_OPTIONS } from '../../../../src/simulation/config.ts';
import { DirtBikeVehicle } from '../../../../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine } from '../../../../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../../../../src/simulation/offroad/venues.ts';
import type { Track } from '../../../../src/simulation/track.ts';
import { Simulation } from '../../../../src/simulation/world.ts';
import { rideMotocrossFlight } from '../../../../tests/motocross-flight-controls.ts';

function sourceFingerprint() {
  const files = readdirSync('src', { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => `${entry.parentPath}/${entry.name}`);
  files.push('package-lock.json', 'index.html', 'vite.config.ts');
  const hash = createHash('sha256');
  for (const name of files.sort()) hash.update(name + '\0').update(readFileSync(name)).update('\0');
  return hash.digest('hex');
}
const sourceBefore = sourceFingerprint();
const dt = 1 / 120, ticks = 720;
const cases = (['mx250', 'mx450'] as const).flatMap(vehicle =>
  (['valley-ridge-mx', 'arena-nord-sx'] as const).map(circuit => ({ vehicle, circuit })));
const values = (bike: DirtBikeVehicle) => [bike.clock, bike.dynamics.x, bike.dynamics.z,
  bike.dynamics.speed, bike.dynamics.heading, bike.dynamics.lean, bike.dynamics.leanRate,
  bike.dynamics.crashes, bike.fuel, bike.cgY, bike.vy, bike.pitch, bike.pitchRate,
  bike.frontSpin, bike.rearSpin, bike.airYaw, bike.airYawRate, bike.slide,
  bike.fork, bike.shock, bike.forceFront, bike.forceRear, bike.riderBody,
  bike.body.position.x, bike.body.position.y, bike.body.position.z];

function run(item: typeof cases[number], observe = false, timed = false) {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit: item.circuit,
    vehicles: [item.vehicle], opponents: 0, mode: 'practice', ruleset: 'motocross-moto', seed: 52001 });
  const bike = sim.cars[0] as DirtBikeVehicle, track = sim.track;
  const jump = offroadCourse(track.circuit)!.jumps.find(j =>
    j.name === (item.circuit === 'valley-ridge-mx' ? 'RIDGE TABLE' : 'TABLETOP'))!;
  const speed = item.circuit === 'valley-ridge-mx' ? 13.5 : 13;
  bike.place(track, jump.start - 12);
  bike.dynamics.speed = speed;
  bike.gear = 3;
  const internal = bike as unknown as {
    stepInterval(dt: number, track: Track, absorb: boolean): void;
    spring(compression: number, front: boolean): number;
  };
  const step = internal.stepInterval, spring = internal.spring;
  const stepDescriptor = Object.getOwnPropertyDescriptor(bike, 'stepInterval');
  const springDescriptor = Object.getOwnPropertyDescriptor(bike, 'spring');
  let intervals = 0, springs = 0, maximumIntervals = 0, maximumSprings = 0;
  const intervalHistogram: Record<number, number> = {}, samples: number[] = [];
  const trace: number[][] = [];
  if (observe) {
    internal.stepInterval = (time, surface, absorb) => {
      intervals++;
      return step.call(bike, time, surface, absorb);
    };
    internal.spring = (compression, front) => {
      springs++;
      return spring.call(bike, compression, front);
    };
  }
  const cpuStart = process.cpuUsage(), loopStart = performance.now();
  try {
    for (let tick = 0; tick < ticks; tick++) {
      if (!bike.airborne) rideLine(bike, track,
        bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
          ? Math.max(speed, bike.dynamics.speed) : speed);
      else rideMotocrossFlight(bike);
      intervals = springs = 0;
      const before = timed ? performance.now() : 0;
      bike.step(dt, track);
      if (timed) samples.push(performance.now() - before);
      if (observe) {
        maximumIntervals = Math.max(maximumIntervals, intervals);
        maximumSprings = Math.max(maximumSprings, springs);
        intervalHistogram[intervals] = (intervalHistogram[intervals] ?? 0) + 1;
      }
      if (!timed) trace.push(values(bike));
      if (!bike.riding || !values(bike).every(Number.isFinite))
        throw new Error(`Invalid native run ${item.vehicle}/${item.circuit} at tick${tick}`);
    }
  } finally {
    if (stepDescriptor) Object.defineProperty(bike, 'stepInterval', stepDescriptor);
    else Reflect.deleteProperty(bike, 'stepInterval');
    if (springDescriptor) Object.defineProperty(bike, 'spring', springDescriptor);
    else Reflect.deleteProperty(bike, 'spring');
  }
  const loopWallMs = performance.now() - loopStart, cpu = process.cpuUsage(cpuStart);
  return { samples, trace, end: values(bike), loopWallMs, loopCPUms: (cpu.user + cpu.system) / 1000,
    maximumIntervals, maximumSprings, intervalHistogram, crashes: bike.dynamics.crashes };
}

const result = cases.map(item => {
  const warm = run(item), observed = run(item, true);
  if (JSON.stringify(warm.trace) !== JSON.stringify(observed.trace))
    throw new Error(`Observation changed native state ${item.vehicle}/${item.circuit}`);
  const repeats = Array.from({ length: 5 }, () => run(item, false, true));
  for (const repeat of repeats) if (JSON.stringify(repeat.end) !== JSON.stringify(warm.end))
    throw new Error(`Repeat changed native state ${item.vehicle}/${item.circuit}`);
  const sorted = repeats.flatMap(r => r.samples).sort((a, b) => a - b);
  const quantile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
  return { ...item, publicTicksPerRun: ticks, measuredRepeats: repeats.length,
    measuredPublicTicks: sorted.length, simulatedSecondsPerRun: ticks * dt,
    maximumCompleteIntervals: observed.maximumIntervals,
    maximumSpringEvaluations: observed.maximumSprings,
    completeIntervalHistogram: observed.intervalHistogram,
    observationExact: true, observedPublicStates: observed.trace.length,
    quantitiesComparedPerState: observed.trace[0].length,
    repeatedEndpointsExact: true, crashes: observed.crashes,
    stepWallMs: { median: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99), maximum: sorted.at(-1),
      mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length },
    loopCPUmsPerRepeat: repeats.map(r => r.loopCPUms),
    loopWallMsPerRepeat: repeats.map(r => r.loopWallMs) };
});
const report = { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
  sourceBefore, sourceAfter: sourceFingerprint(),
  timing: 'Isolated native bike.step wall time, excluding placement and controls. Loop CPU also includes controls and finite-state verification. Shared executor; no graphics, whole-world, device or FPS claim.',
  existingAlgorithmBounds: { completeIntervals: 8, supportedVerticalStagesPerInterval: 16,
    reference: 'agents/33-supported-accuracy.md; current source constants and capped loops inspected' },
  result };
if (report.sourceBefore !== report.sourceAfter) throw new Error('Source changed during CPU audit');
mkdirSync('test-results/agent52', { recursive: true });
writeFileSync('test-results/agent52/runtime-cost.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ cases: result.length, measuredTicks: result.reduce((n, r) => n + r.measuredPublicTicks, 0),
  maximumCompleteIntervals: Math.max(...result.map(r => r.maximumCompleteIntervals)),
  maximumSpringEvaluations: Math.max(...result.map(r => r.maximumSpringEvaluations)),
  summaries: result.map(r => ({ vehicle: r.vehicle, circuit: r.circuit, stepWallMs: r.stepWallMs })) }));
