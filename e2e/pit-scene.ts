import * as T from 'three';
import { FormulaCar } from '../src/rendering/car.ts';
import { PitCrewView } from '../src/rendering/pit-crew.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';

/** Isolated rendering fixture using an actual production simulation snapshot.
 * It does not replace the full-game pit workflow: it makes the service pose
 * inspectable at a fixed camera without racing the screenshot against a timer. */
export function renderPitScene(values: number[]) {
  const frame = new Float32Array(values),
    o = carBase(0);
  const canvas = document.createElement('canvas');
  document.body.style.margin = '0';
  document.body.append(canvas);
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(1280, 800);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene();
  scene.background = new T.Color(0xbac7cb);
  scene.add(new T.HemisphereLight(0xe8eff2, 0x536055, 2));
  const sun = new T.DirectionalLight(0xfff4de, 2.5);
  const car = new FormulaCar(0);
  car.update(frame, frame, o, 1, 0.1, frame[H.TIME], false);
  scene.add(car.root);
  const anchor = car.root.position;
  sun.position.copy(anchor).add(new T.Vector3(-6, 8, 4));
  sun.target.position.copy(anchor);
  scene.add(sun, sun.target);
  const floor = new T.Mesh(
    new T.PlaneGeometry(40, 40),
    new T.MeshStandardMaterial({ color: 0x697378, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.copy(anchor);
  floor.position.y -= 0.43 + frame[o + F.JACK_HEIGHT];
  scene.add(floor);
  const camera = new T.PerspectiveCamera(46, 1280 / 800, 0.05, 200);
  camera.position.set(-6, 3.5, 7).applyQuaternion(car.root.quaternion).add(anchor);
  camera.lookAt(anchor);
  const crew = new PitCrewView();
  crew.update(frame, camera.position);
  scene.add(crew.root);
  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);
  return {
    phase: frame[o + F.PIT_PHASE],
    clock: frame[o + F.PIT_CLOCK],
    jack: frame[o + F.JACK_HEIGHT],
    speed: frame[o + F.SPEED],
    crews: crew.activeCrews,
    people: crew.summary(),
    glError: renderer.getContext().getError(),
    wheelOffsets: car.wheelSpins.map((wheel) => wheel.position.x),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
}
