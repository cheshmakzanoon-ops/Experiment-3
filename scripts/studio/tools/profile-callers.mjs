// Who spends the time? Prints, for each function name given, the inclusive caller
// chains of a V8 .cpuprofile(.gz) ranked by self time of that function.
//   node scripts/studio/tools/profile-callers.mjs <file.cpuprofile[.gz]> getProgramInfoLog readPixels
// Production bundles are minified, so chains read `name file:line`; use the line to
// find the function in dist/assets/*.js (or build with --sourcemap).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const [file, ...names] = process.argv.slice(2);
if (!file || !names.length) {
  console.error('usage: profile-callers.mjs <file.cpuprofile[.gz]> <functionName>...');
  process.exit(2);
}
const raw = readFileSync(file);
const profile = JSON.parse((file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const selfMs = new Map();
for (let i = 0; i < profile.samples.length; i++)
  selfMs.set(profile.samples[i], (selfMs.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
const label = (n) => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
for (const name of names) {
  const chains = new Map();
  let total = 0;
  for (const [id, ms] of selfMs) {
    const n = byId.get(id);
    if (n.callFrame.functionName !== name) continue;
    total += ms;
    const stack = [];
    for (let p = parent.get(id), d = 0; p !== undefined && d < 6; p = parent.get(p), d++) stack.push(label(byId.get(p)));
    const key = stack.join(' <- ');
    chains.set(key, (chains.get(key) ?? 0) + ms);
  }
  console.log(`\n${name}: ${Math.round(total)} ms self`);
  for (const [k, ms] of [...chains].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${Math.round(ms).toString().padStart(7)} ms  ${k}`);
}
