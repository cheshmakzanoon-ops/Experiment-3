/** Controlled CPU service benchmark. This is neither GPU FPS nor human-race
 * evidence. Compare an independently bundled base revision with current source:
 * node --expose-gc --experimental-transform-types scripts/pit-frame-cost.ts \
 *   test-results/pit-baseline.mjs test-results/pit-frame-cost.json
 * Keep the baseline bundle untracked; retain its SHA-256 with the result. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
import { performance } from 'node:perf_hooks';
import * as T from 'three';
import { PitCrewView } from '../src/rendering/pit-crew.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';

type ViewClass = typeof PitCrewView;
const camera = new T.Vector3(0, 3, 15);
function sample(count: number, tick: number) {
  const frame = new Float32Array(HEADER + count * CAR_STRIDE);
  frame[H.CARS] = count;
  frame[H.TIME] = 40 + tick / 60;
  frame[H.PHASE] = 3;
  for (let i = 0; i < count; i++) {
    const o = carBase(i),
      clock = (tick % 310) / 60;
    frame[o + F.QW] = Math.cos(i * 0.035);
    frame[o + F.QY] = Math.sin(i * 0.035);
    frame[o + F.X] = i * 6;
    frame[o + F.Y] = 0.6;
    frame[o + F.IN_PIT] = 1;
    frame[o + F.PIT_CLOCK] = clock;
    frame[o + F.PIT_PHASE] = clock < 0.8 ? 2 : clock < 2.2 ? 3 : clock < 3.5 ? 4 : 5;
    frame[o + F.JACK_HEIGHT] = Math.min(0.19, Math.max(0, clock - 0.8) * 0.16);
    for (let w = 0; w < 4; w++)
      frame[o + WHEEL_BASE + w * WHEEL_STRIDE + W.LENGTH] = 0.25 + 0.01 * w;
  }
  return frame;
}
function release(view: PitCrewView) {
  view.dispose();
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  view.root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    if (o.customDepthMaterial) materials.add(o.customDepthMaterial);
    if (o.customDistanceMaterial) materials.add(o.customDistanceMaterial);
    if (o instanceof T.InstancedMesh) o.dispose();
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
function state(view: PitCrewView) {
  const hash = createHash('sha256');
  const bytes = (array: ArrayBufferView) =>
    hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  for (const object of view.root.children) {
    const mesh = object as T.InstancedMesh;
    hash.update(String(mesh.count));
    bytes(mesh.instanceMatrix.array);
    if (mesh.instanceColor) bytes(mesh.instanceColor.array);
    const slot = mesh.geometry.getAttribute('crewSlot');
    if (slot) bytes(slot.array);
  }
  const material = (view.root.children[0] as T.Mesh).material as T.Material;
  const shader = {
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as Parameters<T.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  bytes((shader.uniforms.crewBones.value as T.DataTexture).image.data);
  const { poseBuilds: _builds, poseReuses: _reuses, ...diagnostics } = view.diagnostics();
  hash.update(JSON.stringify(diagnostics));
  return hash.digest('hex');
}
const baselinePath = process.argv[2];
if (!baselinePath) throw new Error('Supply an independently bundled baseline module');
const baselineBytes = readFileSync(resolve(baselinePath));
const baseline: { PitCrewView: ViewClass } = await import(
  pathToFileURL(resolve(baselinePath)).href
);
const rows = [];
for (const count of [1, 8, 12]) {
  const base = new baseline.PitCrewView(),
    current = new PitCrewView();
  const frames = Array.from({ length: 620 }, (_, tick) => sample(count, tick));
  const before = frames.map((f) => f.slice());
  const identity = createHash('sha256');
  try {
    // Establish equal eventual buffers before byte comparisons. The candidate
    // now creates both cloth colour attributes during loading; the original
    // lazily creates each on its first use. Cold shader behaviour is tested
    // separately, not hidden inside a warmed CPU benchmark.
    const warmCamera = new T.Vector3(0, 3, 70);
    for (const view of [base, current])
      for (const lens of [58, 20]) view.update(frames[108], warmCamera, true, lens);
    // Both detail levels, release/re-entry, rewind and moving service clocks.
    for (const tick of [0, 48, 81, 108, 132, 180, 195, 210, 276, 309, 108]) {
      for (const lens of [58, 20]) {
        base.update(frames[tick], camera, true, lens);
        current.update(frames[tick], camera, true, lens);
        const expected = state(base),
          actual = state(current);
        if (actual !== expected)
          throw new Error(`Changed service bytes: crews=${count}, tick=${tick}, lens=${lens}`);
        identity.update(expected);
      }
    }
    for (const view of [base, current]) view.update(frames[0], camera, false);
    if (state(base) !== state(current)) throw new Error('Changed inactive service');
    for (let repeat = 0; repeat < 2; repeat++)
      for (const view of [base, current]) for (const f of frames) view.update(f, camera);
    const timing: number[][] = [[], []];
    for (let repeat = 0; repeat < 8; repeat++) {
      for (const i of repeat % 2 ? [1, 0] : [0, 1]) {
        global.gc?.();
        const start = performance.now();
        for (const f of frames) [base, current][i].update(f, camera);
        timing[i].push((performance.now() - start) / frames.length);
      }
    }
    // Sampling is a separate run, not included in the elapsed timings. V8
    // accounts collected objects too; these are estimates, not exact heap bytes.
    const allocation = [];
    const session = new Session();
    session.connect();
    try {
      for (const view of [base, current]) {
        global.gc?.();
        await session.post('HeapProfiler.startSampling', {
          samplingInterval: 4096,
          includeObjectsCollectedByMajorGC: true,
          includeObjectsCollectedByMinorGC: true,
        });
        for (const f of frames) view.update(f, camera);
        const { profile } = await session.post('HeapProfiler.stopSampling');
        const total = (node: typeof profile.head): number =>
          node.selfSize + node.children.reduce((n, c) => n + total(c), 0);
        allocation.push(total(profile.head) / frames.length);
      }
    } finally {
      session.disconnect();
    }
    for (let i = 0; i < frames.length; i++)
      if (!frames[i].every((x, j) => Object.is(x, before[i][j])))
        throw new Error('Benchmark mutated a source snapshot');
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return (s[3] + s[4]) / 2;
    };
    rows.push({
      crews: count,
      actors: count * 15,
      verifiedStates: 23,
      stateSHA256: identity.digest('hex'),
      baselineMsPerUpdate: median(timing[0]),
      candidateMsPerUpdate: median(timing[1]),
      baselineSampledAllocatedBytesPerUpdate: allocation[0],
      candidateSampledAllocatedBytesPerUpdate: allocation[1],
      timingsMs: timing,
    });
  } finally {
    release(base);
    release(current);
  }
}
const report = {
  scope: 'Controlled Node CPU service updates; not full-scene GPU or target-hardware FPS',
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  baselineBundleSHA256: createHash('sha256').update(baselineBytes).digest('hex'),
  candidateSourceSHA256: createHash('sha256')
    .update(readFileSync('src/rendering/pit-crew.ts'))
    .digest('hex'),
  colourBufferWarmup:
    'Both baseline and candidate near/mid attributes warmed before state comparisons',
  samplingIntervalBytes: 4096,
  framesPerTimingRun: 620,
  alternatingTimingRuns: 8,
  rows,
};
writeFileSync(
  process.argv[3] ?? 'test-results/pit-frame-cost.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
