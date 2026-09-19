import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';

/** Fixed survey cameras inspect the shipping circuit, not a replacement scene.
 * No vehicle position, track water or input state is fabricated for a photograph.
 * These additional material views use the direct scene pass; the existing
 * reference tests separately exercise the full high-preset post-processing. */
export function captureCircuitSurvey(weather: 'clear' | 'rain') {
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    weather,
    mode: 'practice',
    opponents: 0,
    seed: 1887,
  });
  for (let i = 0; i < 96; i++) simulation.step(1 / 120);
  const frame = simulation.makeFrame(),
    original = frame.slice(),
    water = simulation.track.water.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1280px;height:720px;display:block';
  document.body.style.cssText = 'margin:0;background:#000';
  document.body.append(canvas);
  const view = new RacingRenderer(canvas, simulation.track);
  const images: { view: string; image: string; calls: number; triangles: number }[] = [];
  try {
    view.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
    view.draw(frame, frame, 1, 1 / 60);
    const surveys = [
      { name: 'grandstand', eye: [40, -7, 3.0], target: [57, -38, 4.4], fov: 56 },
      { name: 'barrier', eye: [120, -13, 1.1], target: [143, -19, 1.5], fov: 48 },
      { name: 'kerb', eye: [552, -7.1, 0.45], target: [573, -8.8, 0.02], fov: 56 },
    ];
    for (const survey of surveys) {
      view.camera.position.copy(view.circuit.at(...(survey.eye as [number, number, number])));
      view.camera.lookAt(view.circuit.at(...(survey.target as [number, number, number])));
      view.camera.fov = survey.fov;
      view.camera.updateProjectionMatrix();
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      images.push({
        view: survey.name,
        image: canvas.toDataURL('image/png'),
        calls: view.renderer.info.render.calls,
        triangles: view.renderer.info.render.triangles,
      });
    }
    const before = { ...view.renderer.info.memory };
    view.renderer.render(view.scene, view.camera);
    view.renderer.render(view.scene, view.camera);
    const after = { ...view.renderer.info.memory };
    return {
      weather,
      tick: frame[H.TICK],
      images,
      before,
      after,
      sourceUnchanged: frame.every((x, i) => x === original[i]),
      waterUnchanged: water.every((x, i) => x === simulation.track.water[i]),
      glError: view.renderer.getContext().getError(),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
