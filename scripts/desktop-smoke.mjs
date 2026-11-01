import {
  graphicsFaults,
  createGraphicsLogScanner,
  observationFaults,
} from '../desktop-dist/graphics-health.js';
import { verifyDesktopCompatibility } from './desktop-compatibility.mjs';
import { createNativeGpuTrace, nativeGpuTraceEnabled } from './native-gpu-trace.mjs';
import {
  nativeGpuServiceApiMode,
  nativeGpuServiceApiArguments,
  nativeGpuServiceApiLaunchReceipt,
  nativeGpuServiceApiManualContext,
  validateNativeGpuServiceApiSource,
  validateNativeGpuServiceApiRuntime,
} from './native-gpu-service-api-mode.mjs';
import {
  NATIVE_PREPARATION_CAPTURE,
  installNativePreparationObserver,
  createNativePreparationSink,
  createNativePreparationWriter,
} from './native-preparation-evidence.mjs';
import {
  desktopSmokeJourney,
  runDesktopSmokeJourneys,
  createFirstGraphicsFault,
  retainNativeSmokeFailure,
  validateNativeAurelSurface,
} from './native-smoke-control.mjs';
import {
  readNativeBabylonReadiness,
  normalizeNativeBabylonReadiness,
  createNativeReadinessHistory,
  preserveNativeFailureWhileObserving,
} from './native-readiness-observation.mjs';
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
const firstGraphicsFault = createFirstGraphicsFault();
const readinessHistory = createNativeReadinessHistory();
let nextReadinessGate = 0;
let activeReadinessGate = null;
const readinessBinding = '__motoboundNativeReadinessObservation';
const readinessFailurePrefix = '__MOTOBOUND_READINESS_OBSERVATION_FAILURE__';
const readinessReaderSource = readNativeBabylonReadiness.toString();
const processScanners = [createGraphicsLogScanner(), createGraphicsLogScanner()];
const graphicsBackend = process.env.MOTOBOUND_CI_GL || 'native';
const graphicsArguments = desktopGraphicsArguments(graphicsBackend, target.platform, target.arch);
const executable = desktopExecutable(target.platform, target.arch);
await mkdir('desktop-evidence', { recursive: true });
const preparationEvidence = createNativePreparationSink();
const preparationWriter = createNativePreparationWriter('desktop-evidence/preparation.json');
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
function diagnosticErrorText(error) {
  try {
    return String(error).slice(0, 256);
  } catch {
    return 'Unprintable readiness observation error';
  }
}
function readinessDiagnosticFailure(phase, error) {
  const failures = (report.readinessObservationErrors ??= []);
  failures.push({ phase, error: diagnosticErrorText(error), hostAtMs: Date.now() });
  if (failures.length > 16) failures.shift();
}
function recordReadiness(phase, sample, hostBefore, hostAfter) {
  try {
    return readinessHistory.record(phase, sample, hostBefore, hostAfter);
  } catch (error) {
    readinessDiagnosticFailure('history-record', error);
    return false;
  }
}
function readinessSnapshot() {
  try {
    return readinessHistory.snapshot();
  } catch (error) {
    readinessDiagnosticFailure('history-snapshot', error);
    return null;
  }
}
function stage(name, qualification = {}) {
  report.babylonReadiness = readinessSnapshot();
  const entry = { name, elapsedMs: Date.now() - startedAt, ...qualification };
  report.stages.push(entry);
  writeFileSync('desktop-evidence/partial.json', JSON.stringify(report, null, 2));
  console.log(`[desktop smoke] ${JSON.stringify(entry)}`);
}
async function observeGraphicsHealth(page, readinessPhase = 'graphics-health') {
  let timer;
  const hostBefore = Date.now();
  try {
    const [processObservation, rendererObservations] = await Promise.race([
      Promise.all([
        application.evaluate(() => globalThis.motoboundProcessGraphicsObservation?.()),
        page.evaluate(`() => ({
          document: window.motoboundGraphicsObservation?.(),
          babylon: window.babylonGraphicsDiagnostics?.(),
          readiness: (() => {
            try { return (${readinessReaderSource})(); }
            catch (error) { return { observationError: (${diagnosticErrorText.toString()})(error) }; }
          })(),
        })`),
      ]),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Graphics health observation exceeded 30000ms')),
          30000,
        );
      }),
    ]);
    recordReadiness(readinessPhase, rendererObservations.readiness, hostBefore, Date.now());
    const documentObservation = rendererObservations.document;
    if (rendererObservations.babylon)
      report.babylonGraphicsObservation = rendererObservations.babylon;
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
    for (const fault of report.graphicsFaults) firstGraphicsFault.record(fault);
  } finally {
    clearTimeout(timer);
  }
  return report.graphicsFaults;
}
async function waitForBabylonPresentation(page) {
  const gateId = ++nextReadinessGate;
  let gate = null;
  try {
    if ((await firstGraphicsFault.wait(() => observeGraphicsHealth(page, 'gate-entry'))).length)
      throw new Error('GPU health failed before paused presentation completion');
    gate = { id: gateId, hostBefore: Date.now(), pollsReceived: 0 };
    activeReadinessGate = gate;
    await firstGraphicsFault.wait(() =>
      page.waitForFunction(
        `({ gateId, binding, failurePrefix }) => {
          const data = document.querySelector('#status')?.dataset;
          const submitted = Number(data?.renderedFrames);
          const completed = Number(data?.completedFrames);
          const ready = (
            data?.presentationSettled === 'true' &&
            Number.isSafeInteger(submitted) &&
            submitted > 0 &&
            completed === submitted
          );
          // Existing console transport is only a fallback for diagnostic errors.
          const observationFailure = (phase, error) => {
            try {
              console.debug(failurePrefix + JSON.stringify({ gateId, phase,
                error: (${diagnosticErrorText.toString()})(error) }));
            } catch { /* Lost observation transport remains unavailable, not a pass. */ }
          };
          // Evidence only: never await transport or let it decide this predicate.
          try {
            const sample = (${readinessReaderSource})();
            if (typeof window[binding] === 'function')
              void window[binding](gateId, sample).catch((error) => observationFailure('binding-rejection', error));
          } catch (error) { observationFailure('poll-capture', error); }
          return ready;
        }`,
        { gateId, binding: readinessBinding, failurePrefix: readinessFailurePrefix },
        { timeout: 30000, polling: 100 },
      ),
    );
  } catch (error) {
    activeReadinessGate = null;
    // Retain what arrived BEFORE failure, even if subsequent screenshot/final
    // collection sees a recovered renderer. No fresh query or new wait is added.
    return preserveNativeFailureWhileObserving(error, () => {
      const snapshot = readinessSnapshot();
      const lastPoll =
        snapshot?.observations.findLast(
          (entry) => entry.phase === 'poll' && entry.sample?.gateId === gateId,
        ) ?? null;
      recordReadiness(
        error?.name === 'TimeoutError' ? 'gate-timeout' : 'gate-failure',
        {
          gateId,
          pollsReceived: gate?.pollsReceived ?? 0,
          sampleSource: lastPoll
            ? 'last-received-poll-not-fresh-at-failure'
            : 'absent-before-failure',
          lastPoll,
        },
        gate?.hostBefore ?? null,
        Date.now(),
      );
    });
  } finally {
    activeReadinessGate = null;
  }
  const receipt = await firstGraphicsFault.wait(() =>
    page.locator('#status').evaluate((element) => ({
      submitted: Number(element.dataset.renderedFrames),
      completed: Number(element.dataset.completedFrames),
      settled: element.dataset.presentationSettled,
      surface: {
        kind: element.dataset.surfaceKind,
        roadChunks: element.dataset.surfaceRoadChunks,
        paintChunks: element.dataset.surfacePaintChunks,
        leftPaintChunks: element.dataset.surfaceLeftPaintChunks,
        rightPaintChunks: element.dataset.surfaceRightPaintChunks,
        vertices: element.dataset.surfaceVertices,
        paintFinishMaterials: element.dataset.surfacePaintFinishMaterials,
        asphaltSubstrateRoadChunks: element.dataset.surfaceAsphaltSubstrateRoadChunks,
        asphaltSubstrateMaterials: element.dataset.surfaceAsphaltSubstrateMaterials,
        asphaltSubstrateTextures: element.dataset.surfaceAsphaltSubstrateTextures,
        asphaltSubstrateSrgbTextures: element.dataset.surfaceAsphaltSubstrateSrgbTextures,
        formulaGroundingRoadChunks: element.dataset.surfaceFormulaGroundingRoadChunks,
        formulaGroundingPaintChunks: element.dataset.surfaceFormulaGroundingPaintChunks,
        formulaGroundingMaterials: element.dataset.surfaceFormulaGroundingMaterials,
        formulaGroundingCars: element.dataset.surfaceFormulaGroundingCars,
        lampState: element.dataset.lampState,
        lampParts: element.dataset.lampParts,
        lampMaterials: element.dataset.lampMaterials,
        lampTriangles: element.dataset.lampTriangles,
        lampLights: element.dataset.lampLights,
        gantryState: element.dataset.gantryState,
        gantryParts: element.dataset.gantryParts,
        gantryMaterials: element.dataset.gantryMaterials,
        gantryTextures: element.dataset.gantryTextures,
        gantryTriangles: element.dataset.gantryTriangles,
        gantrySha256: element.dataset.gantrySha256,
        coarseMeshes: element.dataset.surfaceCoarseMeshes,
      },
    })),
  );
  (report.babylonPresentationReceipts ??= []).push(receipt);
  report.formulaSurface = validateNativeAurelSurface(receipt.surface);
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
let application, page, gpuTrace;
try {
  const journey = desktopSmokeJourney(process.env.MOTOBOUND_SMOKE_JOURNEY ?? 'full');
  const traceEnabled = nativeGpuTraceEnabled(process.env.MOTOBOUND_GPU_TRACE ?? '0');
  if (traceEnabled && journey.diagnosticOnly)
    throw new Error('GPU trace requires the unchanged full Babylon model journey');
  const serviceApiMode = nativeGpuServiceApiMode(
    process.env.MOTOBOUND_GPU_SERVICE_API_TRACE ?? 'off',
  );
  const serviceApiOptions = {
    mode: serviceApiMode,
    traceEnabled,
    platform: target.platform,
    arch: target.arch,
    hostArch: target.hostArch,
    graphicsBackend,
    journey: process.env.MOTOBOUND_SMOKE_JOURNEY ?? 'full',
    manualNonpublishing: nativeGpuServiceApiManualContext(process.env),
  };
  const serviceApiArguments = nativeGpuServiceApiArguments(serviceApiOptions);
  const serviceApiLaunch = nativeGpuServiceApiLaunchReceipt(serviceApiOptions);
  validateNativeGpuServiceApiSource(serviceApiMode, report.source);
  if (serviceApiLaunch) report.serviceApiLaunch = serviceApiLaunch;
  report.smokeJourney = journey;
  if (report.source.arch !== target.arch || report.source.platform !== target.platform)
    throw new Error('Build receipt does not match the requested package target');
  stage('launch');
  application = await electron.launch({
    executablePath: resolve(executable),
    args: [
      `--user-data-dir=${profile}`,
      '--enable-logging=stderr',
      ...graphicsArguments,
      ...serviceApiArguments,
    ],
    timeout: 120000,
  });
  stage('electron-connected');
  [application.process().stdout, application.process().stderr].forEach((stream, index) =>
    stream?.on('data', (data) => {
      const chunk = String(data);
      processScanners[index].push(chunk);
      for (const fault of processScanners[index].faults()) firstGraphicsFault.record(fault);
      report.processLog.push(chunk.slice(0, 8000));
      if (report.processLog.length > 128) report.processLog.shift();
    }),
  );
  report.runtime = await application.evaluate(({ app }) => ({
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    translated: app.runningUnderARM64Translation,
  }));
  validateNativeGpuServiceApiRuntime(serviceApiMode, report.runtime);
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
  try {
    await page.exposeBinding(readinessBinding, (source, gateId, sample) => {
      const gate = activeReadinessGate;
      if (!gate || gate.id !== gateId || source.frame !== page.mainFrame()) return;
      gate.pollsReceived++;
      // Wide, explicit clock bracket: host wait invocation -> transport arrival.
      // It is not a claim that a host timestamp equals the renderer sample time.
      const observation = normalizeNativeBabylonReadiness(sample);
      if (!observation) {
        recordReadiness(
          'poll-observation-failure',
          { gateId, error: 'Malformed readiness packet' },
          gate.hostBefore,
          Date.now(),
        );
        return;
      }
      recordReadiness('poll', { gateId, observation }, gate.hostBefore, Date.now());
    });
    report.readinessObservationTransport = { installed: true };
  } catch (error) {
    report.readinessObservationTransport = { installed: false };
    recordReadiness(
      'observer-install-failure',
      { error: diagnosticErrorText(error) },
      null,
      Date.now(),
    );
  }
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
    if (entry.text.startsWith(readinessFailurePrefix)) {
      // Fixed-schema diagnostic messages never become graphics/runtime failures.
      try {
        if (entry.text.length > readinessFailurePrefix.length + 1024) return;
        const failure = JSON.parse(entry.text.slice(readinessFailurePrefix.length));
        if (
          Number.isSafeInteger(failure.gateId) &&
          failure.gateId > 0 &&
          failure.gateId <= nextReadinessGate &&
          ['binding-rejection', 'poll-capture'].includes(failure.phase) &&
          typeof failure.error === 'string'
        )
          recordReadiness(
            'poll-observation-failure',
            {
              gateId: failure.gateId,
              phase: failure.phase,
              error: failure.error.slice(0, 256),
              delivery:
                activeReadinessGate?.id === failure.gateId ? 'active-gate' : 'late-for-closed-gate',
            },
            activeReadinessGate?.id === failure.gateId ? activeReadinessGate.hostBefore : null,
            Date.now(),
          );
      } catch {
        /* Malformed diagnostic packets cannot alter journey outcome. */
      }
      return;
    }
    // Parse the full packet before the generic console's 2048-character cap.
    // The separate Node-owned JSON survives a blocked or disposed renderer.
    const preparationPacket = preparationEvidence.consume(entry.text);
    if (preparationPacket) {
      report.preparationEvidence = preparationEvidence.snapshot();
      preparationWriter.update(report.preparationEvidence);
    }
    // Faults are sticky even when routine console diagnostics roll over.
    const faults = graphicsFaults([], [entry], 0);
    for (const fault of faults) firstGraphicsFault.record(fault);
    if (consoleGraphicsFaults.size < 32 && faults.length)
      consoleGraphicsFaults.add(entry.text.slice(0, 2048));
    if (preparationPacket) return;
    report.console.push({ ...entry, text: entry.text.slice(0, 2048) });
    if (report.console.length > 128) report.console.shift();
  });
  await page.addInitScript(installNativePreparationObserver, NATIVE_PREPARATION_CAPTURE);
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
  stage('babylon-ready', {
    scope: 'simulation-entry-started',
    environmentReadiness: 'not-asserted',
  });
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
  await waitForBabylonPresentation(page);
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
  await waitForBabylonPresentation(page);
  const pausedStatus = await page.locator('#status').textContent();
  await page.waitForTimeout(300); // Explicit observation window for a frozen physics tick.
  if ((await page.locator('#status').textContent()) !== pausedStatus)
    throw new Error('Physics advanced while the desktop game was paused');
  gpuTrace = createNativeGpuTrace({
    enabled: traceEnabled,
    serviceApiMode,
    source: report.source,
    firstFault: firstGraphicsFault,
    onOperationFailure: (error) => retainNativeSmokeFailure(report, error, firstGraphicsFault),
    path: join(profile, 'gpu-trace-raw.pftrace'),
    outputPath: resolve('desktop-evidence/gpu-trace-summary.json'),
    parserPath: process.env.MOTOBOUND_TRACE_PROCESSOR,
    adapter: {
      categories: () =>
        application.evaluate(({ contentTracing }) => contentTracing.getCategories()),
      start: (config) =>
        application.evaluate(
          ({ contentTracing }, options) => contentTracing.startRecording(options),
          config,
        ),
      stop: (path) =>
        application.evaluate(
          ({ contentTracing }, target) => contentTracing.stopRecording(target),
          path,
        ),
    },
  });
  report.gpuTrace = gpuTrace.receipt;
  await runDesktopSmokeJourneys(journey, {
    authoredModel: () =>
      gpuTrace.run(async () => {
        await page
          .getByRole('button', { name: 'Inspect existing Formula asset (35 MB)', exact: true })
          .click();
        await page.waitForFunction(
          () => {
            const text = document.querySelector('#assetStatus')?.textContent ?? '';
            return (
              text.includes('Original Formula asset loaded') || text.includes('Model unavailable')
            );
          },
          {},
          { timeout: 120000, polling: 100 },
        );
        report.assetStatus = await page.locator('#assetStatus').textContent();
        if (!report.assetStatus?.includes('Original Formula asset loaded'))
          throw new Error(report.assetStatus || 'The packaged model did not load');
        report.checks.push('original bundled Formula model imports through the offline protocol');
        const heightCount = await page
          .locator('#assetStatus')
          .getAttribute('data-scalar-height-materials');
        report.scalarHeight = { enabledMaterials: Number(heightCount) };
        if (heightCount !== '10')
          throw new Error('The original model did not retain ten enabled scalar-height materials');
        report.checks.push('ten source-bound scalar-height materials enabled before presentation');
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
        report.checks.push(
          'diagnostic panel preserves the central driving view and touch controls',
        );
        const wheelPhase = await page.locator('#assetStatus').getAttribute('data-wheel-phase');
        if (wheelPhase === null || !Number.isFinite(Number(wheelPhase)))
          throw new Error('Imported wheel adapter did not publish an applied rotation');
        await resume.click();
        await page.keyboard.down('w');
        try {
          await page.waitForFunction(
            (initial) => {
              const value = document
                .querySelector('#assetStatus')
                ?.getAttribute('data-wheel-phase');
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
        await waitForBabylonPresentation(page);
        const frozenWheel = await page.locator('#assetStatus').getAttribute('data-wheel-phase');
        await page.waitForTimeout(300);
        if ((await page.locator('#assetStatus').getAttribute('data-wheel-phase')) !== frozenWheel)
          throw new Error('Authored wheel rotation changed while paused');
        report.checks.push(
          'applied authored wheel rotation moves during simulation and freezes during pause',
        );
        stage('wheel-motion-passed');
      }),
    captureBabylon: async () => {
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
    },
    compatibility: () =>
      verifyDesktopCompatibility(application, page, report, captureChecked, stage),
  });
  if ((await observeGraphicsHealth(page)).length)
    throw new Error('GPU health failed during the installed-game journeys');
  if (report.errors.length || report.remoteRequests.length || report.assetFailures.length)
    throw new Error('Unexpected renderer errors, asset failures or remote runtime requests');
  report.success = true;
} catch (error) {
  retainNativeSmokeFailure(report, error, firstGraphicsFault);
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
      if ((await observeGraphicsHealth(page, 'final-collection')).length && report.success) {
        retainNativeSmokeFailure(
          report,
          new Error('GPU health failed at final evidence collection'),
          firstGraphicsFault,
        );
        process.exitCode = 1;
      }
    } catch (error) {
      report.graphicsObservationError = String(error);
      if (report.success) {
        retainNativeSmokeFailure(
          report,
          new Error('Final graphics health could not be observed'),
          firstGraphicsFault,
        );
        process.exitCode = 1;
      }
    }
  }
  report.babylonReadiness = readinessSnapshot();
  report.preparationEvidence = preparationEvidence.snapshot();
  gpuTrace?.finalize();
  report.firstGraphicsFault = firstGraphicsFault.read()?.message ?? null;
  preparationWriter.update(report.preparationEvidence);
  const preparationWriteError = await preparationWriter.flush();
  if (preparationWriteError) report.preparationEvidenceWriteError = preparationWriteError;
  await writeFile('desktop-evidence/report.json', JSON.stringify(report, null, 2) + '\n');
  let producerClosed = !application;
  try {
    await application?.close();
    producerClosed = true;
  } finally {
    if (gpuTrace?.receipt.enabled) {
      const cleanup = gpuTrace.cleanup({ producerClosed });
      // Constant fields only, separate from the original pre-close failure.
      await writeFile(
        'desktop-evidence/gpu-trace-cleanup.json',
        JSON.stringify(cleanup) + '\n',
      ).catch(() => {});
    }
  }
}
