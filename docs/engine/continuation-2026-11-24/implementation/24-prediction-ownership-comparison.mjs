import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [baselineRoot, candidateRoot, output] = process.argv.slice(2);
if (!baselineRoot || !candidateRoot) throw new Error('Usage: node --experimental-transform-types 24-prediction-ownership-comparison.mjs BASELINE_REPO CANDIDATE_REPO [OUTPUT_JSON]');
const paths = { baseline: resolve(baselineRoot, 'src/net/prediction.ts'), candidate: resolve(candidateRoot, 'src/net/prediction.ts') };
// HEAD labels identify checkout parents; sourceSHA256 identifies actual file
// contents, including unpublished changes in dirty checkouts.
const checkoutCommits = Object.fromEntries(
  Object.entries({ baseline: baselineRoot, candidate: candidateRoot }).map(([name, root]) => [
    name,
    execFileSync('git', ['-C', resolve(root), 'rev-parse', '--verify', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
  ]),
);
const [baseline, candidate, snapshot, config] = await Promise.all([
  import(pathToFileURL(paths.baseline)), import(pathToFileURL(paths.candidate)),
  import(pathToFileURL(resolve(candidateRoot, 'src/net/snapshot.ts'))),
  import(pathToFileURL(resolve(candidateRoot, 'src/simulation/config.ts'))),
]);
const fields = Object.keys(snapshot.emptyCarState());
const poseFields = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw'];
const metrics = ['positionError', 'headingError', 'positionErrorClean', 'positionErrorContact', 'positionErrorAi', 'correction', 'visualStep', 'snaps', 'reconciles', 'aiDriven'];
let seed = 34771, reconciliations = 0, poseReads = 0, renders = 0, authoritativeReads = 0;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const digest = createHash('sha256');
const record = (value) => digest.update(JSON.stringify(value) + '\n');
for (let run = 0; run < 32; run++) {
  const options = { responseLagTicks: [0, 6, 12][run % 3], maxHorizonTicks: [30, 60, 96][run % 3] };
  const a = new baseline.LocalCarPredictor(options), b = new candidate.LocalCarPredictor(options);
  const producer = snapshot.emptyCarState(run), speed = 12 + random() * 70, turn = .05 + random() * .35;
  const input = t => t % 13 === 0 ? undefined : ({ ...config.controls(), throttle: ((Math.floor(t / 17) % 11) + 11) % 11 / 10, brake: t % 101 > 80 ? .25 : 0, steer: Math.sin(t * .001) * .25 });
  for (let index = 0; index < 128; index++) {
    const tick = index * 6, seconds = tick / 120, yaw = seconds * turn, now = (run % 2 ? -150000 : 0) + seconds * 1000;
    const present = tick + 18 + (run % 3) * 6;
    Object.assign(producer, snapshot.emptyCarState(run), {
      flags: snapshot.CAR_FLAG.FULL | (index % 17 === 0 ? snapshot.CAR_FLAG.CONTACT : 0) | (index % 29 === 0 ? snapshot.CAR_FLAG.AI : 0),
      x: speed / turn * (1 - Math.cos(yaw)), y: seconds * .1, z: speed / turn * Math.sin(yaw),
      qy: Math.sin(yaw / 2), qw: Math.cos(yaw / 2), vx: speed * Math.sin(yaw), vy: .1, vz: speed * Math.cos(yaw),
      wy: turn, ax: speed * turn * Math.cos(yaw), az: -speed * turn * Math.sin(yaw),
      steer: .17, throttle: .6, brake: .1, gear: 4, rpm: 9600, s: tick / 3, laps: 2, rank: run + 1,
    });
    a.reconcile({ ...producer }, tick, input, present, now);
    b.reconcile(producer, tick, input, present, now);
    reconciliations++;
    for (const field of fields) producer[field] = 1000;
    const authority = b.authoritative;
    assert.deepStrictEqual(authority, a.authoritative);
    authoritativeReads++; record(authority);
    authority.tick = -9000;
    for (const field of fields) authority.state[field] = -1000;
    assert.deepStrictEqual(b.authoritative, a.authoritative);
    for (let t = tick + 1; t <= present; t++) {
      const pose = b.predictedAt(t);
      assert.deepStrictEqual(pose, a.predictedAt(t));
      poseReads++; record(pose);
      for (const field of poseFields) pose[field] = 5000;
    }
    for (const delay of [0, 7, 14]) {
      const pose = b.render(now + delay);
      assert.deepStrictEqual(pose, a.render(now + delay));
      renders++; record(pose);
      for (const field of poseFields) pose[field] = -5000;
    }
    assert.equal(b.tick, a.tick);
    assert.equal(b.model.observations, a.model.observations);
  }
  for (const key of metrics) { assert.deepStrictEqual(b.stats[key], a.stats[key]); record({ key, value: b.stats[key] }); }
}
const sourceSHA256 = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const evidence = { node: process.version, baselineCommit: checkoutCommits.baseline, candidateCommit: checkoutCommits.candidate, tracks: 32, reconciliations, poseReads, renders, authoritativeReads, traceSHA256: digest.digest('hex'), sourceSHA256 };
if (output) writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
