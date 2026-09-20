import * as T from 'three';
import { Vec3 } from '../../src/core/math.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { H, K, SKID_BASE, carBase } from '../../src/simulation/protocol.ts';
import { Effects, PARTICLE_KIND } from '../../src/rendering/effects.ts';
import { PresentedFrame } from '../../src/rendering/frame-state.ts';
import { EffectPlayback } from '../../src/rendering/effect-playback.ts';
import { FormulaCar } from '../../src/rendering/car.ts';
import { ReplayRecorder } from '../../src/storage/recorders.ts';

/** Controlled initial-condition contact experiment, not the full race acceptance.
 * Every recorded pose, contact position and work value comes from Vehicle.step.
 * Replay renders those same unmodified snapshots through production Effects. */
export function verifySkidContact() {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  const vehicle = sim.cars[0];
  vehicle.body.position.y -= 0.17;
  vehicle.body.orientation.rotate(new Vec3(0, 0, 30), vehicle.body.velocity);
  const frames = [sim.makeFrame()];
  for (let i = 0; i < 24; i++) {
    sim.step(1 / 120);
    if (i % 8 === 7) frames.push(sim.makeFrame());
  }
  const originals = frames.map((frame) => frame.slice());
  const recording = new ReplayRecorder(1, 2);
  for (const frame of frames) recording.append(frame);
  const live = new Effects(),
    replay = new Effects();
  const liveClock = new EffectPlayback(live),
    replayClock = new EffectPlayback(replay);
  for (const frame of frames) liveClock.update(frame);
  const a = recording.makeFrame(),
    b = recording.makeFrame(),
    presented = new PresentedFrame();
  // Use exact recorded times, not a synthetic force or event flag.
  for (const frame of frames) {
    const alpha = recording.sample(frame[H.TIME] - frames[0][H.TIME], a, b);
    replayClock.update(presented.sample(a, b, alpha));
  }
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(640, 400);
  document.body.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0x111920);
  scene.add(new T.HemisphereLight(0xffffff, 0x505868, 2));
  const sun = new T.DirectionalLight(0xffffff, 3);
  sun.position.set(3, 5, 2);
  scene.add(sun);
  const k = carBase(0) + SKID_BASE,
    last = frames[frames.length - 1];
  const contact = new T.Vector3().fromArray(last, k + K.SPARK_X);
  const ground = new T.Mesh(
    new T.PlaneGeometry(100, 100),
    new T.MeshStandardMaterial({ color: 0x283138, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.copy(contact);
  ground.position.y -= 0.03;
  scene.add(ground);
  const car = new FormulaCar(0);
  car.update(last, last, carBase(0), 0, 0, last[H.TIME], false);
  scene.add(car.root, live.group);
  const camera = new T.PerspectiveCamera(48, 640 / 400, 0.05, 100);
  camera.position.copy(contact).add(new T.Vector3(-4, 1.4, 1));
  camera.lookAt(contact.clone().add(new T.Vector3(0, 0.3, 1)));
  const target = new T.WebGLRenderTarget(640, 400);
  const pixels = () => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const data = new Uint8Array(640 * 400 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 640, 400, data);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    return data;
  };
  const changed = (x: Uint8Array, y: Uint8Array) => {
    let count = 0;
    for (let i = 0; i < x.length; i += 4)
      if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 8)
        count++;
    return count;
  };
  try {
    live.group.visible = false;
    const none = pixels();
    live.group.visible = true;
    const shown = pixels(),
      image = renderer.domElement.toDataURL();
    const births = live.diagnostics().spawned[PARTICLE_KIND.SPARK];
    for (let i = 0; i < 120; i++) liveClock.update(last);
    const pauseDifferences = changed(shown, pixels());
    scene.remove(live.group);
    scene.add(replay.group);
    const replayDifferences = changed(shown, pixels());
    return {
      image,
      births,
      replayBirths: replay.diagnostics().spawned[PARTICLE_KIND.SPARK],
      workJ: last[k + K.SPARK_WORK],
      contact: contact.toArray(),
      changedPixels: changed(none, shown),
      pauseDifferences,
      replayDifferences,
      finitePixels: renderer.getContext().getError() === renderer.getContext().NO_ERROR,
      sourcesUnchanged: frames.every((frame, index) =>
        frame.every((v, word) => v === originals[index][word]),
      ),
      frameCount: frames.length,
    };
  } finally {
    target.dispose();
    for (const root of [scene, live.group])
      root.traverse((object) => {
        if (object instanceof T.Mesh || object instanceof T.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    renderer.dispose();
  }
}
