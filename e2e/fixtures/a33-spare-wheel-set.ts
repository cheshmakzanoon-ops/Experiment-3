import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';

/** Full production scene and shipped assets, with real simulation-produced
 * service samples supplied by the test. Fixed cameras are engineering surveys,
 * not a claim of a manually driven lap or physical-hardware FPS validation. */
export async function surveyA33(samples: number[][], lighting: 'day' | 'sunset' | 'night') {
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    opponents: 0,
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 1887,
  });
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1280px;height:720px;display:block';
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  const view = await RacingRenderer.create(
    canvas,
    simulation.track,
    () => {},
    () => false,
  );
  if (!view) throw new Error('A33 scene creation cancelled');
  const images: { name: string; image: string; calls: number; triangles: number }[] = [];
  const observations: ReturnType<typeof view.pitCrew.summary>[] = [];
  const world = new T.Matrix4(),
    car = new T.Object3D(),
    position = new T.Vector3();
  const stateSignatures: string[] = [];
  const signature = () =>
    JSON.stringify(
      view.pitCrew.spareWheels.batches.map((b) => ({
        count: b.count,
        matrix: Array.from(b.instanceMatrix.array.slice(0, b.count * 16)),
        shape: Array.from((b.morphTexture!.image.data as Float32Array).slice(0, b.count * 2)),
      })),
    );
  let unchanged = true;
  try {
    view.setQuality('medium', { ...graphicsPreset('medium'), resolutionScale: 1 });
    view.lighting = lighting;
    for (let i = 0; i < samples.length; i++) {
      const frame = new Float32Array(samples[i]),
        before = frame.slice(),
        o = carBase(0);
      // Use the recorded rain in the snapshot; no invented service phase/clock.
      view.draw(frame, frame, 1, 1 / 60);
      car.position.set(frame[o + F.X], frame[o + F.Y], frame[o + F.Z]);
      car.quaternion.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      car.updateMatrix();
      world.copy(car.matrix);
      view.camera.position.set(-5.1, 2.7, 5.0).applyMatrix4(world);
      view.camera.lookAt(position.set(0, 0.1, 0).applyMatrix4(world));
      view.camera.fov = 49;
      view.camera.updateProjectionMatrix();
      view.pitCrew.update(frame, view.camera.position, true, 49, 1280 / 720);
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      observations.push(view.pitCrew.summary());
      stateSignatures.push(signature());
      unchanged &&= frame.every((v, j) => v === before[j]);
      if (
        [
          0,
          Math.floor(samples.length / 3),
          Math.floor((2 * samples.length) / 3),
          samples.length - 1,
        ].includes(i)
      )
        images.push({
          name: `service-${i}-phase-${frame[o + F.PIT_PHASE]}`,
          image: canvas.toDataURL('image/png'),
          calls: view.renderer.info.render.calls,
          triangles: view.renderer.info.render.triangles,
        });
    }
    const first = new Float32Array(samples[0]);
    view.pitCrew.update(first, view.camera.position, true, 49, 1280 / 720);
    const rewindSame = signature() === stateSignatures[0];
    const version = view.pitCrew.spareWheels.batches[0].morphTexture!.version;
    view.pitCrew.update(first, view.camera.position, true, 49, 1280 / 720);
    const heldUploadStable = view.pitCrew.spareWheels.batches[0].morphTexture!.version === version;
    const garage = view.circuit.heroGarage!;
    const point = (p: number[]) => garage.root.localToWorld(new T.Vector3(p[0], p[1], p[2]));
    view.camera.position.copy(point([-4.1, 1.3, -0.4]));
    view.camera.lookAt(point([-1.7, 0.25, -1.7]));
    view.camera.fov = 45;
    view.camera.updateProjectionMatrix();
    garage.update(view.camera, 'high', lighting);
    view.renderer.info.reset();
    view.renderer.render(view.scene, view.camera);
    images.push({
      name: 'garage-wheel-storage',
      image: canvas.toDataURL('image/png'),
      calls: view.renderer.info.render.calls,
      triangles: view.renderer.info.render.triangles,
    });
    const before = { ...view.renderer.info.memory };
    for (let i = 0; i < 3; i++) {
      garage.update(view.camera, 'high', lighting);
      view.renderer.render(view.scene, view.camera);
    }
    const after = { ...view.renderer.info.memory };
    return {
      lighting,
      images,
      observations,
      before,
      after,
      rewindSame,
      heldUploadStable,
      storage: garage.spareWheelStorage.wheels.diagnostics(),
      sourceUnchanged: unchanged,
      glError: view.renderer.getContext().getError(),
      firstSampleTime: first[H.TIME],
      lastSampleTime: samples[samples.length - 1][H.TIME],
      boundary:
        'Production assets and scene; moving real service samples, fixed engineering cameras; software GPU, not hardware approval.',
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
