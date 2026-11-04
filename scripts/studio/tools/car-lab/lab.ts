// Car lab: the production render classes in a minimal studio scene, for fast close-up iteration.
//
//   npx vite --port 4298 --host 127.0.0.1        (from the repo root)
//   node scripts/studio/tools/car-lab/shots.mjs --url http://127.0.0.1:4298 --out <dir> --id apx01 --views front34,rear34
//
// What it is: the real FormulaCar / VehicleBodies / BikeShells, fed the menu's own static snapshot
// (menuPreview), lit by a neutral room environment and one shadowed key. What it is not: the game's
// sky, post-processing, DOF or grade, so a paint colour here is only comparable with another lab shot;
// the showroom captures (vehicle-shots.mjs) are the evidence for the final look.
import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FormulaCar } from '../../../../src/rendering/car.ts';
import { loadRivalLevels } from '../../../../src/rendering/a61-rival.ts';
import { loadHeroShells } from '../../../../src/rendering/hero-shells.ts';
import { loadDriverAsset } from '../../../../src/rendering/driver-asset.ts';
import { VehicleBodies } from '../../../../src/rendering/vehicle-bodies/index.ts';
import { BikeShells } from '../../../../src/rendering/bike.ts';
import { GP_CORNER_PRESET, menuPreview } from '../../../../src/rendering/menu-preview.ts';
import { sampleChassisPose } from '../../../../src/rendering/snapshot-interpolation.ts';
import { Track } from '../../../../src/simulation/track.ts';
import { circuitDefinition } from '../../../../src/simulation/circuits.ts';
import { vehicleDefinition } from '../../../../src/simulation/vehicles.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../../../src/simulation/protocol.ts';

export interface LabPose {
  steer?: number;
  brake?: number;
  discTemp?: number;
  lean?: number;
  /** Rider hang-off from the bike centreline (m, + left). */
  hang?: number;
  speed?: number;
  /** Presented simulation time (s): the knee sparks are a function of it. */
  time?: number;
}
export interface LabView {
  eye: [number, number, number];
  at: [number, number, number];
  fov?: number;
}
/** Named views in the machine's own frame (x right, y up, z forward), metres. */
export const VIEWS: Record<string, LabView> = {
  front34: { eye: [4.6, 1.15, 6.2], at: [-0.4, 0.45, 0.2], fov: 32 },
  front34r: { eye: [-4.6, 1.15, 6.2], at: [0.4, 0.45, 0.2], fov: 32 },
  side34r: { eye: [-6.5, 0.8, 0.5], at: [0, 0.4, 0], fov: 30 },
  front34low: { eye: [3.2, 0.55, 4.2], at: [0, 0.3, 1.2], fov: 34 },
  rear34: { eye: [4.4, 1.5, -6.4], at: [0, 0.5, -0.6], fov: 32 },
  rear34low: { eye: [2.6, 0.5, -4.2], at: [0, 0.35, -1.6], fov: 36 },
  side: { eye: [7.5, 0.7, 0], at: [0, 0.4, 0], fov: 30 },
  top: { eye: [0.001, 8, 0.2], at: [0, 0, 0], fov: 30 },
  front: { eye: [0, 0.7, 6.5], at: [0, 0.4, 0], fov: 30 },
  cockpit: { eye: [0, 0.41, -0.48], at: [0, 0.3, 40], fov: 54 },
  cockpitLow: { eye: [0, 0.55, -0.1], at: [0, 0.18, 1.2], fov: 62 },
  helmet: { eye: [1.5, 0.75, 0.9], at: [0, 0.52, -0.42], fov: 24 },
  helmetFront: { eye: [0.6, 0.62, 1.5], at: [0, 0.5, -0.4], fov: 24 },
  wheelFront: { eye: [1.8, 0.35, 2.6], at: [0.8, 0.12, 1.82], fov: 30 },
  wheelRear: { eye: [2.2, 0.35, -0.9], at: [0.8, 0.15, -1.62], fov: 30 },
  wingFront: { eye: [1.6, 0.35, 3.6], at: [0, 0.05, 2.25], fov: 32 },
  wingTop: { eye: [0.8, 3.2, -4.4], at: [0, 0.6, -2.1], fov: 30 },
  wingRear: { eye: [2.2, 0.9, -3.8], at: [0, 0.4, -2.0], fov: 32 },
  diffuser: { eye: [1.4, 0.15, -3.8], at: [0, -0.1, -1.8], fov: 34 },
  nose: { eye: [1.2, 0.6, 3.4], at: [0, 0.1, 2.0], fov: 30 },
  bikeFront34: { eye: [2.6, 0.9, 3.4], at: [0, 0.55, 0], fov: 34 },
  bikeSide: { eye: [4.2, 0.7, 0], at: [0, 0.6, 0], fov: 32 },
  bikeRear34: { eye: [-2.4, 1.0, -3.2], at: [0, 0.55, 0], fov: 34 },
  bikeFront: { eye: [0, 0.7, 4], at: [0, 0.55, 0], fov: 30 },
  bikeCorner: { eye: [3.0, 0.35, 3.2], at: [0, 0.35, 0], fov: 36 },
  bikeKnee: { eye: [2.2, 0.18, 0.5], at: [0.55, 0.2, -0.25], fov: 34 },
  bikeKneeRear: { eye: [1.6, 0.25, -2.2], at: [0.45, 0.22, -0.2], fov: 38 },
};

const params = new URLSearchParams(location.search);
const machine = params.get('id') ?? 'apx01';
const width = Number(params.get('w') ?? 1280),
  height = Number(params.get('h') ?? 720);

const canvas = document.createElement('canvas');
document.body.append(canvas);
const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(width, height, false);
renderer.setPixelRatio(1);
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(params.get('exposure') ?? 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;

const scene = new T.Scene();
scene.background = new T.Color(0x101214);
const pmrem = new T.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = Number(params.get('env') ?? 0.6);
const key = new T.DirectionalLight(0xfff1e0, 2.2);
key.position.set(-5, 9, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
scene.add(key);
const rim = new T.DirectionalLight(0x9fb8ff, 1.1);
rim.position.set(6, 3, -7);
scene.add(rim);
const floor = new T.Mesh(
  new T.CircleGeometry(40, 64).rotateX(-Math.PI / 2),
  new T.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.82, metalness: 0 }),
);
floor.receiveShadow = true;
scene.add(floor);
const camera = new T.PerspectiveCamera(32, width / height, 0.05, 200);

const track = new Track('clear', false, undefined, circuitDefinition('aurel'));
const frame = menuPreview(
  track,
  undefined,
  machine,
  params.get('preset') === 'corner' ? GP_CORNER_PRESET : undefined,
);
const o = carBase(0);
const definition = vehicleDefinition(machine);

type Poser = (pose: LabPose, cockpit: boolean) => void;
let poser: Poser = () => undefined;
let carRoot: T.Object3D = new T.Group();
let formula: FormulaCar | null = null;

function applyPose(pose: LabPose) {
  if (pose.time !== undefined) frame[H.TIME] = pose.time;
  if (pose.steer !== undefined) frame[o + F.STEER] = pose.steer;
  if (pose.brake !== undefined) frame[o + F.BRAKE] = pose.brake;
  if (pose.speed !== undefined) frame[o + F.SPEED] = pose.speed;
  if (pose.discTemp !== undefined)
    for (let i = 0; i < 4; i++)
      frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.DISC_TEMP] = pose.discTemp;
  if (pose.steer !== undefined)
    for (let i = 0; i < 2; i++)
      frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.STEER] = pose.steer * 0.3;
  if (pose.lean !== undefined) frame[o + BIKE_BASE + B.LEAN] = pose.lean;
  if (pose.hang !== undefined) frame[o + BIKE_BASE + B.RIDER_OFFSET] = pose.hang;
}

/** The lab floor is y = 0 and the machine faces +Z at the origin, at its showroom datum. */
function seat(root: T.Object3D) {
  if (definition.bike) {
    // A leaning bike pivots about its contact patch: the centre of gravity swings inboard.
    const lean = frame[o + BIKE_BASE + B.LEAN] || 0,
      cg = definition.bike.cgHeight;
    root.position.set(cg * Math.sin(lean), cg * Math.cos(lean), 0);
    root.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), -lean);
    return;
  }
  root.position.set(0, definition.spec.restLength + definition.spec.wheelRadius - 0.05, 0);
  root.quaternion.identity();
}

async function build() {
  if (machine === 'apx01') {
    const [hero, rivals, driver] = await Promise.all([
      loadHeroShells(),
      loadRivalLevels(),
      loadDriverAsset(),
    ]);
    const car = new FormulaCar(0, hero, driver, undefined, rivals);
    formula = car;
    carRoot = car.root;
    scene.add(car.root);
    car.setLod(0, 'high', true, true);
    poser = (pose, cockpit) => {
      applyPose(pose);
      car.update(frame, frame, o, 1, 0, 0, cockpit);
    };
  } else if (definition.bike) {
    const shells = new BikeShells();
    scene.add(shells.root);
    const host = { root: new T.Group() };
    scene.add(host.root);
    carRoot = host.root;
    poser = (pose) => {
      applyPose(pose);
      sampleChassisPose(frame, frame, o, 1, host.root.position, host.root.quaternion);
      seat(host.root);
      shells.update(frame, frame, 1, [host], camera, 'high', 0);
    };
  } else {
    const bodies = new VehicleBodies();
    scene.add(bodies.root);
    const host = { root: new T.Group(), lodLevel: 0 };
    scene.add(host.root);
    carRoot = host.root;
    poser = (pose) => {
      applyPose(pose);
      sampleChassisPose(frame, frame, o, 1, host.root.position, host.root.quaternion);
      seat(host.root);
      bodies.update(frame, frame, 1, [host], false, { follow: 0, cockpit: false, camera: null });
    };
  }
}

async function ready() {
  await build();
  (window as unknown as { lab: unknown }).lab = {
    machine,
    views: Object.keys(VIEWS),
    /** Pose, frame the camera and draw. Returns the draw-call and triangle counts. */
    render(viewName: string, pose: LabPose = {}, custom?: LabView) {
      const view = custom ?? VIEWS[viewName];
      if (!view) throw new Error(`Unknown view ${viewName}`);
      const cockpit = viewName.startsWith('cockpit');
      poser(pose, cockpit);
      seat(carRoot);
      carRoot.updateMatrixWorld(true);
      camera.fov = view.fov ?? 32;
      camera.updateProjectionMatrix();
      const eye = new T.Vector3(...view.eye),
        at = new T.Vector3(...view.at);
      if (viewName.startsWith('cockpit')) {
        eye.add(carRoot.position);
        at.add(carRoot.position);
      } else if (!definition.bike && !viewName.startsWith('bike') && !custom) {
        // The named views are for a 5 m car: a kart (2 m) or a pickup (6.8 m) is framed the same way.
        const scale = Math.min(1.35, Math.max(0.5, (definition.halfExtents[2] * 2) / 5));
        eye.multiplyScalar(scale);
        at.multiplyScalar(scale);
      }
      camera.position.copy(eye);
      camera.lookAt(at);
      // Keep the key light's shadow frustum on the car.
      key.target.position.set(0, 0, 0);
      key.target.updateMatrixWorld();
      renderer.render(scene, camera);
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    formula: () => formula,
    scene,
    camera,
  };
  document.title = `lab:${machine}:ready`;
}
ready().catch((error) => {
  document.title = `lab:error:${String(error)}`;
  console.error(error);
});
