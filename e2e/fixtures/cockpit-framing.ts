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
  const player = renderer.cars[0].suppliedPlayer!;
  const originalEye = player.eye.clone();
  const rows = [];
  for (const [name, delta] of [
    ['original', [0, 0, 0]],
    ['lower-back', [0, -0.05, -0.12]],
    ['lower-deep', [0, -0.09, -0.12]],
    ['back', [0, 0, -0.2]],
    ['higher-back', [0, 0.08, -0.18]],
  ] as const) {
    // Explicit test-only composition study. Source sockets, geometry and
    // simulation remain unchanged; reset to the imported socket each time.
    player.eye.copy(originalEye).add({ x: delta[0], y: delta[1], z: delta[2] });
    renderer.draw(frame, frame, 1, 1 / 60, false, false, 1 / 60);
    const image = await captureRenderedCanvas(canvas);
    const encoded = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(image);
    });
    const visual = renderer.visualDiagnostics();
    rows.push({
      name,
      delta,
      time: frame[H.TIME],
      visual: {
        screenVisible: visual.screenVisible,
        wheelProjection: visual.wheelProjection,
        haloProjection: visual.haloProjection,
        suppliedPlayer: visual.suppliedPlayer,
      },
      stats: { localEye: renderer.stats().cameraLocalPosition, calls: renderer.stats().drawCalls },
      camera: { position: renderer.camera.position.toArray(), fov: renderer.camera.fov },
      image: encoded,
    });
  }
  player.eye.copy(originalEye);
  const report = { rows };
  renderer.dispose();
  return report;
}
