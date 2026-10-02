import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

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
export default defineConfig({
  base: './',
  define: {
    __APEX_SOURCE_FINGERPRINT__: JSON.stringify(fingerprint),
    __APEX_SOURCE_COMMIT__: JSON.stringify(commit),
  },
  plugins: [
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
    sourcemap: true,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  worker: { format: 'es' },
});
