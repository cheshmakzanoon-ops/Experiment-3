import * as T from 'three';
import { MxSpectators } from '../../src/rendering/offroad/mx-spectators.ts';
import { setMxQuality } from '../../src/rendering/offroad/mx-quality.ts';
import { rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  O,
  OFFROAD_BASE,
  carBase,
} from '../../src/simulation/protocol.ts';
import { PHASE } from '../../src/simulation/race.ts';
import { trackPoint } from '../../src/simulation/track.ts';

/** Observe the production outdoor crowd and its own depth shader through a
 * fixed lens. Only the leader's recorded position or speed varies per sample. */
export function captureMxSpectatorPass() {
  setMxQuality('high');
  const track = rigTrack('valley-ridge-mx');
  const spectators = new MxSpectators(track, []);
  const watch = spectators.plan.placements.find((p) => p.kind === 'spectator')!;
  const line = track.at(watch.station, trackPoint());
  const target = new T.Vector3(watch.x, watch.y + 1, watch.z);
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const width = 760,
    height = 430;
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene();
  scene.background = new T.Color(0xbdcad1);
  const camera = new T.PerspectiveCamera(35, width / height, 0.1, 95);
  camera.position.set(line.x + 3 * line.tx, watch.y + 2.3, line.z + 3 * line.tz);
  camera.lookAt(target);
  const light = new T.DirectionalLight(0xffedda, 2.2);
  light.position.copy(target).add(new T.Vector3(-9, 12, 7));
  light.target.position.copy(target);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  Object.assign(light.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, far: 58 });
  light.shadow.normalBias = 0.015;
  const ground = new T.Mesh(
    new T.PlaneGeometry(38, 32),
    new T.MeshStandardMaterial({ color: 0x696c50 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(watch.x, watch.y - 0.08, watch.z);
  ground.receiveShadow = true;
  scene.add(
    spectators.root,
    ground,
    light,
    light.target,
    new T.HemisphereLight(0xd1e2ee, 0xa59170, 1.6),
  );
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  frame[H.PHASE] = PHASE.RACING;
  const b = carBase(0);
  frame[b + F.RANK] = 1;
  frame[b + OFFROAD_BASE + O.AIRBORNE] = 1;
  frame[b + OFFROAD_BASE + O.AIR_TIME] = 0.65;
  const gl = renderer.getContext();
  const capture = (distance: number, speed: number) => {
    frame[b + F.X] = line.x + line.tx * distance;
    frame[b + F.Z] = line.z + line.tz * distance;
    frame[b + F.SPEED] = speed;
    spectators.update(11, frame);
    renderer.render(scene, camera);
    const pixels = new Uint32Array(width * height);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixels.buffer));
    return {
      pixels,
      error: gl.getError(),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  };
  const different = (a: Uint32Array, b: Uint32Array) => {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  };
  try {
    const distant = capture(520, 26);
    const approach = capture(-8, 26);
    const image = renderer.domElement.toDataURL('image/png');
    const held = capture(-8, 26);
    const departure = capture(8, 26);
    const stopped = capture(-8, 0);
    const seek = capture(-8, 26);
    return {
      approach: different(distant.pixels, approach.pixels),
      cross: different(approach.pixels, departure.pixels),
      parked: different(distant.pixels, stopped.pixels),
      hold: different(approach.pixels, held.pixels),
      seek: different(approach.pixels, seek.pixels),
      measures: [distant, approach, held, departure, stopped, seek].map(
        ({ error, calls, triangles }) => ({ error, calls, triangles }),
      ),
      image,
    };
  } finally {
    light.shadow.map?.dispose();
    light.shadow.mapPass?.dispose();
    ground.geometry.dispose();
    ground.material.dispose();
    spectators.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
