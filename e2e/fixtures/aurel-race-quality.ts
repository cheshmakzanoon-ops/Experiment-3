/** Controlled renderer inspection, explicitly separate from the ordinary-game
 * journey. Cache controls change traversal only; light controls restore the old
 * dusk fill on the same scene/camera. Neither control changes simulation. */
import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';

export async function inspectAurelQuality(authored = true) {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 7 });
  const frame = sim.makeFrame(),
    original = frame.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:640px;height:400px;display:block';
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  const view = authored
    ? await RacingRenderer.create(
        canvas,
        sim.track,
        () => {},
        () => false,
      )
    : new RacingRenderer(canvas, sim.track);
  if (!view) throw new Error('Renderer construction cancelled');
  const groups = [view.circuit.props, view.circuit.surfaces, view.circuit.vegetationGroup];
  const cache = (enabled: boolean) =>
    groups.forEach((g) => (enabled ? g.sealTransforms() : g.thawTransforms()));
  const matrices = () => {
    const values: number[] = [];
    view.scene.traverse((o) => values.push(...o.matrixWorld.elements));
    return values;
  };
  const same = (a: ArrayLike<number>, b: ArrayLike<number>) =>
    a.length === b.length && Array.from(a).every((v, i) => Object.is(v, b[i]));
  const pixels = () => {
    const gl = view.renderer.getContext();
    const size = view.renderer.getDrawingBufferSize(new T.Vector2());
    const result = new Uint8Array(size.x * size.y * 4);
    gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, result);
    return result;
  };
  try {
    view.setQuality('medium', {
      ...graphicsPreset('medium'),
      resolutionScale: 1,
      shadowSize: 512,
      autoExposure: false,
      localFog: false,
      reflections: 'environment',
    });
    view.changeCamera('chase');
    view.lighting = 'sunset';
    // Two held frames settle the normal camera and shared material variants.
    view.draw(frame, frame, 1, 1 / 60, false, true);
    view.draw(frame, frame, 1, 1 / 60, false, true);
    const renderer = view.renderer;
    const draw = () => {
      renderer.setRenderTarget(null);
      renderer.info.reset();
      renderer.render(view.scene, view.camera);
      return {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        memory: { ...renderer.info.memory },
        programs: renderer.info.programs?.length ?? 0,
      };
    };
    // Rendering the same production scene directly isolates traversal from
    // post-processing histories. Main-game tests retain the complete pipeline.
    cache(false);
    draw();
    const unsealed = draw(),
      beforePixels = pixels(),
      beforeMatrices = matrices();
    const controlImage = canvas.toDataURL('image/png');
    cache(true);
    const sealed = draw(),
      afterPixels = pixels(),
      afterMatrices = matrices();
    const cacheImage = canvas.toDataURL('image/png');

    const counts: { cached: boolean; visits: number }[] = [];
    const originalUpdate = T.Object3D.prototype.updateMatrixWorld;
    for (const cached of [false, true]) {
      cache(cached);
      view.scene.updateMatrixWorld(true);
      let visits = 0;
      T.Object3D.prototype.updateMatrixWorld = function (force?: boolean) {
        visits++;
        return originalUpdate.call(this, force);
      };
      try {
        view.scene.updateMatrixWorld(true);
      } finally {
        T.Object3D.prototype.updateMatrixWorld = originalUpdate;
      }
      counts.push({ cached, visits });
    }
    const timings: { cached: boolean; millisecondsPerSceneUpdate: number }[] = [];
    // Alternating order, warm each mode, same constructed scene and frame.
    for (let round = 0; round < 8; round++)
      for (const cached of round % 2 ? [true, false] : [false, true]) {
        cache(cached);
        for (let i = 0; i < 20; i++) view.scene.updateMatrixWorld(true);
        const start = performance.now();
        for (let i = 0; i < 120; i++) view.scene.updateMatrixWorld(true);
        timings.push({ cached, millisecondsPerSceneUpdate: (performance.now() - start) / 120 });
      }
    cache(true);
    draw();
    const balancedPixels = pixels(),
      balancedImage = canvas.toDataURL('image/png');
    const fill = view.scene.children.find(
      (o) => o instanceof T.HemisphereLight,
    ) as T.HemisphereLight;
    if (!fill) throw new Error('Production skylight missing');
    const saved = {
      color: fill.color.clone(),
      intensity: fill.intensity,
      environment: view.scene.environmentIntensity,
    };
    const cover = Math.min(1, Math.max(0, frame[H.CLOUD]));
    fill.intensity = 0.27 + cover * 0.2;
    fill.color.setHex(0xd5bdad).lerp(new T.Color(0xbfcbd5), cover * 0.64);
    view.scene.environmentIntensity = 0.24 - cover * 0.06;
    draw();
    const oldPixels = pixels(),
      oldImage = canvas.toDataURL('image/png');
    fill.color.copy(saved.color);
    fill.intensity = saved.intensity;
    view.scene.environmentIntensity = saved.environment;
    const restored = draw(),
      restoredPixels = pixels();
    // The bottom half contains asphalt/bodywork, not the bright sky. Count
    // clipped pixels separately rather than approving art from a mean value.
    const foreground = (p: Uint8Array) => {
      let sum = 0,
        clipped = 0;
      const end = p.length / 2;
      for (let i = 0; i < end; i += 4) {
        sum += (p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722) / 255;
        if (p[i] >= 250 && p[i + 1] >= 250 && p[i + 2] >= 250) clipped++;
      }
      return { luma: sum / (end / 4), clippedFraction: clipped / (end / 4) };
    };
    let nodes = 0;
    groups.forEach((g) => g.traverse(() => nodes++));
    return {
      scope: authored
        ? 'Controlled asset-loaded full scene; not human driving or hardware FPS'
        : 'Local controlled scene with constructor fallback car; not authored-car or gameplay acceptance',
      authored: view.stats().authoredDriver,
      sourceUnchanged: same(frame, original),
      nodes,
      counts,
      timings,
      matricesEqual: same(beforeMatrices, afterMatrices),
      pixelsEqual: same(beforePixels, afterPixels),
      restoredPixelsEqual: same(balancedPixels, restoredPixels),
      unsealed,
      sealed,
      restored,
      dusk: {
        prior: foreground(oldPixels),
        balanced: foreground(balancedPixels),
        keyIntensity: view.sun.intensity,
        exposure: renderer.toneMappingExposure,
      },
      images: {
        'uncached-venue': controlImage,
        'cached-venue': cacheImage,
        'prior-dusk-fill': oldImage,
        'balanced-dusk-fill': balancedImage,
      },
      glError: renderer.getContext().getError(),
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
