/** Untimed actual-source numerical/error proof for W08A. No production rewrites. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const originalCommit = '350119e8ec0606e8c5de5b3ab80df41104025679';
const scriptPath = fileURLToPath(import.meta.url);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  assert(['--baseline', '--current', '--output'].includes(key), `Unknown argument: ${key}`);
  assert(!flags.has(key), `Repeated argument: ${key}`);
  const value = process.argv[i + 1];
  assert(value && isAbsolute(value), `An absolute path is required for ${key}`);
  flags.set(key, value);
}
for (const key of ['--baseline', '--current', '--output']) assert(flags.has(key), `Missing ${key}`);
const output = flags.get('--output');
assert(!existsSync(output), 'Refusing to overwrite an existing proof report');
const roots = {
  baseline: realpathSync(flags.get('--baseline')),
  current: realpathSync(flags.get('--current')),
};
assert.notEqual(roots.baseline, roots.current, 'Use independent original/current source roots');

function git(root, ...args) {
  return execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8',
  }).trimEnd();
}

function identity(root) {
  const files = new Map();
  const remember = (name, recurse = true) => {
    const path = realpathSync(resolve(root, name));
    const key = relative(root, path);
    assert(key !== '..' && !key.startsWith(`..${sep}`) && !isAbsolute(key), 'Source escapes root');
    if (files.has(key)) return;
    const bytes = readFileSync(path);
    files.set(key, { bytes: bytes.length, sha256: sha256(bytes) });
    if (!recurse) return;
    // Conservative static-source manifest: type-only imports are included too.
    // The proof executes the original .ts files directly, never this scan's output.
    const imports = /^\s*(?:import|export)\s+(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
    for (const match of bytes.toString('utf8').matchAll(imports)) {
      assert(match[1].startsWith('.'), `Unexpected nonlocal source import: ${key}: ${match[1]}`);
      remember(resolve(dirname(path), match[1]));
    }
  };
  for (const name of [
    'src/simulation/weather.ts',
    'src/simulation/surface-thermal.ts',
    'src/simulation/track.ts',
    'src/simulation/track-lane-index.ts',
  ])
    remember(name);
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) remember(name, false);
  const manifest = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)));
  const status = git(
    root,
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    ...files.keys(),
  );
  assert.equal(status, '', 'Source inputs must be clean for this proof');
  return { root, commit: git(root, 'rev-parse', 'HEAD'), files: manifest, relevantStatus: status };
}

const before = {
  baseline: identity(roots.baseline),
  current: identity(roots.current),
};
assert.equal(before.baseline.commit, originalCommit, 'Unexpected original baseline');
const scriptIdentity = sha256(readFileSync(scriptPath));
async function modules(root) {
  const weather = await import(pathToFileURL(resolve(root, 'src/simulation/weather.ts')).href);
  const thermal = await import(
    pathToFileURL(resolve(root, 'src/simulation/surface-thermal.ts')).href
  );
  return { ...weather, ...thermal };
}
const baseline = await modules(roots.baseline);
const current = await modules(roots.current);
assert.deepEqual(current.SURFACE_THERMAL, baseline.SURFACE_THERMAL);

const grid = {
  water: [-0, 0, Number.MIN_VALUE, 1e-12, 0.1, 1, Number.MAX_VALUE],
  source: [
    -Number.MAX_VALUE,
    -1e6,
    -1,
    -Number.MIN_VALUE,
    -0,
    0,
    Number.MIN_VALUE,
    1e-6,
    1,
    Number.MAX_VALUE,
  ],
  drainage: [-0, 0, Number.MIN_VALUE, 0.999999e-12, 1e-12, 0.02, 1, Number.MAX_VALUE],
  dt: [-0, 0, Number.MIN_VALUE, 1e-12, 0.5, 1, Number.MAX_VALUE],
};
const encode = (value) => (Object.is(value, -0) ? '-0' : String(value));
const counts = {
  waterCases: 0,
  numericComparisons: 0,
  emptyNonpositiveCases: 0,
  baseInputRejections: 0,
  thermalCases: 0,
  thermalComparisons: 0,
};
const bank = new current.WaterStepCoefficients(3);
for (const water of grid.water)
  for (const source of grid.source)
    for (const drainage of grid.drainage)
      for (const dt of grid.dt) {
        const args = [water, source, drainage, dt];
        const expected = baseline.advanceWater(...args);
        const actuals = [current.advanceWater(...args)];
        for (let cell = 0; cell < 3; cell++)
          actuals.push(current.advanceWater(...args, bank, cell));
        for (const actual of actuals) {
          assert.ok(Object.is(actual, expected), `Water mismatch: ${args.map(encode).join(', ')}`);
          counts.numericComparisons++;
        }
        counts.waterCases++;
        if (water === 0 && source <= 0) {
          assert.ok(
            Object.is(expected, 0),
            'Empty nonpositive-source water must produce positive zero',
          );
          counts.emptyNonpositiveCases++;
        }
      }

const invalidBase = [];
for (let field = 0; field < 4; field++) {
  for (const value of [NaN, Infinity, -Infinity, undefined, null, '0', true]) {
    const args = [0, -1, 0.02, 0.5];
    args[field] = value;
    invalidBase.push(args);
  }
  if (field !== 1) {
    const args = [0, -1, 0.02, 0.5];
    args[field] = -1;
    invalidBase.push(args);
  }
}
for (const args of invalidBase)
  for (const useBank of [false, true]) {
    assert.throws(() => baseline.advanceWater(...args), { message: 'Invalid surface water step' });
    assert.throws(() => current.advanceWater(...args, useBank ? bank : undefined, NaN), {
      message: 'Invalid surface water step',
    });
    counts.baseInputRejections++;
  }

const invalidCellObservations = [];
const oneSlot = new current.WaterStepCoefficients(1);
for (const cell of [-1, 0.5, NaN, Infinity, -Infinity, 1, 2])
  for (const drainage of [0, 0.999e-12, 1e-12, 0.02]) {
    let outcome;
    if (drainage < 1e-12) {
      assert.ok(Object.is(current.advanceWater(0, -1, drainage, 0.5, oneSlot, cell), 0));
      outcome = '+0';
    } else {
      assert.throws(() => current.advanceWater(0, -1, drainage, 0.5, oneSlot, cell), {
        message: 'Invalid surface water coefficient cell',
      });
      outcome = 'Invalid surface water coefficient cell';
    }
    invalidCellObservations.push({ cell: encode(cell), drainage, outcome });
  }

const thermalStages = [
  {},
  { weather: { ambient: -0, rain: -0 } },
  { weather: { ambient: 0, rain: 0 } },
  { weather: { rain: 24, windX: -0, windZ: -0 } },
  { weather: { windX: 0, windZ: 0 } },
  { parameters: { surfaceCapacity: 31000, substrateCapacity: 190000 } },
  { parameters: { conduction: -0, deepConductance: -0, airBase: -0, airWind: -0 } },
  { parameters: { conduction: 0, deepConductance: 0, airBase: 0, airWind: 0 } },
  { parameters: { solarFlux: 0 } },
  { parameters: { ...baseline.SURFACE_THERMAL }, weather: { windX: 6, windZ: 1, rain: 44 } },
];
const parameters = [{ ...baseline.SURFACE_THERMAL }, { ...current.SURFACE_THERMAL }];
const thermal = [
  new baseline.SurfaceThermalStep(parameters[0]),
  new current.SurfaceThermalStep(parameters[1], 4),
];
const waterBank = new current.WaterStepCoefficients(4);
const weather = { ambient: 18, cloud: 0.4, rain: 12, windX: 2, windZ: -1 };
for (const stage of thermalStages) {
  for (const target of parameters) Object.assign(target, stage.parameters);
  Object.assign(weather, stage.weather);
  for (const sheltered of [false, true, false])
    for (const dt of [1 / 120, 0.5, 60, 0.5]) {
      for (const solver of thermal) solver.prepare(dt, weather, sheltered);
      for (let cell = 0; cell < 4; cell++) {
        const args = [
          [-0, 0, 24, 60][cell],
          20,
          cell * 0.125,
          sheltered ? 0 : [-0, 0, 0.001, 0.003][cell],
          [0, 1e-15, 0.02, 1][cell],
          cell * 17,
        ];
        thermal[0].advanceWet(...args);
        thermal[1].advanceWet(...args, cell, waterBank);
        for (const field of ['surface', 'substrate', 'water', 'evaporated']) {
          assert.ok(Object.is(thermal[0][field], thermal[1][field]), `Thermal mismatch: ${field}`);
          counts.thermalComparisons++;
        }
        counts.thermalCases++;
      }
      for (const solver of thermal) solver.advance(23, 20, 11);
      for (const field of ['surface', 'substrate']) {
        assert.ok(
          Object.is(thermal[0][field], thermal[1][field]),
          `Prepared rainfall mismatch: ${field}`,
        );
        counts.thermalComparisons++;
      }
    }
}

assert.deepEqual(counts, {
  waterCases: 3920,
  numericComparisons: 15680,
  emptyNonpositiveCases: 672,
  baseInputRejections: 62,
  thermalCases: 480,
  thermalComparisons: 2160,
});
assert.deepEqual(identity(roots.baseline), before.baseline, 'Original inputs changed');
assert.deepEqual(identity(roots.current), before.current, 'Current inputs changed');
assert.equal(sha256(readFileSync(scriptPath)), scriptIdentity, 'Proof script changed');
const report = {
  schema: 'engine-physics-cache-edge-proof-v1',
  passed: true,
  timingsCollected: false,
  productionChanged: false,
  sourceStable: true,
  runtime: { node: process.version, v8: process.versions.v8, execArgv: process.execArgv },
  script: { path: scriptPath, sha256: scriptIdentity },
  source: before,
  counts,
  waterGrid: Object.fromEntries(
    Object.entries(grid).map(([key, values]) => [key, values.map(encode)]),
  ),
  thermalFixture: {
    initialWeather: { ambient: 18, cloud: 0.4, rain: 12, windX: 2, windZ: -1 },
    stages: thermalStages,
    note: 'Signed-zero stages are preserved in the identified script; JSON numbers normalize -0.',
    sheltered: [false, true, false],
    dt: [1 / 120, 0.5, 60, 0.5],
    surface: ['-0', '0', '24', '60'],
    substrate: 20,
    localRainfall: ['-0', '0', '0.001', '0.003'],
    drainage: [0, 1e-15, 0.02, 1],
    waterPerCell: 0.125,
    heatPerCell: 17,
    restorePreparedRainfallArgs: [23, 20, 11],
  },
  invalidCellObservations,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ passed: true, timingsCollected: false, counts, output }));
