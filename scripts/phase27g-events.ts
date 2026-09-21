/** Bounded offline observation of ordinary production simulations. This creates
 * inspection inputs, not gameplay, a human drive, or camera/art acceptance. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS, controls } from '../src/simulation/config.ts';
import { observeRace, type RaceEventKind } from '../src/rendering/reference-events.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
import { trackPoint } from '../src/simulation/track.ts';
const directory = process.argv[2];
if (!directory)
  throw new Error(
    'Usage: node --experimental-transform-types scripts/phase27g-events.ts NEW_DIRECTORY',
  );
mkdirSync(directory); // Never erase an earlier failed or successful observation.
const hold: Record<RaceEventKind, number> = {
  grid: 0,
  start: 0,
  battle: 1,
  pack: 1,
  'wet-traffic': 3,
  'wet-lap': 3,
  'pit-service': 1,
  gravel: 0.25,
  'loaded-corner': 1,
  braking: 0.5,
  finish: 0,
  motion: 2,
};
const results: Record<string, unknown> = {};
for (const weather of ['clear', 'rain'] as const) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    weather,
    compound: weather === 'rain' ? 'wet' : 'medium',
    laps: 3,
    opponents: 7,
    seed: 1887,
  });
  sim.autoPlayer = true;
  const histories: number[][] = [],
    since = new Map<RaceEventKind, number>(),
    captured = new Set<RaceEventKind>();
  let requestedPit = false;
  const start = Date.now();
  const inspect = () => {
    const frame = sim.makeFrame(),
      observation = observeRace(frame);
    histories.push(Array.from(frame));
    if (histories.length > 76) histories.shift(); // Five simulation seconds at 15 Hz.
    for (const kind of Object.keys(hold) as RaceEventKind[]) {
      if (!observation.events.includes(kind)) {
        since.delete(kind);
        continue;
      }
      if (!since.has(kind)) since.set(kind, observation.time);
      const duration = observation.time - since.get(kind)!;
      if (captured.has(kind) || duration < hold[kind]) continue;
      captured.add(kind);
      const file = `${weather}-${kind}.json`;
      const record = {
        version: 1,
        weather,
        seed: sim.options.seed,
        options: sim.options,
        observation,
        continuousConditionSeconds: duration,
        frames: histories.slice(),
        surface: {
          water: Array.from(sim.track.water),
          rubber: Array.from(sim.track.rubber),
          marbles: Array.from(sim.track.marbles),
        },
        automated: true,
        humanVerified: false,
        cameraVerified: false,
        visualAccepted: false,
        scope:
          'Actual ordinary simulation snapshots. Offline event conditions only; no rendered-camera or full-application claim.',
      };
      writeFileSync(join(directory, file), JSON.stringify(record));
      results[`${weather}-${kind}`] = { file, time: frame[H.TIME], duration, observation };
      console.log(weather, kind, observation.time.toFixed(2), 'held', duration.toFixed(2));
    }
  };
  inspect();
  for (let i = 0; i < 120 * 180; i++) {
    if (!requestedPit && i >= 35 * 120) {
      sim.requestPit();
      requestedPit = true;
    }
    sim.step(1 / 120);
    if (i % 8 === 7) inspect();
  }
  // An incident probe uses only ordinary control inputs, never a pose overwrite.
  // It is separately labelled automated driver input, not the earlier AI race.
  if (!captured.has('gravel')) {
    sim.autoPlayer = false;
    const input = controls();
    input.throttle = 0.8;
    input.steer = 0.8;
    for (let i = 0; i < 120 * 12; i++) {
      sim.setInput(input);
      sim.step(1 / 120);
      if (i % 8 === 7) inspect();
    }
  }
  console.log(weather, 'wall seconds', ((Date.now() - start) / 1000).toFixed(1));
}
// Separate, bounded episodes reproduce driver-requested braking and an
// off-line excursion. Only ordinary throttle/brake/steer requests are written;
// the physical pose, track, tire state and snapshots are never overwritten.
for (const goal of ['braking', 'gravel'] as const) {
  if (results[`clear-${goal}`]) continue;
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0, seed: 1887 });
  sim.autoPlayer = true;
  const history: number[][] = [];
  const point = trackPoint();
  let since: number | null = null;
  let manualAt: number | null = null;
  const input = controls();
  const inputTimeline: { time: number; throttle: number; brake: number; steer: number }[] = [];
  for (let tick = 0; tick < 120 * 45; tick++) {
    const frame = sim.makeFrame();
    const p = sim.track.at(frame[carBase(0) + F.S], point);
    if (
      manualAt === null &&
      (goal === 'braking'
        ? tick >= 8 * 120
        : Math.abs(p.curvature) > 0.006 && frame[carBase(0) + F.SPEED] > 16)
    ) {
      manualAt = frame[H.TIME];
      sim.autoPlayer = false;
      input.throttle = goal === 'braking' ? 0 : 0.4;
      input.brake = goal === 'braking' ? 0.7 : 0;
      input.steer = goal === 'braking' ? 0 : -Math.sign(p.curvature) * 0.8;
      inputTimeline.push({
        time: manualAt,
        throttle: input.throttle,
        brake: input.brake,
        steer: input.steer,
      });
    }
    if (manualAt !== null) sim.setInput(input);
    sim.step(1 / 120);
    if (tick % 8 !== 7) continue;
    const observedFrame = sim.makeFrame();
    const observation = observeRace(observedFrame);
    history.push(Array.from(observedFrame));
    if (history.length > 76) history.shift();
    if (!observation.events.includes(goal)) {
      since = null;
      continue;
    }
    since ??= observation.time;
    const duration = observation.time - since;
    if (duration < hold[goal]) continue;
    const file = `clear-${goal}.json`;
    writeFileSync(
      join(directory, file),
      JSON.stringify({
        version: 1,
        weather: 'clear',
        seed: sim.options.seed,
        options: sim.options,
        observation,
        continuousConditionSeconds: duration,
        frames: history,
        surface: {
          water: Array.from(sim.track.water),
          rubber: Array.from(sim.track.rubber),
          marbles: Array.from(sim.track.marbles),
        },
        inputTimeline,
        automated: true,
        humanVerified: false,
        cameraVerified: false,
        visualAccepted: false,
        scope:
          'Separate ordinary scripted-input episode after production-AI warmup. No physical state/pose editing; not human driving or a full application/camera validation.',
      }),
    );
    results[`clear-${goal}`] = {
      file,
      time: observation.time,
      duration,
      observation,
      episode: 'ordinary-scripted-input',
    };
    console.log(
      'clear',
      goal,
      observation.time.toFixed(2),
      'held',
      duration.toFixed(2),
      'ordinary scripted input',
    );
    break;
  }
}
writeFileSync(
  join(directory, 'index.json'),
  JSON.stringify(
    { generatedAt: new Date().toISOString(), results, missingRemainUnmeasured: true },
    null,
    2,
  ),
);
