import * as T from 'three';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { installWetRoad } from '../../src/rendering/materials.ts';
import { RainStreaks } from '../../src/rendering/rain-streaks.ts';
import { applyCircuitLightPalette } from '../../src/rendering/lighting-coherence.ts';
import { circuitLightState, type LightingMode } from '../../src/rendering/daylight.ts';
import { H, HEADER } from '../../src/simulation/protocol.ts';

/** Isolated GPU contracts, NOT ordinary application or full-lap evidence. */
export function visualCoherenceGPU() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new T.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(256, 256);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene();
  scene.background = new T.Color(0);
  const camera = new T.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 3, 4);
  camera.lookAt(0, 0, 0);
  const sun = new T.DirectionalLight(0xffffff, 0);
  sun.position.set(0, 6, -8);
  const fill = new T.HemisphereLight(0xffffff, 0xffffff, 1.2);
  const lamp = new T.PointLight(0xffffff, 0, 30, 2);
  lamp.position.set(0, 3, 0);
  const stone = new T.MeshStandardMaterial({ color: 0x929292, roughness: 0.9 });
  stone.userData.weatherSurface = 'stone';
  const surface = new T.Mesh(new T.PlaneGeometry(4, 4, 1, 1), stone);
  surface.rotation.x = -Math.PI / 2;
  scene.add(surface, sun, fill, lamp);
  const weather = new WeatherPresentation();
  weather.install(scene);
  const frame = new Float32Array(HEADER);
  frame[H.TIME] = 10;
  const captures: {
    name: string;
    image: string;
    energy: number;
    rgb: number[];
    hash: number;
    nonzero: number;
  }[] = [];
  const pixels = new Uint8Array(256 * 256 * 4);
  const read = (name: string) => {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261,
      energy = 0,
      nonzero = 0;
    const rgb = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) {
      const value = pixels[i] + pixels[i + 1] + pixels[i + 2];
      energy += value;
      if (value > 3) nonzero++;
      for (let c = 0; c < 3; c++) {
        rgb[c] += pixels[i + c];
        hash = Math.imul(hash ^ pixels[i + c], 16777619);
      }
    }
    const value = {
      name,
      image: canvas.toDataURL('image/png'),
      energy,
      rgb,
      hash: hash >>> 0,
      nonzero,
    };
    captures.push(value);
    return value;
  };
  let road: T.MeshPhysicalMaterial | undefined,
    texture: T.DataTexture | undefined,
    rain: RainStreaks | undefined;
  try {
    weather.update(frame);
    const dry = read('stone-dry');
    frame[H.RAIN] = 24;
    frame[H.WATER] = 1;
    weather.update(frame);
    const wet = read('stone-wet');
    const held = read('stone-held');
    frame[H.TIME] = 40;
    frame[H.RAIN] = 0;
    frame[H.WATER] = 0;
    weather.update(frame);
    const restoredDry = read('stone-dry-restored');
    frame[H.TIME] = 10;
    frame[H.RAIN] = 24;
    frame[H.WATER] = 1;
    weather.update(frame);
    const rewoundWet = read('stone-wet-rewound');
    road = new T.MeshPhysicalMaterial({ color: 0x5a5c61, roughness: 0.85, clearcoat: 1 });
    texture = new T.DataTexture(new Uint8Array([240, 0, 0, 255]), 1, 1);
    texture.needsUpdate = true;
    surface.geometry.setAttribute('trackUV', surface.geometry.getAttribute('uv').clone());
    installWetRoad(road, texture, true);
    weather.installMaterial(road);
    surface.material = road;
    sun.intensity = 4.2;
    fill.intensity = 0.3;
    weather.update(frame);
    const ripple = read('road-raining');
    frame[H.TIME] = 10.37;
    weather.update(frame);
    const movingRipple = read('road-ripple-advanced');
    const pausedRipple = read('road-ripple-paused');
    frame[H.TIME] = 10;
    weather.update(frame);
    const rewoundRipple = read('road-ripple-rewound');
    frame[H.RAIN] = 0;
    weather.update(frame);
    const quietWater = read('road-rainless-standing-water');
    frame[H.TIME] = 15;
    weather.update(frame);
    const quietHeld = read('road-rainless-time-advanced');
    surface.material = stone;
    const conditions = [
      ['clear-day', 'day', 0.12, 0, 0],
      ['overcast-day', 'day', 0.95, 0, 0],
      ['sunset', 'sunset', 0.12, 0, 0],
      ['wet-day', 'day', 0.95, 24, 1],
      ['wet-night', 'night', 0.95, 24, 1],
    ] as const;
    for (const [name, mode, cloud, rate, water] of conditions) {
      frame[H.CLOUD] = cloud;
      frame[H.RAIN] = rate;
      frame[H.WATER] = water;
      const light = circuitLightState(cloud, rate, mode);
      applyCircuitLightPalette(sun, fill, cloud, mode as LightingMode);
      sun.intensity = light.sun;
      fill.intensity = light.fill;
      renderer.toneMappingExposure = light.exposure;
      weather.update(frame);
      read(`surface-${name}`);
    }
    surface.visible = false;
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    renderer.toneMappingExposure = 1;
    sun.intensity = fill.intensity = lamp.intensity = 0;
    rain = new RainStreaks(
      new Float32Array(3),
      new Float32Array([0, -15, 0]),
      new Float32Array([0.8]),
    );
    scene.add(rain.mesh);
    const unlit = read('rain-unlit');
    sun.position.set(0, 6, 3);
    sun.intensity = 4.2;
    sun.color.set(0xffb76d);
    const warm = read('rain-warm');
    sun.color.set(0x80beff);
    const cool = read('rain-cool');
    sun.intensity = 0;
    lamp.intensity = 1800;
    const floodlit = read('rain-floodlit');
    lamp.intensity = 0;
    const unlitRestored = read('rain-unlit-restored');
    const resourcesBefore = { ...renderer.info.memory };
    for (let i = 0; i < 12; i++) {
      weather.update(frame);
      rain.upload();
      renderer.render(scene, camera);
    }
    const resourcesAfter = { ...renderer.info.memory };
    return {
      captures,
      dry,
      wet,
      held,
      restoredDry,
      rewoundWet,
      ripple,
      movingRipple,
      pausedRipple,
      rewoundRipple,
      quietWater,
      quietHeld,
      unlit,
      warm,
      cool,
      floodlit,
      unlitRestored,
      resourcesBefore,
      resourcesAfter,
      glError: renderer.getContext().getError(),
    };
  } finally {
    weather.dispose();
    surface.geometry.dispose();
    stone.dispose();
    road?.dispose();
    texture?.dispose();
    rain?.geometry.dispose();
    rain?.material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }
}
