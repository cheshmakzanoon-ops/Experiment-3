import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TyreEquipmentKit, installTyreEquipment } from '../../src/rendering/tyre-trolleys-racks.ts';
import { TyreBlanketSet } from '../../src/rendering/tyre-blankets.ts';
import { shadowAnchor, lightingDirection } from '../../src/rendering/daylight.ts';
import { HeroGarage } from '../../src/rendering/hero-garage.ts';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';

/** Real CircuitScene/materials; fixed and moving survey cameras are not a driven lap. */
export async function captureTyreEquipment(
  encoded: string,
  garageEncoded: string,
  lighting: 'day' | 'sunset' | 'night',
  blanketsEncoded: string,
) {
  const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
  const loader = new GLTFLoader();
  const kit = new TyreEquipmentKit((await loader.parseAsync(bytes(encoded), '')).scene);
  const garage = new HeroGarage((await loader.parseAsync(bytes(garageEncoded), '')).scene);
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    opponents: 0,
    mode: 'practice',
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 3535,
  });
  for (let i = 0; i < 96; i++) simulation.step(1 / 120);
  const frame = simulation.makeFrame(),
    beforeFrame = frame.slice(),
    water = simulation.track.water.slice();
  document.body.style.cssText = 'margin:0;background:#101515';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1280px;height:720px;display:block';
  document.body.append(canvas);
  const view = new RacingRenderer(canvas, simulation.track, true);
  view.circuit.heroGarage = garage;
  const blankets = new TyreBlanketSet((await loader.parseAsync(bytes(blanketsEncoded), '')).scene);
  view.circuit.tyreBlankets = blankets;
  view.tyreEquipment = installTyreEquipment(kit, simulation.track);
  view.circuit.group.add(kit.root);
  view.circuit.construction.runSynchronously();
  const images: {
    name: string;
    image: string;
    addedCalls: number;
    calls: number;
    triangles: number;
  }[] = [];
  try {
    view.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
    view.lighting = lighting;
    // Exercise the normal renderer (including its existing weather / reflection paths) first.
    view.draw(frame, frame, 1, 1 / 60);
    const point = (p: number[]) => garage.root.localToWorld(new T.Vector3().fromArray(p));
    // Use the existing sun shadow anchor around the inspection subject.
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
      { name: 'loaded-trolley', eye: [-4.5, 1.7, -0.8], target: [-2.2, 0.82, -3.35], fov: 53 },
      { name: 'empty-return', eye: [-5.9, 1.3, -1.5], target: [-4.7, 0.85, -3.35], fov: 58 },
      { name: 'full-rack', eye: [2.7, 1.8, -0.6], target: [5.5, 0.95, -2.45], fov: 53 },
    ]) {
      view.camera.position.copy(point(shot.eye));
      view.camera.lookAt(point(shot.target));
      view.camera.fov = shot.fov;
      view.camera.updateProjectionMatrix();
      garage.update(view.camera, 'high', lighting);
      blankets.update(view.camera, 'high', lighting);
      blankets.alignGarageWheels(garage.spareWheelStorage);
      kit.update(view.camera, 'high');
      kit.root.visible = false;
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      const baseline = view.renderer.info.render.calls;
      kit.root.visible = true;
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      images.push({
        name: shot.name,
        image: canvas.toDataURL('image/png'),
        addedCalls: view.renderer.info.render.calls - baseline,
        calls: view.renderer.info.render.calls,
        triangles: view.renderer.info.render.triangles,
      });
    }
    // Warm all load/LOD buffers, then test a repeated moving-camera and empty/full cycle.
    for (const d of [0, 28, 85, 0]) {
      kit.instances.forEach((i) => i.setDetail(d, 'high'));
      view.renderer.render(view.scene, view.camera);
    }
    const first = kit.instances[0];
    for (const state of ['empty', 'full', 'partial-balanced'] as const) {
      first.setLoadState(state);
      view.renderer.render(view.scene, view.camera);
    }
    const before = { ...view.renderer.info.memory };
    for (let i = 0; i < 8; i++) {
      view.camera.position.x += 0.035;
      kit.update(view.camera, 'high');
      view.renderer.render(view.scene, view.camera);
    }
    const result = {
      lighting,
      wet: lighting === 'night',
      images,
      before,
      after: { ...view.renderer.info.memory },
      kit: kit.diagnostics(),
      sourceUnchanged: frame.every((n, i) => n === beforeFrame[i]),
      waterUnchanged: simulation.track.water.every((n, i) => n === water[i]),
      glError: view.renderer.getContext().getError(),
      movingSurveyFrames: 8,
      includesA34: blankets.root.parent !== null,
      boundary:
        'Actual circuit and embedded GLB textures with moving survey cameras. Not a driven lap or physical-GPU certification.',
    };
    return result;
  } finally {
    view.dispose();
    canvas.remove();
  }
}
