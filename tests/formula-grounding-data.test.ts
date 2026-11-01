import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as ts from 'typescript';
import * as T from 'three';
import * as data from '../src/engine/assets/formula-grounding.ts';
import * as original from '../src/rendering/studio/car-grounding.ts';
import { STUDIO_MAX_CARS } from '../src/rendering/studio/studio-frame.ts';
import { F, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../src/simulation/vehicle.ts';
import { FORMULA_APX01, vehicleAt } from '../src/simulation/vehicles.ts';
import {
  arrayBytes,
  decodeFloat32,
  decodeFloat64,
  groundingOracle,
  sha256,
} from './fixtures/formula-grounding-oracle.ts';

it('keeps original exports, fixed mounts, constants and shallow-freeze identities', () => {
  for (const name of ['CAR_GROUNDING', 'CAR_FOOTPRINT', 'CAR_TYRES', 'carGroundingAt'] as const)
    expect(original[name]).toBe(data[name]);
  expect(data.CAR_GROUNDING).toEqual(groundingOracle.constants.grounding);
  expect(data.CAR_FOOTPRINT).toEqual(groundingOracle.constants.footprint);
  expect(data.CAR_TYRES).toEqual(groundingOracle.constants.tyres);
  expect(data.FORMULA_GROUNDING_MAX_CARS).toBe(groundingOracle.constants.maxCars);
  expect(STUDIO_MAX_CARS).toBe(data.FORMULA_GROUNDING_MAX_CARS);
  expect(data.FORMULA_GROUNDING_MOUNTS).toEqual(groundingOracle.constants.mounts);
  expect(data.FORMULA_GROUNDING_MOUNTS).toBe(WHEEL_POSITIONS);
  expect(data.FORMULA_GROUNDING_MOUNTS).toBe(FORMULA_APX01.wheelPositions);
  expect(data.FORMULA_GROUNDING_DEFAULT_LENGTH).toBe(0.25);
  expect(data.FORMULA_GROUNDING_DEFAULT_RADIUS).toBe(0.335);
  for (const value of [data.CAR_GROUNDING, data.CAR_FOOTPRINT, data.CAR_TYRES])
    expect(Object.isFrozen(value)).toBe(true);
  expect(Object.isFrozen(data.CAR_FOOTPRINT[0])).toBe(false);
  expect(Object.isFrozen(data.CAR_FOOTPRINT[0].centre)).toBe(false);
  expect(Object.isFrozen(data.CAR_TYRES.half)).toBe(false);
  expect(Object.isFrozen(data.FORMULA_GROUNDING_MOUNTS)).toBe(true);
  expect(data.FORMULA_GROUNDING_MOUNTS.every(Object.isFrozen)).toBe(true);
});

it('preserves the original three-decimal shader constants without precision changes', () => {
  const f = (n: number) => n.toFixed(3);
  expect({
    grounding: Object.fromEntries(Object.entries(data.CAR_GROUNDING).map(([k, v]) => [k, f(v)])),
    heightStart: f(data.CAR_GROUNDING.height * 0.4),
    reachSquared: f(data.CAR_GROUNDING.reach ** 2),
    footprint: data.CAR_FOOTPRINT.map((p) => ({
      name: p.name,
      centre: p.centre.map(f),
      half: p.half.map(f),
      strength: f(p.strength),
    })),
    tyres: {
      across: f(data.CAR_TYRES.across),
      front: f(data.CAR_TYRES.front),
      rear: f(data.CAR_TYRES.rear),
      half: data.CAR_TYRES.half.map(f),
    },
  }).toEqual(groundingOracle.formatted);
});

it('matches every original local-footprint CPU byte, including edge/height/nonfinite cases', () => {
  const points = decodeFloat64(groundingOracle.cpu.inputs);
  const expected = decodeFloat64(groundingOracle.cpu.output);
  expect(expected.length).toBe(885);
  const actual = new Float64Array(expected.length);
  for (let i = 0; i < actual.length; i++)
    actual[i] = data.carGroundingAt(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
  expect(sha256(arrayBytes(actual))).toBe(groundingOracle.cpu.output.sha256);
  expect(Buffer.compare(arrayBytes(actual), arrayBytes(expected))).toBe(0);
});

it.each([
  [0, 0],
  [-0, 0],
  [-3, 0],
  [NaN, 0],
  [-Infinity, 0],
  [0.9, 0],
  [2.8, 2],
  [11.99, 11],
  [12, 12],
  [13, 12],
  [Infinity, 12],
])('keeps the legacy slot-count rule for %s -> %s', (value, expected) => {
  expect(data.formulaGroundingCarCount(value)).toBe(expected);
});

describe('renderer-neutral pose writes against pre-edit original observations', () => {
  for (const scenario of groundingOracle.cases) {
    it(scenario.name, () => {
      let writes = 0;
      const presentedPosition = new T.Vector3();
      for (const observation of scenario.observations) {
        if (!observation.input || observation.error) continue;
        const input = decodeFloat32(observation.input);
        const before = Buffer.from(arrayBytes(input));
        const poses = decodeFloat64(observation.result.poses);
        const cars = observation.result.diagnostics.cars as number;
        for (let id = 0; id < cars; id++) {
          const offset = carBase(id);
          presentedPosition.set(input[offset + F.X], input[offset + F.Y], input[offset + F.Z]);
          const definition = vehicleAt(Math.round(input[offset + RACE_BASE + R.VEHICLE]));
          if (definition.classId === 'gp-bike' && definition.bike) continue;
          // The original owner normalizes once before its matrix/history and
          // pose paths. Feed that unchanged normalized value, not a new policy.
          const q = new T.Quaternion()
            .set(
              input[offset + F.QX],
              input[offset + F.QY],
              input[offset + F.QZ],
              input[offset + F.QW],
            )
            .normalize();
          const position = Object.freeze({
            x: presentedPosition.x,
            y: presentedPosition.y,
            z: presentedPosition.z,
          });
          const quaternion = Object.freeze({ x: q.x, y: q.y, z: q.z, w: q.w });
          const out = { x: 101, y: 102, z: 103, w: 104 };
          expect(data.writeFormulaGroundingPose(input, offset, position, quaternion, out)).toBe(
            out,
          );
          const actual = new Float64Array([out.x, out.y, out.z, out.w]);
          expect(
            Buffer.compare(arrayBytes(actual), arrayBytes(poses.slice(id * 4, id * 4 + 4))),
          ).toBe(0);
          writes++;
        }
        expect(Buffer.compare(arrayBytes(input), before)).toBe(0);
      }
      // Even initially empty counts are followed by a one-car frame. Every
      // scenario includes a non-GP write, including the mixed field.
      expect(writes).toBeGreaterThan(0);
    });
  }
});

it('retains installed reach, maximum-overlap and separate diffuse/specular light terms', () => {
  // The compatibility suite compares actual full shaders with these frozen
  // strings. This is a source-hook witness, not a new GPU or photometric claim.
  for (const saved of groundingOracle.factories) {
    const fragment = saved.shader.fragmentShader;
    expect(fragment).toContain('#define STUDIO_MAX_CARS 12');
    expect(fragment).toContain('if ( dot( d, d ) > 16.000 ) continue;');
    expect(fragment).toContain('smoothstep( 0.180, 0.450, abs( l.y ) )');
    expect(fragment).toContain('total = max( total, occ * gate );');
    expect(fragment).toContain('1.0 - 0.600 * apexGround');
    expect(fragment).toContain('1.0 - 0.320 * apexGround * apexGround');
    for (const term of ['indirectDiffuse', 'indirectSpecular'])
      expect(fragment).toContain(`reflectedLight.${term} *= apexIndirect;`);
    for (const term of ['directDiffuse', 'directSpecular'])
      expect(fragment).toContain(`reflectedLight.${term} *= apexDirect;`);
  }
});

it('has only renderer-neutral runtime dependencies, with no solver or browser imports', () => {
  const root = resolve('src/engine/assets/formula-grounding.ts');
  const queue = [root];
  const visited = new Set<string>();
  while (queue.length) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    expect(file).not.toMatch(/[/\\](rendering|babylon)[/\\]|[/\\]vehicle\.ts$/);
    const parsed = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        if (clause?.isTypeOnly) return;
        if (
          clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          !clause.name &&
          clause.namedBindings.elements.every((item) => item.isTypeOnly)
        )
          return;
        specifier = node.moduleSpecifier;
      }
      if (ts.isExportDeclaration(node)) {
        if (node.isTypeOnly) return;
        if (
          node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.every((item) => item.isTypeOnly)
        )
          return;
        specifier = node.moduleSpecifier;
      }
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
      if (file === root && ts.isIdentifier(node))
        expect([
          'document',
          'window',
          'performance',
          'Date',
          'requestAnimationFrame',
        ]).not.toContain(node.text);
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  expect(visited.has(resolve('src/simulation/protocol.ts'))).toBe(true);
  expect(visited.has(resolve('src/simulation/vehicles.ts'))).toBe(true);
});
