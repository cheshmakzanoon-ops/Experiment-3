import * as T from 'three';
import { pointLightWorkControl } from '../../src/rendering/point-light-work.ts';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';

/** Frozen production grid, unchanged shading and an independent contiguous-
 * range baseline. These synchronous samples include CPU, GPU wait and readback;
 * they are not frame-rate certification and do not replace live race reviews. */
export async function fullSceneIndexBudget() {
  const canvas = document.createElement('canvas');
  canvas.style.width = '640px';
  canvas.style.height = '400px';
  document.body.append(canvas);
  const simulation = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 7, seed: 711 });
  const view = await RacingRenderer.create(
    canvas,
    simulation.track,
    () => {},
    () => false,
  );
  if (!view) throw new Error('Cancelled production renderer construction');
  const target = new T.WebGLRenderTarget(480, 300, { type: T.HalfFloatType });
  const renderer = view.renderer;
  const frame = simulation.makeFrame(),
    saved = frame.slice();
  const control = view.cars[0].suppliedPlayer!.lods!.drawRanges!;
  const sample = () => {
    const pixels = new Uint16Array(480 * 300 * 4);
    const start = performance.now();
    renderer.info.reset();
    renderer.setRenderTarget(target);
    renderer.render(view.scene, view.camera);
    renderer.readRenderTargetPixels(target, 0, 0, 480, 300, pixels);
    return {
      pixels,
      ms: performance.now() - start,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  };
  try {
    view.setQuality('low');
    view.setCars(8);
    const rows = [];
    for (const camera of ['pod', 'cockpit', 'trackside'] as const) {
      renderer.setRenderTarget(null);
      view.changeCamera(camera);
      view.draw(frame, frame, 1, 1 / 120, false, true);
      control.compact = false;
      sample();
      const before = sample();
      control.compact = true;
      sample();
      const after = sample();
      const buffers = control.diagnostics().compacted;
      const repeat = sample();
      const reused = control.diagnostics().compacted;
      let differentChannels = 0,
        repeatDifferentChannels = 0;
      for (let i = 0; i < before.pixels.length; i++) {
        if (before.pixels[i] !== after.pixels[i]) differentChannels++;
        if (repeat.pixels[i] !== after.pixels[i]) repeatDifferentChannels++;
      }
      rows.push({
        camera,
        before: { ...before, pixels: undefined },
        after: { ...after, pixels: undefined },
        differentChannels,
        repeatDifferentChannels,
        buffers,
        reused,
      });
    }
    const lightingRows = [];
    const lightingControls = new Set<{ value: boolean }>();
    view.scene.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        const control = pointLightWorkControl(material);
        if (control) lightingControls.add(control);
      }
    });
    for (const lighting of ['day', 'sunset', 'night'] as const) {
      renderer.setRenderTarget(null);
      view.lighting = lighting;
      view.changeCamera('cockpit');
      view.draw(frame, frame, 1, 1 / 120, false, true);
      for (const control of lightingControls) control.value = false;
      sample();
      const before = sample();
      for (const control of lightingControls) control.value = true;
      sample();
      const after = sample();
      let differentChannels = 0;
      for (let i = 0; i < before.pixels.length; i++)
        if (before.pixels[i] !== after.pixels[i]) differentChannels++;
      lightingRows.push({
        lighting,
        before: { ...before, pixels: undefined },
        after: { ...after, pixels: undefined },
        differentChannels,
        intensities: view.venueLighting.lights.map((light) => light.intensity),
      });
    }
    return {
      rows,
      lightingRows,
      lightingMaterials: lightingControls.size,
      glError: renderer.getContext().getError(),
      sourceUnchanged: frame.every((n, i) => n === saved[i]),
      scope: 'held production eight-car main pass at 480x300; not live race or target-device FPS',
    };
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
    view.dispose();
  }
}
