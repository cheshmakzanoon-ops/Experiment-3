import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { FixedStepper } from '../../../src/core/math.ts';
import { newSim, Pilot } from '../../../scripts/studio/tools/festival-qa.ts';

const event = 'valley-sprint';
const seed = 41271;
const dt = 1 / 120;
const ticks = 110 * 120;

function stageRace() {
  const sim = newSim({ vehicle: 'sc7', weather: 'rain', seed, traffic: true });
  sim.command({ type: 'travel', event, runUp: false });
  for (let i = 0; i < 1200 && sim.status().card?.id !== event; i++) sim.step(dt);
  assert.equal(sim.status().card?.id, event);
  sim.command({ type: 'start', event });
  return sim;
}

function recordInputs() {
  const sim = stageRace();
  const route = sim.events.find((candidate) => candidate.spec.id === event).path;
  const pilot = new Pilot(sim, route, 0.92);
  const inputs = [];
  for (let tick = 0; tick < ticks; tick++) {
    pilot.step(dt, sim.mode === 'countdown', sim.mode === 'finished');
    inputs.push({ ...sim.player.input });
    sim.step(dt);
  }
  assert.equal(pilot.resets, 0);
  assert.ok(sim.results.some((result) => result.completed));
  return inputs;
}

// All four schedules cover exactly 110 seconds in units of 1/720 s.
// The variable schedule averages 60 visual updates per second.
const schedules = [
  ['30 Hz', [24]],
  ['60 Hz', [12]],
  ['144 Hz', [5]],
  ['variable 6.94–37.50 ms', [5, 27, 7, 13, 8, 12]],
];
const inputs = recordInputs();
const reference = [];
const runs = [];
for (const [presentation, intervals] of schedules) {
  const sim = stageRace();
  const clock = new FixedStepper();
  const fullRun = createHash('sha256');
  const referenceRun = runs.length === 0;
  let units = 0, frames = 0, tick = 0, bytesCompared = 0;
  while (units < ticks * 6) {
    const interval = Math.min(intervals[frames % intervals.length], ticks * 6 - units);
    frames++;
    units += interval;
    clock.advance(interval / 720, (delta) => {
      sim.setInput(inputs[tick]);
      sim.step(delta);
      const packed = sim.makeFrame();
      const bytes = Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
      bytesCompared += bytes.byteLength;
      fullRun.update(bytes);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (referenceRun) reference.push(digest);
      else assert.equal(digest, reference[tick], presentation + ' at tick ' + (tick + 1));
      tick++;
    });
  }
  assert.equal(tick, ticks);
  assert.equal(clock.droppedSeconds, 0);
  const result = sim.results.find((candidate) => candidate.eventId === event);
  assert.ok(result?.completed);
  runs.push({
    presentation, frames, ticks, bytesCompared, droppedSeconds: clock.droppedSeconds,
    finishSeconds: result.time, position: result.position, entrants: result.entrants,
    digest: fullRun.digest('hex'),
  });
}
assert.equal(new Set(runs.map((run) => run.digest)).size, 1);
const source = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: new URL('../../../', import.meta.url),
  encoding: 'utf8',
}).trim();
console.log(JSON.stringify({
  source, event, vehicle: 'sc7', weather: 'rain', seed,
  method: 'Identical recorded throttle, brake and steer commands. Every serialized four-car simulation snapshot was hashed at 120 Hz for 110 seconds. Presentation cadence used integer 1/720-second intervals.',
  runs,
}, null, 2));
