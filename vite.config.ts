import { defineConfig } from 'vite';
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
for (const path of [...sourceFiles(join(root, 'src')), join(root, 'package-lock.json'),
  join(root, 'index.html'), join(root, 'vite.config.ts')].sort()) {
  hash.update(relative(root, path).replaceAll('\\', '/') + '\0');
  hash.update(readFileSync(path));
  hash.update('\0');
}
export default defineConfig({
  base: './',
  define: { __APEX_SOURCE_FINGERPRINT__: JSON.stringify(hash.digest('hex')) },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  worker: { format: 'es' },
});
