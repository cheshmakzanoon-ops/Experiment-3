import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [rootArg, prefixArg] = process.argv.slice(2);
const root = resolve(rootArg), prefix = resolve(prefixArg);
const load = p => import(pathToFileURL(resolve(root, p)).href);
const { Simulation } = await load('src/simulation/world.ts');
const { DEFAULT_OPTIONS } = await load('src/simulation/config.ts');
const { PHASE } = await load('src/simulation/race.ts');
const vehicles = ['gpr1', 'sbk1000', 'gpr1', 'sbk1000', 'gpr1', 'sbk1000'];
const options = { ...DEFAULT_OPTIONS, circuit: 'vellamar', mode: 'race', ruleset: 'gp-motorcycle',
  laps: 2, opponents: vehicles.length - 1, vehicles, seed: 3303 };
const sim = new Simulation(options);
sim.autoPlayer = true;
const DT = 1 / 120, stopped = new Float64Array(vehicles.length);
let tick = 0, longestStop = 0;
const rows = Array.from({ length: 6 }, () => []), events = [], lastLap = Array(6).fill(0), lastCrash = Array(6).fill(0);
const native = Array.from({ length: 6 }, () => ({ steeringThrottleCalls: 0, rollCalls: 0, currentCalls: 0,
  steeringThrottle: null, roll: null, current: null }));
// Wrappers retain the original receiver, arguments, result and call count.
// They only copy native outputs; no extra physical query or time step runs.
for (const c of sim.cars) {
  const d = c.dynamics, a = sim.ai[c.id], n = native[c.id];
  const throttle = a.steeringThrottle;
  a.steeringThrottle = function (...args) {
    const result = throttle.apply(this, args);
    n.steeringThrottleCalls++;
    n.steeringThrottle = result;
    return result;
  };
  if (!d.motoGP) continue;
  const gp = d.motoGP, roll = d.gpSteer;
  d.gpSteer = function (...args) {
    const before = { tick, speed: this.speed, lean: this.lean, rate: this.leanRate,
      riderOffset: this.riderOffset, reaction: (this.frontLoad + this.rearLoad) / this.mass,
      stored: gp.lateralAcceleration, oldFrontFx: -this.frontBrakeForce, oldRearFx: this.driveForce - this.rearBrakeForce };
    n.rollCalls++;
    n.current = null;
    const result = roll.apply(this, args);
    n.roll = { ...before, current: n.current, result, target: gp.leanTarget, demand: gp.lateralDemand };
    return result;
  };
  if (typeof gp.currentLateralAcceleration === 'function') {
    const observe = gp.currentLateralAcceleration;
    gp.currentLateralAcceleration = function (...args) {
      const result = observe.apply(this, args);
      n.currentCalls++;
      n.current = result;
      return result;
    };
  }
}
const columns = ['tick','time','lap','station','lateral','offset','speed','targetSpeed','lean','leanRate',
  'throttle','brake','stick','driveForce','frontBrakeForce','rearBrakeForce','longitudinal','frontLoad','rearLoad',
  'frontGrip','rearGrip','intervention','gpTarget','gpDemand','gpAy','gpYaw','gpSideSpeed','airborne',
  'state','crashes','impact','planLimit','planNext','planDistance','planRecovery','rawPath','decision','limitedBy','blocker',
  'steeringThrottle','rollReaction','rollStoredAy','rollCurrentAy','rollTarget','rollDemand','rollBar','rollLean','rollRate',
  'frontUse','rearUse','rollOldFrontFx','rollOldRearFx'];
function sample(c) {
  const d = c.dynamics, a = sim.ai[c.id], gp = d.motoGP, n = native[c.id], r = n.roll?.tick === tick ? n.roll : null;
  return [tick,sim.race.time,sim.race.laps[c.id].completed,c.s,c.lateral,c.aiOffset,c.speed,c.aiTarget,d.lean,d.leanRate,
    c.input.throttle,c.input.brake,c.input.steer,d.driveForce,d.frontBrakeForce,d.rearBrakeForce,d.longitudinal,d.frontLoad,d.rearLoad,
    d.frontGrip ?? d.grip,d.rearGrip ?? d.grip,d.intervention,gp?.leanTarget ?? null,gp?.lateralDemand ?? null,
    gp?.lateralAcceleration ?? null,gp?.yawRate ?? null,gp?.lateralSpeed ?? null,c.roadSuspension.airborne,d.state,d.crashes,c.impact,
    a.planLimit,a.planNext,a.planDistance,a.planRecovery,a.gpPathAcceleration,a.decision,a.planner.limitedBy,a.planner.blocker,
    n.steeringThrottle,r?.reaction ?? null,r?.stored ?? null,r?.current ?? null,r?.target ?? null,r?.demand ?? null,
    r?.result ?? null,r?.lean ?? null,r?.rate ?? null,d.frontUse,d.rearUse,r?.oldFrontFx ?? null,r?.oldRearFx ?? null];
}
for (; tick < 120 * 400 && sim.race.phase !== PHASE.FINISHED; tick++) {
  sim.step(DT);
  if (sim.race.phase !== PHASE.RACING && sim.race.phase !== PHASE.FINISHED) continue;
  for (const c of sim.cars) {
    const id = c.id, d = c.dynamics, lap = sim.race.laps[id];
    stopped[id] = c.speed < 1 && !c.finishTime && !c.inPit ? stopped[id] + DT : 0;
    longestStop = Math.max(longestStop, stopped[id]);
    const changed = lap.completed !== lastLap[id] || d.crashes !== lastCrash[id];
    if (changed) events.push({ tick, time: sim.race.time, id, lap: { ...lap }, state: d.state,
      crashes: d.crashes, s: c.s, lateral: c.lateral, speed: c.speed, finishTime: c.finishTime });
    if (!c.finishTime && (tick % 4 === 0 || changed)) rows[id].push(sample(c));
    lastLap[id] = lap.completed;
    lastCrash[id] = d.crashes;
  }
}
const result = sim.cars.map(c => ({ id: c.id, vehicle: c.definition.id, retired: c.retired, finishTime: c.finishTime,
  crashes: c.dynamics.crashes, lap: { ...sim.race.laps[c.id] }, native: { ...native[c.id], roll: undefined, current: undefined, steeringThrottle: undefined } }));
const gp = Math.min(...[0,2,4].map(i => sim.race.laps[i].best || Infinity));
const sbk = Math.min(...[1,3,5].map(i => sim.race.laps[i].best || Infinity));
const checks = { finished: sim.race.phase === PHASE.FINISHED,
  crashesAtMostThree: result.reduce((n,c) => n+c.crashes,0) <= 3,
  everybodyFinished: result.every(c => !c.retired && c.finishTime > 0 && c.lap.completed === 2),
  longestStopBelowTwenty: longestStop < 20, gpFaster: gp < sbk, marginOverPointFifteen: sbk-gp > 0.15 };
const hash = b => createHash('sha256').update(b).digest('hex');
const json = JSON.stringify({ columns, rows }, (_, v) => typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);
const archive = gzipSync(json, { level: 6 });
writeFileSync(`${prefix}-rows.json.gz`, archive);
const summary = { diagnostic: true, root, sourceCommit: execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  scriptSha256: hash(readFileSync(new URL(import.meta.url))), options, ticks: tick, time: sim.race.time, phase: sim.race.phase,
  trackLength: sim.track.length, sampleHz: 30, columns, rowCounts: rows.map(r => r.length), result, events,
  gpBest: gp, sbkBest: sbk, margin: sbk-gp, longestStop, originalChecks: checks,
  allOriginalChecksPass: Object.values(checks).every(Boolean),
  data: { file: `${prefix}-rows.json.gz`, bytes: archive.length, sha256: hash(archive), expandedBytes: Buffer.byteLength(json), expandedSha256: hash(json) } };
writeFileSync(`${prefix}-summary.json`, JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({ sourceCommit: summary.sourceCommit, ticks: tick, gpBest: gp, sbkBest: sbk, margin: sbk-gp,
  longestStop, originalChecks: checks, riders: result.map(c=>({id:c.id,best:c.lap.best,crashes:c.crashes})), data: summary.data }));
