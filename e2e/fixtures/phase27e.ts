import * as T from 'three';
import { SprayClouds } from '../../src/rendering/spray-clouds.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../../src/simulation/protocol.ts';
import {
  ReferenceEvidenceStore,
  type RenderedReferenceEvidence,
} from '../../src/ui/reference-evidence.ts';
import { referenceReview, bindReferenceReview } from '../../src/ui/reference-review.ts';
import { ReviewVideo } from '../../src/ui/review-video.ts';
import {
  PresentationReview,
  reviewFrame,
  readPresentationReport,
} from '../../src/rendering/presentation-review.ts';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';

/** Controlled shader diagnostic: real uniform upload/readback, not an image of
 * a race or a claim of volumetric accuracy. Existing spray gates stay separate. */
export function signalSprayGPU() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(256, 256);
  renderer.outputColorSpace = T.SRGBColorSpace;
  const scene = new T.Scene();
  scene.background = new T.Color(0x000000);
  const camera = new T.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, -8);
  camera.lookAt(0, 0, 0);
  scene.add(new T.AmbientLight(0xffffff, 0.03));
  const centers = new Float32Array([0, -0.23, -3.2]),
    velocities = new Float32Array([0.2, 0.1, -5]),
    sizes = new Float32Array([1.1]),
    opacity = new Float32Array([0.65]),
    kinds = new Uint8Array([0]);
  const spray = new SprayClouds(centers, velocities, sizes, opacity, kinds);
  scene.add(spray.mesh);
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  frame[H.TIME] = 1;
  frame[carBase(0) + F.QW] = 1;
  frame[carBase(0) + F.BRAKE] = 0.8;
  const before = frame.slice(),
    centersBefore = centers.slice(),
    velocityBefore = velocities.slice();
  const target = new T.WebGLRenderTarget(256, 256),
    pixels = new Uint8Array(256 * 256 * 4);
  const capture = (enabled: boolean) => {
    spray.signals.update(frame, enabled);
    spray.upload();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
    const channels = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4)
      for (let c = 0; c < 3; c++) channels[c] += pixels[i + c];
    return {
      channels,
      draws: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      image: pixels.slice(),
    };
  };
  try {
    const off = capture(false),
      on = capture(true),
      held = capture(true);
    frame[carBase(0) + F.X] = 30;
    const distant = capture(true);
    frame.set(before);
    const restored = capture(true);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    return {
      off: off.channels,
      on: on.channels,
      distant: distant.channels,
      pauseExact: on.image.every((v, i) => v === held.image[i]),
      rewindExact: on.image.every((v, i) => v === restored.image[i]),
      sourceUnchanged:
        frame.every((v, i) => v === before[i]) &&
        centers.every((v, i) => v === centersBefore[i]) &&
        velocities.every((v, i) => v === velocityBefore[i]),
      draws: on.draws,
      triangles: on.triangles,
      glError: renderer.getContext().getError(),
      image: renderer.domElement.toDataURL('image/png'),
    };
  } finally {
    spray.geometry.dispose();
    spray.material.dispose();
    target.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
let store: ReferenceEvidenceStore;
const source = 'a'.repeat(64); // Explicit fixture identity, not a released source build.
export function beginReferenceEvidenceUI() {
  store = new ReferenceEvidenceStore();
  document.body.innerHTML = '<main id="referenceHost"></main>';
  const host = document.getElementById('referenceHost')!;
  host.innerHTML = referenceReview({ source, store });
  bindReferenceReview(host, { source, store });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#537865';
  context.fillRect(0, 0, 64, 64);
  return {
    png: canvas.toDataURL('image/png'),
    source,
    rows: host.querySelectorAll('[data-reference]').length,
  };
}
export function attachReferenceEvidence(id: number, evidence: RenderedReferenceEvidence) {
  store.capture(id, evidence);
}
export function readReferenceEvidence(id: number) {
  return store.get(id, source);
}

/** Exercise the browser's actual encoder/track lifetime. Diagnostic 2D frames
 * test recording mechanics; they are not represented as game footage. */
export async function reviewVideoProbe() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 64;
  document.body.append(canvas);
  const c = canvas.getContext('2d')!,
    video = new ReviewVideo();
  video.start(canvas);
  try {
    if (video.state === 'unavailable')
      return { supported: false, ...video.diagnostics(), encodedBytes: 0, video: '' };
    for (let i = 0; i < 20; i++) {
      c.fillStyle = `rgb(${i * 10},70,100)`;
      c.fillRect(0, 0, 96, 64);
      c.fillStyle = '#fff';
      c.fillRect(i * 4, 16, 12, 12);
      video.frame();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    video.stop();
    for (let i = 0; i < 200 && video.state === 'stopping'; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const result = video.diagnostics(),
      blob = video.blob;
    const encoded = blob
      ? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        })
      : '';
    return { supported: true, ...result, encodedBytes: blob?.size ?? 0, video: encoded };
  } finally {
    video.dispose();
    canvas.remove();
  }
}

/** Real production simulation and complete renderer/postprocessing. This short
 * moving/held sequence validates observation wiring; it is NOT a complete lap. */
export async function reviewRendererProbe(night: boolean) {
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    weather: 'rain',
    compound: 'wet',
    opponents: 1,
    seed: 1887,
  });
  simulation.autoPlayer = true;
  for (let i = 0; i < 720; i++) simulation.step(1 / 120);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:960px;height:540px;display:block';
  document.body.style.cssText = 'margin:0;background:#000';
  document.body.append(canvas);
  const renderer = new RacingRenderer(canvas, simulation.track);
  renderer.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
  renderer.night = night;
  const metrics = reviewFrame(),
    review = new PresentationReview();
  let frame = simulation.makeFrame(),
    unchanged = true;
  const captures: {
    view: string;
    image: string;
    exposure: number;
    draws: number;
    triangles: number;
  }[] = [];
  try {
    renderer.changeCamera('cockpit');
    renderer.draw(frame, frame, 1, 1 / 60, false);
    renderer.readReviewMetrics(metrics);
    review.start(
      {
        source,
        machine: 'component-fixture-not-consumer-benchmark',
        browser: navigator.userAgent,
        configuration: JSON.stringify(renderer.graphics),
        workload: night ? 'wet-night' : 'wet-day',
        camera: 'cockpit',
        mode: 'full-lap',
        trackLength: simulation.track.length,
        startS: frame[carBase(0) + F.S],
        startLaps: frame[carBase(0) + F.LAPS],
        startTime: frame[H.TIME],
        followedCar: 0,
        videoRequested: false,
      },
      performance.now(),
      metrics.gpuSequence,
    );
    for (let i = 0; i < 24; i++) {
      for (let tick = 0; tick < 4; tick++) simulation.step(1 / 120);
      frame = simulation.makeFrame();
      const copy = frame.slice();
      renderer.draw(frame, frame, 1, 1 / 30, false);
      renderer.readReviewMetrics(metrics);
      review.record(performance.now(), metrics);
      unchanged &&= frame.every((v, j) => v === copy[j]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    review.interrupt('Short rendering regression ends here; not a full-lap acceptance');
    const report = readPresentationReport(review.report());
    const heldFrame = frame.slice(),
      water = simulation.track.water.slice();
    for (const mode of ['cockpit', 'chase', 'pod', 'trackside'] as const) {
      renderer.changeCamera(mode);
      renderer.draw(frame, frame, 1, 0, false);
      renderer.readReviewMetrics(metrics);
      captures.push({
        view: `${night ? 'night' : 'day'}-${mode}`,
        image: canvas.toDataURL('image/png'),
        exposure: metrics.exposure,
        draws: metrics.drawCalls,
        triangles: metrics.triangles,
      });
    }
    return {
      report,
      unchanged:
        unchanged &&
        frame.every((v, i) => v === heldFrame[i]) &&
        simulation.track.water.every((v, i) => v === water[i]),
      captures,
      metrics,
      signalSources: renderer.effects.signalSourceCount,
      glError: renderer.renderer.getContext().getError(),
    };
  } finally {
    renderer.dispose();
    canvas.remove();
  }
}
