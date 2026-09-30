import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { shadowAnchor, lightingDirection } from '../../src/rendering/daylight.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';

/** Full production factory: A21/A22/A26/A31-A36 coexist, using native texture decoding.
 * Inspection cameras are not a human-driven lap or a physical-GPU performance claim. */
export async function captureWorkshop(wet: boolean) {
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    opponents: 0,
    mode: 'practice',
    weather: wet ? 'rain' : 'clear',
    seed: 3605,
  });
  for (let i = 0; i < 96; i++) simulation.step(1 / 120);
  const frame = simulation.makeFrame(),
    saved = frame.slice(),
    water = simulation.track.water.slice();
  document.body.style.cssText = 'margin:0;background:#10171b';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1280px;height:720px;display:block';
  document.body.append(canvas);
  const view = await RacingRenderer.create(
    canvas,
    simulation.track,
    () => {},
    () => false,
  );
  if (!view) throw new Error('A36 production factory cancelled');
  const garage = view.circuit.heroGarage,
    equipment = garage?.workshop;
  if (!garage || !equipment) {
    view.dispose();
    canvas.remove();
    throw new Error('A36 production integration missing');
  }
  const images: { view: string; image: string; addedCalls: number; triangles: number }[] = [];
  const surveys: {
    lighting: string;
    before: { geometries: number; textures: number };
    after: { geometries: number; textures: number };
    lods: number[];
    glError: number;
  }[] = [];
  try {
    view.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
    const point = (p: number[]) => garage.root.localToWorld(new T.Vector3().fromArray(p));
    const camera = (
      eye: number[],
      target: number[],
      fov: number,
      lighting: 'day' | 'sunset' | 'night',
    ) => {
      view.camera.position.copy(point(eye));
      view.camera.lookAt(point(target));
      view.camera.fov = fov;
      view.camera.updateProjectionMatrix();
      view.camera.updateMatrixWorld(true);
      garage.update(view.camera, 'high', lighting);
      view.circuit.tyreBlankets?.update(view.camera, 'high', lighting);
      view.circuit.tyreBlankets?.alignGarageWheels(garage.spareWheelStorage);
    };
    const modes = wet ? (['day', 'night'] as const) : (['day', 'sunset'] as const);
    for (const lighting of modes) {
      view.lighting = lighting;
      view.draw(frame, frame, 1, 1 / 60);
      // Normal shadow anchoring around the inspection subject, without extra lights/exposure.
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
        { name: 'complete-garage', eye: [-5.9, 1.8, 0.1], target: [1.5, 0.95, 1.35], fov: 76 },
        { name: 'chest-and-bench', eye: [-3.4, 1.5, 0.7], target: [-3.05, 0.66, 3.35], fov: 76 },
        { name: 'workbench', eye: [-0.35, 1.45, 1.1], target: [-1.6, 0.65, 2.95], fov: 70 },
        { name: 'flight-cases', eye: [3.5, 1.25, 0.85], target: [5.28, 0.43, 2.55], fov: 66 },
      ]) {
        camera(shot.eye, shot.target, shot.fov, lighting);
        // Warm all uniforms/resources before measuring the extra submission count.
        view.renderer.render(view.scene, view.camera);
        equipment.levels.forEach((o) => {
          o.visible = false;
        });
        view.renderer.info.reset();
        view.renderer.render(view.scene, view.camera);
        const base = view.renderer.info.render.calls;
        equipment.levels.forEach((o) => {
          o.visible = true;
        });
        view.renderer.info.reset();
        view.renderer.render(view.scene, view.camera);
        images.push({
          view: `${wet ? 'wet' : 'dry'}-${lighting}-${shot.name}`,
          image: canvas.toDataURL('image/png'),
          addedCalls: view.renderer.info.render.calls - base,
          triangles: view.renderer.info.render.triangles,
        });
      }
      const lods: number[] = [];
      for (const distance of [0, 60, 160, 0]) {
        garage.setDetail(distance, 'high');
        view.renderer.render(view.scene, view.camera);
        lods.push(garage.diagnostics().workshop!.lod);
      }
      camera([-5.9, 1.55, 0.15], [-2.5, 0.65, 3.34], 72, lighting);
      view.renderer.render(view.scene, view.camera);
      const before = { ...view.renderer.info.memory };
      for (let i = 0; i < 12; i++) {
        camera([-5.6 + i * 0.32, 1.45, 0.35], [-3.05, 0.7, 3.34], 72, lighting);
        view.renderer.render(view.scene, view.camera);
      }
      const after = { ...view.renderer.info.memory };
      images.push({
        view: `${wet ? 'wet' : 'dry'}-${lighting}-moving-end`,
        image: canvas.toDataURL('image/png'),
        addedCalls: 0,
        triangles: view.renderer.info.render.triangles,
      });
      surveys.push({
        lighting,
        before,
        after,
        lods,
        glError: view.renderer.getContext().getError(),
      });
    }
    return {
      wet,
      images,
      surveys,
      garage: garage.diagnostics(),
      neighbouringAssets: {
        overhead: garage.overhead?.diagnostics(),
        blankets: view.circuit.tyreBlankets?.diagnostics(),
        tyreStorage: view.tyreEquipment?.diagnostics(),
      },
      frameUnchanged: frame.every((v, i) => v === saved[i]),
      waterUnchanged: water.every((v, i) => v === simulation.track.water[i]),
      boundary:
        'Normal production factory and fixed/moving inspection cameras. Not a driven lap, physical-GPU certification, final-art approval or cockpit repair.',
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
