import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as T from 'three';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
import {
  RaceReviewEvents,
  raceReviewFrame,
  readRaceReviewFrame,
} from '../src/rendering/race-review.ts';
import { Effects } from '../src/rendering/effects.ts';
import { EffectPlayback } from '../src/rendering/effect-playback.ts';
import { PitCrewView } from '../src/rendering/pit-crew.ts';

/** Real deterministic simulation/component scenarios. These are not ordinary-
 * application footage, consumer-GPU measurements, or human race acceptance. */
const reports = [];
for (const workload of ['grid-start', 'close-racing', 'wet-following', 'pit-service'] as const) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    laps: 5,
    opponents: workload === 'grid-start' ? 11 : 7,
    weather: workload === 'wet-following' ? 'rain' : 'clear',
    compound: workload === 'wet-following' ? 'wet' : 'medium',
  });
  sim.autoPlayer = true;
  const frame = sim.makeFrame(),
    observation = raceReviewFrame(),
    events = new RaceReviewEvents(),
    effects = new Effects(),
    playback = new EffectPlayback(effects),
    crew = new PitCrewView(),
    camera = new T.Vector3();
  if (workload === 'pit-service') sim.requestPit();
  let ticks = 0,
    maximumLeaderSpray = 0,
    maximumCrew = 0;
  const stages: { time: number; stage: string; stops: number }[] = [];
  let stage = 'unseen';
  for (; ticks < 240 * 120; ticks++) {
    sim.step(1 / 120);
    if (ticks % 4) continue; // Sample real states at 30Hz; never skip physics ticks.
    sim.writeFrame(frame);
    assert(
      sim.cars.every((c) => c.body.position.finite() && !c.retired),
      'Invalid/retired car',
    );
    if (workload === 'wet-following') playback.update(frame);
    camera.set(frame[carBase(0) + F.X], frame[carBase(0) + F.Y] + 2.5, frame[carBase(0) + F.Z] - 7);
    if (workload === 'pit-service') crew.update(frame, camera);
    readRaceReviewFrame(frame, 0, 0, crew.actorCountFor(0), observation);
    observation.sprayParticles = effects.activeSprayCountFor(observation.leader);
    maximumLeaderSpray = Math.max(maximumLeaderSpray, observation.sprayParticles);
    maximumCrew = Math.max(maximumCrew, observation.crewActors);
    events.observe(frame[H.TIME], frame[H.RAIN], frame[H.WATER], observation);
    if (events.pitStage !== stage) {
      stage = events.pitStage;
      stages.push({ time: frame[H.TIME], stage, stops: observation.pitStops });
    }
    if (sim.race.time >= 30 && events.qualified(workload)) break;
  }
  const report = {
    workload,
    passed: events.qualified(workload),
    simulationSeconds: sim.race.time,
    cars: sim.cars.length,
    maximumLeaderSpray,
    maximumCrew,
    stages,
    summary: events.summary(workload),
  };
  reports.push(report);
  console.log(JSON.stringify(report));
  crew.dispose();
}
const path = resolve(process.argv[2] ?? 'test-results/phase27h6-simulation.json');
mkdirSync(dirname(path), { recursive: true });
writeFileSync(
  path,
  JSON.stringify(
    {
      boundary:
        'Numerical simulation and rendering-component observations only. No WebGL draw or physical-hardware timing.',
      passed: reports.every((r) => r.passed),
      reports,
    },
    null,
    2,
  ) + '\n',
);
assert(
  reports.every((r) => r.passed),
  'Unqualified racing workload; retain its diagnostic report',
);
