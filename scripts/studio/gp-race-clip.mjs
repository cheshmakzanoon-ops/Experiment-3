import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/studio/gp-race-clip.mjs OUTPUT_DIRECTORY');
const output = resolve(directory);
const settings = {
  circuit: 'poggio-alto',
  preset: 'high',
  weather: 'clear',
  seed: 34100,
  opponents: 3,
  moments: [24],
  views: ['trackside'],
  width: 640,
  height: 360,
  clip: { frames: 48, fps: 24 },
};

await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string')
    throw new Error('The local capture server did not start');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const page = await browser.newPage({
    viewport: { width: settings.width, height: settings.height },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'log') console.log(message.text());
  });
  await page.route('**/gp-camera-review', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>GP trackside camera</title>',
    }),
  );
  await page.goto(`http://127.0.0.1:${address.port}/gp-camera-review`);
  let frames = 0;
  await page.exposeFunction('saveCapture', async (name, url) => {
    if (basename(name) !== name || !url.startsWith('data:image/jpeg;base64,'))
      throw new Error('Unexpected race capture');
    await writeFile(join(output, name), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    if (name.includes('-frame-')) {
      frames++;
      if (frames % 12 === 0) console.log(`Captured ${frames} of ${settings.clip.frames} frames`);
    }
  });
  const review = await page.evaluate(async (options) => {
    const { captureGPMoments } = await import('/e2e/fixtures/motogp-hyperreal-capture.ts');
    const result = await captureGPMoments(options);
    return { ...result, captures: result.captures.map(({ image: _image, ...metrics }) => metrics) };
  }, settings);
  const fixedCadence =
    review.timeline?.length === frames &&
    review.timeline.every(
      (sample, i, samples) =>
        i === 0 || sample.tick - samples[i - 1].tick === 120 / settings.clip.fps,
    );
  if (
    !fixedCadence ||
    errors.length ||
    review.glError ||
    !review.finite ||
    frames !== settings.clip.frames
  )
    throw new Error(
      JSON.stringify({ errors, glError: review.glError, finite: review.finite, frames }),
    );
  await writeFile(
    join(output, 'clip.json'),
    JSON.stringify({ settings, frames, ...review }, null, 2),
  );
  console.log(`Saved ${frames} frames at ${settings.clip.fps} fps in ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
