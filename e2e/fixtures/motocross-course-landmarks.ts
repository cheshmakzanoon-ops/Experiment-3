import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BuildQueue } from '../../src/rendering/build-queue.ts';
import { OffroadScene } from '../../src/rendering/offroad/index.ts';
import { mxFurnitureGround } from '../../src/rendering/offroad/mx-trackside-furniture.ts';
import { scannedGround } from '../../src/rendering/ground/scan-store.ts';
import { disposeTextureLoaders } from '../../src/rendering/assets/texture-loader.ts';
import { materials } from '../../src/rendering/materials/index.ts';
import { lightPoolUniforms } from '../../src/rendering/studio/light-pools.ts';
import { rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import { trackPoint } from '../../src/simulation/track.ts';

/** Isolated production course objects under controlled inspection lighting.
 * This deliberately reports a component render, not full-game FPS. The full
 * app/worker/controls are exercised separately by MX45. */
export async function captureMxCourseIdentities(circuit: 'valley-ridge-mx' | 'arena-nord-sx') {
  const track = rigTrack(circuit),
    queue = new BuildQueue(),
    world = new OffroadScene(track, queue);
  queue.runSynchronously();
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1280, 800);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(),
    indoor = circuit === 'arena-nord-sx',
    camera = new T.PerspectiveCamera(48, 1.6, 0.1, 1400),
    sun = new T.DirectionalLight(indoor ? 0xd9e9ff : 0xffebce, indoor ? 2.5 : 3.1);
  scene.background = new T.Color(indoor ? 0x142135 : 0xb9cbd4);
  scene.fog = new T.Fog(scene.background, 220, 1200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.012;
  Object.assign(sun.shadow.camera, {
    left: -25,
    right: 25,
    top: 25,
    bottom: -25,
    near: 0.1,
    far: 150,
  });
  scene.add(world.group, sun, sun.target, new T.HemisphereLight(0xc8e1f1, 0x746149, 1.05));
  const pmrem = new T.PMREMGenerator(renderer),
    room = new RoomEnvironment(),
    environment = pmrem.fromScene(room, 0.08);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.55;
  const strength = lightPoolUniforms.lightPoolStrength.value;
  lightPoolUniforms.lightPoolStrength.value = 0;
  const patches: T.Mesh<T.PlaneGeometry, T.MeshStandardMaterial>[] = [];
  const targets: {
    label: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    distance: number;
    front: number;
  }[] = world.landmarks!.plan.landmarks.map((site) => ({
    label: site.kind,
    x: site.x,
    y: site.y + (site.kind === 'quarry' ? 2 : 2.6),
    z: site.z,
    yaw: site.yaw,
    distance: site.kind === 'quarry' ? 24 : 20,
    front: -1,
  }));
  const guide = world.landmarks!.plan.guides[0];
  if (guide)
    targets.push({
      label: 'jump-guide',
      x: guide.x,
      y: guide.y + 1.2,
      z: guide.z,
      yaw: guide.yaw,
      distance: 4.1,
      front: 1,
    });
  if (!indoor) {
    // Local ground is sampled from the same visible-ground query used for
    // each footing, rather than moving models down to an arbitrary flat plane.
    for (const target of targets) {
      const geometry = new T.PlaneGeometry(66, 66, 44, 44).rotateX(-Math.PI / 2),
        position = geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        const x = target.x + position.getX(i),
          z = target.z + position.getZ(i),
          p = trackPoint(),
          lateral = track.nearest(x, z, p);
        const y = mxFurnitureGround(track, x, z) - 0.025;
        position.setXYZ(i, x, y, z);
        // TerrainView owns every legal riding surface; this substrate sits
        // below it and only fills the ground behind the course furniture.
        if (Math.abs(lateral) < p.width + 4) position.setY(i, y - 0.2);
      }
      geometry.computeVertexNormals();
      const patch = new T.Mesh(
        geometry,
        new T.MeshStandardMaterial({ color: 0x656b49, roughness: 1 }),
      );
      patch.receiveShadow = true;
      patches.push(patch);
      scene.add(patch);
    }
  }
  try {
    materials.prepare(renderer);
    scannedGround.attach(renderer, 'high');
    if (!(await scannedGround.ready(60000)))
      throw new Error(`Scans unavailable: ${JSON.stringify(scannedGround.diagnostics())}`);
    const captures = [];
    for (const target of targets) {
      const rightX = Math.cos(target.yaw),
        rightZ = -Math.sin(target.yaw),
        forwardX = Math.sin(target.yaw),
        forwardZ = Math.cos(target.yaw);
      camera.position.set(
        target.x + target.front * forwardX * target.distance + rightX * target.distance * 0.34,
        target.y + (target.label === 'jump-guide' ? 0.1 : 3.0),
        target.z + target.front * forwardZ * target.distance + rightZ * target.distance * 0.34,
      );
      camera.lookAt(target.x, target.y, target.z);
      sun.position.set(target.x - 22, target.y + 40, target.z + 25);
      sun.target.position.set(target.x, target.y, target.z);
      renderer.render(scene, camera);
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      captures.push({
        label: target.label,
        image: renderer.domElement.toDataURL('image/png'),
        glError: gl.getError(),
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        landmarks: world.landmarks!.plan.landmarks.map(({ kind, name }) => ({ kind, name })),
        guides: world.landmarks!.plan.guides.map(({ jump, station }) => ({
          name: jump.name,
          station,
        })),
        budget: { draws: world.landmarks!.draws, triangles: world.landmarks!.triangles },
        soilScans: scannedGround.diagnostics(),
        view: { camera: camera.position.toArray(), lookAt: [target.x, target.y, target.z] },
      });
    }
    return captures;
  } finally {
    lightPoolUniforms.lightPoolStrength.value = strength;
    scannedGround.detach(renderer);
    world.dispose();
    for (const patch of patches) {
      patch.geometry.dispose();
      patch.material.dispose();
    }
    environment.dispose();
    room.dispose();
    pmrem.dispose();
    await disposeTextureLoaders(renderer);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
