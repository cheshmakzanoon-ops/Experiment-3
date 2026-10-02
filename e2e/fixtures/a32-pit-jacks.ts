import { measureA32Contact } from './a32-contact-witness.ts';
import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { measurePitJackFits } from '../../src/rendering/a32-jack-contact.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, carBase } from '../../src/simulation/protocol.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { completedDrawMilliseconds } from './completed-draw.ts';

/** Real production scene and simulation-produced service packets. Fixed survey
 * cameras are for inspection, not a substitute for a driven-lap/hardware review. */
export async function surveyA32(samples: number[][], lighting: 'day' | 'sunset' | 'night') {
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    opponents: 0,
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 1887,
  });
  document.body.style.cssText = 'margin:0';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1280px;height:720px;display:block';
  document.body.append(canvas);
  const view = await RacingRenderer.create(
    canvas,
    simulation.track,
    () => {},
    () => false,
  );
  if (!view) throw new Error('A32 scene cancelled');
  const jacks = view.pitCrew.pitJacks!;
  const images: {
    name: string;
    image: string;
    addedCalls: number;
    triangles: number;
    pixels: { nonBlackFraction: number; range: number };
  }[] = [];
  const gl = view.renderer.getContext();
  const completionPixel = new Uint8Array(4),
    framePixels = new Uint8Array(1280 * 720 * 4);
  const draw = () =>
    completedDrawMilliseconds(
      gl,
      () => view.renderer.render(view.scene, view.camera),
      completionPixel,
    );
  const states: ReturnType<typeof view.pitCrew.summary>[] = [];
  const signatures: string[] = [];
  const contacts: ReturnType<typeof measureA32Contact>[] = [];
  const car = new T.Object3D(),
    point = new T.Vector3(),
    matrix = new T.Matrix4();
  let unchanged = true;
  const signature = () => JSON.stringify(Array.from(jacks.matrices));
  try {
    view.setQuality('medium', { ...graphicsPreset('medium'), resolutionScale: 1 });
    view.lighting = lighting;
    const fits = measurePitJackFits(view.cars[0]);
    const camera = (frame: Float32Array, shot: 'pair' | 'front' | 'rear') => {
      const o = carBase(0);
      car.position.set(frame[o + F.X], frame[o + F.Y], frame[o + F.Z]);
      car.quaternion.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      car.updateMatrix();
      const eye =
        shot === 'pair'
          ? [6.6, 2.7, 6.5]
          : shot === 'front'
            ? [1.5, 0.47, 4.55]
            : [-1.6, 0.55, -4.1];
      const target =
        shot === 'pair' ? [0, 0.05, 0] : shot === 'front' ? [0, -0.2, 3.2] : [0, -0.15, -2.65];
      view.camera.position.fromArray(eye).applyMatrix4(car.matrix);
      view.camera.lookAt(point.fromArray(target).applyMatrix4(car.matrix));
      view.camera.fov = shot === 'pair' ? 48 : 46;
      view.camera.updateProjectionMatrix();
      view.pitCrew.update(frame, view.camera.position, true, view.camera.fov, 1280 / 720);
    };
    const capture = (name: string) => {
      for (const b of jacks.batches) b.visible = false;
      view.renderer.info.reset();
      draw();
      const baseline = view.renderer.info.render.calls;
      for (const b of jacks.batches) b.visible = true;
      view.renderer.info.reset();
      draw();
      gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, framePixels);
      if (gl.isContextLost()) throw new Error('Lost A32 circuit inspection context');
      let min = 255,
        max = 0,
        nonBlack = 0;
      for (let i = 0; i < framePixels.length; i += 4) {
        const value = Math.max(framePixels[i], framePixels[i + 1], framePixels[i + 2]);
        min = Math.min(min, value);
        max = Math.max(max, value);
        if (value > 2) nonBlack++;
      }
      images.push({
        name,
        image: canvas.toDataURL('image/png'),
        addedCalls: view.renderer.info.render.calls - baseline,
        triangles: view.renderer.info.render.triangles,
        pixels: { nonBlackFraction: nonBlack / (1280 * 720), range: max - min },
      });
    };
    for (let i = 0; i < samples.length; i++) {
      const frame = new Float32Array(samples[i]),
        original = frame.slice(),
        o = carBase(0);
      view.draw(frame, frame, 1, 1 / 60);
      camera(frame, 'pair');
      states.push(view.pitCrew.summary());
      signatures.push(signature());
      unchanged &&= frame.every((v, k) => v === original[k]);
      for (const [slot, role] of [
        [0, 'rear'],
        [1, 'front'],
      ] as const) {
        const prefix = `A32_${role.toUpperCase()}`;
        matrix.fromArray(jacks.matrices, (slot * 4 + 2) * 16);
        const socket = jacks.prototype.getObjectByName(`SOCKET_${prefix}_CONTACT`)!;
        const actual = socket.position.clone().applyMatrix4(matrix);
        const root = matrix.fromArray(jacks.matrices, slot * 4 * 16);
        const ground = jacks.prototype.getObjectByName(`SOCKET_${prefix}_GROUND`)!;
        const localGround = ground.position
          .clone()
          .applyMatrix4(root)
          .applyMatrix4(car.matrix.clone().invert());
        contacts.push(
          measureA32Contact(
            role,
            frame[o + F.PIT_PHASE],
            frame[o + F.PIT_CLOCK],
            frame[o + F.JACK_HEIGHT],
            actual.applyMatrix4(car.matrix.clone().invert()),
            fits[role],
            localGround,
          ),
        );
      }
      if (i === 0 || i === Math.floor(samples.length / 2) || i === samples.length - 1) {
        capture(`pair-phase-${frame[o + F.PIT_PHASE]}-${i}`);
        for (const shot of ['front', 'rear'] as const) {
          camera(frame, shot);
          capture(`${shot}-phase-${frame[o + F.PIT_PHASE]}-${i}`);
        }
      }
    }
    const first = new Float32Array(samples[0]);
    view.draw(first, first, 1, 0);
    camera(first, 'pair');
    const rewindSame = signature() === signatures[0],
      uploads = jacks.uploads;
    view.pitCrew.update(first, view.camera.position, true, view.camera.fov, 1280 / 720);
    const heldUploadStable = jacks.uploads === uploads;
    const before = { ...view.renderer.info.memory };
    for (let i = 0; i < 3; i++) {
      view.pitCrew.update(first, view.camera.position, true, view.camera.fov, 1280 / 720);
      draw();
    }
    return {
      lighting,
      images,
      states,
      contacts,
      fits,
      rewindSame,
      heldUploadStable,
      sourceUnchanged: unchanged,
      before,
      after: { ...view.renderer.info.memory },
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
      boundary:
        'Real circuit/service frames; not final art approval or physical-hardware profiling.',
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
