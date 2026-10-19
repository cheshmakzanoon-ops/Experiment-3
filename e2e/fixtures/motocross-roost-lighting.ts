import * as T from 'three';
import { LocalAtmosphere } from '../../src/rendering/local-atmosphere.ts';
import { Roost } from '../../src/rendering/offroad/roost.ts';
import { TrackTerrainSurface } from '../../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../../src/simulation/offroad/jump-rig.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../src/simulation/protocol.ts';
import { MATERIAL } from '../../src/simulation/surface-material.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { vehicleIndex } from '../../src/simulation/vehicles.ts';

/** Controlled snapshot emitter for the production roost material/contact
 * renderer. This close-up is a component check, not a played race or FPS test. */
function emittedRoost(wet: boolean) {
  const track = rigTrack('valley-ridge-mx');
  const terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain;
  const p = track.at(100, trackPoint());
  const roost = new Roost(track);
  roost.groundHeight = (s, lateral) => terrain.baseHeight(s, lateral);
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    b = carBase(0);
  frame[H.CARS] = 1;
  frame[b + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
  frame[b + F.X] = p.x;
  frame[b + F.Y] = terrain.baseHeight(100, 0) + 0.55;
  frame[b + F.Z] = p.z;
  const yaw = Math.atan2(p.tx, p.tz);
  frame[b + F.QY] = Math.sin(yaw / 2);
  frame[b + F.QW] = Math.cos(yaw / 2);
  frame[b + F.S] = p.s;
  frame[b + F.SPEED] = 18;
  frame[b + F.VX] = p.tx * 18;
  frame[b + F.VZ] = p.tz * 18;
  frame[b + OFFROAD_BASE + O.MOISTURE] = wet ? 0.7 : 0;
  for (const wheel of [0, 2]) {
    const w = b + WHEEL_BASE + wheel * WHEEL_STRIDE;
    frame[w + W.LOAD] = 650;
    frame[w + W.SLIP] = 0.42;
    frame[w + W.SURFACE] = wet ? MATERIAL.MUD : MATERIAL.DIRT;
  }
  const source = frame.slice();
  for (let i = 0; i < 40; i++) roost.update(frame, 1 / 60);
  return { track, terrain, p, roost, frame, source };
}

export function captureMotocrossRoostLighting(wet: boolean) {
  const { track, terrain, p, roost, frame, source } = emittedRoost(wet);
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1120, 700);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene();
  scene.background = new T.Color(0x434a4e);
  const key = new T.DirectionalLight(0xffe6c2, 3.4);
  key.position.set(p.x + p.nx * 8 - p.tx * 2, p.y + 6, p.z + p.nz * 8 - p.tz * 2);
  key.target.position.set(p.x, p.y, p.z);
  scene.add(key, key.target, new T.HemisphereLight(0xc9deed, 0x645340, 0.8));
  scene.add(roost.points, roost.clods!, roost.contactShadows!);
  const ground = new T.PlaneGeometry(24, 24, 48, 48).rotateX(-Math.PI / 2);
  const positions = ground.getAttribute('position'),
    at = trackPoint();
  for (let i = 0; i < positions.count; i++) {
    const x = p.x + positions.getX(i),
      z = p.z + positions.getZ(i);
    const lateral = track.nearest(x, z, at);
    positions.setXYZ(i, x, terrain.baseHeight(at.s, lateral), z);
  }
  ground.computeVertexNormals();
  const soil = new T.MeshStandardMaterial({
    color: wet ? 0x564534 : 0x95734f,
    roughness: wet ? 0.66 : 0.96,
  });
  const floor = new T.Mesh(ground, soil);
  scene.add(floor);
  const camera = new T.PerspectiveCamera(51, 1.6, 0.08, 100);
  const y = terrain.baseHeight(100, 0);
  camera.position.set(p.x - p.tx * 4.3 + p.nx * 2.1, y + 1.5, p.z - p.tz * 4.3 + p.nz * 2.1);
  camera.lookAt(p.x - p.tx * 1.7, y + 0.8, p.z - p.tz * 1.7);
  const gl = renderer.getContext(),
    pixels = new Uint8Array(1120 * 700 * 4);
  const sample = (label: string) => {
    renderer.render(scene, camera);
    gl.readPixels(0, 0, 1120, 700, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return {
      label,
      hash,
      image: renderer.domElement.toDataURL('image/png'),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      resources: { ...renderer.info.memory },
      glError: gl.getError(),
    };
  };
  const whole = sample(wet ? 'wet-soil-contact' : 'dry-soil-contact');
  floor.visible = roost.points.visible = roost.contactShadows!.visible = false;
  const left = sample('fragments-lit-from-left');
  key.position.set(p.x - p.nx * 8 - p.tx * 2, p.y + 6, p.z - p.nz * 8 - p.tz * 2);
  const right = sample('fragments-lit-from-right');
  const repeat = sample('fragments-held');
  roost.clods!.visible = false;
  const hidden = sample('fragments-hidden');
  const result = {
    wet,
    clods: roost.clods!.count,
    active: roost.active,
    sourceUnchanged: frame.every((value, i) => value === source[i]),
    samples: [whole, left, right, repeat, hidden],
  };
  ground.dispose();
  soil.dispose();
  roost.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return result;
}

/** Keep actual emitted dust positions/opacity fixed while changing only the
 * real scene lights. A black background isolates scattered light from clods,
 * ground colour, atmosphere and post-processing. */
export function captureMotocrossDustLighting() {
  const { track, roost, frame, source } = emittedRoost(false);
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(800, 500);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene();
  scene.background = new T.Color(0);
  scene.fog = new T.FogExp2(0x7891a3, 0);
  scene.add(roost.points);
  const geometry = roost.points.geometry,
    positions = geometry.getAttribute('position'),
    shapes = geometry.getAttribute('mxParticleShape'),
    opacity = geometry.getAttribute('mxParticleAlpha'),
    centre = new T.Vector3();
  let count = 0;
  for (let i = 0; i < positions.count; i++) {
    if (shapes.getX(i) < 0.5 || opacity.getX(i) <= 0) continue;
    centre.add(new T.Vector3().fromBufferAttribute(positions, i));
    count++;
  }
  centre.divideScalar(count);
  const camera = new T.PerspectiveCamera(50, 1.6, 0.05, 100);
  const toEye = new T.Vector3(0.6, 0.35, 1).normalize();
  camera.position.copy(centre).addScaledVector(toEye, 5);
  camera.lookAt(centre);
  const sun = new T.DirectionalLight(0xfff0d8, 0),
    hemisphere = new T.HemisphereLight(0x8eb6ec, 0x7d5c3d, 0),
    lamp = new T.PointLight(0xffaa66, 0, 20, 2),
    spot = new T.SpotLight(0x75aaff, 0, 20, 0.6, 0.3, 2);
  sun.target.position.copy(centre);
  spot.target.position.copy(centre);
  sun.position.copy(centre).addScaledVector(toEye, 100);
  lamp.position.copy(centre).addScaledVector(toEye, 2.5);
  spot.position.copy(centre).addScaledVector(toEye, 4);
  scene.add(sun, sun.target, hemisphere, lamp, spot, spot.target);
  const gl = renderer.getContext(),
    debug = gl.getExtension('WEBGL_debug_renderer_info'),
    adapter = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable';
  const samples: {
    label: string;
    hash: number;
    width: number;
    height: number;
    rgb: number[];
    energy: number;
    coverage: number;
    calls: number;
    resources: { geometries: number; textures: number; programs: number };
    glError: number;
    image: string;
  }[] = [];
  const capture = (label: string) => {
    renderer.render(scene, camera);
    const width = renderer.domElement.width,
      height = renderer.domElement.height,
      pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261,
      litPixels = 0;
    const rgb = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        rgb[channel] += pixels[i + channel];
        hash = Math.imul(hash ^ pixels[i + channel], 16777619) >>> 0;
      }
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 9) litPixels++;
    }
    const sample = {
      label,
      hash,
      width,
      height,
      rgb,
      energy: rgb.reduce((sum, value) => sum + value, 0) / (width * height),
      coverage: litPixels / (width * height),
      calls: renderer.info.render.calls,
      resources: { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 },
      glError: gl.getError(),
      image: renderer.domElement.toDataURL('image/png'),
    };
    samples.push(sample);
  };
  capture('dark');
  sun.intensity = 4;
  capture('front-lit');
  sun.position.copy(centre).addScaledVector(toEye, -100);
  capture('back-lit');
  capture('back-lit-held');
  sun.intensity = 0;
  hemisphere.intensity = 1.1;
  capture('sky-lit');
  hemisphere.intensity = 0;
  lamp.intensity = 70;
  capture('lamp-near');
  lamp.position.copy(centre).addScaledVector(toEye, 9);
  capture('lamp-far');
  lamp.intensity = 0;
  spot.intensity = 100;
  capture('spot-blue');
  spot.target.position.copy(centre).add(new T.Vector3(20, 20, 0));
  capture('spot-away');
  spot.intensity = 0;
  hemisphere.intensity = 1.1;
  scene.fog.density = 0.22;
  capture('fog');
  scene.fog.density = 0;
  capture('sky-restored');
  renderer.setPixelRatio(2);
  renderer.setSize(400, 250);
  capture('sky-dpr2');
  renderer.setPixelRatio(1);
  renderer.setSize(800, 500);
  capture('sky-resized-back');

  // Exercise the production hook after the primary lighting comparisons.
  // Translate the intact cloud and camera together into an actual authored
  // pocket; the simulation snapshot and particle buffers remain unchanged.
  const atmosphere = new LocalAtmosphere(track),
    pocket = atmosphere.pockets[0],
    offset = new T.Vector3(pocket.x, pocket.floor + 0.7, pocket.z).sub(centre),
    weather = frame.slice(),
    atmosphereStart = samples.length;
  roost.points.position.copy(offset);
  camera.position.add(offset);
  camera.lookAt(centre.clone().add(offset));
  scene.fog.density = 0.22;
  capture('atmosphere-native-fog');
  atmosphere.install(roost.points);
  atmosphere.install(roost.points); // Reused-scene installation is idempotent.
  capture('atmosphere-clear');
  weather[H.CLOUD] = 1;
  weather[H.RAIN] = 20;
  atmosphere.update(weather, true);
  capture('atmosphere-local-fog');
  capture('atmosphere-local-held');
  atmosphere.update(weather, false);
  capture('atmosphere-restored');
  const atmosphereSamples = samples.splice(atmosphereStart);
  const result = {
    adapter,
    dust: count,
    capacity: positions.count,
    sourceUnchanged: frame.every((value, i) => value === source[i]),
    samples,
    atmosphere: { materialCount: atmosphere.materialCount, samples: atmosphereSamples },
  };
  roost.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return result;
}
