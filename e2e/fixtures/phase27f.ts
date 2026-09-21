import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { configureSky, SkyEnvironment } from '../../src/rendering/daylight.ts';
import { RacingAudio } from '../../src/audio/engine.ts';
import { AudioViewTracker } from '../../src/audio/spatial.ts';
import { ReviewVideo } from '../../src/ui/review-video.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { carBase, F, H } from '../../src/simulation/protocol.ts';
import { reviewHardware } from '../../src/ui/review-hardware.ts';

/** Real production sky/PMREM rendering with held and restored states. A component
 * image is not a gameplay screenshot or a calibrated night-visibility score. */
export function nightSkyGPU() {
  const renderer = new T.WebGLRenderer({ antialias: false });
  renderer.setSize(384, 216);
  const scene = new T.Scene(),
    sky = new Sky();
  configureSky(sky);
  sky.scale.setScalar(450000);
  scene.add(sky);
  const camera = new T.PerspectiveCamera(65, 384 / 216, 0.1, 700000);
  camera.lookAt(-1, 0.25, -1);
  const environment = new SkyEnvironment(sky),
    target = new T.WebGLRenderTarget(384, 216);
  const render = (night: boolean, cloud: number) => {
    sky.material.uniforms.nightAmount.value = night ? 1 : 0;
    sky.material.uniforms.cloudCover.value = cloud;
    environment.update(renderer, scene, cloud, night);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(384 * 216 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 384, 216, pixels);
    const channels = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4)
      for (let c = 0; c < 3; c++) channels[c] += pixels[i + c];
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    return { pixels, channels, image: renderer.domElement.toDataURL('image/png') };
  };
  try {
    const day = render(false, 0.5),
      night = render(true, 0.5),
      held = render(true, 0.5);
    const clear = render(true, 0),
      restored = render(true, 0.5),
      restoredDay = render(false, 0.5);
    const same = (a: Uint8Array, b: Uint8Array) => a.every((v, i) => v === b[i]);
    return {
      captures: [
        { name: 'day', image: day.image },
        { name: 'cloud-night', image: night.image },
        { name: 'clear-night', image: clear.image },
      ],
      day: day.channels,
      night: night.channels,
      clear: clear.channels,
      heldExact: same(night.pixels, held.pixels),
      restoredExact: same(night.pixels, restored.pixels),
      dayRestoredExact: same(day.pixels, restoredDay.pixels),
      environmentCaptures: environment.captures,
      glError: renderer.getContext().getError(),
      hardware: reviewHardware(renderer.getContext()),
    };
  } finally {
    target.dispose();
    environment.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    renderer.dispose();
  }
}

let audio: RacingAudio | null = null;
/** The real browser click is required to start Web Audio; no autoplay-policy
 * override, microphone access or replacement oscillator is used. */
export function mountAudioStart() {
  audio = new RacingAudio();
  const button = document.createElement('button');
  button.id = 'startGameAudio';
  button.textContent = 'START GAME AUDIO';
  button.onclick = async () => {
    try {
      await audio!.start();
      button.dataset.started = 'true';
    } catch (error) {
      button.dataset.error = String(error);
    }
  };
  document.body.append(button);
}
export async function gameAudioVideoProbe() {
  if (!audio) throw new Error('Audio must be started through the real button');
  const engine = audio,
    canvas = document.createElement('canvas'),
    video = new ReviewVideo();
  canvas.width = 192;
  canvas.height = 108;
  document.body.append(canvas);
  const c = canvas.getContext('2d')!,
    sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  const view = new AudioViewTracker(),
    source = engine.captureOutput(),
    tracks = source.stream.getTracks();
  const camera = new T.PerspectiveCamera();
  video.start(canvas, source);
  try {
    if (video.state !== 'recording') throw new Error(video.reason ?? 'Encoder did not start');
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 6; j++) sim.step(1 / 120);
      const f = sim.makeFrame(),
        b = carBase(0);
      camera.position.set(f[b + F.X], f[b + F.Y] + 0.4, f[b + F.Z]);
      engine.update(f, true, true, view.update(camera, f[H.TIME], 1, true));
      c.fillStyle = '#172226';
      c.fillRect(0, 0, 192, 108);
      c.fillStyle = '#ededed';
      c.fillRect(i * 4, 40, 10, 30);
      video.frame();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    video.stop();
    for (let i = 0; i < 250 && video.diagnostics().state === 'stopping'; i++)
      await new Promise((r) => setTimeout(r, 20));
    if (!video.blob) throw new Error(video.reason ?? 'Encoder produced no output');
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(video.blob!);
    });
    return {
      video: encoded,
      diagnostics: video.diagnostics(),
      audio: engine.diagnostics(),
      tracksEnded: tracks.every((t) => t.readyState === 'ended'),
    };
  } finally {
    video.dispose();
    engine.dispose();
    audio = null;
    canvas.remove();
    document.getElementById('startGameAudio')?.remove();
  }
}

import { Interface } from '../../src/ui/interface.ts';
import { Track } from '../../src/simulation/track.ts';
import { referenceReview, bindReferenceReview } from '../../src/ui/reference-review.ts';
import { ReferenceEvidenceStore } from '../../src/ui/reference-evidence.ts';
let reviewUi: Interface | null = null;
export function mountEvidenceUi(mode: 'references' | 'session' | 'lap') {
  reviewUi?.closeModal();
  document.body.innerHTML = '';
  const root = document.createElement('main');
  document.body.append(root);
  const noop = () => {};
  reviewUi = new Interface(root, new Track(), {
    action: noop,
    start: noop,
    apply: noop,
    seek: noop,
    replaySpeed: noop,
    exportSetup: noop,
    importSetup: noop,
  });
  if (mode === 'session')
    reviewUi.sessionReview('UNVERIFIED — component layout fixture', false, true, false);
  else if (mode === 'lap')
    reviewUi.presentationReview(
      'UNVERIFIED — component layout fixture',
      'Automated UI fixture',
      false,
      false,
    );
  else {
    const context = { source: 'a'.repeat(64), store: new ReferenceEvidenceStore() };
    reviewUi.modalContent(referenceReview(context));
    bindReferenceReview(reviewUi.modal, context);
  }
}
