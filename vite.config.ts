import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { lazyData } from './scripts/vite-lazy-data.ts';

// Content identity, not the staging commit SHA: CI applies the patch before
// building, so a HEAD label alone would identify the wrong source tree.
const root = fileURLToPath(new URL('.', import.meta.url));
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}
const hash = createHash('sha256');
for (const path of [
  ...sourceFiles(join(root, 'src')),
  join(root, 'package-lock.json'),
  join(root, 'index.html'),
  join(root, 'vite.config.ts'),
].sort()) {
  hash.update(relative(root, path).replaceAll('\\', '/') + '\0');
  hash.update(readFileSync(path));
  hash.update('\0');
}
const fingerprint = hash.digest('hex');
let commit: string | null = null;
try {
  const dirty = execFileSync(
    'git',
    ['status', '--porcelain', '--', 'src', 'index.html', 'vite.config.ts', 'package-lock.json'],
    { cwd: root, encoding: 'utf8' },
  );
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (!dirty && /^[0-9a-f]{40}$/.test(head)) commit = head;
} catch {
  /* Source archives have a fingerprint, not an invented commit. */
}
/**
 * Large JSON documents served as lazy datasets (their large keys load from
 * separate chunks; contract in src/core/lazy-data.ts). The group names the
 * first place that needs the data:
 * - 'showroom': read while the menu showroom renderer is built (it still
 *   builds the pit and grid crew and the venue landmark), so
 *   RacingRenderer.create loads it before constructing one;
 * - 'circuit': read only once a circuit or festival session starts.
 */
const LAZY_DATA = {
  'src/rendering/crew-performance.geometry.json': 'showroom',
  'src/rendering/human-kit.json': 'showroom',
  'src/rendering/a33-spare-wheel-set.geometry.json': 'showroom',
  'src/rendering/aurel-people.geometry.json': 'showroom',
  'src/rendering/assets/gp-bodywork.mesh.json': 'showroom',
  'src/rendering/start-finish.geometry.json': 'circuit',
  'src/rendering/event-hall.geometry.json': 'showroom',
  'src/rendering/secondary-grandstands.geometry.json': 'circuit',
  'src/rendering/assets/mx-authored-kit.mesh.json': 'circuit',
};
export default defineConfig({
  base: './',
  define: {
    __APEX_SOURCE_FINGERPRINT__: JSON.stringify(fingerprint),
    __APEX_SOURCE_COMMIT__: JSON.stringify(commit),
  },
  plugins: [
    // Authored geometry tables load on demand instead of inflating the entry
    // chunk (see src/core/lazy-data.ts for the loading contract).
    lazyData({ root, files: LAZY_DATA, preload: ['showroom'] }),
    {
      name: 'source-identity',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'BUILD_IDENTITY.json',
          source: JSON.stringify({ version: 1, commit, fingerprint }, null, 2) + '\n',
        });
      },
    },
  ],
  build: {
    target: 'es2022',
    // Maps roughly double the shipped JS and are not needed by players. Set
    // APEX_SOURCEMAP=1 for a profiling or crash-symbolication build.
    sourcemap: process.env.APEX_SOURCEMAP === '1',
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  worker: { format: 'es' },
});
