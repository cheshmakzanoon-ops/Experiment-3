/**
 * Release gate G15 (docs/studio/reports/ip-audit.md): fail when a build ships third-party
 * brand identifiers or owner-only assets. Run after `npm run build` (it is part of
 * `npm run check:bundle`):
 *
 *   node scripts/ip-guard.mjs [--dist dist] [--owner-build] [--json]
 *
 * It checks the OUTPUT a player receives, not the repository:
 *  1. no owner-only binary (models/supplied-player*.gz) unless --owner-build;
 *  2. no real-brand identifier (teams, sponsors, tyre/brake makers, commercial games and
 *     their coverage domains) in any shipped text file, in the name tables of any shipped
 *     GLB / gzipped GLB, or in the text of a gzip-compressed text asset;
 *  3. no file under dist/ larger than --max-file-mb (default 20) that is not a known asset kind.
 *
 * The list is deliberately conservative (whole words, case-insensitive) and an engineering
 * aid, not legal clearance: see docs/studio/reports/ip-audit.md for what it cannot catch
 * (silhouettes, likenesses, trade dress, look-alike names).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { FORBIDDEN_RE, SOFT, ALLOW } from './ip-denylist.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const dist = option('--dist', 'dist');
// Explicit flag only: an environment variable must never be able to turn the check off.
const ownerBuild = args.includes('--owner-build');
const maxFileMb = Number(option('--max-file-mb', '20'));

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
  );

function glbJson(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) return null;
  const length = bytes.readUInt32LE(12);
  return bytes.subarray(20, 20 + length).toString('utf8');
}
function scanText(text) {
  const hits = [];
  for (const [label, re] of FORBIDDEN_RE) {
    const global = new RegExp(re.source, 'gi');
    for (const match of text.matchAll(global)) {
      const around = text.slice(Math.max(0, match.index - 12), match.index + match[0].length + 12);
      if (ALLOW.some((a) => a.test(around))) continue;
      hits.push({ label, word: match[0], around: around.replace(/\s+/g, ' ') });
      if (hits.length > 20) return hits;
    }
  }
  return hits;
}

if (ownerBuild) {
  // An owner build carries the real-brand supplied model, its decal key table and its node
  // names on purpose. There is nothing meaningful to scan: it must never be published.
  console.log(
    `IP guard: ${dist} is an OWNER-ONLY build (MOTOBOUND_SUPPLIED_PLAYER=1) and contains real-brand assets by design. Do not publish, deploy, package or share it.`,
  );
  process.exit(0);
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No build at ${dist}/index.html. Run npm run build first.`);
  process.exit(2);
}
const problems = [];
const TEXT = /\.(?:js|mjs|css|html|json|txt|svg|webmanifest|map)$/i;
let scanned = 0;
let soft = 0;
for (const file of walk(dist)) {
  const rel = relative(dist, file).replaceAll('\\', '/');
  const size = statSync(file).size;
  if (!ownerBuild && /(^|\/)supplied-player[^/]*\.(?:glb|gz|bin)(?:\.gz)?$/i.test(rel))
    problems.push(`${rel}: owner-only supplied-player binary in a product build`);
  if (size > maxFileMb * 1048576 && !/\.(?:glb|ktx2|webp|jpg|png|wasm|bin)$/i.test(rel))
    problems.push(`${rel}: ${(size / 1048576).toFixed(1)} MB unclassified file`);
  let text = null;
  if (TEXT.test(rel)) text = readFileSync(file, 'utf8');
  else if (/\.glb$/i.test(rel)) text = glbJson(readFileSync(file));
  else if (/\.gz$/i.test(rel)) {
    try {
      const raw = gunzipSync(readFileSync(file));
      text = glbJson(raw) ?? raw.subarray(0, 4_000_000).toString('latin1');
    } catch {
      text = null;
    }
  }
  if (text === null) continue;
  scanned++;
  soft += (text.match(SOFT) ?? []).length;
  // Owner builds legitimately carry the supplied asset and its look-dev tables.
  if (ownerBuild && /supplied-player/i.test(rel)) continue;
  for (const hit of scanText(text))
    problems.push(`${rel}: ${hit.label} "${hit.word}" in ...${hit.around}...`);
}
if (args.includes('--json'))
  console.log(
    JSON.stringify({ dist, ownerBuild, scanned, softIdentifierHits: soft, problems }, null, 2),
  );
else if (problems.length) {
  console.error(
    `IP guard: ${problems.length} problem(s) in ${dist} (${scanned} text files scanned)`,
  );
  for (const p of problems.slice(0, 60)) console.error(`  - ${p}`);
} else
  console.log(
    `IP guard: clean (${scanned} shipped text files and GLB name tables scanned in ${dist}; ${soft} internal-identifier mentions of a series name tolerated).`,
  );
process.exit(problems.length ? 1 : 0);
