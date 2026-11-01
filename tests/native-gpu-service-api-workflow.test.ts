import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NATIVE_GPU_TRACE } from '../scripts/native-gpu-trace.mjs';
import { NATIVE_TRACE_PROCESSOR } from '../scripts/native-gpu-trace-summary.mjs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = (name: string) => read(`.github/workflows/${name}`);
const platform = workflow('desktop-platform.yml');
const diagnostic = workflow('desktop-gpu-service-api-review.yml');
const harness = read('scripts/desktop-smoke.mjs');
const step = (name: string) => platform.split(`name: ${name}\n`)[1]?.split('      - ')[0];

describe('manual-only nonpublishing service API diagnostic workflow', () => {
  it('removes temporary push launch code while retaining historical evidence validation', () => {
    for (const source of [
      diagnostic,
      harness,
      read('scripts/native-gpu-service-api-mode.mjs'),
      read('scripts/native-gpu-service-api-mode.d.mts'),
    ])
      expect(source).not.toMatch(
        /ONE_SHOT|oneShotPushNonpublishing|OneShotPushContext|ServiceApiAuthorization|GITHUB_EVENT_PATH|8dc45f7a|b3a0cc29a78f03ac019e701592b4788d468f124e/,
      );
    // Historical v3 receipts remain independently verifiable; parsing an old
    // receipt is not a launch authorization. Dual-receipt tests exercise it.
    expect(read('scripts/native-gpu-trace.mjs')).toContain('oneShotPushNonpublishing');
  });

  it('defaults every reusable invocation to off while retaining the original trace selector', () => {
    expect(platform).toMatch(
      /gpu_service_api_trace:\n\s+required: false\n\s+type: string\n\s+default: 'off'/,
    );
    expect(platform).toContain(
      'MOTOBOUND_GPU_SERVICE_API_TRACE: ${{ inputs.gpu_service_api_trace }}',
    );
    expect(platform).toMatch(/gpu_trace:\n\s+required: false\n\s+type: boolean\n\s+default: false/);
    expect(platform).toContain("MOTOBOUND_GPU_TRACE: ${{ inputs.gpu_trace && '1' || '0' }}");
  });

  it('offers only a fixed manual Linux x64 Mesa full-journey diagnostic', () => {
    expect(diagnostic).toMatch(/on:\n {2}workflow_dispatch:\npermissions:\n {2}contents: read/);
    expect(diagnostic).not.toMatch(/\b(push|pull_request|schedule|workflow_call|inputs):/);
    expect(diagnostic).toContain('uses: ./.github/workflows/desktop-platform.yml');
    for (const setting of [
      'runner: ubuntu-22.04',
      'target: linux',
      'arch: x64',
      'linux_graphics: mesa',
      'smoke_journey: full',
      'gpu_trace: true',
      'gpu_service_api_trace: service-api-boundary-v1',
    ])
      expect(diagnostic).toContain(setting);
    expect(diagnostic.match(/uses: \.\/.github\/workflows\/desktop-platform.yml/g)).toHaveLength(1);
    expect(diagnostic).not.toMatch(
      /contents: write|needs:|publish-development|continue-on-error|desktop-out|desktop-checksums/,
    );
  });

  it('never opts required or existing diagnostic workflows into the new instrumentation', () => {
    for (const name of readdirSync(new URL('../.github/workflows/', import.meta.url))) {
      if (
        !name.endsWith('.yml') ||
        ['desktop-platform.yml', 'desktop-gpu-service-api-review.yml'].includes(name)
      )
        continue;
      expect(workflow(name), name).not.toMatch(
        /gpu_service_api_trace|MOTOBOUND_GPU_SERVICE_API_TRACE|enable-gpu-service-tracing|service-api-boundary-v1/,
      );
    }
    const required = workflow('desktop-build.yml');
    expect(required).toContain('needs: build');
    expect(required).toContain('fail-fast: false');
    expect(required).not.toContain('service-api-mesa');
    expect(workflow('desktop-linux-driver-review.yml')).toContain('gpu_trace: true');
    expect(workflow('desktop-linux-driver-review.yml')).toContain('push:');
  });

  it('rejects incompatible non-off selections before installing dependencies or packaging', () => {
    const name = 'Validate GPU service API diagnostic selection';
    const guard = step(name);
    expect(guard).not.toContain('if:');
    expect(guard).toContain('MOTOBOUND_PACKAGE_TARGET: ${{ inputs.target }}');
    expect(guard).toContain('MOTOBOUND_CI_GL: ${{ inputs.linux_graphics }}');
    expect(guard).toContain('set -euo pipefail');
    expect(guard).toContain(
      'if test "$MOTOBOUND_GPU_SERVICE_API_TRACE" = off; then\n            exit 0\n          fi',
    );
    expect(guard).toContain('test "$MOTOBOUND_PACKAGE_TARGET" = linux');
    expect(guard).toContain('node scripts/native-gpu-service-api-mode.mjs --validate');
    expect(platform.indexOf(`name: ${name}`)).toBeLessThan(platform.indexOf('run: npm ci'));
    expect(platform.indexOf(`name: ${name}`)).toBeLessThan(
      platform.indexOf('npm run desktop:package'),
    );
    expect(guard).not.toMatch(/continue-on-error|\|\| true/);
  });

  it('excludes checksums and installer uploads even for an invalid non-off selector', () => {
    for (const name of [
      'Record package checksums and exact source',
      'Upload development installers',
    ])
      expect(step(name)).toContain(
        "if: inputs.smoke_journey == 'full' && !inputs.gpu_trace && inputs.gpu_service_api_trace == 'off'",
      );
    expect(step('Build the bundled offline desktop game')).toContain('--publish never');
    expect(step('Preserve native launch evidence')).toContain('if: always()');
    expect(step('Preserve native launch evidence')).toContain('path: desktop-evidence/');
    expect(step('Preserve native launch evidence')).toContain(
      "${{ inputs.gpu_service_api_trace != 'off' && '-service-api-boundary-v1' || '' }}",
    );
    expect(platform).not.toMatch(/path:.*(profile|gpu-trace-raw|pftrace|RUNNER_TEMP)/);
  });

  it('runs the default-off and workflow contracts without removing existing coverage', () => {
    const contracts = step('Validate desktop isolation and engine contracts');
    expect(contracts).toContain('run: npm test -- ');
    for (const name of [
      'native-gpu-service-api-mode',
      'native-gpu-service-api-summary',
      'native-gpu-service-api-workflow',
      'native-gpu-trace',
      'native-gpu-trace-summary',
      'native-gpu-trace-workflow',
      'native-smoke-control',
      'native-preparation-evidence',
      'desktop-policy',
      'desktop-target',
      'circuit-ribbon-data',
    ])
      expect(contracts).toContain(`tests/${name}.test.ts`);
    expect(contracts).toContain('tests/babylon-*.test.ts');
    const selectors = contracts!.match(/tests\/\S+\.test\.ts/g)!;
    expect(new Set(selectors).size).toBe(selectors.length);
    expect(contracts).not.toMatch(/--exclude|--passWithNoTests|--ignore-scripts/);
  });

  it('requires the real pinned parser fixtures only in the new mode before launching', () => {
    const name = 'Validate real offline GPU service API parser fixtures (diagnostic only)';
    const fixtures = step(name);
    expect(fixtures).toContain(
      "if: inputs.gpu_trace && inputs.gpu_service_api_trace == 'service-api-boundary-v1'",
    );
    expect(fixtures).toContain("MOTOBOUND_TRACE_PARSER_REQUIRED: '1'");
    expect(fixtures).toContain('run: npm test -- tests/native-gpu-service-api-parser.test.ts');
    expect(fixtures).not.toMatch(/continue-on-error|\|\| true/);
    expect(platform.indexOf(`name: ${name}`)).toBeGreaterThan(
      platform.indexOf('name: Acquire SHA-pinned offline GPU trace parser (diagnostic only)'),
    );
    expect(platform.indexOf(`name: ${name}`)).toBeLessThan(
      platform.indexOf('name: Launch the packaged Linux executable'),
    );
    const baseline = step('Validate real offline GPU trace parser fixtures (diagnostic only)');
    expect(baseline).toContain('if: inputs.gpu_trace');
    expect(baseline).toContain("MOTOBOUND_TRACE_PARSER_REQUIRED: '1'");
    expect(baseline).toContain('run: npm test -- tests/native-gpu-trace-parser.test.ts');
    expect(baseline).not.toContain('gpu_service_api_trace');
    expect(step('Validate desktop isolation and engine contracts')).not.toContain(
      'tests/native-gpu-service-api-parser.test.ts',
    );
  });
});

describe('service API launch wiring preserves the existing native experiment', () => {
  it('validates before Electron launch and adds guard facts only when the mode is on', () => {
    const selector = harness.indexOf('const serviceApiMode = nativeGpuServiceApiMode(');
    const launch = harness.indexOf('application = await electron.launch(');
    expect(selector).toBeGreaterThan(-1);
    expect(selector).toBeLessThan(launch);
    expect(harness.slice(selector, launch)).toContain(
      "process.env.MOTOBOUND_GPU_SERVICE_API_TRACE ?? 'off'",
    );
    for (const binding of [
      'mode: serviceApiMode',
      'traceEnabled,',
      'platform: target.platform',
      'arch: target.arch',
      'hostArch: target.hostArch',
      'graphicsBackend,',
      "journey: process.env.MOTOBOUND_SMOKE_JOURNEY ?? 'full'",
      'manualNonpublishing: nativeGpuServiceApiManualContext(process.env)',
      'const serviceApiArguments = nativeGpuServiceApiArguments(serviceApiOptions)',
      'const serviceApiLaunch = nativeGpuServiceApiLaunchReceipt(serviceApiOptions)',
      'validateNativeGpuServiceApiSource(serviceApiMode, report.source)',
      'if (serviceApiLaunch) report.serviceApiLaunch = serviceApiLaunch',
    ])
      expect(harness.slice(selector, launch)).toContain(binding);
    expect(harness.slice(launch, harness.indexOf("stage('electron-connected')"))).toContain(
      '...serviceApiArguments',
    );
    expect(harness).toContain(
      'createNativeGpuTrace({\n    enabled: traceEnabled,\n    serviceApiMode,',
    );
    expect(harness).toContain('report.gpuTrace = gpuTrace.receipt');
    expect(harness).not.toContain('--enable-gpu-service-tracing');
  });

  it('checks the already-observed runtime pin before the trace or renderer work', () => {
    const observation = harness.indexOf('report.runtime = await application.evaluate(');
    const guard = harness.indexOf(
      'validateNativeGpuServiceApiRuntime(serviceApiMode, report.runtime)',
    );
    expect(observation).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(observation);
    expect(guard).toBeLessThan(harness.indexOf('application.firstWindow('));
    expect(guard).toBeLessThan(harness.indexOf('gpuTrace = createNativeGpuTrace('));
    expect(harness.slice(observation, guard)).toContain('electron: process.versions.electron');
    expect(harness.slice(observation, guard)).toContain('chromium: process.versions.chrome');
  });

  it('keeps raw captures private with unchanged parser and post-launch validation paths', () => {
    expect(harness).toContain("path: join(profile, 'gpu-trace-raw.pftrace')");
    expect(harness).toContain("outputPath: resolve('desktop-evidence/gpu-trace-summary.json')");
    expect(harness).toContain("mkdtemp(join(tmpdir(), 'motobound-smoke-'))");
    expect(step('Validate retained GPU trace evidence (diagnostic only)')).toContain(
      'if: always() && inputs.gpu_trace',
    );
    expect(step('Validate retained GPU trace evidence (diagnostic only)')).toContain(
      'node scripts/native-gpu-trace.mjs --validate desktop-evidence/report.json',
    );
    expect(step('Acquire SHA-pinned offline GPU trace parser (diagnostic only)')).toContain(
      NATIVE_TRACE_PROCESSOR.sha256,
    );
    expect(step('Acquire SHA-pinned offline GPU trace parser (diagnostic only)')).toContain(
      'timeout-minutes: 2',
    );
  });

  it('retains exactly the nine category filters and original capture/processing limits', () => {
    expect(NATIVE_GPU_TRACE.categories).toEqual([
      'gpu',
      'gpu.service',
      'gpu.angle',
      'viz',
      'toplevel',
      'disabled-by-default-gpu.service',
      'disabled-by-default-gpu.device',
      'disabled-by-default-gpu.debug',
      'disabled-by-default-angle',
    ]);
    expect(NATIVE_GPU_TRACE).toMatchObject({
      bufferKiB: 16384,
      maxFileBytes: 64 * 1024 * 1024,
      setupMs: 5000,
      stopMs: 5000,
      categoryInventory: { maxGroups: 4096, maxGroupCharacters: 512, maxBytes: 16384 },
      scope: 'unchanged-babylon-inspect-through-authored-wheel-check-or-first-gpu-fault',
    });
    expect(NATIVE_TRACE_PROCESSOR).toEqual({
      version: '58.2',
      bytes: 14897560,
      sha256: '58042408e6cc861fb1a731c26bb082dc222285561eaa4e12a48a8b2b90dca7b9',
      maxInputBytes: 64 * 1024 * 1024,
      maxStdoutBytes: 16 * 1024,
      maxStderrBytes: 4 * 1024,
      maxSummaryBytes: 16 * 1024,
      processingMs: 5000,
    });
  });

  it('retains Inspect through wheel or first-fault scope, all journeys, security and deadlines', () => {
    const windowStart = harness.indexOf('gpuTrace.run(async () => {');
    const inspect = harness.indexOf("name: 'Inspect existing Formula asset (35 MB)'");
    const wheel = harness.indexOf("stage('wheel-motion-passed')");
    const capture = harness.indexOf('captureBabylon: async () => {');
    const compatibility = harness.indexOf('compatibility: () =>');
    expect(windowStart).toBeGreaterThan(-1);
    expect(windowStart).toBeLessThan(inspect);
    expect(inspect).toBeLessThan(wheel);
    expect(wheel).toBeLessThan(capture);
    expect(capture).toBeLessThan(compatibility);
    expect(harness).toContain('firstFault: firstGraphicsFault');
    expect(harness).toContain(
      'onOperationFailure: (error) => retainNativeSmokeFailure(report, error, firstGraphicsFault)',
    );
    expect(harness).toContain(
      'verifyDesktopCompatibility(application, page, report, captureChecked, stage)',
    );
    expect(harness).toContain("throw new Error('Authored wheel rotation changed while paused')");
    expect(harness).toContain('preferences.webSecurity === false');
    expect(harness).toContain('!preferences.sandbox');
    expect(harness).toContain('!preferences.contextIsolation');
    expect(harness).toContain('preferences.nodeIntegration');
    expect(harness).toContain('timeout: 120000');
    expect(harness).toContain('{ timeout: 15000, polling: 100 }');
    expect(platform).toContain('timeout-minutes: 50');
    expect(platform).toContain('run: xvfb-run -a node scripts/desktop-smoke.mjs');
    expect(platform).toContain('run: node scripts/desktop-smoke.mjs');
    expect(platform).toContain("LIBGL_ALWAYS_SOFTWARE: '1'");
    for (const text of [harness, platform, diagnostic])
      expect(text).not.toMatch(
        /--no-sandbox|--disable-gpu|--disable-web-security|disable.*watchdog|continue-on-error/,
      );
  });
});
