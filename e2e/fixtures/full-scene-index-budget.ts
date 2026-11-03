import * as T from 'three';
import { pointLightWorkControl } from '../../src/rendering/point-light-work.ts';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';

/** Triangles, draws and index-buffer bytes of the player's car, counted like the A61 census in
 * tests/a61-rival.test.ts (visible meshes; instanced meshes by instance count), plus the buffers
 * of every level (hidden ones too) and whether any index points past its position buffer. */
function playerCensus(root: T.Object3D) {
  let draws = 0,
    triangles = 0,
    indexBytes = 0,
    outOfRange = 0;
  const seen = new Set<T.BufferAttribute | T.InterleavedBufferAttribute>();
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const index = object.geometry.index;
    if (!index || seen.has(index)) return;
    seen.add(index);
    indexBytes += index.array.byteLength;
    const vertices = object.geometry.getAttribute('position').count;
    for (let i = 0; i < index.array.length; i++) if (index.array[i] >= vertices) outOfRange++;
  });
  root.traverseVisible((object) => {
    if (!(object instanceof T.Mesh)) return;
    draws += Array.isArray(object.material) ? object.geometry.groups.length : 1;
    triangles +=
      ((object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3) *
      (object instanceof T.InstancedMesh ? object.count : 1);
  });
  return { draws, triangles, indexBytes, indexBuffers: seen.size, outOfRange };
}

/** Frozen production grid, unchanged shading and an independent contiguous-
 * range baseline. These synchronous samples include CPU, GPU wait and readback;
 * they are not frame-rate certification and do not replace live race reviews.
 *
 * G15: the player's car is the original authored APX-01 in a product build, so the
 * budget is measured on THAT car (`playerRows`: the real eight-car main pass, the player's
 * own triangles / draws / index buffers, and a held-frame repeat). The owner-supplied model
 * has one extra, owner-only control (index compaction of its 1.4 M-triangle LOD0); its
 * before / after comparison (`compactionRows`) runs only when that model is present. */
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
  const player = view.cars[0];
  const playerKind = player.suppliedPlayer ? ('supplied' as const) : ('authored' as const);
  const control = player.suppliedPlayer?.lods?.drawRanges ?? null;
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
    const playerRows = [];
    for (const camera of ['pod', 'cockpit', 'trackside'] as const) {
      renderer.setRenderTarget(null);
      view.changeCamera(camera);
      view.draw(frame, frame, 1, 1 / 120, false, true);
      if (control) {
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
      // The player's own car, whichever it is: one warm-up, then two held samples.
      sample();
      const first = sample();
      const second = sample();
      let heldDifferentChannels = 0;
      for (let i = 0; i < first.pixels.length; i++)
        if (first.pixels[i] !== second.pixels[i]) heldDifferentChannels++;
      playerRows.push({
        camera,
        scene: { calls: second.calls, triangles: second.triangles },
        sameCallsAndTriangles: first.calls === second.calls && first.triangles === second.triangles,
        heldDifferentChannels,
        player: playerCensus(player.root),
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
      playerKind,
      rows,
      playerRows,
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
