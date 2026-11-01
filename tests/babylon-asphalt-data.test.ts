import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as ts from 'typescript';
import * as data from '../src/engine/assets/surface-texel-data.ts';
import * as original from '../src/rendering/surface-detail.ts';
import { AsphaltAggregate } from '../src/rendering/asphalt-aggregate.ts';
import { ASPHALT_DETAIL } from '../src/rendering/studio/road-detail.ts';
import { ASPHALT_TONE } from '../src/rendering/circuit-finish.ts';
import {
  arrayBytes,
  compressedOracle,
  oracle,
  ORACLE_SHA256,
  sha256,
  type ArrayOracle,
} from './fixtures/asphalt-source-oracle.ts';

function expectArray(actual: ArrayBufferView & { length: number }, saved: ArrayOracle) {
  expect(actual.constructor.name).toBe(saved.type);
  expect(actual.length).toBe(saved.length);
  expect(actual.byteLength).toBe(saved.byteLength);
  const bytes = arrayBytes(actual);
  expect(sha256(bytes)).toBe(saved.sha256);
  if (saved.bytes !== undefined) {
    const expected = Buffer.from(saved.bytes, 'base64');
    expect(sha256(expected)).toBe(saved.sha256);
    // Every captured byte, not sampled texels, epsilon or aggregate statistics.
    expect(Buffer.compare(bytes, expected)).toBe(0);
  }
}

it('pins the independent pre-extraction original source and immutable data fixture', () => {
  expect(sha256(compressedOracle)).toBe(ORACLE_SHA256);
  expect(oracle.version).toBe(1);
  expect(oracle.sourceCommit).toBe('cee488b3e399c67fcf5c4d94fc9defa02b355272');
  expect(oracle.nodeVersion).toBe('v22.23.4');
  expect(oracle.captureScriptSHA256).toBe(
    'c1e553a8efed78a20626bae68adf7f181fb191893ac2dc71b82f9ad47e744f2e',
  );
  expect(Object.keys(oracle.sourceFiles)).toHaveLength(11);
  expect(oracle.sourceFiles['src/rendering/surface-detail.ts']).toBe(
    '38894b399d54dda27efb89c719a623cc1a9351f6b8d4fa84ee35e57321882431',
  );
  expect(oracle.cases).toHaveLength(12);
  expect(oracle.normalCases).toHaveLength(4);
  expect(oracle.factories).toHaveLength(8);
});

describe('unchanged original surface data after renderer-neutral extraction', () => {
  for (const saved of oracle.cases) {
    it(saved.name, () => {
      const actual = data.surfacePixels(saved.kind, saved.size, saved.seed);
      expect(Object.keys(actual)).toEqual(Object.keys(saved.arrays));
      for (const key of ['albedo', 'height', 'roughness'] as const)
        expectArray(actual[key], saved.arrays[key]);
      expectArray(data.surfaceNormalPixels(actual.height, saved.size), saved.normal);
      if (saved.meso) expectArray(data.asphaltMesoPixels(saved.size, saved.seed), saved.meso);
      expect(data.asphaltTexelMeans(actual)).toEqual(saved.means);
    });
  }
  for (const saved of oracle.normalCases) {
    it(`wrapped Sobel bytes: ${saved.name}`, () => {
      const height = new Uint8Array(Buffer.from(saved.height.bytes!, 'base64'));
      expectArray(height, saved.height);
      expectArray(data.surfaceNormalPixels(height, saved.size, saved.strength), saved.normal);
    });
  }
});

it('retains compatibility identities, original constant values and shallow freeze semantics', () => {
  for (const name of [
    'surfacePixels',
    'asphaltMesoPixels',
    'surfaceNormalPixels',
    'asphaltTexelMeans',
    'ASPHALT_TEXELS',
  ] as const)
    expect(original[name]).toBe(data[name]);
  expect(AsphaltAggregate).toBe(data.AsphaltAggregate);
  expect(ASPHALT_DETAIL).toBe(data.ASPHALT_DETAIL);
  expect(ASPHALT_TONE).toBe(data.ASPHALT_TONE);
  expect(data.ASPHALT_TEXELS).toEqual(oracle.constants.texels);
  expect(data.ASPHALT_DETAIL).toEqual(oracle.constants.detail);
  expect(data.ASPHALT_TONE).toEqual(oracle.constants.tone);
  for (const value of [data.ASPHALT_TEXELS, data.ASPHALT_DETAIL, data.ASPHALT_TONE])
    expect(Object.isFrozen(value)).toBe(true);
  expect(Object.isFrozen(data.ASPHALT_DETAIL.microFade)).toBe(false);
});

it('preserves original rounded shader constants rather than silently increasing precision', () => {
  const D = data.ASPHALT_DETAIL;
  const g = (v: number) => v.toFixed(5);
  const means = data.asphaltTexelMeans(data.surfacePixels('asphalt'));
  expect({
    tone: data.ASPHALT_TONE.map((v) => v.toFixed(3)),
    linearMean: means.albedo.map(g),
    roughnessMean: g(means.roughness),
    microFade: D.microFade.map(g),
    microContrast: g(D.microContrast),
    mesoFrequency: g(1 / D.mesoTile),
    mesoTone: g(D.mesoTone),
    mesoRoughness: g(D.mesoRoughness),
    mesoSlopeGain: g(D.mesoRelief / ((1.5 / 512) * D.mesoTile)),
    glintFrequency: g(1 / D.glintCell),
    glintShare: g(D.glintShare),
    glintRadius: g(D.glintRadius),
    glintFade: [g(D.glintRange * 0.65), g(D.glintRange)],
    glintRoughness: g(D.glintRoughness),
  }).toEqual(oracle.formatted);
});

it('retains validation and caller-owned fresh buffers without mutating supplied heights', () => {
  for (const size of [NaN, 7, 8.5, 1025]) {
    expect(() => data.surfacePixels('asphalt', size)).toThrow('Invalid surface size');
    expect(() => data.asphaltMesoPixels(size)).toThrow('Invalid meso size');
  }
  expect(() => new data.AsphaltAggregate(Infinity)).toThrow('Invalid aggregate seed');
  const height = Uint8Array.from({ length: 64 }, (_, i) => i * 3);
  const before = height.slice();
  data.surfaceNormalPixels(height, 8);
  expect(height).toEqual(before);
  expect(() => data.surfaceNormalPixels(height, 7)).toThrow('Invalid normal source');
  for (const strength of [NaN, Infinity, -1])
    expect(() => data.surfaceNormalPixels(height, 8, strength)).toThrow('Invalid normal strength');
  const first = data.surfacePixels('asphalt', 8);
  const second = data.surfacePixels('asphalt', 8);
  for (const key of ['albedo', 'height', 'roughness'] as const) {
    expect(first[key]).not.toBe(second[key]);
    expect(first[key]).toEqual(second[key]);
    first[key][0] ^= 255;
    expect(first[key][0]).not.toBe(second[key][0]);
  }
});

it('has only neutral transitive imports, including re-exports and dynamic imports', () => {
  const root = resolve('src/engine/assets/surface-texel-data.ts');
  const queue = [root];
  const visited = new Set<string>();
  while (queue.length) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    expect(file).not.toMatch(/[/\\]rendering[/\\]|[/\\]babylon[/\\]/);
    const parsed = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        expect(node.arguments).toHaveLength(1);
        specifier = node.arguments[0];
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
        expect(node.expression.text).not.toBe('require');
      if (specifier) {
        expect(ts.isStringLiteral(specifier)).toBe(true);
        if (ts.isStringLiteral(specifier)) {
          expect(specifier.text.startsWith('.')).toBe(true);
          expect(specifier.text.endsWith('.ts')).toBe(true);
          queue.push(resolve(dirname(file), specifier.text));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  expect([...visited].sort()).toEqual([resolve('src/core/math.ts'), root].sort());
});
