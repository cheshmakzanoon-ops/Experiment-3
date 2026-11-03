/**
 * QA / owner build (release gate G15, docs/studio/reports/ip-audit.md).
 *
 *   npm run build:qa [-- --outDir <dir>]
 *
 * Builds the web app WITH the two things a product build must not contain:
 *  - the owner-supplied real-brand player model (MOTOBOUND_SUPPLIED_PLAYER=1, plus its
 *    player-LOD index), which the owner-only specs (e2e/39, 41, p0-cockpit-framing, the owner
 *    half of 24 / application / 53) measure;
 *  - the internal review tooling (MOTOBOUND_REVIEW_TOOLS=1: the reference catalogue of
 *    commercial-game pages), which the review specs (e2e/07, 08, 09, 14, 15) use.
 *
 * The output labels itself: `BUILD_IDENTITY.json` says `variant: "owner"` and the folder gets a
 * NOT_FOR_RELEASE.txt. `scripts/ip-guard.mjs` refuses it, `scripts/publish-validated-release.sh`
 * refuses it, and `npm run build` refuses to be pointed at these variables. This is the only
 * way to make such a build, and it never calls the certifying path (no `tsc`, no IP guard).
 * Run the specs against it with the same two variables set (e2e/fixtures/owner-build.ts), and
 * delete it afterwards. Never upload it as a release or deployment artifact.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  MOTOBOUND_QA_BUILD: '1',
  MOTOBOUND_SUPPLIED_PLAYER: '1',
  MOTOBOUND_REVIEW_TOOLS: '1',
};
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
// The owner model's LOD index (skipped by a product build's `prebuild`).
run(process.execPath, ['--experimental-strip-types', join(root, 'scripts/build-player-lods.mjs')]);
run(process.execPath, [
  join(root, 'node_modules/vite/bin/vite.js'),
  'build',
  ...process.argv.slice(2),
]);
console.log(
  'QA build written (owner + review variant). It is NOT_FOR_RELEASE: never publish, deploy or package it.',
);
