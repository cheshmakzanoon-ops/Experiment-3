import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { measureWheelGunFits } from '../../src/rendering/wheel-gun-contact.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';

/** Real production loading/geometry and simulation-produced moving service
 * frames. Engineering cameras, not a human driven lap or hardware FPS claim. */
export async function surveyA31(samples: number[][], lighting: 'day' | 'sunset' | 'night') {
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
  if (!view) throw new Error('A31 scene cancelled');
  const images: { name: string; image: string; calls: number; triangles: number }[] = [];
  const states: ReturnType<typeof view.pitCrew.summary>[] = [];
  const signatures: string[] = [];
  const world = new T.Matrix4(),
    car = new T.Object3D(),
    target = new T.Vector3(),
    gunMatrix = new T.Matrix4();
  const errors: { wheel: number; position: number; axis: number; radialClearance: number }[] = [];
  let unchanged = true;
  const signature = () => JSON.stringify(Array.from(view.pitCrew.wheelGuns!.matrices));
  try {
    view.setQuality('medium', { ...graphicsPreset('medium'), resolutionScale: 1 });
    view.lighting = lighting;
    const fits = measureWheelGunFits(view.cars[0]);
    for (let i = 0; i < samples.length; i++) {
      const frame = new Float32Array(samples[i]),
        before = frame.slice(),
        o = carBase(0);
      view.draw(frame, frame, 1, 1 / 60);
      car.position.set(frame[o + F.X], frame[o + F.Y], frame[o + F.Z]);
      car.quaternion.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      car.updateMatrix();
      world.copy(car.matrix);
      const side = i % 2 ? 1 : -1,
        wheel = i % 2;
      view.camera.position.set(side * 2.15, 0.5, 2.65).applyMatrix4(world);
      view.camera.lookAt(target.set(side * 1.1, -0.26, 1.7).applyMatrix4(world));
      view.camera.fov = 43;
      view.camera.updateProjectionMatrix();
      view.pitCrew.update(frame, view.camera.position, true, 43, 1280 / 720);
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      states.push(view.pitCrew.summary());
      signatures.push(signature());
      unchanged &&= frame.every((v, j) => v === before[j]);
      // Matrix witnesses are checked against the actual imported wheel carrier.
      // These are independent of the frame-based placement calculation.
      if (frame[o + F.PIT_PHASE] === 3 && frame[o + F.PIT_CLOCK] < 1)
        for (let w = 0; w < 4; w++) {
          const carrier = view.cars[0].suppliedPlayer!.wheels[w];
          carrier.updateWorldMatrix(true, false);
          const wanted = carrier.localToWorld(
            new T.Vector3((w % 2 ? 1 : -1) * fits[w].axial, 0, 0),
          );
          view.pitCrew.wheelGuns!.socketTransform(w, 'SOCKET_WHEEL_NUT', gunMatrix);
          const actual = new T.Vector3().setFromMatrixPosition(gunMatrix);
          const axis = new T.Vector3(0, 0, 1).transformDirection(gunMatrix);
          const wantedAxis = new T.Vector3(w % 2 ? -1 : 1, 0, 0).transformDirection(
            carrier.matrixWorld,
          );
          errors.push({
            wheel: w,
            position: actual.distanceTo(wanted),
            axis: axis.angleTo(wantedAxis),
            radialClearance: fits[w].socketScale * 0.0375 * Math.cos(Math.PI / 6) - fits[w].radius,
          });
        }
      if ([0, 1, Math.floor(samples.length / 2), samples.length - 1].includes(i))
        images.push({
          name: `service-${i}-wheel-${wheel}-phase-${frame[o + F.PIT_PHASE]}`,
          image: canvas.toDataURL('image/png'),
          calls: view.renderer.info.render.calls,
          triangles: view.renderer.info.render.triangles,
        });
      if (i === 2) {
        // Keep the full crew visible; inspect the real tool from both sides.
        for (const contactWheel of [0, 1]) {
          view.pitCrew.wheelGuns!.socketTransform(contactWheel, 'SOCKET_WHEEL_NUT', gunMatrix);
          for (const lateral of [-1, 1]) {
            view.camera.position.set(lateral * 0.48, 0.19, -0.16).applyMatrix4(gunMatrix);
            view.camera.lookAt(target.set(0, -0.025, -0.155).applyMatrix4(gunMatrix));
            view.camera.fov = 49;
            view.camera.updateProjectionMatrix();
            view.pitCrew.update(frame, view.camera.position, true, 49, 1280 / 720);
            view.renderer.info.reset();
            view.renderer.render(view.scene, view.camera);
            images.push({
              name: `contact-wheel-${contactWheel}-side-${lateral < 0 ? 'a' : 'b'}`,
              image: canvas.toDataURL('image/png'),
              calls: view.renderer.info.render.calls,
              triangles: view.renderer.info.render.triangles,
            });
          }
        }
      }
    }
    const first = new Float32Array(samples[0]);
    view.draw(first, first, 1, 0);
    view.pitCrew.update(first, view.camera.position, true, 43, 1280 / 720);
    const rewindSame = signature() === signatures[0];
    const uploads = view.pitCrew.wheelGuns!.uploads;
    view.pitCrew.update(first, view.camera.position, true, 43, 1280 / 720);
    const heldUploadStable = view.pitCrew.wheelGuns!.uploads === uploads;
    const garage = view.circuit.heroGarage!,
      point = (p: number[]) => garage.root.localToWorld(new T.Vector3(p[0], p[1], p[2]));
    view.camera.position.copy(point([3.1, 1.75, -2.4]));
    view.camera.lookAt(point([3.87, 1.23, -3.3]));
    view.camera.fov = 40;
    view.camera.updateProjectionMatrix();
    garage.update(view.camera, 'high', lighting);
    view.wheelGunStorage!.update(view.camera);
    view.renderer.info.reset();
    view.renderer.render(view.scene, view.camera);
    images.push({
      name: 'stowed-worktop',
      image: canvas.toDataURL('image/png'),
      calls: view.renderer.info.render.calls,
      triangles: view.renderer.info.render.triangles,
    });
    const before = { ...view.renderer.info.memory };
    for (let i = 0; i < 3; i++) {
      view.wheelGunStorage!.update(view.camera);
      view.renderer.render(view.scene, view.camera);
    }
    const after = { ...view.renderer.info.memory };
    return {
      lighting,
      images,
      states,
      errors,
      fits,
      before,
      after,
      rewindSame,
      heldUploadStable,
      sourceUnchanged: unchanged,
      storage: view.wheelGunStorage!.guns.diagnostics(),
      glError: view.renderer.getContext().getError(),
      firstTime: first[H.TIME],
      lastTime: samples.at(-1)![H.TIME],
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
