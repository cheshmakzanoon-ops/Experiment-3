'use strict';
/**
 * Copy the built web game (../dist) into desktop/web for packaging, leaving
 * source maps behind (they are only useful in a browser's devtools). Fails
 * loudly if the web build is missing or incomplete rather than packaging a
 * shell around nothing.
 */
const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '..', '..', 'dist');
const target = path.resolve(__dirname, '..', 'web');

function fail(message) {
  console.error(`stage-web: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(source, 'index.html')))
  fail(`${source}/index.html not found. Run "npm run build" in the repository root first.`);
if (!fs.existsSync(path.join(source, 'assets')))
  fail(`${source}/assets not found; the web build is incomplete.`);

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

console.log(
  `stage-web: ${files} files, ${(bytes / 1048576).toFixed(1)} MiB -> ${path.relative(process.cwd(), target) || '.'}`,
);
