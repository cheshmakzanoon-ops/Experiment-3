import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';

/** Read-only submission census for the SAME first complete cockpit frame as the
 * infrastructure budget. Does not warm away a lighting bake or hide any caster.
 * Instrumentation is restricted to this test fixture, not the game hot path. */
export async function sceneryShadowBudget(lighting: 'day' | 'sunset' | 'night') {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    opponents: 11,
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 1887,
  });
  sim.autoPlayer = true;
  for (let i = 0; i < 8 * 120; i++) sim.step(1 / 120);
  const frame = sim.makeFrame().slice();
  const original = frame.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:1280px;height:720px';
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  const view = await RacingRenderer.create(
    canvas,
    sim.track,
    () => {},
    () => false,
    {
      quality: 'medium',
      graphics: { ...graphicsPreset('medium'), resolutionScale: 1 },
    },
  );
  if (!view) throw new Error('Production renderer unavailable');
  const renderer = view.renderer;
  const originalDraw = renderer.renderBufferDirect;
  const rows = new Map<
    string,
    { object: string; lens: string; calls: number; triangles: number }
  >();
  renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const beforeCalls = renderer.info.render.calls;
    const beforeTriangles = renderer.info.render.triangles;
    originalDraw.call(this, camera, scene, geometry, material, object, group);
    if (!(material instanceof T.MeshDepthMaterial || material instanceof T.MeshDistanceMaterial))
      return;
    const names: string[] = [];
    for (let p: T.Object3D | null = object; p && names.length < 5; p = p.parent)
      if (p.name) names.unshift(p.name);
    const name = names.join('/') || object.type;
    const lens =
      camera instanceof T.OrthographicCamera
        ? `ortho:${camera.left},${camera.right},${camera.bottom},${camera.top}`
        : camera instanceof T.PerspectiveCamera
          ? `perspective:${camera.fov}`
          : camera.type;
    const key = `${lens}|${name}`;
    const row = rows.get(key) ?? { object: name, lens, calls: 0, triangles: 0 };
    row.calls += renderer.info.render.calls - beforeCalls;
    row.triangles += renderer.info.render.triangles - beforeTriangles;
    rows.set(key, row);
  };
  try {
    view.lighting = lighting;
    view.mode = 'cockpit';
    view.draw(frame, frame, 1, 1 / 60);
    const stats = view.stats();
    const shadows = [...rows.values()].sort((a, b) => b.triangles - a.triangles);
    return {
      lighting,
      workload: { cars: 12, seed: 1887, seconds: 8, quality: 'medium', resolution: [1280, 720] },
      image: canvas.toDataURL('image/png'),
      calls: stats.drawCalls,
      triangles: stats.triangles,
      passes: stats.drawBreakdown,
      shadows,
      sourceUnchanged: frame.every((v, i) => Object.is(v, original[i])),
      glError: renderer.getContext().getError(),
      contextLost: renderer.getContext().isContextLost(),
    };
  } finally {
    renderer.renderBufferDirect = originalDraw;
    view.dispose();
    canvas.remove();
  }
}
