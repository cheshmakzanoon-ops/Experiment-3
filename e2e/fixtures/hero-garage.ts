import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HeroGarage } from '../../src/rendering/hero-garage.ts';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';

/** Offline inspection of the real CircuitScene. The caller verifies asset bytes;
 * the normal-startup case independently tests the production network loader. */
export async function captureHeroGarage(
  encoded: string,
  lighting: 'day' | 'sunset' | 'night',
  wet: boolean,
) {
  const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(raw.buffer, '');
  const garage = new HeroGarage(gltf.scene);
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    opponents: 0,
    mode: 'practice',
    weather: wet ? 'rain' : 'clear',
    seed: 1887,
  });
  for (let i = 0; i < 96; i++) simulation.step(1 / 120);
  const frame = simulation.makeFrame(),
    original = frame.slice(),
    water = simulation.track.water.slice();
  document.body.style.cssText = 'margin:0;background:#101515';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1280px;height:720px;display:block';
  document.body.append(canvas);
  const view = new RacingRenderer(canvas, simulation.track, true);
  view.circuit.heroGarage = garage;
  view.circuit.construction.runSynchronously();
  const images: {
    view: string;
    image: string;
    calls: number;
    triangles: number;
    addedCalls: number;
  }[] = [];
  try {
    view.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
    view.lighting = lighting;
    view.draw(frame, frame, 1, 1 / 60);
    const point = (p: number[]) =>
      garage.root.localToWorld(new T.Vector3(...(p as [number, number, number])));
    view.venueLighting.update(
      lighting !== 'day',
      point([0, 1, 0]),
      lighting === 'sunset' ? 0.18 : 1,
    );
    for (const shot of [
      { name: 'pit-approach', eye: [-14, 2.25, -5.8], target: [-1.5, 2.4, 0], fov: 55 },
      { name: 'open-interior', eye: [-5.65, 1.65, 0], target: [5.9, 1.65, 0], fov: 64 },
      { name: 'workstation', eye: [-1.8, 1.55, 0.2], target: [2.4, 1.35, 3.05], fov: 58 },
    ]) {
      view.camera.position.copy(point(shot.eye));
      view.camera.lookAt(point(shot.target));
      view.camera.fov = shot.fov;
      view.camera.updateProjectionMatrix();
      garage.update(view.camera, 'high', lighting);
      garage.root.visible = false;
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      const baseline = view.renderer.info.render.calls;
      garage.root.visible = true;
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      images.push({
        view: shot.name,
        image: canvas.toDataURL('image/png'),
        calls: view.renderer.info.render.calls,
        triangles: view.renderer.info.render.triangles,
        addedCalls: view.renderer.info.render.calls - baseline,
      });
    }
    const before = { ...view.renderer.info.memory };
    for (let i = 0; i < 3; i++) {
      garage.update(view.camera, 'high', lighting);
      view.renderer.render(view.scene, view.camera);
    }
    return {
      lighting,
      wet,
      images,
      before,
      after: { ...view.renderer.info.memory },
      garage: garage.diagnostics(),
      sourceUnchanged: frame.every((n, i) => n === original[i]),
      waterUnchanged: simulation.track.water.every((n, i) => n === water[i]),
      glError: view.renderer.getContext().getError(),
      replacedLegacyBay: !view.circuit.props.children.some((o) => o.name === 'Open garage bay 5'),
      boundary: 'Offline real-circuit inspection; not a driven lap or hardware FPS certification.',
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
