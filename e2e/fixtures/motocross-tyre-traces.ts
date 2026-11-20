import * as T from 'three';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../src/simulation/protocol.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { trackPoint } from '../../src/simulation/track.ts';
import { disposeTextureLoaders } from '../../src/rendering/assets/texture-loader.ts';
import { scannedGround } from '../../src/rendering/ground/scan-store.ts';
import { materials } from '../../src/rendering/materials/index.ts';
import { MxTyreTraces } from '../../src/rendering/offroad/mx-tyre-traces.ts';
import { Roost } from '../../src/rendering/offroad/roost.ts';
import { TerrainView } from '../../src/rendering/offroad/terrain-view.ts';

function changedPixels(a: Uint8Array, b: Uint8Array) {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4)
    if (
      Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2]),
      ) >= 3
    )
      changed++;
  return changed;
}

/** A loaded production motorcycle starts and rides on its real terrain. Use a
 * fixed camera over the travelled strip so a rewind can be compared pixel for
 * pixel with the same photographed soil before the wheel went over it. */
export async function captureMxTyrePassage(
  circuit: 'valley-ridge-mx' | 'arena-nord-sx',
  machine: 'sm450' | 'mx250' | 'mx450',
) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit,
    opponents: 0,
    laps: 1,
    mode: 'race',
    ruleset: machine === 'sm450' ? 'supermoto-moto' : 'motocross-moto',
    vehicles: [machine],
  });
  sim.autoPlayer = true;
  const view = new TerrainView(sim.track),
    marks = new MxTyreTraces(sim.track),
    roost = new Roost(sim.track);
  roost.groundHeight = (s, l) => view.heightAt(s, l);
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const width = 800,
    height = 500;
  renderer.setSize(width, height);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(48, width / height, 0.04, 90);
  scene.background = new T.Color(0xb8c6c5);
  const key = new T.DirectionalLight(0xffe6c5, 2.5);
  key.position.set(3, 6, 2);
  scene.add(
    view.group,
    marks.mesh,
    key,
    key.target,
    new T.HemisphereLight(0xcddbe3, 0x665544, 1.8),
  );
  const frame = new Float32Array(HEADER + CAR_STRIDE * sim.cars.length);
  const sliding = machine === 'sm450' ? new MxTyreTraces(sim.track) : null;
  const slideFrame = sliding ? new Float32Array(frame.length) : null;
  if (sliding) scene.add(sliding.mesh);
  try {
    materials.prepare(renderer);
    scannedGround.attach(renderer, 'high');
    if (!(await scannedGround.ready(60000))) throw new Error('Photographed soil failed to load');
    for (let i = 0; i < 3600 && marks.recordedSegments < 300; i++) {
      sim.step(1 / 120);
      if (i % 4 !== 0) continue;
      sim.writeFrame(frame);
      if (i % 120 === 0)
        view.record(sim.offroad!.terrain.renderDelta(i === 0), frame[H.TIME], true);
      marks.record(frame, roost);
      if (sliding && slideFrame) {
        // Identical measured wheel path, load and winding. Change only the slip
        // channel to see whether swept grooves disappear in a saturated slide.
        slideFrame.set(frame);
        const wheel = carBase(0) + WHEEL_BASE;
        slideFrame[wheel + W.SLIP] = slideFrame[wheel + 2 * WHEEL_STRIDE + W.SLIP] = 1;
        sliding.record(slideFrame, roost);
      }
    }
    const time = frame[H.TIME];
    const o = carBase(0),
      s = frame[o + F.S] - 3.6,
      l = frame[o + F.LATERAL];
    const p = sim.track.at(s, trackPoint());
    const target = new T.Vector3(p.x + p.nx * l, view.heightAt(p.s, l), p.z + p.nz * l);
    camera.position.copy(target);
    camera.position.x += p.nx * 0.92 - p.tx * 1.35;
    camera.position.z += p.nz * 0.92 - p.tz * 1.35;
    camera.position.y += 1.18;
    camera.lookAt(target);
    key.position.add(target);
    key.target.position.copy(target);
    const capture = (at: number, trail = marks) => {
      marks.mesh.visible = trail === marks;
      if (sliding) sliding.mesh.visible = trail === sliding;
      trail.show(at, view);
      renderer.render(scene, camera);
      const gl = renderer.getContext(),
        pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let hash = 2166136261;
      for (const v of pixels) hash = Math.imul(hash ^ v, 16777619) >>> 0;
      return {
        pixels,
        hash,
        glError: gl.getError(),
        calls: renderer.info.render.calls,
        image: renderer.domElement.toDataURL('image/png'),
      };
    };
    const before = capture(-1),
      after = capture(time),
      rewind = capture(-1),
      restored = capture(time);
    const slide = sliding && capture(time, sliding);
    return {
      circuit,
      machine,
      time,
      segments: marks.recordedSegments,
      changed: changedPixels(before.pixels, after.pixels),
      byteExactRewind: before.pixels.every((value, i) => value === rewind.pixels[i]),
      byteExactRestore: after.pixels.every((value, i) => value === restored.pixels[i]),
      saturatedSlipControl:
        slide && sliding
          ? {
              changed: changedPixels(after.pixels, slide.pixels),
              segments: sliding.recordedSegments,
              calls: slide.calls,
              error: slide.glError,
            }
          : null,
      width,
      height,
      calls: [before.calls, after.calls],
      hashes: [before.hash, after.hash, rewind.hash, restored.hash],
      errors: [before.glError, after.glError, rewind.glError, restored.glError],
      before: before.image,
      after: after.image,
    };
  } finally {
    sliding?.dispose();
    marks.dispose();
    roost.dispose();
    view.dispose();
    scannedGround.detach(renderer);
    await disposeTextureLoaders(renderer);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
