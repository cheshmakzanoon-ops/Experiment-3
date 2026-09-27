import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { resolve } from 'node:path';
import manifest from '../src/rendering/apx01-driver.manifest.json' with { type: 'json' };
import type * as Probe from './fixtures/character-quality.ts';
let code: string;
test.beforeAll(async () => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/character-quality.ts'),
        name: 'CharacterProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing GPU probe output');
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing GPU probe chunk');
  code = chunk.code;
});
for (const method of ['driver', 'helmet'] as const) {
  test(`character quality: ${method} production GPU construction and held-frame integrity`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setContent(
      '<!doctype html><title>Controlled authored-character GPU inspection</title>',
    );
    // Test-only digest adapter for opaque documents. Runtime loaders retain
    // their production integrity verification and never accept substitute bytes.
    await page.exposeFunction('characterTestDigest', (base64: string) => [
      ...createHash('sha256').update(Buffer.from(base64, 'base64')).digest(),
    ]);
    await page.evaluate(() => {
      if (crypto.subtle) return;
      Object.defineProperty(crypto, 'subtle', {
        value: {
          digest: async (algorithm: string, bytes: ArrayBuffer) => {
            if (algorithm !== 'SHA-256') throw new Error('Unexpected digest');
            const a = new Uint8Array(bytes);
            let s = '';
            for (let i = 0; i < a.length; i += 32768)
              s += String.fromCharCode(...a.subarray(i, i + 32768));
            const r = await (
              window as unknown as {
                characterTestDigest(s: string): Promise<number[]>;
              }
            ).characterTestDigest(btoa(s));
            return new Uint8Array(r).buffer;
          },
        },
      });
    });
    await page.addScriptTag({ content: code });
    const bytes =
      method === 'driver'
        ? await Promise.all([
            readFile('src/rendering/apx01-shell.glb.gz'),
            readFile('src/rendering/apx01-driver.glb.gz'),
          ])
        : [];
    const result = await page.evaluate(
      async ({ method, bytes }) => {
        const probe = (window as unknown as { CharacterProbe: typeof Probe }).CharacterProbe;
        return method === 'driver'
          ? probe.driverGPU(
              ...(bytes.map((b) => Array.from(atob(b), (c) => c.charCodeAt(0))) as [
                number[],
                number[],
              ]),
            )
          : probe.helmetGPU();
      },
      { method, bytes: bytes.map((b) => b.toString('base64')) },
    );
    for (const c of result.captures)
      await info.attach(`${c.name}.png`, {
        body: Buffer.from(c.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await info.attach(`${method}-construction.json`, {
      body: JSON.stringify(result, (k, v) => (k === 'image' ? undefined : v), 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
    expect(result.glError).toBe(0);
    expect(result.after).toEqual(result.before);
    const find = (name: string) => {
      const c = result.captures.find((c) => c.name === name);
      if (!c) throw new Error(`Missing capture ${name}`);
      return c;
    };
    if ('identity' in result) {
      expect(result.identity.sha256).toBe(manifest.sha256);
      expect(find('driver-neutral').hash).toBe(find('driver-held').hash);
      expect(find('driver-neutral').hash).toBe(find('driver-rewound').hash);
      expect(find('driver-left-lock').hash).not.toBe(find('driver-right-lock').hash);
      for (const c of result.captures) {
        expect(c.triangles).toBeGreaterThan(1000);
        expect(c.arms).toHaveLength(2);
        expect(c.arms.every((a) => a.authoredSkin && a.reachable)).toBe(true);
      }
    } else {
      expect(result.lensPixels).toBeGreaterThan(100);
      expect(result.shellPixels).toBeGreaterThan(100);
      expect(find('helmet-authored-lens').hash).not.toBe(find('helmet-uncoated-control').hash);
      expect(find('helmet-authored-lens').hash).toBe(find('helmet-held').hash);
      expect(find('helmet-authored-lens').calls).toBe(find('helmet-uncoated-control').calls);
      expect(find('helmet-authored-lens').triangles).toBe(
        find('helmet-uncoated-control').triangles,
      );
    }
  });
}
