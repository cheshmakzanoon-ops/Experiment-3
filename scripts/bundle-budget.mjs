/**
 * Release gate G7 (cold load budget): measure the JavaScript a player must
 * download, parse and run before the menu (index.html's entry module, its
 * modulepreload hints and their static import closure) and fail when it
 * exceeds the budget.
 *
 *   npm run build && npm run check:bundle
 *   node scripts/bundle-budget.mjs [--dist dist] [--max-gzip-mb 4] [--json]
 *
 * Gzip is level 9 of each chunk, the same measure Vite prints. Lazy chunks
 * (dynamic imports, lazy datasets) are listed but do not count as initial.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const dist = option('--dist', 'dist');
const budgetMb = Number(option('--max-gzip-mb', '4'));
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No build at ${dist}/index.html. Run npm run build first.`);
  process.exit(2);
}
const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
  );
const files = walk(dist);
const chunks = new Map();
for (const file of files) {
  const rel = relative(dist, file).replaceAll('\\', '/');
  if (!/^assets\/.*\.js$/.test(rel) || rel.startsWith('assets/basis/')) continue;
  const bytes = readFileSync(file);
  chunks.set(rel, {
    rel,
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    code: bytes.toString('utf8'),
  });
}
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const roots = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const staticImports = (chunk) =>
  [
    ...chunk.code.matchAll(
      /(?:^|[;}\n,])(?:import|export)\s*(?:[^'"`;]*?from\s*)?"\.\/([^"]+\.js)"/g,
    ),
  ].map((m) => `assets/${m[1]}`);
const initial = new Set();
const pending = [...roots];
while (pending.length) {
  const id = pending.pop();
  if (initial.has(id) || !chunks.has(id)) continue;
  initial.add(id);
  pending.push(...staticImports(chunks.get(id)));
}
const mb = (bytes) => bytes / 1048576;
const sum = (list, key) => list.reduce((total, chunk) => total + chunk[key], 0);
const initialChunks = [...initial].map((id) => chunks.get(id));
const lazyChunks = [...chunks.values()].filter((chunk) => !initial.has(chunk.rel));
const maps = files.filter((file) => file.endsWith('.map'));
const report = {
  budgetGzipMb: budgetMb,
  initial: initialChunks.map(({ rel, raw, gzip }) => ({ rel, raw, gzip })),
  initialRawMb: +mb(sum(initialChunks, 'raw')).toFixed(2),
  initialGzipMb: +mb(sum(initialChunks, 'gzip')).toFixed(2),
  lazy: lazyChunks.map(({ rel, raw, gzip }) => ({ rel, raw, gzip })),
  lazyGzipMb: +mb(sum(lazyChunks, 'gzip')).toFixed(2),
  sourcemapMb: +mb(maps.reduce((total, file) => total + statSync(file).size, 0)).toFixed(1),
  distMb: +mb(files.reduce((total, file) => total + statSync(file).size, 0)).toFixed(1),
};
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  const row = ({ rel, raw, gzip }) =>
    `  ${rel.padEnd(62)} ${(raw / 1024).toFixed(0).padStart(7)} KB raw ${(gzip / 1024).toFixed(0).padStart(7)} KB gzip`;
  console.log('Initial JS (entry + static imports):');
  report.initial.forEach((chunk) => console.log(row(chunk)));
  console.log(
    `  total ${report.initialRawMb} MB raw, ${report.initialGzipMb} MB gzip (budget ${budgetMb} MB gzip)`,
  );
  console.log(`Lazy JS (${report.lazy.length} chunks, ${report.lazyGzipMb} MB gzip):`);
  report.lazy.sort((a, b) => b.gzip - a.gzip).forEach((chunk) => console.log(row(chunk)));
  console.log(`dist ${report.distMb} MB, sourcemaps ${report.sourcemapMb} MB`);
}
if (report.initialGzipMb > budgetMb) {
  console.error(
    `FAIL: initial JS is ${report.initialGzipMb} MB gzip, over the ${budgetMb} MB budget (gate G7).`,
  );
  process.exit(1);
}
