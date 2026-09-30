import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';
import { captureRenderedCanvas } from '../../src/rendering/frame-capture.ts';

/** The production loader, supplied asset, full circuit and simulation snapshots. */
export async function cockpitFramingSurvey() {
  const simulation = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1280px;height:720px';
  document.body.append(canvas);
  const renderer = await RacingRenderer.create(
    canvas,
    simulation.track,
    () => {},
    () => false,
  );
  if (!renderer) throw new Error('Renderer cancelled');
  renderer.setQuality('low');
  renderer.changeCamera('cockpit');
  for (let i = 0; i < 120; i++) simulation.step(1 / 120);
  const frame = simulation.makeFrame();
  renderer.draw(frame, frame, 1, 1 / 60, false, false, 1 / 60);
  const image = await captureRenderedCanvas(canvas);
  const encoded = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(image);
  });
  const visual = renderer.visualDiagnostics();
  const report = {
    time: frame[H.TIME],
    visual,
    stats: renderer.stats(),
    camera: { position: renderer.camera.position.toArray(), fov: renderer.camera.fov },
    image: encoded,
  };
  renderer.dispose();
  return report;
}
