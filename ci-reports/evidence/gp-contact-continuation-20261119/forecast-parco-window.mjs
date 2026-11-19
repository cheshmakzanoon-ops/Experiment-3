import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [rootArg, inputArg, outputArg] = process.argv.slice(2);
const { gpHangOffAngle } = await import(pathToFileURL(resolve(rootArg, 'src/simulation/motogp-physics.ts')).href);
const { GP_ASSIST } = await import(pathToFileURL(resolve(rootArg, 'src/simulation/bike.ts')).href);
const data = JSON.parse(readFileSync(inputArg, 'utf8'));
const rows = data.history[data.falls[0].id].rows;
const h = rows.find(r => r.entryState).entryState.bike.p.cgHeight;
const records = [];
for (let index = 0; index < rows.length; index++) {
  const row = rows[index], o = row.observation;
  if (!o || !row.dt) continue;
  const count = GP_ASSIST.lead / row.dt, floor = Math.floor(count), weight = count - floor;
  if (index + floor + 1 >= rows.length) continue;
  const sequence = rows.slice(index, index + floor + 2);
  for (let j = 1; j < sequence.length; j++) {
    const a = sequence[j-1].before, b = sequence[j].before;
    if (2*b.tick+b.substep !== 2*a.tick+a.substep+1) throw new Error('Not consecutive native states');
  }
  const a = rows[index+floor].before, b = rows[index+floor+1].before;
  const psiA = a.lean + gpHangOffAngle(a.riderOffset, h), psiB = b.lean + gpHangOffAngle(b.riderOffset, h);
  const futurePsi = psiA + weight*(psiB-psiA), futureRate = a.leanRate+weight*(b.leanRate-a.leanRate);
  const crossesAirborne = sequence.some(r => r.before.road.airborne || r.after?.road.airborne);
  const crossesFall = sequence.some(r => r.before.state !== 'riding' || r.after?.state !== 'riding');
  records.push({ tick: row.before.tick, substep: row.before.substep, time: row.before.time, s: row.before.s, crossesAirborne, crossesFall,
    actual: { psi: futurePsi, rate: futureRate },
    stored: { psiError: o.storedForecast.ahead-futurePsi, rateError: o.storedForecast.rateAhead-futureRate },
    current: { psiError: o.currentForecast.ahead-futurePsi, rateError: o.currentForecast.rateAhead-futureRate },
    reaction: o.reaction, storedAcceleration: o.stored, currentAcceleration: o.current });
}
function stats(selected) {
  const r = { count: selected.length };
  for (const variant of ['stored','current']) r[variant] = Object.fromEntries(['psi','rate'].map(field => [field+'Rmse', Math.sqrt(selected.reduce((s,r)=>s+r[variant][field+'Error']**2,0)/selected.length)]));
  return r;
}
const result = { scope: 'Saved-trajectory forecast comparison, diagnostic only; changed controls could change the future trajectory.',
  source: inputArg, horizon: GP_ASSIST.lead, timestep: rows.find(r=>r.dt).dt,
  alignment: 'Forecast originates before native plant/roll at row i; future actual is interpolation of BEFORE states i+14 and i+15 (14.4 substeps).',
  all: stats(records), supported: stats(records.filter(r=>!r.crossesAirborne&&!r.crossesFall)),
  earlyYawOnset: stats(records.filter(r=>r.tick>=25904&&r.tick<25948)),
  brakeRelease: stats(records.filter(r=>r.tick>=25948&&r.tick<25972)),
  laterRunaway: stats(records.filter(r=>r.tick>=25972)), records };
writeFileSync(outputArg, JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,records:undefined},null,2));
