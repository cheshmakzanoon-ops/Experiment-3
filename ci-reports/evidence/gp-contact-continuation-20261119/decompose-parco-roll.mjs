import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rootArg, inputArg, outputArg] = process.argv.slice(2);
const root = resolve(rootArg);
const { gpRollInertia, gpHangOffAngle, gpSpinPerSpeed, GP_RAKE } = await import(pathToFileURL(resolve(root, 'src/simulation/motogp-physics.ts')).href);
const data = JSON.parse(readFileSync(inputArg, 'utf8'));
const history = data.history[data.falls[0].id].rows;
const reference = history.find(row => row.entryState).entryState;
const rows = history.filter(row => row.plant?.after && row.observation && row.after && row.frontInverse && row.rearPreview);
const records = [];
const errors = [];
for (const row of rows) {
  const body = row.entryState?.bike ?? { ...row.before, p: reference.bike.p };
  const gp = row.entryState?.gp ?? { ...row.before.gp, geometry: reference.gp.geometry, lateralAcceleration: row.before.gp.storedAcceleration };
  const q = row.plant.q, actual = row.plant.after;
  const m = body.mass, h = body.p.cgHeight, inertia = gpRollInertia(gp.geometry, m, h);
  const psi = body.lean + gpHangOffAngle(body.riderOffset, h);
  const controllerPsi = body.lean + gpHangOffAngle(row.after.riderOffset, h);
  const reaction = (q.frontLoad + q.rearLoad) / m;
  const frontSpin = gp.geometry.frontWheelInertia * actual.frontOmega;
  const spin = frontSpin + gp.geometry.rearWheelInertia * actual.rearOmega;
  const steerRate = (q.steer - body.steer) / row.dt;
  const reactionPart = m * h * reaction * Math.sin(psi) / inertia;
  const lateralPart = -m * h * actual.acceleration * Math.cos(psi) / inertia;
  const yawPart = -spin * actual.yawRate * Math.cos(body.lean) / inertia;
  const steerPart = -frontSpin * steerRate * Math.cos(GP_RAKE) / inertia;
  const rollAccel = (m * h * (reaction * Math.sin(psi) - actual.acceleration * Math.cos(psi)) - spin * actual.yawRate * Math.cos(body.lean) - frontSpin * steerRate * Math.cos(GP_RAKE)) / inertia;
  const damping = Math.exp(-(body.p.rollDamping ?? 1.2) * row.dt);
  const rate = (body.leanRate + rollAccel * row.dt) * damping;
  const lean = psi + rate * row.dt - gpHangOffAngle(row.after.riderOffset, h);
  if (Math.abs(rate - row.after.leanRate) > 1e-13 || Math.abs(lean - row.after.lean) > 1e-13) errors.push({ tick: row.before.tick, substep: row.before.substep, rate, expectedRate: row.after.leanRate, lean, expectedLean: row.after.lean });
  const nominalSpin = gpSpinPerSpeed(gp.geometry) * body.speed;
  const oldYawPart = -nominalSpin * gp.yawRate * Math.cos(body.lean) / inertia;
  const measuredNewYawPart = -spin * gp.yawRate * Math.cos(body.lean) / inertia;
  const storedLateralPart = -m * h * gp.lateralAcceleration * Math.cos(psi) / inertia;
  const currentLateralPart = -m * h * row.observation.current * Math.cos(psi) / inertia;
  const storedAtOldPsi = (m * h * (reaction * Math.sin(psi) - gp.lateralAcceleration * Math.cos(psi)) - nominalSpin * gp.yawRate * Math.cos(body.lean)) / inertia;
  const actualWithoutBar = reactionPart + lateralPart + yawPart;
  records.push({ tick: row.before.tick, substep: row.before.substep, time: row.before.time, s: row.before.s,
    speed: body.speed, lean: body.lean, rate: body.leanRate, steer: body.steer, nextSteer: q.steer, target: row.rollResult?.target,
    input: row.input.lean, rawPath: row.observation.rawPath, reaction, frontLoad: q.frontLoad, rearLoad: q.rearLoad,
    earlyFx: [row.frontInverse.args[3], row.rearPreview.args[4]], finalFx: [q.frontFx, q.rearFx],
    pathCorrection: row.before.correction, offset: row.before.offset, lateral: row.before.lateral, decision: row.before.decision,
    demand: row.rollResult?.demand, frontForce: row.frontInverse.args[0],
    psi, controllerPsi, steerRate, nominalSpin, measuredSpin: spin,
    ay: { stored: gp.lateralAcceleration, current: row.observation.current, actual: actual.acceleration },
    forecast: { stored: row.observation.storedForecast.rolling, current: row.observation.currentForecast.rolling, active: (row.observation.activeForecast ?? row.observation.storedForecast).rolling, actual: rollAccel, actualWithoutBar },
    parts: { reaction: reactionPart, lateral: lateralPart, yaw: yawPart, steering: steerPart },
    differences: { riderPhase: storedAtOldPsi - row.observation.storedForecast.rolling,
      currentStrain: currentLateralPart - storedLateralPart,
      forceEvolution: lateralPart - currentLateralPart,
      measuredSpin: measuredNewYawPart - oldYawPart,
      newYaw: yawPart - measuredNewYawPart, steering: steerPart },
    actualAfter: { lean: row.after.lean, rate: row.after.leanRate },
    expectedAfter: { lean, rate } });
}
const max = (selector, subset = records) => subset.length ? subset.reduce((a,b) => Math.abs(selector(a)) >= Math.abs(selector(b)) ? a : b) : null;
const early = records.filter(r => r.tick >= 25930 && r.tick <= 25990);
const summary = { scope: 'Exact native roll equation decomposition, no change to production and no causal closed-loop remedy claim.',
  input: inputArg, records: records.length, reconstructionErrors: errors,
  maximumDifference: { total: max(r => r.forecast.actual-r.forecast.stored), steering: max(r => r.parts.steering), forceEvolution: max(r => r.differences.forceEvolution), currentStrain: max(r => r.differences.currentStrain), riderPhase: max(r => r.differences.riderPhase), measuredSpin: max(r => r.differences.measuredSpin), newYaw: max(r => r.differences.newYaw) },
  earlyMaximumDifference: { total: max(r => r.forecast.actual-r.forecast.stored, early), steering: max(r => r.parts.steering, early), forceEvolution: max(r => r.differences.forceEvolution, early) },
  earlyRecords: early, records };
writeFileSync(outputArg, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, records: undefined, earlyRecords: undefined }, null, 2));
if (errors.length) process.exitCode = 1;
