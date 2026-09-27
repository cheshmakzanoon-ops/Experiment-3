import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import type { captureSuppliedPlayer } from './fixtures/supplied-player.ts';
import manifest from '../src/rendering/supplied-player.manifest.json' with { type: 'json' };

test('supplied RB19 and R06: actual binary fit, both locks, POV, T-cam and rewind', async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const bundled = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      lib: {
        entry: resolve('e2e/fixtures/supplied-player.ts'),
        name: 'SuppliedPlayerProbe',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in output)) throw new Error('Missing player fixture output');
  const chunk = output.output.find((e) => e.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing player fixture chunk');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/player-model-probe', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Supplied player assembly verification</title>',
    }),
  );
  await page.goto('/player-model-probe');
  await page.addScriptTag({ content: chunk.code });
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        SuppliedPlayerProbe: { captureSuppliedPlayer: typeof captureSuppliedPlayer };
      }
    ).SuppliedPlayerProbe.captureSuppliedPlayer(
      new URL('/models/supplied-player.glb.gz', location.href).href,
    ),
  );
  for (const c of [
    ...result.results,
    ...result.lodReview.map((row) => ({ ...row, name: row.label })),
  ])
    await info.attach(`${c.name}.png`, {
      body: Buffer.from(c.image.split(',')[1], 'base64'),
      contentType: 'image/png',
    });
  await info.attach('supplied-player-verification.json', {
    body: JSON.stringify(
      {
        ...result,
        results: result.results.map(({ image: _image, ...c }) => c),
        lodReview: result.lodReview.map(({ image: _image, ...c }) => c),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.sourceUnchanged).toBe(true);
  expect(result.results).toHaveLength(7);
  const neutral = result.results[1],
    left = result.results[2],
    right = result.results[3],
    paused = result.results[4],
    rewind = result.results[5];
  for (const c of result.results) {
    expect(c.diagnostics.sha256).toBe(manifest.sha256);
    expect(c.diagnostics.joints).toBe(manifest.joints);
    expect(c.diagnostics.heightMapsRestored).toBe(10);
    expect(c.diagnostics.suspensionDatum).toBe(0.25);
    c.diagnostics.chassisWheelCenters.forEach((hub, i) => {
      expect(hub[1]).toBeCloseTo(0.05 - c.suspension[i], 5);
      expect(c.wheelWorld[i][1]).toBeCloseTo(c.chassisY + hub[1], 5);
    });
    expect(c.diagnostics.eye[1]).toBeCloseTo(manifest.sockets.eye[1] - 0.25, 6);
    expect(c.diagnostics.headVisible).toBe(c.mode !== 'cockpit');
    expect(c.triangles).toBeGreaterThan(100000);
    expect(c.image.length).toBeGreaterThan(30000);
    if (c.mode === 'cockpit') {
      expect(Math.abs(c.screen[0])).toBeLessThan(1);
      expect(Math.abs(c.screen[1])).toBeLessThan(1);
      expect(c.screen[2]).toBeLessThan(1);
    }
    for (const arm of c.pose.arms) {
      expect(arm.authoredSkin).toBe(true);
      expect(arm.shoulder).not.toBeNull();
      expect(arm.elbow).not.toBeNull();
      expect(arm.wrist).not.toBeNull();
      expect([...arm.shoulder!, ...arm.elbow!, ...arm.wrist!].every(Number.isFinite)).toBe(true);
    }
    // Source IK wrist targets must remain fixed in the steering wheel frame.
    c.handInWheel.forEach((hand, i) =>
      hand.forEach((v, j) => expect(Math.abs(v - neutral.handInWheel[i][j])).toBeLessThan(0.025)),
    );
  }
  expect(result.poseRetained).toBe(true);
  expect(result.reusedResources).toEqual(result.warmedResources);
  expect(result.lodReview.map((row) => row.lod.tier)).toEqual([0, 1, 2, 3, 0]);
  for (const row of result.lodReview) {
    expect(row.identityRetained).toBe(true);
    expect(row.pose).toEqual(result.lodReview[0].pose);
    expect(row.image.length).toBeGreaterThan(30000);
    expect(row.calls).toBe(result.lodReview[0].calls);
  }
  for (const row of result.lodReview.slice(1, 4)) {
    const saved = result.lodReview[0].lod.triangles - row.lod.triangles;
    expect(saved).toBeGreaterThan(result.lodReview[0].lod.triangles * 0.3);
    // Transparent two-sided decals incur an unchanged extra render pass.
    // Measure the exact removed triangles, not a ratio diluted by that overhead.
    expect(result.lodReview[0].triangles - row.triangles).toBe(saved);
  }
  // Sub-millimetre simplifier tolerances are not by themselves visual proof.
  // The close view must retain its appearance, and exact mode must restore pixels.
  expect(result.lodReview[1].meanChannelDelta).toBeLessThan(2);
  expect(result.lodReview[4].maxChannelDelta).toBe(0);
  expect(left.diagnostics.steeringTime).not.toBe(right.diagnostics.steeringTime);
  expect(left.pose.arms).not.toEqual(right.pose.arms);
  expect(paused.pose).toEqual(right.pose);
  expect(rewind.pose).toEqual(neutral.pose);
});
