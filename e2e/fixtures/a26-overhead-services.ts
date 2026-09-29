import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HeroGarage } from '../../src/rendering/hero-garage.ts';
import { decodeOverheadServiceRig } from '../../src/rendering/overhead-garage-service-rig.ts';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';

/** Real circuit, actual materials and rendering; scripted moving inspection, not a driven lap. */
export async function captureA26(
  encodedGarage: string,
  encodedRig: string,
  lighting: 'day' | 'sunset' | 'night',
  wet: boolean,
) {
  const unpack = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(unpack(encodedGarage).buffer, '');
  const garage = new HeroGarage(gltf.scene);
  const rig = await decodeOverheadServiceRig(unpack(encodedRig));
  garage.overhead = rig;
  rig.attachTo(garage.root, garage.levels);
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    opponents: 0,
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
  const images: { view: string; image: string; addedCalls: number; triangles: number }[] = [];
  const errors: number[] = [];
  try {
    view.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
    view.lighting = lighting;
    view.draw(frame, frame, 1, 1 / 60);
    const point = (p: number[]) => garage.root.localToWorld(new T.Vector3().fromArray(p));
    view.venueLighting.update(
      lighting !== 'day',
      point([0, 1, 0]),
      lighting === 'sunset' ? 0.18 : 1,
    );
    for (const shot of [
      { name: 'entrance-services', eye: [-5.8, 1.8, 0], target: [1.8, 2.8, 0], fov: 64 },
      { name: 'reels', eye: [-5.1, 1.8, 0.9], target: [-3.5, 2.35, 3.25], fov: 58 },
      { name: 'rear-to-front', eye: [4.8, 1.75, -0.3], target: [-4, 2.75, 0], fov: 65 },
    ]) {
      view.camera.position.copy(point(shot.eye));
      view.camera.lookAt(point(shot.target));
      view.camera.fov = shot.fov;
      view.camera.updateProjectionMatrix();
      garage.update(view.camera, 'high', lighting);
      rig.levels.forEach((o) => {
        o.visible = false;
      });
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      const baseline = view.renderer.info.render.calls;
      rig.levels.forEach((o) => {
        o.visible = true;
      });
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      images.push({
        view: shot.name,
        image: canvas.toDataURL('image/png'),
        addedCalls: view.renderer.info.render.calls - baseline,
        triangles: view.renderer.info.render.triangles,
      });
      errors.push(view.renderer.getContext().getError());
    }
    // Warm the moving route before measuring retained geometry/texture allocations.
    const setCamera = (t: number) => {
      view.camera.position.copy(point([-5.6 + t * 8, 1.7, Math.sin(t * Math.PI) * 0.6]));
      view.camera.lookAt(point([4.8 - t * 8, 2.75, 0]));
      garage.update(view.camera, 'high', lighting);
      view.renderer.render(view.scene, view.camera);
    };
    for (let i = 0; i <= 12; i++) setCamera(i / 12);
    const before = { ...view.renderer.info.memory };
    for (let i = 0; i <= 12; i++) {
      setCamera(i / 12);
      errors.push(view.renderer.getContext().getError());
      if (i === 6 || i === 12)
        images.push({
          view: 'move-' + i,
          image: canvas.toDataURL('image/png'),
          addedCalls: 0,
          triangles: view.renderer.info.render.triangles,
        });
    }
    let lights = 0;
    view.scene.traverse((o) => {
      if (o instanceof T.Light) lights++;
    });
    return {
      lighting,
      wet,
      images,
      errors,
      before,
      after: { ...view.renderer.info.memory },
      lights,
      garage: garage.diagnostics(),
      sourceUnchanged: frame.every((n, i) => n === original[i]),
      waterUnchanged: simulation.track.water.every((n, i) => n === water[i]),
      boundary:
        'Actual CircuitScene scripted moving survey; no cockpit repair, driven lap or physical-hardware certification.',
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
