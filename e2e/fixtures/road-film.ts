import { VENUE_LAMP_RADIUS } from '../../src/rendering/light-footprint.ts';
import * as T from 'three';
import { installWetRoad, installStableSurfaceBump } from '../../src/rendering/materials.ts';

/** Controlled production-material probe, not a gameplay screenshot. Diagnostic
 * normal views test film conformance independently of exposure and light colour. */
export function roadFilmGPU() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(192, 192);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene();
  const camera = new T.OrthographicCamera(-2, 2, 2, -2, 0.1, 30);
  camera.position.set(0, 5, 4);
  camera.lookAt(0, 0, 0);
  const sun = new T.DirectionalLight(0xffffff, 3);
  sun.position.set(-2, 3, -4);
  const sky = new T.HemisphereLight(0xbad8ed, 0x434844, 0.5);
  // Compile the actual four-light production path even while intensity is zero.
  // Co-located lamps isolate lobe size from nearest-site switching in this probe.
  const lamps = Array.from({ length: 4 }, () => new T.PointLight(0xd9e8ff, 0, 135, 2));
  for (const lamp of lamps) lamp.position.set(0, 6, -5);
  scene.add(sun, sky, ...lamps);
  const heights = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const n = (y * 64 + x) * 4;
      const h = Math.round(
        128 + 42 * Math.sin(x * 0.73) * Math.cos(y * 0.61) + 23 * Math.sin((x + y) * 1.4),
      );
      heights.set([h, h, h, 255], n);
    }
  const bump = new T.DataTexture(heights, 64, 64);
  bump.wrapS = bump.wrapT = T.RepeatWrapping;
  bump.minFilter = bump.magFilter = T.LinearFilter;
  bump.needsUpdate = true;
  const water = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  water.needsUpdate = true;
  const material = new T.MeshPhysicalMaterial({
    color: 0x55585c,
    roughness: 0.86,
    bumpMap: bump,
    bumpScale: 0.18,
    clearcoat: 1,
  });
  installStableSurfaceBump(material);
  installWetRoad(material, water, true);
  const original = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  const diagnostic = { value: 0 },
    lampRadius = { value: 0 };
  material.onBeforeCompile = (shader, gl) => {
    original.call(material, shader, gl);
    shader.uniforms.filmDiagnostic = diagnostic;
    shader.uniforms.roadLampRadius = lampRadius;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <lights_physical_fragment>',
        'float observedLampRoughness = 0.;\n#include <lights_physical_fragment>',
      )
      .replace(
        'material.clearcoatRoughness = savedRoadCoatRoughness;',
        'observedLampRoughness = material.clearcoatRoughness;\nmaterial.clearcoatRoughness = savedRoadCoatRoughness;',
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform float filmDiagnostic;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <colorspace_fragment>',
      `#include <colorspace_fragment>
      // Encode small production-normal deviations above the 8-bit readback floor.
      // This affects only the diagnostic view, never the physical material.
      if (filmDiagnostic > 4.5) gl_FragColor = vec4(vec3(observedLampRoughness), 1.0);
      else if (filmDiagnostic > 3.5) gl_FragColor = vec4(material.clearcoatF0 * 8.0, 1.0);
      else if (filmDiagnostic > 2.5) gl_FragColor = vec4(vec3(material.clearcoatRoughness), 1.0);
      else if (filmDiagnostic > 0.5) gl_FragColor = vec4(
        ((filmDiagnostic > 1.5 ? clearcoatNormal : normal) - nonPerturbedNormal) * 16.0 + 0.5, 1.0);`,
    );
  };
  material.customProgramCacheKey = () => key + '|test-only-normal-observation';
  const geometry = new T.PlaneGeometry(8, 8);
  geometry.setAttribute('trackUV', geometry.getAttribute('uv').clone());
  const surface = new T.Mesh(geometry, material);
  surface.rotation.x = -Math.PI / 2;
  scene.add(surface);
  const pixels = new Uint8Array(192 * 192 * 4);
  const captures: { name: string; image: string; detail: number; energy: number; hash: number }[] =
    [];
  function capture(name: string, amount: number, mode: number) {
    water.image.data[0] = Math.round((amount / 2) * 255);
    water.needsUpdate = true;
    diagnostic.value = mode;
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, 192, 192, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261,
      energy = 0,
      count = 0,
      saturated = 0;
    const sum = [0, 0, 0],
      squares = [0, 0, 0];
    for (let y = 48; y < 144; y++)
      for (let x = 48; x < 144; x++) {
        const i = (y * 192 + x) * 4;
        count++;
        for (let c = 0; c < 3; c++) {
          const v = pixels[i + c];
          if (v === 0 || v === 255) saturated++;
          sum[c] += v;
          squares[c] += v * v;
          energy += v;
          hash = Math.imul(hash ^ v, 16777619);
        }
      }
    const detail = squares.reduce((v, square, c) => v + square / count - (sum[c] / count) ** 2, 0);
    const result = {
      name,
      saturated,
      detail,
      energy,
      mean: energy / (count * 3 * 255),
      hash: hash >>> 0,
      image: renderer.domElement.toDataURL('image/png'),
    };
    captures.push(result);
    return result;
  }
  try {
    const dry = capture('dry-base-normal', 0, 1);
    const damp = capture('damp-base-normal', 0.35, 1);
    const puddle = capture('standing-water-base-normal', 1.8, 1);
    const dampCoat = capture('damp-conforming-coat-normal', 0.35, 2);
    const puddleCoat = capture('standing-water-coat-normal', 1.8, 2);
    const restored = capture('damp-restored-coat-normal', 0.35, 2);
    const filmFresnel = capture('water-film-normal-incidence-reflectance', 1.8, 4);
    const dampRoughness = capture('damp-effective-coat-roughness', 0.35, 3);
    const puddleRoughness = capture('standing-water-effective-coat-roughness', 1.8, 3);
    for (const [name, amount] of [
      ['dry', 0],
      ['damp', 0.35],
      ['standing-water', 1.8],
    ] as const)
      capture(`physical-${name}`, amount, 0);
    sun.intensity = sky.intensity = 0;
    for (const lamp of lamps) lamp.intensity = 25;
    const dryPoint = capture('physical-dry-point-lamp', 0, 0);
    lampRadius.value = VENUE_LAMP_RADIUS;
    const dryFinite = capture('physical-dry-finite-lamp', 0, 0);
    lampRadius.value = 0;
    const wetPoint = capture('physical-wet-point-lamp', 1.8, 0);
    lampRadius.value = VENUE_LAMP_RADIUS;
    const wetFinite = capture('physical-wet-finite-lamp', 1.8, 0);
    // Read the actual per-point-light material, then its restored post-light value.
    // Remove bump only for this coefficient control, never for physical captures.
    material.bumpScale = 0;
    lampRadius.value = 0;
    const pointRoughness = capture('point-lamp-coat-roughness', 1.8, 5);
    lampRadius.value = VENUE_LAMP_RADIUS;
    const finiteRoughness = capture('finite-lamp-coat-roughness', 1.8, 5);
    const restoredRoughness = capture('post-lamp-restored-coat-roughness', 1.8, 3);
    material.bumpScale = 0.18;
    lampRadius.value = 0;
    for (const lamp of lamps) lamp.intensity = 0;
    sun.intensity = 3;
    sky.intensity = 0.5;
    const before = { ...renderer.info.memory };
    for (let i = 0; i < 12; i++) capture(`held-${i}`, 0.35, 0);
    return {
      dry,
      damp,
      puddle,
      dampCoat,
      puddleCoat,
      restored,
      filmFresnel,
      dampRoughness,
      puddleRoughness,
      lampFootprint: {
        dryPoint,
        dryFinite,
        wetPoint,
        wetFinite,
        pointRoughness,
        finiteRoughness,
        restoredRoughness,
      },
      captures,
      before,
      after: { ...renderer.info.memory },
      error: renderer.getContext().getError(),
    };
  } finally {
    geometry.dispose();
    material.dispose();
    bump.dispose();
    water.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
