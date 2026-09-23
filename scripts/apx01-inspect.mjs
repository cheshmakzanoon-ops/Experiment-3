/** Export the real assembled car's posed geometry, not the loose GLB prototypes.
 * node scripts/apx01-inspect.mjs test-results/apx01/runtime-car.json
 * Needs installed Playwright Chromium or CHROMIUM_PATH; deliberately no WebGL.
 * For labelled CPU inspection only, NEVER normal-application visual approval.
 */
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const destination = resolve(process.argv[2] ?? 'test-results/apx01/runtime-car.json');
const result = await build({
  configFile: false,
  logLevel: 'error',
  build: {
    write: false,
    lib: {
      entry: resolve('e2e/fixtures/apx01-assembly.ts'),
      name: 'APXAssemblyProbe',
      formats: ['iife'],
    },
  },
});
const bundle = Array.isArray(result) ? result[0] : result;
if (!('output' in bundle)) throw new Error('Missing inspection bundle');
const chunk = bundle.output.find((item) => item.type === 'chunk');
if (!chunk || chunk.type !== 'chunk') throw new Error('Missing inspection entry');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>APX CPU-only geometry extraction</title>');
  await page.exposeFunction('apxTestDigest', (base64) => [
    ...createHash('sha256').update(Buffer.from(base64, 'base64')).digest(),
  ]);
  await page.evaluate(() => {
    if (crypto.subtle) return;
    Object.defineProperty(crypto, 'subtle', {
      value: {
        digest: async (algorithm, bytes) => {
          if (algorithm !== 'SHA-256') throw new Error('Unsupported test digest');
          const a = new Uint8Array(bytes);
          let s = '';
          for (let i = 0; i < a.length; i += 32768)
            s += String.fromCharCode(...a.subarray(i, i + 32768));
          return new Uint8Array(await window.apxTestDigest(btoa(s))).buffer;
        },
      },
    });
  });
  await page.addScriptTag({ content: chunk.code });
  const bytes = (await readFile('src/rendering/apx01-shell.glb.gz')).toString('base64');
  // JSON serialization happens inside Chromium to avoid a huge CDP property tree.
  const json = await page.evaluate(
    async (b) =>
      JSON.stringify(
        await window.APXAssemblyProbe.exportGeometry(Array.from(atob(b), (c) => c.charCodeAt(0))),
      ),
    bytes,
  );
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, json);
  console.log(
    `Exported ${JSON.parse(json).length} visible runtime meshes to ${destination}. CPU inspection only.`,
  );
} finally {
  await browser.close();
}
