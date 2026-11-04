import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
 * its binaries. MOTOBOUND_SUPPLIED_PLAYER=1 makes an owner-only QA build that keeps both
 * (`npm run build:qa`; never certified, never published; see `variant` below).
 */
const OWNER_ONLY_PUBLIC_FILES = [
  'models/supplied-player.glb.gz',
  'models/supplied-player-lods.bin.gz',
];
const OWNER_ONLY_MODULES =
  /\/src\/rendering\/(supplied-player|supplied-player-lods|studio\/supplied-lookdev|studio\/supplied-decal-art|studio\/supplied-character-lookdev)\.ts$/;
const suppliedPlayer = process.env.MOTOBOUND_SUPPLIED_PLAYER === '1';
const reviewTools = process.env.MOTOBOUND_REVIEW_TOOLS === '1';
/**
 * The Steam demo / Next Fest edition (`npm run build:demo`, scripts/build-demo.mjs). Unlike the
 * two QA variants above this is a PRODUCT-class build: it is certified by the IP guard exactly
 * like the full game (and the guard runs inside this build), and BUILD_IDENTITY.json keeps
 * `variant: "product"`. What changes is the content slice (src/release/demo.ts) and
 * `edition: "demo"`, which `scripts/publish-validated-release.sh` refuses to publish as the
 * game and `desktop/scripts/stage-web.cjs` packages only into the demo app.
 */
const demoBuild = process.env.MOTOBOUND_DEMO === '1';
const edition = demoBuild ? 'demo' : 'full';
/**
 * What this build is. Only `product` can be certified by `scripts/ip-guard.mjs` and published
 * (`scripts/publish-validated-release.sh`). `owner` carries the real-brand player model and
 * `review` the commercial-game reference catalogue: both are QA-only builds made by
 * `npm run build:qa` (which sets MOTOBOUND_QA_BUILD=1) and never leave the machine or the CI
 * job that made them. `npm run build` refuses to make them.
 */
const variant = suppliedPlayer ? 'owner' : reviewTools ? 'review' : 'product';
let outDir = resolve(root, 'dist');
/** `npm run build` is the certifying path: it must produce a product build or fail. */
function requireCertifiableBuild(command: string) {
  if (command !== 'build' || variant === 'product' || process.env.MOTOBOUND_QA_BUILD === '1')
    return;
  throw new Error(
    `MOTOBOUND_SUPPLIED_PLAYER / MOTOBOUND_REVIEW_TOOLS select a ${variant} build, which can never be certified or published (release gate G15, docs/studio/reports/ip-audit.md). Make QA builds with \`npm run build:qa\`, and unset the variable for \`npm run build\`.`,
  );
}
export default defineConfig({
  base: './',
  define: {
    __APEX_SOURCE_FINGERPRINT__: JSON.stringify(fingerprint),
    __APEX_SOURCE_COMMIT__: JSON.stringify(commit),
    __SUPPLIED_PLAYER__: JSON.stringify(suppliedPlayer),
    __REVIEW_TOOLS__: JSON.stringify(reviewTools),
    __DEMO_BUILD__: JSON.stringify(demoBuild),
  },
  plugins: [
    {
      name: 'certifiable-build',
      config(_config, { command }) {
        requireCertifiableBuild(command);
      },
    },
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
    {
      // Release gate G15, enforced: every product build is checked by scripts/ip-guard.mjs
      // when it is written, so `npm run build` (and any `vite build`) fails on a brand name or
      // an owner-only asset in the output. A QA build is labelled instead and can never be
      // certified. Runs after owner-only-assets has removed the owner binaries (closeBundle
      // hooks of different plugins are not ordered), hence the explicit second removal.
      name: 'ip-guard',
      apply: 'build',
      enforce: 'post',
      closeBundle: {
        order: 'post',
        handler() {
          if (variant !== 'product') {
            writeFileSync(
              join(outDir, 'NOT_FOR_RELEASE.txt'),
              `This is ${variant === 'owner' ? 'an owner' : 'a review'} QA build (MOTOBOUND_SUPPLIED_PLAYER / MOTOBOUND_REVIEW_TOOLS).\n` +
                'It contains a real-brand model or commercial-game material by design.\n' +
                'Never publish, deploy, package or share it. scripts/ip-guard.mjs refuses it.\n',
            );
            return;
          }
          for (const file of OWNER_ONLY_PUBLIC_FILES) rmSync(join(outDir, file), { force: true });
          execFileSync(process.execPath, [join(root, 'scripts/ip-guard.mjs'), '--dist', outDir], {
            stdio: 'inherit',
          });
        },
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
          source:
            JSON.stringify({ version: 1, commit, fingerprint, variant, edition }, null, 2) + '\n',
        });
      },
    },
    {
      // The demo is its own Steam app: say so in the window and tab title.
      name: 'demo-title',
      transformIndexHtml(html) {
        return demoBuild ? html.replace(/<title>([^<]*)<\/title>/, '<title>$1 · DEMO</title>') : html;
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
