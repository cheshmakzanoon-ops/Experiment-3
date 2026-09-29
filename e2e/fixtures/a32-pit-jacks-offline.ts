import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FormulaCar } from '../../src/rendering/car.ts';
import { SuppliedPlayer, type SuppliedPlayerAsset } from '../../src/rendering/supplied-player.ts';
import { PitCrewView } from '../../src/rendering/pit-crew.ts';
import { PitJackBatches, pitJackDocument } from '../../src/rendering/a32-pit-jacks.ts';
import { WheelGunBatches } from '../../src/rendering/wheel-gun.ts';
import { measurePitJackFits } from '../../src/rendering/a32-jack-contact.ts';
import { measureWheelGunFits } from '../../src/rendering/wheel-gun-contact.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import { completedDrawMilliseconds } from './completed-draw.ts';

export interface A32OfflineInput {
  jacks: string;
  player: string;
  guns: string;
  samples: number[][];
  lighting: 'day' | 'sunset' | 'night';
}
const bytes = (base64: string) => {
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Network-free assembly inspection on about:blank. Node verifies the exact
 * source bytes before passing them here. This deliberately does NOT exercise
 * the production acquisition/startup path or claim a complete circuit survey. */
export async function inspectA32Offline(input: A32OfflineInput) {
  const loader = new GLTFLoader();
  const jackBytes = bytes(input.jacks);
  pitJackDocument(jackBytes);
  const jackAsset = await loader.parseAsync(jackBytes.buffer, '');
  const gunAsset = await loader.parseAsync(bytes(input.guns).buffer, '');
  const zipped = bytes(input.player);
  const playerBytes = await new Response(
    new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer();
  const playerAsset = await loader.parseAsync(playerBytes, '');
  // Exercise the actual supplied-player pose implementation without fetching
  // its separately generated LOD derivative. Full retained LOD0 is used here.
  const measuredAsset = {
    take: (display: T.CanvasTexture) =>
      new SuppliedPlayer(playerAsset.scene, playerAsset.animations, display),
  } as unknown as SuppliedPlayerAsset;
  const car = new FormulaCar(0, undefined, undefined, measuredAsset);
  car.setLod(0, 'high', true);
  const fits = measurePitJackFits(car);
  const crew = new PitCrewView();
  const jacks = new PitJackBatches(jackAsset.scene);
  const guns = new WheelGunBatches(gunAsset.scene);
  crew.installWheelGuns(guns);
  crew.installPitJacks(jacks);
  crew.setPitJackFits(0, fits);
  crew.setWheelGunFits(0, measureWheelGunFits(car));
  const scene = new T.Scene();
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1280, 720);
  renderer.setPixelRatio(1);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = input.lighting === 'night' ? 1.25 : 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const env = new RoomEnvironment();
  const pmrem = new T.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.03);
  env.dispose();
  pmrem.dispose();
  scene.environment = target.texture;
  scene.environmentIntensity = input.lighting === 'night' ? 0.22 : 0.8;
  scene.background = new T.Color(input.lighting === 'night' ? 0x161d27 : 0xb2b8bd);
  const ambient = new T.HemisphereLight(
    0xd9e8ff,
    0x444345,
    input.lighting === 'night' ? 0.55 : 1.4,
  );
  const sun = new T.DirectionalLight(
    input.lighting === 'sunset' ? 0xffc999 : 0xf1f6ff,
    input.lighting === 'night' ? 2.2 : 3,
  );
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
  sun.shadow.camera.right = sun.shadow.camera.top = 8;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 40;
  sun.shadow.normalBias = 0.006;
  const ground = new T.Mesh(
    new T.PlaneGeometry(25, 25).rotateX(-Math.PI / 2),
    new T.MeshStandardMaterial({
      color: input.lighting === 'night' ? 0x282d33 : 0x5e676b,
      roughness: input.lighting === 'night' ? 0.28 : 0.78,
      metalness: 0.08,
    }),
  );
  ground.receiveShadow = true;
  scene.add(car.root, crew.root, ground, ambient, sun, sun.target);
  // This fixture's floor/illumination are intentionally simple engineering
  // references, not the game's circuit, weather, mirror or exposure systems.
  document.body.style.cssText = 'margin:0;background:#161d27';
  document.body.append(renderer.domElement);
  const camera = new T.PerspectiveCamera(48, 1280 / 720, 0.03, 100);
  const o = carBase(0);
  const point = new T.Vector3();
  const signatures: string[] = [];
  const states: ReturnType<typeof crew.summary>[] = [];
  const contacts: { role: string; error: number; floorError: number }[] = [];
  const images: {
    name: string;
    image: string;
    calls: number;
    triangles: number;
    pixels: { nonBlackFraction: number; range: number };
  }[] = [];
  const gl = renderer.getContext();
  const completionPixel = new Uint8Array(4);
  const framePixels = new Uint8Array(1280 * 720 * 4);
  const draw = () =>
    completedDrawMilliseconds(gl, () => renderer.render(scene, camera), completionPixel);
  const imagePixels = () => {
    gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, framePixels);
    if (gl.isContextLost()) throw new Error('Lost A32 inspection context');
    let min = 255,
      max = 0,
      nonBlack = 0;
    for (let i = 0; i < framePixels.length; i += 4) {
      const value = Math.max(framePixels[i], framePixels[i + 1], framePixels[i + 2]);
      min = Math.min(min, value);
      max = Math.max(max, value);
      if (value > 2) nonBlack++;
    }
    return { nonBlackFraction: nonBlack / (1280 * 720), range: max - min };
  };
  const signature = () => JSON.stringify(Array.from(jacks.matrices));
  let sourceUnchanged = true;
  const setCamera = (shot: 'pair' | 'front' | 'rear') => {
    const eye =
      shot === 'pair'
        ? [6.6, 3.5, 7.3]
        : shot === 'front'
          ? [1.38, 0.36, 4.42]
          : [-1.38, 0.48, -3.98];
    const look =
      shot === 'pair' ? [0, 0.05, 0] : shot === 'front' ? [0, -0.18, 3.1] : [0, -0.13, -2.66];
    camera.position.fromArray(eye).applyMatrix4(car.root.matrixWorld);
    camera.lookAt(point.fromArray(look).applyMatrix4(car.root.matrixWorld));
    camera.fov = shot === 'pair' ? 48 : 46;
    camera.updateProjectionMatrix();
  };
  const update = (frame: Float32Array) => {
    car.update(frame, frame, o, 1, 0, frame[H.TIME], false);
    car.root.updateMatrixWorld(true);
    ground.position.set(0, -0.43 - frame[o + F.JACK_HEIGHT], 0).applyMatrix4(car.root.matrixWorld);
    ground.quaternion.copy(car.root.quaternion);
    sun.position
      .set(5, input.lighting === 'sunset' ? 2.5 : 8, 4)
      .applyMatrix4(car.root.matrixWorld);
    sun.target.position.copy(car.root.position);
    setCamera('pair');
    crew.update(frame, camera.position, true, camera.fov, camera.aspect);
  };
  try {
    const textureFacts: { name: string; width: number; height: number }[] = [];
    const material = jacks.batches[0].material as T.MeshStandardMaterial;
    for (const t of new Set([material.map, material.normalMap, material.roughnessMap])) {
      if (!t?.image) throw new Error('A32 native browser texture decode failed');
      textureFacts.push({ name: t.name, width: t.image.width, height: t.image.height });
    }
    for (let i = 0; i < input.samples.length; i++) {
      const frame = new Float32Array(input.samples[i]);
      const before = frame.slice();
      update(frame);
      signatures.push(signature());
      states.push(crew.summary());
      sourceUnchanged &&= frame.every((v, k) => v === before[k]);
      const inverse = car.root.matrixWorld.clone().invert();
      for (const [slot, role] of [
        [0, 'rear'],
        [1, 'front'],
      ] as const) {
        const prefix = `A32_${role.toUpperCase()}`;
        const matrix = new T.Matrix4().fromArray(jacks.matrices, (slot * 4 + 2) * 16);
        const actual = jackAsset.scene
          .getObjectByName(`SOCKET_${prefix}_CONTACT`)!
          .position.clone()
          .applyMatrix4(matrix);
        const wanted = new T.Vector3(...fits[role]).applyMatrix4(car.root.matrixWorld);
        matrix.fromArray(jacks.matrices, slot * 4 * 16);
        const localGround = jackAsset.scene
          .getObjectByName(`SOCKET_${prefix}_GROUND`)!
          .position.clone()
          .applyMatrix4(matrix)
          .applyMatrix4(inverse);
        contacts.push({
          role,
          error: actual.distanceTo(wanted),
          floorError: Math.abs(localGround.y - (-0.43 - frame[o + F.JACK_HEIGHT])),
        });
      }
      draw();
      if (i === 0 || i === Math.floor(input.samples.length / 2) || i === input.samples.length - 1) {
        for (const shot of ['pair', 'front', 'rear'] as const) {
          setCamera(shot);
          crew.update(frame, camera.position, true, camera.fov, camera.aspect);
          renderer.info.reset();
          draw();
          images.push({
            name: `${shot}-phase-${frame[o + F.PIT_PHASE]}-${i}`,
            image: renderer.domElement.toDataURL('image/png'),
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            pixels: imagePixels(),
          });
        }
      }
    }
    const first = new Float32Array(input.samples[0]);
    update(first);
    const rewindSame = signature() === signatures[0];
    const uploads = jacks.uploads;
    crew.update(first, camera.position, true, camera.fov, camera.aspect);
    const heldUploadStable = jacks.uploads === uploads;
    draw();
    const before = { ...renderer.info.memory };
    for (let i = 0; i < 3; i++) draw();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      images,
      states,
      contacts,
      textureFacts,
      fits,
      sourceUnchanged,
      rewindSame,
      heldUploadStable,
      before,
      after: { ...renderer.info.memory },
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown',
      boundary:
        'Offline production-car/crew assembly on an engineering floor; no HTTP startup, complete circuit, weather, mirror, or hardware-performance certification.',
    };
  } finally {
    crew.dispose();
    car.suppliedPlayer?.disposeAnimation();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    scene.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof T.Texture) textures.add(value);
      }
      if (object instanceof T.InstancedMesh) object.dispose();
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => {
      t.dispose();
      if (t.image instanceof ImageBitmap) t.image.close();
    });
    target.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
}
