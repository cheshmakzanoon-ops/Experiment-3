'use strict';
/**
 * Copy a built web game into desktop/web for packaging, leaving source maps behind (they are only
 * useful in a browser's devtools). Fails loudly if the web build is missing or incomplete rather
 * than packaging a shell around nothing, and (release gate G15) if the build is not certified by
 * the repository's IP guard: an owner or review QA build, or any real-brand name, is never packaged.
 *
 *   node scripts/stage-web.cjs                 the full game: ../dist       (edition "full")
 *   node scripts/stage-web.cjs --demo          the Steam demo: ../dist-demo (edition "demo")
 *   node scripts/stage-web.cjs --source <dir>  another certified build (its edition is still checked)
 *
 * The edition in BUILD_IDENTITY.json must match what is being staged, so a demo build can never
 * be packaged as the game (or the game as the demo) by pointing the wrong directory at the wrong
 * electron-builder config. The staged folder also gets STORE_LINK.json (the full game's store
 * app id from MOTOBOUND_STORE_APPID, or null); see src/store-link.cjs.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseAppId } = require('../src/store-link.cjs');

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const at = args.indexOf('--source');
const repo = path.resolve(__dirname, '..', '..');
const source = path.resolve(
  at >= 0 && args[at + 1] ? args[at + 1] : path.join(repo, demo ? 'dist-demo' : 'dist'),
);
const target = path.resolve(__dirname, '..', 'web');
const wanted = demo ? 'demo' : 'full';

function fail(message) {
  console.error(`stage-web: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(source, 'index.html')))
  fail(
    `${source}/index.html not found. Run "npm run ${demo ? 'build:demo' : 'build'}" in the repository root first.`,
  );
if (!fs.existsSync(path.join(source, 'assets')))
  fail(`${source}/assets not found; the web build is incomplete.`);

let identity = null;
try {
  identity = JSON.parse(fs.readFileSync(path.join(source, 'BUILD_IDENTITY.json'), 'utf8'));
} catch {
  /* the guard below refuses a build with no identity file */
}
// Builds from before the demo edition carry no edition and are the full game.
const edition = identity?.edition ?? 'full';
if (edition !== wanted)
  fail(
    `${source} is a "${edition}" edition build but this stage is for "${wanted}" ` +
      `(${demo ? 'run npm run build:demo' : 'run npm run build'}); refusing to package it.`,
  );

const guard = spawnSync(
  process.execPath,
  [path.resolve(repo, 'scripts', 'ip-guard.mjs'), '--dist', source],
  { stdio: 'inherit' },
);
if (guard.status !== 0)
  fail('the web build is not certified by scripts/ip-guard.mjs; refusing to package it.');

fs.rmSync(target, { recursive: true, force: true });
let files = 0;
let bytes = 0;
(function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copy(src, dst);
    else if (!entry.name.endsWith('.map')) {
      fs.copyFileSync(src, dst);
      files++;
      bytes += fs.statSync(dst).size;
    }
  }
})(source, target);

const storeAppId = parseAppId(process.env.MOTOBOUND_STORE_APPID);
fs.writeFileSync(
  path.join(target, 'STORE_LINK.json'),
  JSON.stringify({ edition, appId: storeAppId }, null, 2) + '\n',
);
if (demo && !storeAppId)
  console.warn(
    'stage-web: MOTOBOUND_STORE_APPID is not set: the demo\'s WISHLIST button will not open a page ' +
      '(set it to the full game\'s Steam app id when packaging a build for players).',
  );

console.log(
  `stage-web: ${edition} edition, ${files} files, ${(bytes / 1048576).toFixed(1)} MiB -> ${path.relative(process.cwd(), target) || '.'}`,
);
