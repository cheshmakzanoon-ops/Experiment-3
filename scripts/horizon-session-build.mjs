/** Build the production application plus real-session and HUD verification
 * entries. It preserves production quality and emits exact fixture identities. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { build } from 'vite';

const root = process.cwd();
const output = resolve(
  process.env.HORIZON_SESSION_BUILD_DIR ?? 'test-results/horizon-session-build',
);
assert(output !== root && relative(output, root).startsWith('..'));
const fixtures = {
  HORIZON_FIXTURE_IDENTITY: [
    'e2e/fixtures/horizon-session.html',
    'e2e/fixtures/horizon-session.ts',
    'scripts/horizon-practice-session-review.mjs',
  ],
  HORIZON_HUD_FIXTURE_IDENTITY: [
    'e2e/fixtures/horizon-practice-hud.html',
    'e2e/fixtures/horizon-practice-hud.ts',
    'scripts/horizon-practice-hud-review.mjs',
    'src/ui/festival-hud.ts',
    'src/ui/festival-hud.css',
    'src/simulation/open-world/circuit-pace.ts',
  ],
};
const hashes = async (files) =>
  Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(join(root, file)))
          .digest('hex'),
      ]),
    ),
  );
const identities = Object.fromEntries(
  await Promise.all(
    Object.entries(fixtures).map(async ([name, files]) => [name, await hashes(files)]),
  ),
);
await build({
  root,
  build: {
    outDir: output,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: join(root, 'index.html'),
        'horizon-session': join(root, fixtures.HORIZON_FIXTURE_IDENTITY[0]),
        'horizon-hud': join(root, fixtures.HORIZON_HUD_FIXTURE_IDENTITY[0]),
      },
    },
  },
});
for (const [name, files] of Object.entries(fixtures)) {
  assert.deepEqual(await hashes(files), identities[name], 'Review source changed during build');
  // Vite emits entry links relative to the nested page. Runtime GLBs and
  // dynamically preloaded chunks resolve against document.baseURI as well.
  // Both entry points must use the same product root, including subpath hosts.
  const nested = join(output, files[0]);
  const entry = (await readFile(nested, 'utf8')).replaceAll(
    /((?:src|href)=["'])\.\.\/\.\.\/assets\//g,
    '$1./assets/',
  );
  await writeFile(join(output, basename(files[0])), entry);
  await writeFile(nested, entry.replace('<head>', '<head>\n    <base href="../../" />'));
  await writeFile(join(output, `${name}.json`), JSON.stringify(identities[name], null, 2) + '\n');
}
console.log('HORIZON_SESSION_BUILD', output);
