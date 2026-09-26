import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type * as Probe from './fixtures/race-finish.ts';

let code: string;
test.beforeAll(async () => {
  const built = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/race-finish.ts'),
        name: 'RaceFinishProbe',
        formats: ['iife'],
      },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  if (!('output' in result)) throw new Error('Missing fixture build output');
  const chunk = result.output.find((entry) => entry.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing fixture chunk');
  code = chunk.code;
});
for (const method of ['signalGPU', 'crewGPU', 'canopyGPU'] as const) {
  test(`race finish: production ${method} pixels, continuity and resource bounds`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setContent(
      '<!doctype html><title>Controlled race-finish component comparison</title>',
    );
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(
      (name) => (window as unknown as { RaceFinishProbe: typeof Probe }).RaceFinishProbe[name](),
      method,
    );
    for (const capture of result.captures)
      await info.attach(`${capture.name}.png`, {
        body: Buffer.from(capture.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    await info.attach(`${method}.json`, {
      body: JSON.stringify(result, (key, value) => (key === 'image' ? undefined : value), 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
    expect(result.glError).toBe(0);
    const find = (name: string) => {
      const capture = result.captures.find((c) => c.name === name);
      if (!capture) throw new Error(`Missing capture: ${name}`);
      return capture;
    };
    if (method === 'signalGPU') {
      for (const lod of [0, 1, 2]) {
        const prefix = `rear-signal-lod${lod}-`;
        const idle = find(prefix + 'idle'),
          brake = find(prefix + 'brake');
        expect(brake.nonzero).toBeGreaterThan(4);
        expect(brake.energy).toBeGreaterThan(idle.energy);
        expect(brake.hash).toBe(find(prefix + 'held').hash);
        expect(idle.hash).toBe(find(prefix + 'rewound').hash);
      }
    } else if (method === 'crewGPU') {
      for (const lod of ['near', 'mid']) {
        const prefix = `crew-${lod}-`,
          plain = find(prefix + 'plain-control'),
          tailored = find(prefix + 'tailored');
        expect(tailored.nonzero).toBeGreaterThan(1000);
        expect(tailored.hash).not.toBe(plain.hash);
        expect(tailored.calls).toBe(plain.calls);
        expect(tailored.triangles).toBe(plain.triangles);
        expect(tailored.hash).toBe(find(prefix + 'held').hash);
        expect(tailored.hash).toBe(find(prefix + 'rewound').hash);
      }
      expect('actors' in result && result.actors).toBe(15);
      expect('before' in result && result.before).toEqual('after' in result && result.after);
    } else {
      const front = find('canopy-corrected-front'),
        back = find('canopy-corrected-back');
      expect(front.nonzero).toBeGreaterThan(100);
      expect(front.hash).toBe(back.hash);
      expect(find('canopy-control-front').hash).not.toBe(find('canopy-control-back').hash);
      expect(front.hash).toBe(find('canopy-control-front').hash);
      expect(front.calls).toBe(back.calls);
    }
  });
}
