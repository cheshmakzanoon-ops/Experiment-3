// Prints a compact digest of a journey tool output directory:
//   node scripts/studio/tools/journey-summary.mjs <out-dir> [--rows]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, flag] = process.argv.slice(2);
if (!dir) {
  console.error('usage: journey-summary.mjs <out-dir> [--rows]');
  process.exit(2);
}
const r = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
const s = r.summary ?? {};
console.log(`journey ${r.journey} outcome ${s.outcome} quality ${r.cfg?.quality ?? 'default'}`);
console.log('boot', JSON.stringify(s.boot));
for (const x of s.sessions ?? []) console.log('session', JSON.stringify(x));
console.log('inputs', JSON.stringify({ menu: s.inputs?.menuInputs, drive: s.inputs?.driveKeyEvents }));
const { samples, ...growth } = s.memory ?? {};
console.log('memory', JSON.stringify(growth));
for (const m of samples ?? []) console.log('  mem', JSON.stringify(m));
for (const f of r.findings) console.log(`FINDING [${f.severity}] ${f.where}: ${f.message.slice(0, 260)}`);
console.log('console', JSON.stringify(r.console).slice(0, 1500));
console.log('requestFailures', JSON.stringify(r.requestFailures).slice(0, 600));
for (const d of s.drives ?? [])
  console.log(
    'drive',
    JSON.stringify({ label: d.label, ended: d.ended, sim: d.simElapsed, wall: d.wallS, rtf: d.realTimeFactor, maxKph: d.maxKph, offTrackS: d.offTrackS, stuckS: d.stuckS, keyEvents: d.keyEvents, fallbackAt: d.fallbackAt }),
  );
if (flag === '--rows')
  for (const d of s.drives ?? []) for (const row of d.rows.slice(0, 40)) console.log(d.label, JSON.stringify(row));
if (s.pause) console.log('pause', JSON.stringify(s.pause));
if (s.results) console.log('results', JSON.stringify(s.results).slice(0, 2500));
if (s.loads) for (const l of s.loads) console.log('festival load', JSON.stringify({ ...l, samples: undefined, stages: l.stages, profile: l.profile?.chunks?.map((c) => ({ name: c.name, totalMs: c.totalMs, top: c.top.slice(0, 6) })) }));
console.log('page', JSON.stringify(r.pageCounters));
