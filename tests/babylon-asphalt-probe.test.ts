import { expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compareAsphaltPixels } from '../e2e/fixtures/asphalt-parity-metrics.ts';

const image = (size = 16) => {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 4) data.set([100, 110, 120, 255], i);
  return data;
};
it('compares every reference-selected interior colour and bounds the worst outlier', () => {
  const expected = image(),
    actual = expected.slice();
  expect(compareAsphaltPixels(actual, expected, 16)).toMatchObject({
    comparedPixels: 144,
    maxChannelError: 0,
    meanChannelError: 0,
    missingInteriorPixels: 0,
    excessCoveragePixels: 0,
  });
  actual[(8 * 16 + 8) * 4] = 255;
  expect(compareAsphaltPixels(actual, expected, 16)).toMatchObject({
    comparedPixels: 144,
    changedPixels: 1,
    maxChannelError: 155,
    meanChannelError: 155 / (144 * 3),
  });
});
it('does not hide a candidate hole or empty image through an intersected coverage mask', () => {
  const expected = image(),
    actual = expected.slice();
  actual.fill(0, (8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4);
  expect(compareAsphaltPixels(actual, expected, 16)).toMatchObject({
    comparedPixels: 144,
    missingInteriorPixels: 1,
    changedPixels: 1,
    maxChannelError: 120,
  });
  actual.fill(0);
  expect(compareAsphaltPixels(actual, expected, 16)).toMatchObject({
    comparedPixels: 144,
    missingInteriorPixels: 144,
    changedPixels: 144,
    maxChannelError: 120,
  });
});
it('allows only the fixed geometry-edge band, not arbitrary extra candidate coverage', () => {
  const expected = new Uint8Array(32 * 32 * 4);
  for (let y = 8; y < 24; y++)
    for (let x = 8; x < 24; x++) expected.set([100, 110, 120, 255], (y * 32 + x) * 4);
  const actual = expected.slice();
  actual.set([100, 110, 120, 255], (16 * 32 + 6) * 4);
  expect(compareAsphaltPixels(actual, expected, 32).excessCoveragePixels).toBe(0);
  actual.set([100, 110, 120, 255], (16 * 32 + 5) * 4);
  expect(compareAsphaltPixels(actual, expected, 32).excessCoveragePixels).toBe(1);
});
it('rejects incompatible images and leaves an uncovered reference unqualified', () => {
  expect(() => compareAsphaltPixels(image(), new Uint8Array(3), 16)).toThrow();
  expect(() => compareAsphaltPixels(new Uint8Array(16), new Uint8Array(16), 2)).toThrow();
  expect(compareAsphaltPixels(new Uint8Array(256), new Uint8Array(256), 8)).toMatchObject({
    comparedPixels: 0,
    meanChannelError: Infinity,
  });
});
it('qualifies original repeats and damaged-source controls before allocating the candidate', () => {
  const source = readFileSync('e2e/fixtures/babylon-asphalt-parity.ts', 'utf8');
  expect(source.indexOf('referenceQualified = true')).toBeGreaterThan(
    source.indexOf('negative control not discriminating'),
  );
  expect(source.indexOf('owner = createAsphaltSubstrate')).toBeGreaterThan(
    source.indexOf('referenceQualified = true'),
  );
  expect(source).toContain('Original asphalt negative control not discriminating');
  expect(source).toContain('metrics.maxChannelError > ASPHALT_PARITY_LIMITS.referenceMax');
  expect(source).toContain('metrics.meanChannelError > ASPHALT_PARITY_LIMITS.referenceMean');
  expect(source).toContain('asphaltProbeAlbedo=surfaceAlbedo;');
  expect(source).toContain('asphaltProbeRoughness=metallicRoughness.g;');
  expect(source).toContain('vec3(asphaltProbeRoughness*.5)');
  expect(source).not.toContain('asphaltSubstrateRoughness');
  expect(source).toContain('mat3(asphaltSubstrateView)*normalW');
});
it('keeps the candidate outside every live import and leaves the actual original factory untouched', () => {
  const files: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.ts$/.test(entry.name)) files.push(child);
    }
  };
  walk('src');
  const imports = files.filter(
    (path) =>
      !path.includes('/asphalt-substrate') &&
      /from\s+['"][^'"]*asphalt-substrate/.test(readFileSync(path, 'utf8')),
  );
  expect(imports).toEqual([]);
  const original = readFileSync('src/rendering/surface-detail.ts', 'utf8');
  expect(original).not.toContain('babylon');
});
it('selects every isolated asphalt fixture change and contract without weakening existing GPU journeys', () => {
  const workflow = readFileSync('.github/workflows/babylon-integration.yml', 'utf8');
  const paths = workflow.split('    paths:')[1]?.split('permissions:')[0];
  for (const path of [
    'e2e/fixtures/asphalt-reference.ts',
    'e2e/fixtures/asphalt-parity-metrics.ts',
    'e2e/fixtures/babylon-asphalt-parity.ts',
    'e2e/babylon-surface-parity.spec.ts',
    'tests/babylon-*.test.ts',
  ])
    expect(paths).toContain(`- '${path}'`);
  const contract = workflow
    .split('name: Engine component and existing asset geometry contracts')[1]
    ?.split('      - ')[0];
  expect(contract).toContain('run: npx vitest run tests/babylon-*.test.ts');
  const journeys = workflow
    .split('name: Real WebGL engine, model import and mode-switching journeys')[1]
    ?.split('      - ')[0];
  for (const path of [
    'e2e/babylon-engine.spec.ts',
    'e2e/discipline-entry.spec.ts',
    'e2e/babylon-player-lods.spec.ts',
    'e2e/babylon-height-parity.spec.ts',
    'e2e/babylon-surface-parity.spec.ts',
  ])
    expect(journeys).toContain(path);
  expect(contract + journeys).not.toMatch(
    /continue-on-error|--exclude|--testNamePattern|--passWithNoTests|--grep/,
  );
});
