/** Actual regional building and production material under fixed component
 * lighting. The sole comparison switch is the facade interior-depth uniform. */
import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Buildings } from '../../src/rendering/open-world/buildings.ts';
import { facadeLayout } from '../../src/rendering/open-world/facade-layout.ts';
import { regionStructures } from '../../src/simulation/open-world/placement.ts';
import { openWorld } from '../../src/simulation/open-world/world.ts';
import { pixelDifference } from './pixel-difference.ts';

const canvas = document.querySelector('canvas')!;
const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(960, 640);
renderer.setPixelRatio(1);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
const scene = new T.Scene();
const structure = regionStructures(openWorld())
  .filter((s) => s.kind === 'shop')
  .sort((a, b) => Math.hypot(a.x - 570, a.z + 2590) - Math.hypot(b.x - 570, b.z + 2590))
  .find((s) =>
    facadeLayout(s, s.hx * 2, 0)?.openings.some(
      (o) => o.kind === 'shop' && o.room > 0.3 && o.room < 0.75,
    ),
  )!;
const opening = facadeLayout(structure, structure.hx * 2, 0)!.openings.find(
  (o) => o.kind === 'shop' && o.room > 0.3 && o.room < 0.75,
)!;
const buildings = new Buildings([structure]);
scene.add(buildings.root);
const c = Math.cos(structure.heading),
  s = Math.sin(structure.heading);
const local = (x: number, y: number, z: number) =>
  new T.Vector3(structure.x + c * x - s * z, structure.base + y, structure.z + s * x + c * z);
const centre = local(
  structure.hx - (opening.u0 + opening.u1) / 2,
  (opening.v0 + opening.v1) / 2,
  -structure.hz,
);
const tangent = new T.Vector3(-c, 0, -s),
  outward = new T.Vector3(s, 0, -c);
const camera = new T.PerspectiveCamera(47, 1.5, 0.1, 400);
const sun = new T.DirectionalLight(0xffedce, 3.2);
sun.position.copy(local(-35, 45, -20));
sun.target.position.copy(local(0, 2, 0));
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -25;
sun.shadow.camera.right = sun.shadow.camera.top = 25;
sun.shadow.normalBias = 0.025;
const hemisphere = new T.HemisphereLight(0xcbd9ee, 0x4b4840, 1.2);
scene.add(sun, sun.target, hemisphere);
const ground = new T.Mesh(
  new T.PlaneGeometry(100, 100),
  new T.MeshStandardMaterial({ color: 0x777975, roughness: 0.96 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.copy(local(0, 0.5, 0));
ground.receiveShadow = true;
scene.add(ground);
const pmrem = new T.PMREMGenerator(renderer),
  room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture;
room.dispose();
pmrem.dispose();
const context = renderer.getContext();
const adapterInfo = context.getExtension('WEBGL_debug_renderer_info');
const adapter = context.getParameter(
  adapterInfo ? adapterInfo.UNMASKED_RENDERER_WEBGL : context.RENDERER,
);
const read = () => {
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  context.readPixels(
    0,
    0,
    canvas.width,
    canvas.height,
    context.RGBA,
    context.UNSIGNED_BYTE,
    pixels,
  );
  return pixels;
};
const draw = (depth: boolean) => {
  buildings.interiorDepth.value = Number(depth);
  renderer.render(scene, camera);
  return {
    pixels: read(),
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    memory: { ...renderer.info.memory },
  };
};
function review(night: boolean, angle: number, wide = false) {
  const target = wide ? local(0, structure.height * 0.35, -structure.hz) : centre;
  camera.position
    .copy(target)
    .addScaledVector(outward, wide ? 22 : 4.8)
    .addScaledVector(tangent, angle)
    .add(new T.Vector3(0, wide ? 3 : 0.3, 0));
  camera.lookAt(target);
  camera.updateMatrixWorld();
  buildings.joinery.update(camera, 'medium');
  buildings.setNight(night ? 1 : 0);
  sun.intensity = night ? 0.12 : 3.2;
  hemisphere.intensity = night ? 0.08 : 1.2;
  scene.environmentIntensity = night ? 0.06 : 1;
  renderer.toneMappingExposure = night ? 0.7 : 0.95;
  scene.background = new T.Color(night ? 0x0b1425 : 0xb9c6d1);
  const before = draw(false),
    beforeImage = canvas.toDataURL('image/png');
  const after = draw(true),
    afterImage = canvas.toDataURL('image/png');
  const repeat = draw(false);
  buildings.interiorDepth.value = 1;
  return {
    adapter,
    structure,
    opening,
    camera: camera.position.toArray(),
    night,
    angle,
    wide,
    beforeImage,
    afterImage,
    difference: pixelDifference(before.pixels, after.pixels),
    repeatDifference: pixelDifference(before.pixels, repeat.pixels),
    before: { calls: before.calls, triangles: before.triangles, memory: before.memory },
    after: { calls: after.calls, triangles: after.triangles, memory: after.memory },
    error: context.getError(),
    contextLost: context.isContextLost(),
  };
}
Object.assign(window, { horizonRooms: { review, ready: true } });
