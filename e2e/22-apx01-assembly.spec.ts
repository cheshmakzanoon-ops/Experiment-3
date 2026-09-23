import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { resolve } from 'node:path';
import manifest from '../src/rendering/apx01-shell.manifest.json' with { type: 'json' };
import type * as Probe from './fixtures/apx01-assembly.ts';
test('27H.1 CPU component: complete car preserves physical motion, live materials, pit/damage ownership and replay', async ({
  page,
}, info) => {
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
  if (!('output' in bundle)) throw new Error('Missing assembly probe output');
  const chunk = bundle.output.find((x) => x.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing probe chunk');
  // Opaque documents lack WebCrypto in some managed Chromium builds. Only this
  // offline test adapts SHA256 to Node. Production still verifies with WebCrypto.
  await page.setContent('<!doctype html><title>APX real-car CPU integration</title>');
  await page.exposeFunction('apxTestDigest', (base64: string) => [
    ...createHash('sha256').update(Buffer.from(base64, 'base64')).digest(),
  ]);
  await page.evaluate(() => {
    if (crypto.subtle) return;
    Object.defineProperty(crypto, 'subtle', {
      value: {
        digest: async (algorithm: string, bytes: ArrayBuffer) => {
          if (algorithm !== 'SHA-256') throw new Error('Unexpected test hash algorithm');
          const a = new Uint8Array(bytes);
          let s = '';
          for (let i = 0; i < a.length; i += 32768)
            s += String.fromCharCode(...a.subarray(i, i + 32768));
          const result = await (
            window as unknown as { apxTestDigest(s: string): Promise<number[]> }
          ).apxTestDigest(btoa(s));
          return new Uint8Array(result).buffer;
        },
      },
    });
  });
  await page.addScriptTag({ content: chunk.code });
  const base64 = (await readFile('src/rendering/apx01-shell.glb.gz')).toString('base64');
  const report = await page.evaluate(
    async (b) =>
      (window as unknown as { APXAssemblyProbe: typeof Probe }).APXAssemblyProbe.exercise(
        Array.from(atob(b), (c) => c.charCodeAt(0)),
      ),
    base64,
  );
  expect(report.parts).toBe(41);
  expect(report.assetSHA256).toBe(manifest.sha256);
  expect(report.poses).toBe(68);
  expect(report.physicalStateUnchanged).toBe(true);
  expect(report.finalArtApproved).toBe(false);
  const reportPath = info.outputPath('27h1-actual-car-cpu-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await info.attach('27h1-actual-car-cpu-report.json', {
    path: reportPath,
    contentType: 'application/json',
  });
});
