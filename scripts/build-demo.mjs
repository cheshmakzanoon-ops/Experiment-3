/**
 * Steam demo / Next Fest build (docs/studio/store/LAUNCH_PLAN.md "Demo").
 *
 *   npm run build:demo [-- --outDir <dir>]        (default: dist-demo)
 *
 * The demo is a PRODUCT-class build with a smaller content slice (src/release/demo.ts):
 *  - MOTOBOUND_DEMO=1 selects the slice and `edition: "demo"` in BUILD_IDENTITY.json;
 *  - `variant` stays "product", so the IP guard certifies it like the full game. The guard runs
 *    inside `vite build` (vite.config.ts) and again here on the directory that was written, so a
 *    demo that carries a real-brand name or an owner-only asset does not build and does not exit 0;
 *  - the output goes to dist-demo/, never dist/: CI uploads and the release script publish dist/
 *    only, and `scripts/publish-validated-release.sh` refuses any edition other than "full".
 *
 * The owner and review QA variants cannot be combined with it (vite.config.ts refuses them for a
 * certifying `vite build`), and this script refuses them first with a plain message.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--outDir');
const outDir = resolve(root, at >= 0 && args[at + 1] ? args[at + 1] : 'dist-demo');
const passthrough = args.filter((arg, i) => arg !== '--outDir' && args[i - 1] !== '--outDir');

for (const name of ['MOTOBOUND_SUPPLIED_PLAYER', 'MOTOBOUND_REVIEW_TOOLS', 'MOTOBOUND_QA_BUILD']) {
  if (process.env[name] === '1') {
    console.error(`build:demo refuses ${name}=1: the demo is a product build (release gate G15).`);
    process.exit(1);
  }
}

const env = { ...process.env, MOTOBOUND_DEMO: '1' };
const run = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(process.execPath, [
  join(root, 'node_modules/vite/bin/vite.js'),
  'build',
  '--outDir',
  outDir,
  '--emptyOutDir',
  ...passthrough,
]);
run(process.execPath, [join(root, 'scripts/ip-guard.mjs'), '--dist', outDir]);

const identity = JSON.parse(readFileSync(join(outDir, 'BUILD_IDENTITY.json'), 'utf8'));
if (identity.variant !== 'product' || identity.edition !== 'demo') {
  console.error(
    `build:demo wrote an unexpected identity (variant ${identity.variant}, edition ${identity.edition}).`,
  );
  process.exit(1);
}
console.log(`Demo build written to ${outDir} (variant product, edition demo, IP guard passed).`);
