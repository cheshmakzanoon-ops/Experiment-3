import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Compare only ResponseModel so unrelated predictor/metrics changes do not
 * contaminate its numerical or CPU comparison. Each timing sample gets a fresh
 * Node process and uses precomputed inputs. No asset generation is involved. */
async function loadModel(file) {
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf('const BINS = 20,');
  const end = source.indexOf('\nexport interface PredictorOptions', start);
  assert.ok(start >= 0 && end > start, `ResponseModel section missing in ${file}`);
  const section = source.slice(start, end);
  const javascript = ts.transpileModule(section, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
  );
  return {
    Model: module.ResponseModel,
    sha256: createHash('sha256').update(section).digest('hex'),
  };
}

function makeInputs(count = 4096) {
  let seed = 293710;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => {
    const throttle = i % 11 === 0 ? 1 : random();
    const brake = i % 13 === 0 ? random() : 0;
    const steer = random() * 2 - 1;
    return {
      speed: (i % 20) * 5 + random() * 5,
      aLong: -1.2 + 14 * throttle - 35 * brake + (random() - 0.5) * 0.1,
      yaw: steer * (0.2 + random() * 0.4),
      input: { throttle, brake, steer, clutch: 0, gearUp: false, gearDown: false },
    };
  });
}

function exercise(Model, inputs, count, train = true) {
  const model = new Model();
  let checksum = 0;
  for (let i = 0; i < 8192; i++) {
    const v = inputs[i % inputs.length];
    model.observe(v.speed, v.aLong, v.yaw, v.input);
  }
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    const v = inputs[i % inputs.length];
    if (train) model.observe(v.speed, v.aLong, v.yaw, v.input);
    const gain = model.longGain(v.speed);
    checksum += gain[0] + gain[1] + model.yawGain(v.speed);
  }
  return { milliseconds: performance.now() - start, checksum };
}

function countContainerCalls(Model) {
  const model = new Model(),
    inputs = makeInputs(),
    originalFrom = Array.from,
    originalSubarray = Float64Array.prototype.subarray;
  const counts = { operations: 10000, arrayFrom: 0, typedArraySubarray: 0 };
  try {
    Array.from = function (...args) {
      counts.arrayFrom++;
      return Reflect.apply(originalFrom, this, args);
    };
    Float64Array.prototype.subarray = function (...args) {
      counts.typedArraySubarray++;
      return Reflect.apply(originalSubarray, this, args);
    };
    for (let i = 0; i < counts.operations; i++) {
      const v = inputs[i % inputs.length];
      model.observe(v.speed, v.aLong, v.yaw, v.input);
      model.longGain(v.speed);
    }
  } finally {
    Array.from = originalFrom;
    Float64Array.prototype.subarray = originalSubarray;
  }
  return counts;
}

if (process.argv[2] === '--worker') {
  const { Model } = await loadModel(resolve(process.argv[3]));
  const inputs = makeInputs();
  exercise(Model, inputs, 100000);
  globalThis.gc?.();
  const combined = exercise(Model, inputs, 250000);
  globalThis.gc?.();
  const queryOnly = exercise(Model, inputs, 250000, false);
  console.log(JSON.stringify({ combined, queryOnly }));
} else {
  const [baseline, candidate, output] = process.argv.slice(2).map((p) => resolve(p));
  if (!baseline || !candidate) {
    throw new Error(
      'Usage: node scripts/prediction-response-benchmark.mjs BASELINE_PREDICTION_TS CANDIDATE_PREDICTION_TS [OUTPUT_JSON]',
    );
  }
  const a = await loadModel(baseline),
    b = await loadModel(candidate);
  const inputs = makeInputs();
  const digest = createHash('sha256');
  const bytes = Buffer.alloc(8);
  let observations = 0,
    queries = 0;
  for (let run = 0; run < 32; run++) {
    const before = new a.Model(),
      after = new b.Model();
    for (let i = 0; i < 4096; i++) {
      const v = inputs[(i + run * 53) % inputs.length];
      const speed = v.speed + ((run % 3) - 1) * 0.00001;
      before.observe(speed, v.aLong, v.yaw, v.input);
      after.observe(speed, v.aLong, v.yaw, v.input);
      observations++;
      for (const at of [speed, 0, 4.999999, 5, 95, 1000]) {
        const expected = [...before.longGain(at), before.yawGain(at)];
        const actual = [...after.longGain(at), after.yawGain(at)];
        assert.deepStrictEqual(actual, expected);
        for (const value of actual) {
          bytes.writeDoubleLE(value);
          digest.update(bytes);
        }
        queries++;
      }
    }
    assert.equal(after.observations, before.observations);
    for (const key of ['normal', 'target', 'yawNum', 'yawDen']) {
      assert.deepStrictEqual(after[key], before[key]);
    }
  }
  const samples = { baseline: [], candidate: [] };
  const script = fileURLToPath(import.meta.url);
  for (let repetition = 0; repetition < 5; repetition++) {
    // Alternate execution order to avoid always assigning a warmer host to one side.
    const order = repetition % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (const name of order) {
      const child = spawnSync(
        process.execPath,
        ['--expose-gc', script, '--worker', name === 'baseline' ? baseline : candidate],
        {
          encoding: 'utf8',
          env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' },
        },
      );
      if (child.status !== 0)
        throw new Error(child.stderr || `benchmark worker exited ${child.status}`);
      samples[name].push(JSON.parse(child.stdout));
    }
  }
  for (let i = 0; i < samples.baseline.length; i++) {
    for (const kind of ['combined', 'queryOnly']) {
      assert.equal(samples.baseline[i][kind].checksum, samples.candidate[i][kind].checksum);
    }
  }
  const medians = Object.fromEntries(
    Object.entries(samples).map(([name, runs]) => [
      name,
      Object.fromEntries(
        ['combined', 'queryOnly'].map((kind) => [
          kind,
          runs.map((r) => r[kind].milliseconds).sort((x, y) => x - y)[2],
        ]),
      ),
    ]),
  );
  const result = {
    node: process.version,
    sourceSectionSHA256: { baseline: a.sha256, candidate: b.sha256 },
    observations,
    queries,
    traceSHA256: digest.digest('hex'),
    containerFactoryCalls: {
      baseline: countContainerCalls(a.Model),
      candidate: countContainerCalls(b.Model),
    },
    iterationsPerTimingSample: 250000,
    samples,
    medianMilliseconds: medians,
    limitation:
      'Isolated ResponseModel CPU microbenchmark, not frame time, total client CPU, or a heap-allocation profiler.',
  };
  if (output) writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
