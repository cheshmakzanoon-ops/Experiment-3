import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';

/** Production simulation + actual renderer, deliberately presenting only one
 * frame per two simulated seconds. No car pose, lap, force or tire overrides.
 * Original circuit construction is included. Reduced viewport cost keeps this
 * a camera/rendering oracle, not a representative-device FPS certificate. */
export function cameraContinuity() {
  const simulation = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  simulation.autoPlayer = true;
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new RacingRenderer(canvas, simulation.track);
  renderer.setQuality('low');
  renderer.changeCamera('cockpit');
  const frame = simulation.makeFrame();
  const observations: {
    time: number;
    screen: boolean;
    projection: number[];
    localEye: number[];
  }[] = [];
  try {
    for (let tick = 0; tick <= 120 * 68; tick++) {
      if (tick > 0) simulation.step(1 / 120);
      if (tick % 240 !== 0) continue;
      simulation.writeFrame(frame, 0, 0);
      renderer.draw(frame, frame, 1, 0.08, false, false, 2);
      const visual = renderer.visualDiagnostics();
      observations.push({
        time: frame[H.TIME],
        screen: visual.screenVisible,
        projection: visual.wheelProjection,
        localEye: renderer.stats().cameraLocalPosition,
      });
    }
    const beforePause = {
      position: renderer.camera.position.toArray(),
      rotation: renderer.camera.quaternion.toArray(),
      listener: { ...renderer.audioView.value },
      time: renderer.presented.value[H.TIME],
    };
    for (let i = 0; i < 5; i++) renderer.draw(frame, frame, 1, 0.08, false, false, 0.5);
    const afterPause = {
      position: renderer.camera.position.toArray(),
      rotation: renderer.camera.quaternion.toArray(),
      listener: { ...renderer.audioView.value },
      time: renderer.presented.value[H.TIME],
    };
    // One settling observation is permitted only for the listener's velocity:
    // a frozen camera is stationary, regardless of its last moving sample.
    const settled = { ...renderer.audioView.value };
    renderer.draw(frame, frame, 1, 0.08, false, false, 0.5);
    const settledAgain = { ...renderer.audioView.value };
    const previousMode = renderer.stats().camera;
    renderer.changeCamera('trackside');
    const pending = {
      camera: renderer.stats().camera,
      requested: renderer.stats().requestedCamera,
      interior: renderer.audioView.value.interior,
    };
    renderer.draw(frame, frame, 1, 0.08, false, true, 0.5);
    const committed = {
      camera: renderer.stats().camera,
      requested: renderer.stats().requestedCamera,
      interior: renderer.audioView.value.interior,
      velocity: [
        renderer.audioView.value.vx,
        renderer.audioView.value.vy,
        renderer.audioView.value.vz,
      ],
    };
    renderer.changeCamera('cockpit');
    renderer.draw(frame, frame, 1, 0.08, false, true, 0.5);
    return {
      image: canvas.toDataURL('image/png'),
      observations,
      previousMode,
      pending,
      committed,
      beforePause,
      afterPause,
      settled,
      settledAgain,
      laps: simulation.race.laps[0].completed,
      context: renderer.renderer.getContext().getParameter(WebGL2RenderingContext.VERSION),
    };
  } finally {
    renderer.dispose();
  }
}
