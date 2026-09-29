import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HeroGarage } from '../../src/rendering/hero-garage.ts';
import { PitWallStation } from '../../src/rendering/pit-wall-station.ts';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';

/** Real CircuitScene and production materials. Fixed inspection cameras are
 * separate from the normal-startup case, and are not a driven-lap certificate. */
export async function capturePitWall(
  encoded: string,
  garageEncoded: string,
  lighting: 'day' | 'sunset' | 'night',
) {
  const raw = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const loader = new GLTFLoader();
  const station = new PitWallStation((await loader.parseAsync(raw(encoded).buffer, '')).scene);
  const garage = new HeroGarage((await loader.parseAsync(raw(garageEncoded).buffer, '')).scene);
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    opponents: 1,
    mode: 'practice',
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 1887,
  });
  for (let i = 0; i < 12; i++) simulation.step(1 / 120);
  const earlier = simulation.makeFrame().slice();
  for (let i = 12; i < 96; i++) simulation.step(1 / 120);
  const frame = simulation.makeFrame(),
    saved = frame.slice(),
    water = simulation.track.water.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1280px;height:720px;display:block';
  document.body.style.cssText = 'margin:0;background:#10171b';
  document.body.append(canvas);
  const view = new RacingRenderer(canvas, simulation.track, true);
  view.circuit.heroGarage = garage;
  view.circuit.pitWallStation = station;
  view.circuit.construction.runSynchronously();
  const images: { view: string; image: string; addedCalls: number; triangles: number }[] = [];
  try {
    view.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
    view.lighting = lighting;
    view.draw(frame, frame, 1, 1 / 60);
    const point = (p: number[]) =>
      station.root.localToWorld(new T.Vector3(...(p as [number, number, number])));
    view.venueLighting.update(
      lighting !== 'day',
      point([0, 1, 0]),
      lighting === 'sunset' ? 0.18 : 1,
    );
    for (const shot of [
      { name: 'circuit-side', eye: [-6, 1.9, -9], target: [0, 1.3, 0], fov: 55 },
      { name: 'engineering-side', eye: [5, 2.0, -7.4], target: [-0.3, 1.36, 0], fov: 58 },
      { name: 'live-screens', eye: [1.4, 1.86, -0.65], target: [-0.6, 1.59, -0.875], fov: 59 },
    ]) {
      view.camera.position.copy(point(shot.eye));
      view.camera.lookAt(point(shot.target));
      view.camera.fov = shot.fov;
      view.camera.updateProjectionMatrix();
      view.camera.updateMatrixWorld(true);
      station.update(view.camera, 'high', lighting, frame, 'HELD');
      station.root.visible = false;
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      const baseline = view.renderer.info.render.calls;
      station.root.visible = true;
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      images.push({
        view: shot.name,
        image: canvas.toDataURL('image/png'),
        addedCalls: view.renderer.info.render.calls - baseline,
        triangles: view.renderer.info.render.triangles,
      });
    }
    const before = { ...view.renderer.info.memory },
      uploads = station.diagnostics().screenUploads;
    for (let i = 0; i < 5; i++) {
      station.update(view.camera, 'high', lighting, frame, 'HELD');
      view.renderer.render(view.scene, view.camera);
    }
    const pausedUploads = station.diagnostics().screenUploads;
    station.update(view.camera, 'high', lighting, earlier, 'REPLAY');
    view.renderer.render(view.scene, view.camera);
    const rewoundTime = station.diagnostics().screenTime;
    station.update(view.camera, 'high', lighting, frame, 'HELD');
    view.renderer.render(view.scene, view.camera);
    return {
      images,
      station: station.diagnostics(),
      before,
      after: { ...view.renderer.info.memory },
      uploads,
      pausedUploads,
      rewoundTime,
      expectedRewind: earlier[H.TIME],
      restoredTime: frame[H.TIME],
      placement: station.root.userData.placement,
      atlas: station.atlas.image.toDataURL('image/png'),
      frameUnchanged: frame.every((n, i) => n === saved[i]),
      waterUnchanged: simulation.track.water.every((n, i) => n === water[i]),
      glError: view.renderer.getContext().getError(),
      lights: view.scene.children.filter((o) => o instanceof T.Light).length,
      boundary:
        'Real-circuit fixed inspection, software graphics; not a hardware FPS or final-art approval.',
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
