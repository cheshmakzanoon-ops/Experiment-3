import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
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
/**
 * Release gate G15 (docs/studio/reports/ip-audit.md). The owner-supplied player
 * car is a real-brand model: product builds neither bundle its loader nor copy
 * its binaries. MOTOBOUND_SUPPLIED_PLAYER=1 makes an owner-only build that keeps both.
 */
const OWNER_ONLY_PUBLIC_FILES = [
  'models/supplied-player.glb.gz',
  'models/supplied-player-lods.bin.gz',
];
const OWNER_ONLY_MODULES =
  /\/src\/rendering\/(supplied-player|supplied-player-lods|studio\/supplied-lookdev|studio\/supplied-decal-art|studio\/supplied-character-lookdev)\.ts$/;
const suppliedPlayer = process.env.MOTOBOUND_SUPPLIED_PLAYER === '1';
let outDir = resolve(root, 'dist');
export default defineConfig({
  base: './',
  define: {
    __APEX_SOURCE_FINGERPRINT__: JSON.stringify(fingerprint),
    __APEX_SOURCE_COMMIT__: JSON.stringify(commit),
    __SUPPLIED_PLAYER__: JSON.stringify(suppliedPlayer),
    __REVIEW_TOOLS__: JSON.stringify(process.env.MOTOBOUND_REVIEW_TOOLS === '1'),
  },
  plugins: [
    {
      name: 'owner-only-assets',
      apply: 'build',
      // Vite copies public/ wholesale before the bundle is written; take the
      // owner-only binaries back out of the output unless this is an owner build.
      configResolved(config) {
        outDir = resolve(config.root, config.build.outDir);
      },
      // Rollup still emits the module behind a tree-shaken `import()` as an orphan
      // chunk nothing loads. Drop it so no real-brand string stays in dist/.
      generateBundle(_options, bundle) {
        if (suppliedPlayer) return;
        const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
        for (const chunk of chunks) {
          if (chunk.isEntry || !/^assets\/supplied-player-/.test(chunk.fileName)) continue;
          const name = chunk.fileName.slice('assets/'.length);
          if (!chunks.some((other) => other !== chunk && other.code.includes(name)))
            delete bundle[chunk.fileName];
        }
      },
      closeBundle() {
        if (suppliedPlayer) return;
        for (const file of OWNER_ONLY_PUBLIC_FILES) rmSync(join(outDir, file), { force: true });
      },
    },
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
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } },
      // G15: product builds treat the owner-only modules as side-effect free, so the
      // dead `SUPPLIED_PLAYER_BUILD` branches drop them (and the real names they carry)
      // from the bundle instead of leaving an orphan chunk behind.
      treeshake: {
        moduleSideEffects: (id) =>
          suppliedPlayer || !OWNER_ONLY_MODULES.test(id.replaceAll('\\', '/')),
      },
    },
  },
  worker: { format: 'es' },
});
