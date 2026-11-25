import * as T from 'three';
import { Stadium } from '../../src/rendering/offroad/stadium.ts';
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

function changedPixels(a: Uint32Array, b: Uint32Array, end = a.length) {
  let count = 0;
  for (let i = 0; i < end; i++) if (a[i] !== b[i]) count++;
  return count;
}

/** Observe one real seated spectator through the stadium's far material.
 * Isolating the seat makes both its silhouette and its planted feet countable. */
function captureArenaCard(renderer: T.WebGLRenderer) {
  const arena = new Stadium(rigTrack('arena-nord-sx'));
  const card = arena.crowd;
  const attr = (name: string) => card.geometry.getAttribute(name) as T.InstancedBufferAttribute;
  const phases = attr('spectatorPhase'), style = attr('spectatorStyle');
  const fract = (n: number) => n - Math.floor(n);
  let seat = 0;
  while (seat < card.count) {
    const phase = phases.getX(seat);
    if (style.getZ(seat) < 0.5 && fract(phase * 6.71) < 0.66 &&
        fract(phase * 2.17) > 0.5 && fract(phase * 4.13) > 0.68) break;
    seat++;
  }
  if (seat === card.count) throw new Error('No seated signal cohort in the stadium');
  const pose = new T.Matrix4();
  card.getMatrixAt(seat, pose);
  card.setMatrixAt(0, pose);
  const colour = new T.Color();
  card.getColorAt(seat, colour);
  card.setColorAt(0, colour);
  for (const name of ['spectatorPhase', 'spectatorStyle', 'spectatorSkin', 'sculptedSeat'])
    attr(name).copyAt(0, attr(name), seat);
  card.count = 1;
  arena.nearCrowd.visible = false;
  const origin = new T.Vector3().setFromMatrixPosition(pose);
  const face = new T.Vector3(-1, 0, 0).transformDirection(pose);
  const side = new T.Vector3(0, 0, 1).transformDirection(pose);
  const camera = new T.OrthographicCamera(-0.7, 0.7, 0.7, -0.7, 0.1, 12);
  const target = origin.clone().add(new T.Vector3(0, 0.27, 0));
  camera.position.copy(target).addScaledVector(face, 4);
  camera.lookAt(target);
  const scene = new T.Scene();
  scene.background = new T.Color(0x263746);
  scene.add(card, new T.HemisphereLight(0xffffff, 0xb4a69a, 2));
  const size = 256;
  renderer.setSize(size, size);
  const gl = renderer.getContext();
  const frame = new Float32Array(HEADER + CAR_STRIDE), b = carBase(0);
  frame[H.CARS] = 1;
  frame[H.PHASE] = PHASE.RACING;
  frame[b + F.RANK] = 1;
  frame[b + OFFROAD_BASE + O.AIRBORNE] = 1;
  frame[b + OFFROAD_BASE + O.AIR_TIME] = 0.65;
  const capture = (speed: number, direction: number) => {
    frame[b + F.X] = origin.x + 14 * face.x - 4 * side.x;
    frame[b + F.Z] = origin.z + 14 * face.z - 4 * side.z;
    frame[b + F.SPEED] = speed;
    frame[b + F.VX] = speed * direction * side.x;
    frame[b + F.VZ] = speed * direction * side.z;
    arena.update(11, frame);
    renderer.render(scene, camera);
    const pixels = new Uint32Array(size * size);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixels.buffer));
    return pixels;
  };
  try {
    const waiting = capture(0, 0), watching = capture(26, 1);
    const held = capture(26, 1), reversed = capture(26, -1), sought = capture(26, 1);
    return {
      changed: changedPixels(waiting, watching),
      velocity: changedPixels(watching, reversed),
      feet: changedPixels(waiting, watching, size * Math.floor(size * 0.30)),
      held: changedPixels(watching, held),
      seek: changedPixels(watching, sought),
      error: gl.getError(),
      draws: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  } finally {
    arena.root.add(card);
    arena.dispose();
  }
}

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
  const capture = (distance: number, speed: number, direction = 1) => {
    frame[b + F.X] = line.x + line.tx * distance;
    frame[b + F.Z] = line.z + line.tz * distance;
    frame[b + F.SPEED] = speed;
    frame[b + F.VX] = line.tx * speed * direction;
    frame[b + F.VZ] = line.tz * speed * direction;
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
  try {
    const distant = capture(520, 26);
    const approach = capture(-8, 26);
    const image = renderer.domElement.toDataURL('image/png');
    const held = capture(-8, 26);
    const departure = capture(8, 26);
    const stopped = capture(-8, 0);
    const seek = capture(-8, 26);
    const reversed = capture(-8, 26, -1);
    return {
      arenaCard: captureArenaCard(renderer),
      velocity: changedPixels(approach.pixels, reversed.pixels),
      approach: changedPixels(distant.pixels, approach.pixels),
      cross: changedPixels(approach.pixels, departure.pixels),
      parked: changedPixels(distant.pixels, stopped.pixels),
      hold: changedPixels(approach.pixels, held.pixels),
      seek: changedPixels(approach.pixels, seek.pixels),
      measures: [distant, approach, held, departure, stopped, seek, reversed].map(
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
