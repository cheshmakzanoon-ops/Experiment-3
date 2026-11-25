import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import type * as Fixture from './fixtures/engine-native-resources.ts';

type NativeWindow = Window & { EngineNativeResources: typeof Fixture };
let fixture: string;
let sources: Fixture.OwnerSources;

function ownerSource(path: string, name: string) {
  const source = ts.createSourceFile(
    path,
    readFileSync(resolve(path), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owner = source.statements.find(
    (node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name,
  );
  const output = owner?.members.find(
    (node): node is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(node) && node.name.getText(source) === 'outputPass',
  );
  const dispose = owner?.members.find(
    (node): node is ts.MethodDeclaration =>
      ts.isMethodDeclaration(node) && node.name.getText(source) === 'dispose',
  );
  if (!output?.initializer || !dispose) throw new Error(`Missing ${name} resource ownership`);
  return ts.transpileModule(
    `class Owner { ${output.getText(source)} ${dispose.getText(source)} }`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    },
  ).outputText;
}
test.beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve('e2e/fixtures/engine-native-resources.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'EngineNativeResources',
    platform: 'browser',
    target: 'es2022',
  });
  fixture = result.outputFiles[0].text;
  sources = {
    festival: ownerSource('src/rendering/open-world/festival-renderer.ts', 'FestivalRenderer'),
    circuit: ownerSource('src/rendering/renderer.ts', 'RacingRenderer'),
  };
});
async function load(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__engine_native_resources__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native engine resource ownership</title>',
    }),
  );
  await page.goto('/__engine_native_resources__');
  await page.addScriptTag({ content: fixture });
  return errors;
}

test('native texture registration batches shared groups without changing pixels or ownership', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(() =>
    (window as unknown as NativeWindow).EngineNativeResources.textureRegistration(),
  );
  expect(report.backend).toBeTruthy();
  expect(report.registration).toMatchObject({
    wrappers: 1025,
    drawCalls: 3,
    versionIncrements: 1025,
    groups: 3,
    sizes: [
      [64, 32],
      [64, 32],
      [128, 64],
    ],
  });
  for (const filter of report.registration.filters)
    expect(filter).toEqual({ minFilter: 1008, mipmaps: true, anisotropy: 2 });
  expect(report.afterUpload.textures - report.beforeUpload.textures).toBe(3);
  for (const pixels of report.pixels) {
    expect(pixels).toMatchObject({ canvasDifferences: 0, gpuDifferences: 0 });
    expect(pixels.canvasHash).toBe(pixels.referenceCanvasHash);
    expect(pixels.gpuHash).toBe(pixels.referenceGpuHash);
  }
  expect(report.refreshedCenter).toEqual([255, 255, 0, 255]);
  expect(report.fullSize).toEqual([
    [256, 128],
    [256, 128],
    [256, 128],
  ]);
  expect(report.originalImages && report.restored && report.lateRestored).toBe(true);
  expect(report.afterCleanup).toEqual({ textures: 0, geometries: 0, programs: 0, programUses: 0 });
  expect(report.glError).toBe(0);
  expect(report.lost).toBe(false);
  expect(errors).toEqual([]);
  await info.attach('native-texture-registration.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

test('native Festival resource cycles release GPU allocations and preserve the borrowed backend', async ({
  page,
}, info) => {
  const errors = await load(page);
  const report = await page.evaluate(
    (source) => (window as unknown as NativeWindow).EngineNativeResources.festivalCycles(source),
    sources.festival,
  );
  expect(report.cycles).toHaveLength(6);
  const retained = report.cycles[0].released;
  for (const [index, cycle] of report.cycles.entries()) {
    expect(cycle.active.textures).toBeGreaterThan(cycle.released.textures);
    expect(cycle.active.geometries).toBeGreaterThan(cycle.released.geometries);
    expect(cycle.released).toEqual(retained);
    for (const count of Object.values(cycle.events)) expect(count).toBe(1);
    expect(cycle.caught).toBe(index === 3);
    expect(cycle.emptyScene).toBe(true);
    expect(cycle.pixel).toEqual([0, 255, 0, 255]);
    expect(cycle.contextLost).toBe(false);
    expect(cycle.glError).toBe(0);
    expect(cycle.backendDisposals).toBe(0);
  }
  expect(report.backendDisposals).toBe(0);
  expect(errors).toEqual([]);
  await info.attach('native-festival-resource-cycles.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

for (const kind of ['imported', 'generated'] as const)
  test(`native circuit teardown restores mixed sources after ${kind} listener failure`, async ({
    page,
  }, info) => {
    const errors = await load(page);
    const report = await page.evaluate(
      ({ source, kind }) =>
        (window as unknown as NativeWindow).EngineNativeResources.mixedCircuitFailure(source, kind),
      { source: sources.circuit, kind },
    );
    expect(
      report.threw && report.firstWasUndefined && report.restored && report.foliageRestored,
    ).toBe(true);
    expect(report.snapshots).toEqual([[true, true, true, true]]);
    expect(report.callbackSources).toEqual(['budget', 'original']);
    expect(report.backendDisposals).toBe(1);
    for (const count of Object.values(report.events)) expect(count).toBe(1);
    expect(report.released.textures).toBe(0);
    expect(report.internalVsmGeometries).toBe(1);
    expect(report.released.geometries).toBe(report.internalVsmGeometries);
    expect(report.internalVsmPrograms).toBe(3);
    expect(report.onlyBackendProgramsRemain).toBe(true);
    expect(report.released.programs).toBe(report.internalVsmPrograms);
    expect(report.released.programUses).toBe(report.internalVsmPrograms);
    expect(report.afterInternalCleanup.textures).toBe(0);
    expect(report.afterInternalCleanup.geometries).toBe(0);
    expect(report.liveInternalPrograms).toBe(0);
    expect(report.glError).toBe(0);
    expect(report.contextLost).toBe(false);
    expect(errors).toEqual([]);
    await info.attach(`native-circuit-${kind}-failure.json`, {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
  });
