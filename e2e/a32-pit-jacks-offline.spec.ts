import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { build } from 'vite';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import jacks from '../src/rendering/a32-pit-jacks.manifest.json' with { type: 'json' };
import player from '../src/rendering/supplied-player.manifest.json' with { type: 'json' };
import guns from '../src/rendering/wheel-gun.manifest.json' with { type: 'json' };
import type { inspectA32Offline } from './fixtures/a32-pit-jacks-offline.ts';

/** Supplemental GPU evidence. Never replace the normal-startup/circuit suite
 * with this fixture: it purposefully has no HTTP acquisition or navigation. */
for (const lighting of ['day', 'sunset', 'night'] as const) {
  test(`A32 offline native-texture assembly inspection: ${lighting}`, async ({ page }, info) => {
    const readVerified = (path: string, sha256: string) => {
      const bytes = readFileSync(path);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
      return bytes.toString('base64');
    };
    const jackBytes = readVerified(`public/${jacks.url}`, jacks.sha256);
    const playerBytes = readVerified(
      'public/models/supplied-player.glb.gz',
      player.compressedSHA256,
    );
    const gunBytes = readVerified(`public/${guns.url}`, guns.sha256);
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      weather: lighting === 'night' ? 'rain' : 'clear',
      seed: 1887,
    });
    sim.autoPlayer = true;
    sim.cars[0].pitRequested = true;
    const samples: number[][] = [];
    let next = 0.3;
    for (let tick = 0; tick < 250 * 120; tick++) {
      sim.step(1 / 120);
      const car = sim.cars[0];
      if (car.pitPhase >= 2 && car.pitPhase <= 5 && car.pitClock >= next) {
        samples.push(Array.from(sim.makeFrame()));
        next += 0.28;
      }
      // Retain every original sample, then include the fully withdrawn jacks
      // before the unchanged 5.2-second minimum release. These are real frames.
      if (car.pitPhase === 5 && car.pitClock >= 5.15) {
        samples.push(Array.from(sim.makeFrame()));
        break;
      }
    }
    expect(samples.length).toBeGreaterThanOrEqual(16);
    const bundle = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        lib: {
          entry: resolve('e2e/fixtures/a32-pit-jacks-offline.ts'),
          name: 'A32Offline',
          formats: ['iife'],
        },
      },
    });
    const output = Array.isArray(bundle) ? bundle[0] : bundle;
    if (!('output' in output)) throw new Error('Missing offline A32 output');
    const chunk = output.output.find((o) => o.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing offline A32 fixture');
    const errors: string[] = [],
      requests: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('request', (r) => {
      if (/^https?:/.test(r.url())) requests.push(r.url());
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent('<!doctype html><title>A32 offline assembly inspection</title>');
    await page.addScriptTag({ content: chunk.code });
    const report = await page.evaluate(
      async (input) =>
        (
          window as unknown as { A32Offline: { inspectA32Offline: typeof inspectA32Offline } }
        ).A32Offline.inspectA32Offline(input),
      { jacks: jackBytes, player: playerBytes, guns: gunBytes, samples, lighting },
    );
    const reportPath = info.outputPath(`a32-offline-${lighting}.json`);
    writeFileSync(
      reportPath,
      JSON.stringify(
        { ...report, images: report.images.map(({ image: _image, ...row }) => row) },
        null,
        2,
      ),
    );
    await info.attach(`a32-offline-${lighting}.json`, {
      path: reportPath,
      contentType: 'application/json',
    });
    for (const shot of report.images) {
      const name = `a32-offline-${lighting}-${shot.name}.png`,
        path = info.outputPath(name);
      writeFileSync(path, Buffer.from(shot.image.split(',')[1], 'base64'));
      await info.attach(name, { path, contentType: 'image/png' });
    }
    expect(report.images).toHaveLength(9);
    for (const shot of report.images) {
      expect(shot.pixels.nonBlackFraction).toBeGreaterThan(0.2);
      expect(shot.pixels.range).toBeGreaterThan(30);
    }
    expect(report.contextLost).toBe(false);
    expect(report.textureFacts).toHaveLength(3);
    for (const texture of report.textureFacts)
      expect([texture.width, texture.height]).toEqual(jacks.textureSize);
    expect(report.sourceUnchanged).toBe(true);
    expect(report.rewindSame).toBe(true);
    expect(report.heldUploadStable).toBe(true);
    for (const state of report.states) {
      expect(state.pitJacks?.instances).toBe(2);
      expect(state.pitJacks?.drawBatches).toBeLessThanOrEqual(8);
      expect(state.wheelGuns?.instances).toBe(4);
      expect(state.actors).toBe(15);
      expect(state.unreachableArms).toBe(0);
      expect(state.maxGripError).toBeLessThan(0.0001);
    }
    for (const contact of report.contacts) {
      expect(contact.error).toBeLessThan(0.00001);
      expect(contact.floorError).toBeLessThan(0.00001);
    }
    // A pad must contact the car while loaded/lowering, but must follow its
    // clearance route once lowered. Neither requirement may disappear silently.
    for (const role of ['front', 'rear'] as const) {
      const contacts = report.contacts.filter((c) => c.role === role);
      const attached = contacts.filter((c) => c.state === 'contact');
      const withdrawing = contacts.filter((c) => c.state === 'withdrawing');
      expect(attached.length).toBeGreaterThan(0);
      expect(attached.some((c) => c.height > 0.18)).toBe(true);
      expect(attached.some((c) => c.phase === 5 && c.height > 1e-6)).toBe(true);
      for (const c of attached) expect(c.carContactError).toBeLessThan(0.00001);
      expect(withdrawing.length).toBeGreaterThan(0);
      for (const c of withdrawing) {
        expect(c.phase).toBe(5);
        expect(c.height).toBeLessThanOrEqual(1e-6);
        expect(c.clock).toBeGreaterThan(4.72);
        expect(Math.sign(c.observedOffset)).toBe(role === 'front' ? 1 : -1);
        expect(Math.abs(c.observedOffset - c.expectedOffset)).toBeLessThan(0.00001);
      }
      expect(withdrawing.some((c) => Math.abs(c.observedOffset) > 1.54999)).toBe(true);
    }
    expect(report.before).toEqual(report.after);
    expect(report.glError).toBe(0);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
