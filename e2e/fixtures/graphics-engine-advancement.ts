import * as T from 'three';
import { TrafficCars } from '../../src/rendering/traffic-cars.ts';
import { TRAFFIC_VISUAL_PROFILES } from '../../src/rendering/traffic-car-geometry.ts';
import { StreetLightPools } from '../../src/rendering/open-world/street-light-pools.ts';
import {
  TF,
  TRAFFIC_HEADER,
  TRAFFIC_STRIDE,
  TRAFFIC_VERSION,
} from '../../src/simulation/open-world/ambient-traffic.ts';

/** A real WebGL check of the production traffic and lamp owners. It needs no
 * downloaded art, so a shader or depth-pass regression cannot be hidden by
 * unrelated asset streaming. The images are component evidence, not a full
 * gameplay screenshot or a hardware performance benchmark. */
export function capture() {
  const width = 720,
    height = 420;
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  const renderer = new T.WebGLRenderer({ canvas, context: gl });
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.AgXToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const scene = new T.Scene();
  scene.background = new T.Color(0x080e19);
  const camera = new T.PerspectiveCamera(56, width / height, 0.2, 160);
  camera.position.set(16, 12, -12);
  camera.lookAt(0, 0.5, 10);
  camera.updateMatrixWorld();
  const ground = new T.Mesh(
    new T.PlaneGeometry(80, 70).rotateX(-Math.PI / 2),
    new T.MeshStandardMaterial({ color: 0x7b8187, roughness: 0.88 }),
  );
  ground.receiveShadow = true;
  scene.add(ground, new T.HemisphereLight(0x8fa9d0, 0x292521, 0.3));
  const cars = new TrafficCars();
  scene.add(cars.root);
  const snapshot = new Float32Array(
    TRAFFIC_HEADER + TRAFFIC_VISUAL_PROFILES.length * TRAFFIC_STRIDE,
  );
  snapshot[0] = TRAFFIC_VISUAL_PROFILES.length;
  snapshot[1] = 1;
  snapshot[2] = TRAFFIC_VERSION;
  TRAFFIC_VISUAL_PROFILES.forEach((profile, i) => {
    const o = TRAFFIC_HEADER + i * TRAFFIC_STRIDE;
    snapshot[o + TF.ID] = i + 1;
    snapshot[o + TF.VEHICLE] = profile.index;
    snapshot[o + TF.X] = ((i % 5) - 2) * 5;
    snapshot[o + TF.Y] = profile.vehicle.halfExtents[1];
    snapshot[o + TF.Z] = i < 5 ? 4 : 16;
    snapshot[o + TF.QW] = 1;
    snapshot[o + TF.DISTANCE] = i * 0.37;
  });
  cars.update(snapshot, snapshot, 1, 1, 1);
  const pools = new StreetLightPools(
    [-6, 6].map((x) => ({
      position: new T.Vector3(x, 7, 9),
      target: new T.Vector3(x, 0, 9),
    })),
  );
  scene.add(pools.root);
  pools.configureShadows('ultra', true, renderer.capabilities.maxTextureSize);
  for (let i = 0; i < 20; i++) pools.update(camera, 1, 'ultra', 0.08);
  const pixels = () => {
    const data = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
  };
  const draw = (time: number) =>
    pools.renderWithShadows(renderer, time, 0, () => renderer.render(scene, camera));
  draw(1);
  const shadowed = pixels(),
    shadowedImage = canvas.toDataURL('image/png'),
    ultra = pools.diagnostics();
  draw(1);
  const held = pools.diagnostics();
  pools.configureShadows('ultra', false, renderer.capabilities.maxTextureSize);
  draw(1);
  const unshadowed = pixels(),
    unshadowedImage = canvas.toDataURL('image/png'),
    off = pools.diagnostics();
  let darkenedPixels = 0,
    brighterPixels = 0,
    difference = 0;
  for (let p = 0; p < shadowed.length; p += 4) {
    const on = shadowed[p] + shadowed[p + 1] + shadowed[p + 2],
      without = unshadowed[p] + unshadowed[p + 1] + unshadowed[p + 2];
    if (without - on > 12) darkenedPixels++;
    if (on - without > 12) brighterPixels++;
    difference += Math.abs(on - without);
  }
  pools.configureShadows('high', true, renderer.capabilities.maxTextureSize);
  pools.update(camera, 1, 'high', 0.08);
  draw(2);
  const high = pools.diagnostics();
  // A bright view makes the actual native body morphs reviewable as well.
  pools.update(camera, 0, 'high', 0.08);
  const sun = new T.DirectionalLight(0xfff3d9, 3.2);
  sun.position.set(-12, 22, -8);
  scene.background.set(0x899bab);
  scene.add(sun);
  renderer.render(scene, camera);
  const daylightImage = canvas.toDataURL('image/png');
  const glErrors: number[] = [];
  for (
    let i = 0, error = gl.getError();
    error !== gl.NO_ERROR && i < 16;
    i++, error = gl.getError()
  )
    glErrors.push(error);
  const traffic = cars.diagnostics;
  cars.dispose();
  pools.dispose();
  ground.geometry.dispose();
  ground.material.dispose();
  renderer.dispose();
  return {
    images: { daylight: daylightImage, shadowed: shadowedImage, unshadowed: unshadowedImage },
    width,
    height,
    glErrors,
    contextAlive: !gl.isContextLost(),
    traffic,
    ultra,
    held,
    off,
    high,
    darkenedPixels,
    brighterPixels,
    absoluteChannelDifference: difference,
  };
}
