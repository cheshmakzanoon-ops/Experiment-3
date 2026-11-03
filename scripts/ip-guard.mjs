/**
 * Release gate G15 (docs/studio/reports/ip-audit.md): certify that a build's OUTPUT ships no
 * third-party brand identifier and no owner-only asset. It is enforced, not advisory:
 *
 *  - `vite build` runs it on every product build (`vite.config.ts`, plugin
 *    `owner-only-assets`), so `npm run build` fails when the output is not clean;
 *  - the CI `validate` job runs `npm run check:ip` again on the uploaded `dist/`;
 *  - `scripts/publish-validated-release.sh` runs it on the artifact it is about to release.
 *
 *   node scripts/ip-guard.mjs [--dist dist] [--json] [--max-file-mb 20]
 *
 * It checks the OUTPUT a player receives, not the repository:
 *  1. the build is a PRODUCT build: no owner-only binary or chunk (`supplied-player*`) and
 *     `BUILD_IDENTITY.json` says `variant: "product"` when it names a variant. An owner build
 *     (`MOTOBOUND_SUPPLIED_PLAYER=1`) or a review build (`MOTOBOUND_REVIEW_TOOLS=1`) can NEVER
 *     pass: the guard exits 1 with an explanation. There is deliberately no flag, environment
 *     variable or option that certifies such a build (the old `--owner-build` exited 0 and was
 *     removed); QA workflows build with `npm run build:qa` and never call this script;
 *  2. no real-brand identifier (teams, sponsors, tyre/brake makers, commercial games and
 *     their coverage domains) in any shipped text file, in the name tables of any shipped
 *     GLB / gzipped GLB, or in the text of a gzip-compressed text asset. Matching is
 *     separator-, case- and camelCase-insensitive (`RB19_BODY`, `redbull_wordmark`,
 *     `tyre_pirelli`, `hard_rock`, `cash_app`: rule in `scripts/ip-denylist.mjs`);
 *  3. no file under dist/ larger than --max-file-mb (default 20) that is not a known asset kind.
 *
 * The list is an engineering aid, not legal clearance: see docs/studio/reports/ip-audit.md
 * for what it cannot catch (silhouettes, likenesses, trade dress, look-alike names).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { findBrands, SOFT } from './ip-denylist.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const dist = option('--dist', 'dist');
const maxFileMb = Number(option('--max-file-mb', '20'));

if (args.includes('--owner-build')) {
  console.error(
    'IP guard: --owner-build was removed. An owner build (MOTOBOUND_SUPPLIED_PLAYER=1) contains a real-brand model by design and can never be certified, published, deployed or packaged. Build it with `npm run build:qa` and do not run this script on it.',
  );
  process.exit(2);
}

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
  );

function glbJson(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) return null;
  const length = bytes.readUInt32LE(12);
  return bytes.subarray(20, 20 + length).toString('utf8');
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No build at ${dist}/index.html. Run npm run build first.`);
  process.exit(2);
}

// 1. Is this a product build at all? Everything else is refused before any scanning: an owner
// or review build carries real-brand or commercial-game material on purpose.
const refusals = [];
let variant = null;
try {
  variant = JSON.parse(readFileSync(join(dist, 'BUILD_IDENTITY.json'), 'utf8')).variant ?? null;
} catch {
  /* An older or hand-made output without an identity file is judged by its content. */
}
if (variant !== null && variant !== 'product')
  refusals.push(`BUILD_IDENTITY.json says variant "${variant}", not "product"`);
const files = walk(dist);
for (const file of files) {
  const rel = relative(dist, file).replaceAll('\\', '/');
  if (/(^|\/)supplied-player[^/]*$/i.test(rel))
    refusals.push(`${rel}: owner-only supplied-player asset or chunk`);
}
if (refusals.length) {
  const detail = refusals.slice(0, 20).map((r) => `  - ${r}`);
  const message = [
    `IP guard: REFUSED. ${dist} is an owner-only or review build (MOTOBOUND_SUPPLIED_PLAYER=1 / MOTOBOUND_REVIEW_TOOLS=1).`,
    ...detail,
    'It contains a real-brand model or commercial-game material by design and can never be certified, published, deployed or packaged. Use it for local QA only and delete it afterwards.',
  ];
  if (args.includes('--json'))
    console.log(JSON.stringify({ dist, variant, certified: false, refused: refusals }, null, 2));
  else console.error(message.join('\n'));
  process.exit(1);
}

// 2 and 3. Scan the product output.
const problems = [];
const TEXT = /\.(?:js|mjs|css|html|json|txt|svg|webmanifest|map)$/i;
let scanned = 0;
let soft = 0;
for (const file of files) {
  const rel = relative(dist, file).replaceAll('\\', '/');
  const size = statSync(file).size;
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
  for (const hit of findBrands(text))
    problems.push(`${rel}: ${hit.label} "${hit.word}" in ...${hit.around}...`);
}
if (args.includes('--json'))
  console.log(
    JSON.stringify(
      { dist, variant, certified: !problems.length, scanned, softIdentifierHits: soft, problems },
      null,
      2,
    ),
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
