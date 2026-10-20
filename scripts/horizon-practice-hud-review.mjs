/** Bounded production DOM review. Synthetic status, actual CircuitPace and
 * FestivalHud; no WebGL or claim of completed physical driving. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createServer, preview } from 'vite';
import { chromium } from 'playwright';

const root = realpathSync(process.cwd());
const output = resolve(process.env.HORIZON_HUD_OUTPUT ?? 'test-results/horizon-practice-hud');
const fixture = 'e2e/fixtures/horizon-practice-hud.html';
const buildDirectory = process.env.HORIZON_HUD_BUILD_DIR;
const sourceFiles = [
  'src/ui/festival-hud.ts',
  'src/ui/festival-hud.css',
  'src/simulation/open-world/circuit-pace.ts',
  'e2e/fixtures/horizon-practice-hud.ts',
  fixture,
  'scripts/horizon-practice-hud-review.mjs',
];
const hashSources = async () =>
  Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(join(root, file)))
          .digest('hex'),
      ]),
    ),
  );
await mkdir(output, { recursive: true });
const report = {
  passed: false,
  productionHud: true,
  productionCircuitPace: true,
  syntheticStatus: true,
  webgl: false,
  font: 'Saira Variable (production dependency)',
  sourceSha256: await hashSources(),
  cases: [],
  errors: [],
  screenshots: [],
  limitations: [
    'DOM/layout/callback evidence only; no driving, physics completion, persistence, or hardware performance claim',
  ],
};
let server, browser, page, deadline;
let fixturePath = fixture;
const check = async (name, work) => {
  try {
    report.cases.push({ name, passed: true, state: await work() });
  } catch (error) {
    report.cases.push({ name, passed: false, error: String(error) });
  }
};
const screenshot = async (name) => {
  await page.screenshot({ path: join(output, `${name}.png`) });
  report.screenshots.push(`${name}.png`);
};
const inside = (box, width, height, label) => {
  assert.ok(
    box.x >= -1 && box.y >= -1 && box.right <= width + 1 && box.bottom <= height + 1,
    `${label} outside viewport`,
  );
  assert.ok(box.scrollWidth <= box.clientWidth + 1, `${label} horizontal content overflow`);
};
try {
  await Promise.race([
    (async () => {
      if (buildDirectory) {
        const manifest = JSON.parse(
          await readFile(join(buildDirectory, 'HORIZON_HUD_FIXTURE_IDENTITY.json'), 'utf8'),
        );
        assert.deepEqual(
          manifest,
          await hashSources(),
          'HUD build does not match current reviewed source',
        );
        report.buildIdentity = JSON.parse(
          await readFile(join(buildDirectory, 'BUILD_IDENTITY.json'), 'utf8'),
        );
        const built = await preview({
          root,
          configFile: false,
          base: './',
          build: { outDir: resolve(buildDirectory) },
          preview: {
            host: '127.0.0.1',
            port: Number(process.env.HORIZON_HUD_PORT ?? 5318),
            strictPort: true,
          },
          logLevel: 'warn',
        });
        server = {
          resolvedUrls: built.resolvedUrls,
          close: () =>
            new Promise((resolve, reject) =>
              built.httpServer.close((error) => (error ? reject(error) : resolve())),
            ),
        };
        fixturePath = basename(fixture);
        report.servingMode = 'bundled';
      } else {
        server = await createServer({
          root,
          configFile: false,
          cacheDir: join(output, 'vite-cache'),
          logLevel: 'warn',
          optimizeDeps: { entries: [fixture], include: ['three'] },
          server: {
            host: '127.0.0.1',
            port: Number(process.env.HORIZON_HUD_PORT ?? 5318),
            strictPort: true,
            hmr: false,
            fs: { allow: [root, realpathSync(join(root, 'node_modules'))] },
          },
        });
        await server.listen();
        report.servingMode = 'development';
      }
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.HORIZON_REVIEW_EXECUTABLE || undefined,
        args: ['--no-sandbox', '--disable-gpu'],
        timeout: 20000,
      });
      page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      page.setDefaultTimeout(8000);
      page.on('pageerror', (error) => report.errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') report.errors.push(message.text());
      });
      await page.goto(`${server.resolvedUrls.local[0]}${fixturePath}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForFunction(() => window.practiceHudReview?.ready, undefined, {
        timeout: 30000,
      });
      await page.evaluate(() => document.fonts.ready);
      await check('running same-car session best and measured sectors', async () => {
        const state = await page.evaluate(() => window.practiceHudReview.draw('running'));
        assert.equal(state.practiceVisible, true);
        assert.equal(state.splitCount, 3);
        assert.match(state.practiceText, /SESSION BEST 1:40.00 · SAME CAR/);
        assert.match(state.practiceText, /0:32.00/);
        assert.match(state.practiceText, /−1.33 S/);
        assert.doesNotMatch(state.eventRow, /POSITION/);
        assert.equal(state.liveVisible, true);
        assert.equal(state.liveTrend, 'ahead');
        assert(state.liveDelta < 0);
        assert.match(state.liveText, /AHEAD/);
        assert.equal(state.liveRole, 'timer');
        assert.equal(state.liveAriaLive, 'off');
        assert.match(state.liveAria, /same route position/);
        await screenshot('running-desktop');
        return state;
      });
      for (const mode of ['behind', 'even', 'legacy-reference'])
        await check(`live comparison ${mode}`, async () => {
          const state = await page.evaluate((mode) => window.practiceHudReview.draw(mode), mode);
          if (mode === 'legacy-reference') {
            assert.equal(state.liveVisible, false);
            assert.equal(state.liveDelta, null);
            assert.match(state.practiceText, /NEW CLEAN BEST/);
          } else {
            assert.equal(state.liveVisible, true);
            assert.equal(state.liveTrend, mode);
            assert.match(state.liveText, mode === 'behind' ? /BEHIND/ : /EVEN/);
            if (mode === 'behind') assert(state.liveDelta > 0);
            else assert(Math.abs(state.liveDelta) < 0.005);
          }
          return state;
        });
      await check('first benchmark prompt', async () => {
        const state = await page.evaluate(() => window.practiceHudReview.draw('first-run'));
        assert.match(state.practiceText, /SET YOUR FIRST CLEAN LAP/);
        assert.equal(state.liveVisible, false);
        return state;
      });
      for (const mode of ['offroad', 'autopilot'])
        await check(`invalid ${mode}`, async () => {
          const state = await page.evaluate((mode) => window.practiceHudReview.draw(mode), mode);
          assert.equal(state.state, 'invalid');
          assert.match(state.practiceText, /UNRANKED/);
          assert.match(state.practiceText, mode === 'autopilot' ? /AUTOPILOT/ : /LEFT THE ROUTE/);
          assert.equal(state.acceptedRecord, null);
          assert.equal(state.liveVisible, false);
          return state;
        });
      await check('completed new-best result and retry callback', async () => {
        const state = await page.evaluate(() => window.practiceHudReview.draw('completed'));
        assert.equal(state.resultVisible, true);
        assert.equal(state.practiceVisible, false);
        assert.equal(state.resultRows, 3);
        assert.match(state.resultText, /NEW SESSION BEST/);
        assert.match(state.resultText, /Same car · this Festival session/);
        assert.equal(state.acceptedRecord.time, 96);
        await screenshot('completed-desktop');
        await page.locator('#festResults [data-fest="retry"]').click();
        const after = await page.evaluate(() => window.practiceHudReview.inspect());
        assert.equal(after.actions.at(-1), 'retry:saltmarsh-practice');
        return after;
      });
      await check('invalid completed run never claims a benchmark', async () => {
        const state = await page.evaluate(() =>
          window.practiceHudReview.draw('completed-autopilot'),
        );
        assert.match(state.resultText, /AUTOPILOT · NOT A CLEAN BENCHMARK/);
        assert.doesNotMatch(
          state.resultText,
          /NEW SESSION BEST|TIME NOT SAVED|FIRST CLEAN BENCHMARK SET/,
        );
        assert.equal(state.acceptedRecord, null);
        await screenshot('completed-invalid');
        return state;
      });
      for (const mode of ['menu', 'map', 'photo'])
        await check(`immediate ${mode} suppression`, async () => {
          await page.evaluate(() => window.practiceHudReview.draw('running'));
          const state = await page.evaluate((mode) => window.practiceHudReview.overlay(mode), mode);
          if (state.practiceVisible) await screenshot(`failure-${mode}`);
          assert.equal(state.practiceVisible, false, 'No status tick should be necessary');
          assert.equal(
            state.activeLabel,
            mode === 'menu' ? 'resume' : mode === 'map' ? 'mapClose' : 'photoClose',
          );
          return state;
        });
      for (const [name, width, height] of [
        ['portrait', 390, 844],
        ['compact', 375, 667],
        ['landscape', 844, 390],
      ]) {
        await page.setViewportSize({ width, height });
        for (const mode of ['running', 'autopilot', 'completed'])
          await check(`${name} ${mode} bounds`, async () => {
            const state = await page.evaluate((mode) => window.practiceHudReview.draw(mode), mode);
            inside(
              mode === 'completed' ? state.result : state.event,
              width,
              height,
              `${name} ${mode}`,
            );
            assert.ok(state.pageWidth <= width, 'Page has horizontal overflow');
            if (mode === 'running') inside(state.live, width, height, `${name} live delta`);
            await screenshot(`${name}-${mode}`);
            return state;
          });
      }
      await check('dispose removes HUD', async () => {
        await page.evaluate(() => window.practiceHudReview.dispose());
        assert.equal(await page.locator('#festivalHud').count(), 0);
        return null;
      });
      report.sourceStable =
        JSON.stringify(report.sourceSha256) === JSON.stringify(await hashSources());
      report.passed =
        report.cases.every((entry) => entry.passed) && !report.errors.length && report.sourceStable;
    })(),
    new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('HUD review exceeded 120 seconds')), 120000);
    }),
  ]);
} catch (error) {
  report.errors.push(String(error));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server?.close();
  await writeFile(join(output, 'review.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      cases: report.cases.length,
      failures: report.cases.filter((entry) => !entry.passed),
      errors: report.errors,
      output,
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
