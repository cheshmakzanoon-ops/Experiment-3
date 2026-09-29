import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TyreBlanketSet } from '../../src/rendering/tyre-blankets.ts';
import { HeroGarage } from '../../src/rendering/hero-garage.ts';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { shadowAnchor, lightingDirection } from '../../src/rendering/daylight.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
/** Real circuit, normal materials and weather. Fixed survey and moving-camera
 * evidence is separate from the normal startup test, not a human-driven lap. */
export async function captureBlankets(
  encoded: string,
  garageEncoded: string,
  lighting: 'day' | 'sunset' | 'night',
) {
  const raw = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const loader = new GLTFLoader();
  const kit = new TyreBlanketSet((await loader.parseAsync(raw(encoded).buffer, '')).scene);
  const garage = new HeroGarage((await loader.parseAsync(raw(garageEncoded).buffer, '')).scene);
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    opponents: 0,
    mode: 'practice',
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 1887,
  });
  for (let i = 0; i < 96; i++) simulation.step(1 / 120);
  const frame = simulation.makeFrame(),
    saved = frame.slice(),
    water = simulation.track.water.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1280px;height:720px;display:block';
  document.body.style.cssText = 'margin:0;background:#10171b';
  document.body.append(canvas);
  const view = new RacingRenderer(canvas, simulation.track, true);
  view.circuit.heroGarage = garage;
  view.circuit.tyreBlankets = kit;
  view.circuit.construction.runSynchronously();
  const images: { view: string; image: string; addedCalls: number; triangles: number }[] = [];
  try {
    view.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
    view.lighting = lighting;
    view.draw(frame, frame, 1, 1 / 60);
    const point = (p: number[]) =>
      kit.root.localToWorld(new T.Vector3(...(p as [number, number, number])));
    // Use the normal sun-shadow anchor around this inspection subject, not the
    // distant car spawn. No extra scene light or stronger exposure is introduced.
    shadowAnchor(
      point([0, 0, 0]),
      view.sun.shadow.mapSize.x,
      view.sun.shadow.camera.right,
      view.sun.target.position,
      lighting,
    );
    view.sun.position.copy(view.sun.target.position).add(lightingDirection(lighting));
    view.sun.target.updateMatrixWorld();
    view.venueLighting.update(
      lighting !== 'day',
      point([0, 1, 0]),
      lighting === 'sunset' ? 0.18 : 1,
    );
    for (const shot of [
      { name: 'garage-wide', eye: [-5.8, 2.15, 3.1], target: [-0.15, 0.45, 0], fov: 65 },
      { name: 'fitted-front-detail', eye: [-2.85, 1.02, 3.05], target: [-2, 0.43, 1.7], fov: 58 },
      {
        name: 'controller-detail',
        eye: [-0.48, 0.65, -1.65],
        target: [-0.2, 0.23, -2.75],
        fov: 58,
      },
    ]) {
      view.camera.position.copy(point(shot.eye));
      view.camera.lookAt(point(shot.target));
      view.camera.fov = shot.fov;
      view.camera.updateProjectionMatrix();
      view.camera.updateMatrixWorld(true);
      garage.update(view.camera, 'high', lighting);
      kit.update(view.camera, 'high', lighting);
      kit.alignGarageWheels(garage.spareWheelStorage);
      kit.root.visible = false;
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      const base = view.renderer.info.render.calls;
      kit.root.visible = true;
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      images.push({
        view: shot.name,
        image: canvas.toDataURL('image/png'),
        addedCalls: view.renderer.info.render.calls - base,
        triangles: view.renderer.info.render.triangles,
      });
    }
    const before = { ...view.renderer.info.memory };
    for (let i = 0; i < 8; i++) {
      view.camera.position.copy(point([-5.8 + i * 0.42, 1.35, 2.6]));
      view.camera.lookAt(point([-0.3, 0.46, 0.1]));
      view.camera.updateMatrixWorld(true);
      garage.update(view.camera, 'high', lighting);
      kit.update(view.camera, 'high', lighting);
      kit.alignGarageWheels(garage.spareWheelStorage);
      view.renderer.render(view.scene, view.camera);
    }
    const after = { ...view.renderer.info.memory };
    images.push({
      view: 'moving-inspection-end',
      image: canvas.toDataURL('image/png'),
      addedCalls: 0,
      triangles: view.renderer.info.render.triangles,
    });
    const wireCamera = view.camera.position.clone();
    kit.setDetail(80, 'high');
    view.renderer.render(view.scene, view.camera);
    const far = kit.diagnostics();
    view.camera.position.copy(wireCamera);
    kit.update(view.camera, 'high', lighting);
    const glError = view.renderer.getContext().getError();
    return {
      images,
      before,
      after,
      kit: kit.diagnostics(),
      far,
      glError,
      frameUnchanged: frame.every((v, i) => v === saved[i]),
      waterUnchanged: water.every((v, i) => v === simulation.track.water[i]),
      boundary:
        'Real CircuitScene fixed and moving inspection, not a driven lap, target-GPU measurement or final-art approval.',
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
