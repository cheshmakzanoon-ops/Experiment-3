import gantryManifest from '../src/rendering/start-gantry.manifest.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createGraphicsLogScanner } from '../desktop/graphics-health.ts';
import {
  createFirstGraphicsFault,
  desktopSmokeJourney,
  retainNativeSmokeFailure,
  runDesktopSmokeJourneys,
  validateNativeAurelSurface,
} from '../scripts/native-smoke-control.mjs';

describe('native smoke scope', () => {
  it('keeps the required default model/capture/real-menu journey order', async () => {
    const order: string[] = [];
    const journey = desktopSmokeJourney();
    await runDesktopSmokeJourneys(journey, {
      authoredModel: async () => {
        order.push('model');
      },
      captureBabylon: async () => {
        order.push('capture');
      },
      compatibility: async () => {
        order.push('menu');
      },
    });
    expect(order).toEqual(['model', 'capture', 'menu']);
    expect(journey).toEqual({ requestedJourney: 'full', diagnosticOnly: false, omittedChecks: [] });
  });
  it('explicitly records omitted model checks but retains capture and native menu checks', async () => {
    const authoredModel = vi.fn(async () => {});
    const captureBabylon = vi.fn(async () => {});
    const compatibility = vi.fn(async () => {});
    const journey = desktopSmokeJourney('compatibility-diagnostic');
    await runDesktopSmokeJourneys(journey, { authoredModel, captureBabylon, compatibility });
    expect(authoredModel).not.toHaveBeenCalled();
    expect(captureBabylon).toHaveBeenCalledOnce();
    expect(compatibility).toHaveBeenCalledOnce();
    expect(journey.diagnosticOnly).toBe(true);
    expect(journey.omittedChecks).toHaveLength(3);
  });
  it.each(['', 'compatibility', 'Full', 'skip', '__proto__'])(
    'rejects unknown scope %s',
    (mode) => {
      expect(() => desktopSmokeJourney(mode)).toThrow('Unknown desktop smoke journey');
    },
  );
  it('keeps diagnostic uploads distinct and out of default publication gates', () => {
    const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    const platform = source('../.github/workflows/desktop-platform.yml');
    const required = source('../.github/workflows/desktop-build.yml');
    const diagnostic = source('../.github/workflows/desktop-linux-driver-review.yml');
    expect(platform).toMatch(/smoke_journey:[\s\S]*?default: full/);
    expect(platform).toContain(
      "inputs.smoke_journey != 'full' && '-compatibility-diagnostic' || ''",
    );
    expect(platform).toMatch(
      /Record package checksums and exact source\n\s+if: inputs.smoke_journey == 'full'/,
    );
    expect(platform).toMatch(
      /Upload development installers\n\s+if: inputs.smoke_journey == 'full'/,
    );
    expect(required).not.toContain('smoke_journey');
    expect(required).toContain('needs: build');
    expect(diagnostic).toContain('smoke_journey: compatibility-diagnostic');
    expect(diagnostic).toContain('linux_graphics: swiftshader');
    expect(diagnostic).toContain('linux_graphics: mesa');
    expect(diagnostic).not.toContain('contents: write');
    expect(diagnostic).not.toContain('publish-development');
    expect(source('../scripts/desktop-compatibility.mjs')).toContain(
      'report.compatibilityEntry = { ...entry, url: page.url(), activated: true }',
    );
  });
});

describe('sticky first native GPU fault', () => {
  it('fails a pending wait immediately on a split process-log crash, and never clears it', async () => {
    const scanner = createGraphicsLogScanner();
    const faults = createFirstGraphicsFault();
    const wait = faults.wait(() => new Promise<void>(() => {}));
    const failed = expect(wait).rejects.toThrow('GPU process exited unexpectedly');
    scanner.push('GPU process exited unex');
    for (const fault of scanner.faults()) faults.record(fault);
    expect(faults.read()).toBeUndefined();
    scanner.push('pectedly: exit_code=512\n');
    for (const fault of scanner.faults()) faults.record(fault);
    await failed;
    const first = faults.read();
    faults.record('later context loss');
    scanner.push('context restored');
    expect(faults.read()).toBe(first);
  });
  it('does not start an observation after a preexisting GPU failure', async () => {
    const faults = createFirstGraphicsFault();
    faults.record('exitCode=512');
    const operation = vi.fn(async () => 1);
    await expect(faults.wait(operation)).rejects.toBe(faults.read());
    expect(operation).not.toHaveBeenCalled();
  });
  it('handles a losing observation rejection without changing the first failure', async () => {
    const faults = createFirstGraphicsFault();
    let rejectLate!: (error: Error) => void;
    const wait = faults.wait(
      () =>
        new Promise<void>((_, reject) => {
          rejectLate = reject;
        }),
    );
    const failed = expect(wait).rejects.toThrow('crashed');
    faults.record('crashed');
    await failed;
    rejectLate(new Error('late observation timeout'));
    await Promise.resolve();
    expect(faults.read()?.message).toContain('crashed');
  });
  it('preserves healthy results and the original operation timeout unchanged', async () => {
    const faults = createFirstGraphicsFault();
    await expect(faults.wait(async () => 42)).resolves.toBe(42);
    const timeout = new Error('Timeout 30000ms exceeded');
    await expect(
      faults.wait(async () => {
        throw timeout;
      }),
    ).rejects.toBe(timeout);
    expect(faults.read()).toBeUndefined();
  });
  it('does not add a timer or shorten the existing 30000ms observation budget', async () => {
    vi.useFakeTimers();
    try {
      const faults = createFirstGraphicsFault();
      const timeout = new Error('original deadline');
      const wait = faults.wait(
        () => new Promise<void>((_, reject) => setTimeout(() => reject(timeout), 30000)),
      );
      let settled = false;
      const observed = wait.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      const failed = expect(wait).rejects.toBe(timeout);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(29999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await failed;
      await observed;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('preserves synchronous and falsy rejections without installing its own deadline', async () => {
    const faults = createFirstGraphicsFault();
    const error = new Error('synchronous failure');
    await expect(
      faults.wait(() => {
        throw error;
      }),
    ).rejects.toBe(error);
    await expect(faults.wait(() => Promise.reject(undefined))).rejects.toBeUndefined();
  });
  it('does not replace an observed crash with timeout or snapshot failures', () => {
    const faults = createFirstGraphicsFault();
    faults.record('exitCode=512');
    const report: { success?: boolean; failure?: string } = {};
    retainNativeSmokeFailure(report, new Error('Timeout 30000ms exceeded'), faults);
    const first = report.failure;
    retainNativeSmokeFailure(report, new Error('snapshot failed'), faults);
    expect(report).toEqual({ success: false, failure: first });
    expect(first).toContain('exitCode=512');
    expect(first).not.toContain('Timeout');
  });
  it('does not erase an earlier non-GPU failure during later cleanup', () => {
    const faults = createFirstGraphicsFault();
    const report: { success?: boolean; failure?: string } = {};
    retainNativeSmokeFailure(report, new Error('original assertion'), faults);
    faults.record('later crash');
    retainNativeSmokeFailure(report, new Error('snapshot failed'), faults);
    expect(report.failure).toBe('Error: original assertion');
  });
});

describe('same-readiness-receipt native Aurel surface acceptance', () => {
  const raw = {
    kind: 'formula-ribbon',
    roadChunks: '38',
    paintChunks: '76',
    leftPaintChunks: '38',
    rightPaintChunks: '38',
    vertices: '31882',
    paintFinishMaterials: '1',
    asphaltSubstrateRoadChunks: '38',
    asphaltSubstrateMaterials: '1',
    asphaltSubstrateTextures: '3',
    asphaltSubstrateSrgbTextures: '1',
    formulaGroundingRoadChunks: '38',
    formulaGroundingPaintChunks: '76',
    formulaGroundingMaterials: '2',
    formulaGroundingCars: '1',
    gantryState: 'ready',
    gantryParts: '4',
    gantryMaterials: '1',
    gantryTextures: '3',
    gantryTriangles: '9520',
    gantrySha256: gantryManifest.sha256,
    coarseMeshes: '0',
  };
  it('returns observed counts without mutating the raw evidence', () => {
    const snapshot = { ...raw };
    expect(validateNativeAurelSurface(raw)).toEqual({
      kind: 'formula-ribbon',
      roadChunks: 38,
      paintChunks: 76,
      leftPaintChunks: 38,
      rightPaintChunks: 38,
      vertices: 31882,
      paintFinishMaterials: 1,
      asphaltSubstrateRoadChunks: 38,
      asphaltSubstrateMaterials: 1,
      asphaltSubstrateTextures: 3,
      asphaltSubstrateSrgbTextures: 1,
      formulaGroundingRoadChunks: 38,
      formulaGroundingPaintChunks: 76,
      formulaGroundingMaterials: 2,
      formulaGroundingCars: 1,
      gantryState: 'ready',
      gantryParts: 4,
      gantryMaterials: 1,
      gantryTextures: 3,
      gantryTriangles: 9520,
      gantrySha256: gantryManifest.sha256,
      coarseMeshes: 0,
    });
    expect(raw).toEqual(snapshot);
  });
  it('rejects missing, non-object and inherited receipts', () => {
    for (const value of [undefined, null, [], true, 'formula-ribbon', 0, {}, Object.create(raw)])
      expect(() => validateNativeAurelSurface(value)).toThrow('Native Aurel surface');
    for (const key of Object.keys(raw)) {
      const missing = { ...raw } as Record<string, unknown>;
      delete missing[key];
      expect(() => validateNativeAurelSurface(missing)).toThrow(key);
    }
  });
  it('rejects each wrong count, unsupported surface kind and malformed numeric value', () => {
    expect(() => validateNativeAurelSurface({ ...raw, kind: 'coarse' })).toThrow('kind');
    for (const key of Object.keys(raw).filter((k) => k !== 'kind'))
      for (const value of [
        '999',
        '',
        null,
        undefined,
        NaN,
        Infinity,
        38,
        '038',
        '38.0',
        ' 38',
        {},
        [],
      ])
        expect(() => validateNativeAurelSurface({ ...raw, [key]: value })).toThrow(key);
    expect(() => validateNativeAurelSurface({ ...raw, coarseMeshes: '1' })).toThrow('coarseMeshes');
    expect(() =>
      validateNativeAurelSurface({
        ...raw,
        roadChunks: '50',
        paintChunks: '100',
        vertices: '42700',
      }),
    ).toThrow('roadChunks');
  });
  it('extends the existing readiness snapshot without another query or changing the frame budget', () => {
    const source = readFileSync('scripts/desktop-smoke.mjs', 'utf8');
    const body = source.slice(
      source.indexOf('async function waitForBabylonPresentation('),
      source.indexOf('async function captureChecked('),
    );
    expect(body.match(/\.evaluate\(/g)).toHaveLength(1);
    expect(body.match(/page\.waitForFunction\(/g)).toHaveLength(1);
    expect(body).toContain('{ timeout: 30000, polling: 100 }');
    expect(body).toContain("data?.presentationSettled === 'true'");
    expect(body).toContain('submitted > 0');
    expect(body).toContain('completed === submitted');
    expect(body.indexOf('validateNativeAurelSurface(receipt.surface)')).toBeGreaterThan(
      body.indexOf('.push(receipt)'),
    );
    for (const name of [
      'surfaceKind',
      'surfaceRoadChunks',
      'surfacePaintChunks',
      'surfaceLeftPaintChunks',
      'surfaceRightPaintChunks',
      'surfaceVertices',
      'surfacePaintFinishMaterials',
      'surfaceAsphaltSubstrateRoadChunks',
      'surfaceAsphaltSubstrateMaterials',
      'surfaceAsphaltSubstrateTextures',
      'surfaceAsphaltSubstrateSrgbTextures',
      'surfaceCoarseMeshes',
    ])
      expect(body).toContain(`element.dataset.${name}`);
  });
});
