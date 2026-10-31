import {
  graphicsFaults,
  createGraphicsLogScanner,
  observationFaults,
} from '../desktop-dist/graphics-health.js';
import { verifyDesktopCompatibility } from './desktop-compatibility.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  desktopTarget,
  desktopExecutable,
  desktopGraphicsArguments,
} from '../desktop-dist/target.js';
const target = desktopTarget(process.platform, process.arch, process.env.MOTOBOUND_TARGET_ARCH);
const startedAt = Date.now();
const consoleGraphicsFaults = new Set();
const processScanners = [createGraphicsLogScanner(), createGraphicsLogScanner()];
const graphicsBackend = process.env.MOTOBOUND_CI_GL || 'native';
const graphicsArguments = desktopGraphicsArguments(graphicsBackend, target.platform, target.arch);
const executable = desktopExecutable(target.platform, target.arch);
await mkdir('desktop-evidence', { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'motobound-smoke-'));
const report = {
  ...target,
  executable,
  graphicsBackend,
  source: JSON.parse(await readFile('desktop-stage/DESKTOP_BUILD.json', 'utf8')),
  checks: [],
  stages: [],
  console: [],
  processLog: [],
  errors: [],
  remoteRequests: [],
  assetFailures: [],
  graphicsFaults: [],
  contextLosses: 0,
};
function stage(name) {
  const entry = { name, elapsedMs: Date.now() - startedAt };
  report.stages.push(entry);
  writeFileSync('desktop-evidence/partial.json', JSON.stringify(report, null, 2));
  console.log(`[desktop smoke] ${JSON.stringify(entry)}`);
}
async function observeGraphicsHealth(page) {
  let timer;
  try {
    const [processObservation, documentObservation] = await Promise.race([
      Promise.all([
        application.evaluate(() => globalThis.motoboundProcessGraphicsObservation?.()),
        page.evaluate(() => window.motoboundGraphicsObservation?.()),
      ]),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Graphics health observation exceeded 30000ms')),
          30000,
        );
      }),
    ]);
    report.processGraphicsObservation = processObservation;
    report.documentGraphicsObservation = documentObservation;
    report.contextLosses = documentObservation?.documents?.reduce(
      (sum, doc) => sum + doc.losses,
      0,
    );
    report.graphicsFaults = [
      ...new Set([
        ...observationFaults(processObservation, documentObservation),
        ...consoleGraphicsFaults,
        ...graphicsFaults([], report.console, report.contextLosses),
        ...processScanners.flatMap((scanner) => scanner.faults()),
      ]),
    ];
  } finally {
    clearTimeout(timer);
  }
  return report.graphicsFaults;
}
async function captureChecked(page, path) {
  if ((await observeGraphicsHealth(page)).length)
    throw new Error('GPU health failed before capture');
  await captureViewport(page, path);
  if ((await observeGraphicsHealth(page)).length)
    throw new Error('GPU health failed during capture');
}
async function captureViewport(page, path) {
  const session = await page.context().newCDPSession(page);
  let timer;
  try {
    // Capture the already rendered surface, as the existing production
    // visual tests do. Avoid page-wide font/style/caret preparation on a
    // busy software GPU. Keep the same bounded 30-second capture budget.
    const result = await Promise.race([
      session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
        optimizeForSpeed: true,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Native viewport capture exceeded 30000 ms')),
          30000,
        );
      }),
    ]);
    const png = Buffer.from(result.data, 'base64');
    if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
      throw new Error('Native viewport capture did not produce a PNG');
    await writeFile(path, png);
  } finally {
    clearTimeout(timer);
    await session.detach();
  }
}
let application, page;
try {
  if (report.source.arch !== target.arch || report.source.platform !== target.platform)
    throw new Error('Build receipt does not match the requested package target');
  stage('launch');
  application = await electron.launch({
    executablePath: resolve(executable),
    args: [`--user-data-dir=${profile}`, '--enable-logging=stderr', ...graphicsArguments],
    timeout: 120000,
  });
  stage('electron-connected');
  [application.process().stdout, application.process().stderr].forEach((stream, index) =>
    stream?.on('data', (data) => {
      const chunk = String(data);
      processScanners[index].push(chunk);
      report.processLog.push(chunk.slice(0, 8000));
      if (report.processLog.length > 128) report.processLog.shift();
    }),
  );
  report.runtime = await application.evaluate(({ app }) => ({
    platform: process.platform,
    arch: process.arch,
    translated: app.runningUnderARM64Translation,
  }));
  if (report.runtime.arch !== target.arch || report.runtime.platform !== target.platform)
    throw new Error('Packaged process architecture does not match its target');
  if (
    target.platform === 'darwin' &&
    target.hostArch === 'arm64' &&
    target.arch === 'x64' &&
    !report.runtime.translated
  )
    throw new Error('Expected an x64 process under Rosetta, not an arm64 replacement');
  report.checks.push('packaged process architecture matches target');
  report.gpu = await application.evaluate(({ app }) => app.getGPUFeatureStatus());
  page = await application.firstWindow({ timeout: 120000 });
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(120000);
  stage('window-created');
  // A hidden ready-to-show window must not be required to produce the frame
  // that makes it visible. Show it before the existing startup deadline.
  report.initialWindow = await application.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.show();
    app.focus({ steal: true });
    window.focus();
    return { visible: window.isVisible(), focused: window.isFocused() };
  });
  await page.bringToFront();
  if (process.env.GITHUB_ACTIONS === 'true' && report.runtime.translated) {
    // Rosetta's directly launched window may be backgrounded by the hosted
    // desktop. Keep foreground test scheduling without changing the package
    // or disabling its focus-loss pause logic. All real input checks remain.
    report.testScheduling = await application.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const previous = contents.getBackgroundThrottling();
      contents.setBackgroundThrottling(false);
      return {
        previousBackgroundThrottling: previous,
        backgroundThrottling: contents.getBackgroundThrottling(),
      };
    });
  }
  page.on('console', (message) => {
    const entry = { type: message.type(), text: message.text() };
    // Faults are sticky even when routine console diagnostics roll over.
    if (consoleGraphicsFaults.size < 32 && graphicsFaults([], [entry], 0).length)
      consoleGraphicsFaults.add(entry.text.slice(0, 2048));
    report.console.push({ ...entry, text: entry.text.slice(0, 2048) });
    if (report.console.length > 128) report.console.shift();
  });
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  page.on('response', (response) => {
    if (response.status() >= 400)
      report.assetFailures.push({ url: response.url(), status: response.status() });
  });
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText;
    // Navigation can intentionally cancel obsolete loads; retain other failures.
    if (error !== 'net::ERR_ABORTED') report.assetFailures.push({ url: request.url(), error });
  });
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.remoteRequests.push(request.url());
  });
  await page.waitForURL('motobound://game/babylon.html', { timeout: 120000 });
  stage('document-loaded');
  report.startupObservation = await page.evaluate(() => ({
    text: document.querySelector('#status')?.textContent,
    readyState: document.readyState,
    hidden: document.hidden,
  }));
  await page.waitForFunction(
    () =>
      /DRIVING|PAUSED|could not start/.test(document.querySelector('#status')?.textContent ?? ''),
    {},
    { timeout: 120000, polling: 100 },
  );
  report.initialStatus = await page.locator('#status').textContent();
  if (!/DRIVING|PAUSED/.test(report.initialStatus ?? ''))
    throw new Error(report.initialStatus || 'Babylon did not start');
  report.renderer = await page.evaluate(() => {
    const canvas = document.querySelector('#game');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
  });
  if (process.env.MOTOBOUND_CI_GL === 'mesa' && !/llvmpipe/i.test(report.renderer ?? ''))
    throw new Error(`Requested Mesa CI renderer, received ${report.renderer}`);
  if (graphicsBackend === 'swiftshader' && !/swiftshader/i.test(report.renderer ?? ''))
    throw new Error(`Requested SwiftShader driver, received ${report.renderer}`);
  report.checks.push('packaged offline Babylon entry started');
  stage('babylon-ready');
  // A directly launched macOS bundle can remain behind the runner's desktop.
  // Activate it before testing real pointer/keyboard input and RAF stability.
  report.windowFocus = await application.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    const window = BrowserWindow.getAllWindows()[0];
    window.show();
    window.focus();
    return window.isFocused();
  });
  await page.bringToFront();
  report.windowFocus = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].isFocused(),
  );
  report.documentFocus = await page.evaluate(() => ({
    focused: document.hasFocus(),
    hidden: document.hidden,
  }));

  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('#status')?.textContent?.includes('PAUSED'),
  );
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('#status')?.textContent?.includes('DRIVING'),
  );
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  report.checks.push('pause/resume/restart');
  stage('lifecycle-passed');
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(
      () => {
        const speed = document.querySelector('#status')?.textContent?.match(/(\d+) km\/h/);
        return speed && Number(speed[1]) > 5;
      },
      {},
      { timeout: 30000, polling: 100 },
    );
  } finally {
    await page.keyboard.up('w');
  }
  report.checks.push('native keyboard drives the existing simulation');
  stage('keyboard-passed');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('#status')?.textContent?.includes('PAUSED'),
  );
  const pausedStatus = await page.locator('#status').textContent();
  await page.waitForTimeout(300); // Explicit observation window for a frozen physics tick.
  if ((await page.locator('#status').textContent()) !== pausedStatus)
    throw new Error('Physics advanced while the desktop game was paused');
  await page
    .getByRole('button', { name: 'Inspect existing Formula asset (35 MB)', exact: true })
    .click();
  await page.waitForFunction(
    () => {
      const text = document.querySelector('#assetStatus')?.textContent ?? '';
      return text.includes('Original Formula asset loaded') || text.includes('Model unavailable');
    },
    {},
    { timeout: 120000, polling: 100 },
  );
  report.assetStatus = await page.locator('#assetStatus').textContent();
  if (!report.assetStatus?.includes('Original Formula asset loaded'))
    throw new Error(report.assetStatus || 'The packaged model did not load');
  report.checks.push('original bundled Formula model imports through the offline protocol');
  stage('model-presented');
  report.drivingView = await page.evaluate(() => {
    const panel = document.querySelector('#panel').getBoundingClientRect();
    const controls = document.querySelector('#touchDrive').getBoundingClientRect();
    return {
      panelRight: panel.right,
      panelBottom: panel.bottom,
      controlsTop: controls.top,
      width: innerWidth,
    };
  });
  if (
    report.drivingView.panelRight >= report.drivingView.width * 0.45 ||
    report.drivingView.panelBottom >= report.drivingView.controlsTop
  )
    throw new Error('Diagnostic panel obscures the central driving view or touch controls');
  report.checks.push('diagnostic panel preserves the central driving view and touch controls');
  const wheelPhase = await page.locator('#assetStatus').getAttribute('data-wheel-phase');
  if (wheelPhase === null || !Number.isFinite(Number(wheelPhase)))
    throw new Error('Imported wheel adapter did not publish an applied rotation');
  await resume.click();
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(
      (initial) => {
        const value = document.querySelector('#assetStatus')?.getAttribute('data-wheel-phase');
        if (value == null || !Number.isFinite(Number(value))) return false;
        const delta = Number(value) - initial;
        return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) > 0.1;
      },
      Number(wheelPhase),
      { timeout: 15000, polling: 100 },
    );
  } finally {
    await page.keyboard.up('w');
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('#status')?.textContent?.includes('PAUSED'),
  );
  const frozenWheel = await page.locator('#assetStatus').getAttribute('data-wheel-phase');
  await page.waitForTimeout(300);
  if ((await page.locator('#assetStatus').getAttribute('data-wheel-phase')) !== frozenWheel)
    throw new Error('Authored wheel rotation changed while paused');
  report.checks.push(
    'applied authored wheel rotation moves during simulation and freezes during pause',
  );
  stage('wheel-motion-passed');
  const preferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  if (
    !preferences.contextIsolation ||
    !preferences.sandbox ||
    preferences.nodeIntegration ||
    preferences.webSecurity === false
  )
    throw new Error('Desktop renderer isolation is not active');
  report.checks.push('sandbox/context isolation active, Node integration disabled');
  report.gpu = await application.evaluate(({ app }) => app.getGPUFeatureStatus());
  stage('capturing');
  await captureChecked(page, 'desktop-evidence/packaged-babylon.png');
  stage('capture-passed');
  await verifyDesktopCompatibility(application, page, report, captureChecked, stage);
  if ((await observeGraphicsHealth(page)).length)
    throw new Error('GPU health failed during the installed-game journeys');
  if (report.errors.length || report.remoteRequests.length || report.assetFailures.length)
    throw new Error('Unexpected renderer errors, asset failures or remote runtime requests');
  report.success = true;
} catch (error) {
  report.success = false;
  report.failure = String(error);
  stage('failed');
  console.error(report.failure);
  try {
    if (page) await captureViewport(page, 'desktop-evidence/failure.png');
  } catch {
    // A failed launch may not have produced a renderer to capture.
  }
  process.exitCode = 1;
} finally {
  if (page) {
    try {
      if ((await observeGraphicsHealth(page)).length && report.success) {
        report.success = false;
        report.failure = 'GPU health failed at final evidence collection';
        process.exitCode = 1;
      }
    } catch (error) {
      report.graphicsObservationError = String(error);
      if (report.success) {
        report.success = false;
        report.failure = 'Final graphics health could not be observed';
        process.exitCode = 1;
      }
    }
  }
  await writeFile('desktop-evidence/report.json', JSON.stringify(report, null, 2) + '\n');
  await application?.close();
}
