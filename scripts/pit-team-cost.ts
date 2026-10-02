/** Reproducible CPU-only pose workload. Synthetic frames are not gameplay,
 * consumer-GPU performance, or a benchmark of the complete renderer. */
import * as T from 'three';
import { PitCrewView } from '../src/rendering/pit-crew.ts';
import { HEADER, CAR_STRIDE, H, F, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
const camera = new T.Vector3();
const result = [];
for (const cars of [1, 12]) {
  const view = new PitCrewView();
  const frame = new Float32Array(HEADER + cars * CAR_STRIDE);
  frame[H.CARS] = cars;
  const samples: number[] = [];
  try {
    for (let i = 0; i < 360; i++) {
      const t = 0.02 + (i % 104) * 0.05;
      for (let id = 0; id < cars; id++) {
        const b = carBase(id);
        frame[b + F.QW] = 1;
        frame[b + F.X] = id * 6;
        frame[b + F.Y] = 0.6;
        frame[b + F.PIT_CLOCK] = t;
        frame[b + F.PIT_PHASE] = t < 0.8 ? 2 : t < 2.2 ? 3 : t < 3.5 ? 4 : 5;
        frame[b + F.JACK_HEIGHT] = t < 3.5 ? Math.min(0.19, Math.max(0, t - 0.8) * 0.16) : Math.max(0, 0.19 - (t - 3.5) * 0.16);
        for (let w = 0; w < 4; w++) frame[b + WHEEL_BASE + w * WHEEL_STRIDE + W.LENGTH] = 0.3;
      }
      const start = performance.now();
      view.update(frame, camera);
      const elapsed = performance.now() - start;
      if (i >= 48) samples.push(elapsed);
    }
    samples.sort((a, b) => a - b);
    result.push({ cars, samples: samples.length, medianMs: samples[Math.floor(samples.length * 0.5)], p95Ms: samples[Math.floor(samples.length * 0.95)], ...view.summary() });
  } finally {
    view.dispose();
  }
}
console.log(JSON.stringify({ boundary: 'Synthetic CPU pose workload; no WebGL, texture decoding, actual race or consumer-GPU timing.', node: process.version, platform: process.platform, results: result }, null, 2));
