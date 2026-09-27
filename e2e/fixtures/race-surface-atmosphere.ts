/** Real production materials/renderer with explicit, reversible test controls.
 * These held comparisons do not substitute for ordinary race/pit/replay suites. */
import * as T from 'three';
import { surfaceMaterial, surfacePixels } from '../../src/rendering/surface-detail.ts';
import { legacySurfacePixels } from './race-surface-control.ts';
import { completedDrawMilliseconds } from './completed-draw.ts';
import { LocalAtmosphere, LOCAL_FOG_OPTICAL_ERROR } from '../../src/rendering/local-atmosphere.ts';
import { RainStreaks } from '../../src/rendering/rain-streaks.ts';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Track } from '../../src/simulation/track.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';

function pixels(renderer: T.WebGLRenderer) {
  const gl = renderer.getContext(),
    size = renderer.getDrawingBufferSize(new T.Vector2());
  const data = new Uint8Array(size.x * size.y * 4);
  gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return data;
}
function difference(a: Uint8Array, b: Uint8Array) {
  let max = 0,
    changed = 0,
    sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    max = Math.max(max, d);
    sum += d;
    if (d) changed++;
  }
  return { maxChannelDelta: max, changedChannels: changed, meanChannelDelta: sum / a.length };
}
function resources(renderer: T.WebGLRenderer) {
  return { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 };
}
function studio() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(512, 384);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  document.body.style.margin = '0';
  document.body.append(renderer.domElement);
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(42, 512 / 384, 0.02, 5000);
  scene.background = new T.Color(0x131b25);
  scene.add(new T.HemisphereLight(0xd8e8ff, 0x88725d, 1.1));
  const key = new T.DirectionalLight(0xffeddb, 3);
  key.position.set(-2, 3, 1);
  scene.add(key);
  const draw = () => {
    renderer.render(scene, camera);
    return {
      pixels: pixels(renderer),
      image: renderer.domElement.toDataURL('image/png'),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  };
  const dispose = () => {
    renderer.dispose();
    renderer.domElement.remove();
  };
  return { renderer, scene, camera, draw, dispose };
}

export function roadMaterialGPU() {
  const { renderer, scene, camera, draw, dispose } = studio();
  const material = surfaceMaterial('asphalt');
  const geometry = new T.PlaneGeometry(2, 2);
  geometry.rotateX(-Math.PI / 2);
  // Match the production ribbon's five metres per UV unit.
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.4, uv.getY(i) * 0.4);
  const road = new T.Mesh(geometry, material);
  scene.add(road);
  camera.position.set(0.13, 0.2, 0.45);
  camera.lookAt(0, 0, 0);
  const prior = legacySurfacePixels('asphalt'),
    current = surfacePixels('asphalt');
  const upload = (data: typeof current) => {
    const height = new Uint8ClampedArray(data.albedo.length);
    for (let i = 0; i < data.height.length; i++) {
      height[i * 4] = height[i * 4 + 1] = height[i * 4 + 2] = data.height[i];
      height[i * 4 + 3] = 255;
    }
    for (const [texture, bytes] of [
      [material.map!, data.albedo],
      [material.bumpMap!, height],
      [material.roughnessMap!, data.roughness],
    ] as const) {
      const canvas = texture.image as HTMLCanvasElement,
        context = canvas.getContext('2d')!;
      const image = context.createImageData(canvas.width, canvas.height);
      image.data.set(bytes);
      context.putImageData(image, 0, 0);
      texture.needsUpdate = true;
    }
  };
  try {
    upload(prior);
    draw();
    const baseline = draw(),
      before = resources(renderer);
    upload(current);
    const candidate = draw(),
      held = draw();
    upload(prior);
    const rewound = draw();
    upload(current);
    const restored = draw();
    const after = resources(renderer);
    return {
      scope: 'Production dry asphalt material, controlled close-up; not a driven lap',
      comparisons: {
        changed: difference(baseline.pixels, candidate.pixels),
        held: difference(candidate.pixels, held.pixels),
        rewound: difference(baseline.pixels, rewound.pixels),
        restored: difference(candidate.pixels, restored.pixels),
      },
      counts: [baseline, candidate].map(({ calls, triangles }) => ({ calls, triangles })),
      before,
      after,
      images: { 'prior-asphalt': baseline.image, 'registered-asphalt': candidate.image },
      glError: renderer.getContext().getError(),
    };
  } finally {
    for (const texture of [material.map!, material.bumpMap!, material.roughnessMap!])
      texture.dispose();
    geometry.dispose();
    material.dispose();
    dispose();
  }
}

export function rainFogGPU() {
  const { renderer, scene, camera, draw, dispose } = studio();
  const atmosphere = new LocalAtmosphere(new Track()),
    p = atmosphere.pockets[0];
  // World-space drops in a real authored district. The negative control instead
  // samples template corners near the origin: its previous production bug.
  const positions = new Float32Array(120 * 3),
    velocities = new Float32Array(120 * 3);
  const opacity = new Float32Array(120).fill(0.9);
  for (let i = 0; i < 120; i++) {
    positions[i * 3] = p.x + ((i % 15) - 7) * 0.19;
    positions[i * 3 + 1] = p.floor + 0.5 + Math.floor(i / 15) * 0.22;
    positions[i * 3 + 2] = p.z;
    velocities[i * 3 + 1] = -19;
  }
  const original = positions.slice(),
    rain = new RainStreaks(positions, velocities, opacity);
  const wrong = new RainStreaks(positions, velocities, opacity);
  wrong.material.userData.localWeatherPosition = 'position';
  atmosphere.installMaterial(rain.material);
  atmosphere.installMaterial(wrong.material);
  scene.add(rain.mesh, wrong.mesh);
  scene.fog = new T.Fog(0x07111d, 10000, 20000);
  camera.position.set(p.x, p.floor + 1.4, p.z + 4);
  camera.lookAt(p.x, p.floor + 1.4, p.z);
  // Exaggerated optical strength isolates the coordinate error over a four-metre
  // fixture. Normal application tests retain actual snapshot weather density.
  atmosphere.sigma.value = 0.4;
  const select = (correct: boolean) => {
    rain.mesh.visible = correct;
    wrong.mesh.visible = !correct;
  };
  try {
    select(false);
    draw();
    const baseline = draw();
    select(true);
    draw();
    const candidate = draw(),
      before = resources(renderer);
    const held = draw();
    atmosphere.tailError.value = 0;
    const unbounded = draw();
    atmosphere.tailError.value = LOCAL_FOG_OPTICAL_ERROR / 3;
    const restored = draw();
    select(false);
    const rewound = draw();
    select(true);
    draw();
    return {
      scope: 'Production rain shader at an actual district; exaggerated controlled fog, not a race',
      before,
      after: resources(renderer),
      sourceUnchanged: positions.every((v, i) => v === original[i]),
      comparisons: {
        coordinate: difference(baseline.pixels, candidate.pixels),
        held: difference(candidate.pixels, held.pixels),
        reference: difference(candidate.pixels, unbounded.pixels),
        restored: difference(candidate.pixels, restored.pixels),
        rewound: difference(baseline.pixels, rewound.pixels),
      },
      counts: [baseline, candidate].map(({ calls, triangles }) => ({ calls, triangles })),
      images: {
        'rain-template-corner-control': baseline.image,
        'rain-drop-centre-haze': candidate.image,
      },
      glError: renderer.getContext().getError(),
    };
  } finally {
    rain.geometry.dispose();
    rain.material.dispose();
    wrong.geometry.dispose();
    wrong.material.dispose();
    dispose();
  }
}

export type FogView = 'populated-grid' | 'low-district' | 'high-district' | 'long-district';

export async function fullSceneFogGPU(mode: FogView) {
  if (!['populated-grid', 'low-district', 'high-district', 'long-district'].includes(mode))
    throw new Error('Unknown full-scene fog view');
  const progress = async (stage: string) => {
    console.info('Full-scene fog comparison', mode, stage);
    // Let the browser present diagnostic progress between held renders. This
    // fixture owns no animation loop and never advances its physical snapshot.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
  await progress('constructing');
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 7, weather: 'rain' });
  const frame = sim.makeFrame(),
    original = frame.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:640px;height:400px;display:block';
  document.body.append(canvas);
  const view = await RacingRenderer.create(
    canvas,
    sim.track,
    () => {},
    () => false,
  );
  if (!view) throw new Error('Renderer construction cancelled');
  await progress('asset-loaded');
  // Fixture-only access to the owned uniform, never a new runtime control/UI.
  const atmosphere = (view as unknown as { atmosphere: LocalAtmosphere }).atmosphere;
  try {
    view.setQuality('medium', {
      ...graphicsPreset('medium'),
      resolutionScale: 1,
      shadowSize: 512,
      autoExposure: false,
      localFog: true,
      reflections: 'environment',
    });
    view.changeCamera('chase');
    view.draw(frame, frame, 1, 1 / 60, false, true);
    view.draw(frame, frame, 1, 1 / 60, false, true);
    const renderer = view.renderer,
      camera = view.camera;
    const draw = () => {
      renderer.setRenderTarget(null);
      renderer.info.reset();
      renderer.render(view.scene, camera);
    };
    const observations = [],
      images: Record<string, string> = {};
    const p = atmosphere.pockets[0];
    const savedPosition = camera.position.clone(),
      savedQuaternion = camera.quaternion.clone();
    {
      await progress('reference-and-held-comparisons');
      if (mode === 'populated-grid') {
        camera.position.copy(savedPosition);
        camera.quaternion.copy(savedQuaternion);
      } else if (mode === 'low-district') {
        camera.position.set(p.x - 110, p.floor + 2, p.z + 60);
        camera.lookAt(p.x + 100, p.floor + 1, p.z);
      } else if (mode === 'high-district') {
        camera.position.set(p.x, p.floor + 180, p.z + 220);
        camera.lookAt(p.x, p.floor, p.z);
      } else {
        camera.position.set(p.x - 1400, p.floor + 3, p.z);
        camera.lookAt(p.x + 400, p.floor + 1, p.z);
      }
      camera.updateMatrixWorld(true);
      atmosphere.tailError.value = 0;
      draw();
      const reference = pixels(renderer);
      images[`${mode}-reference`] = canvas.toDataURL('image/png');
      const before = resources(renderer),
        calls = renderer.info.render.calls,
        triangles = renderer.info.render.triangles;
      atmosphere.tailError.value = LOCAL_FOG_OPTICAL_ERROR / 3;
      draw();
      const candidate = pixels(renderer);
      images[`${mode}-bounded`] = canvas.toDataURL('image/png');
      const countsEqual =
        calls === renderer.info.render.calls && triangles === renderer.info.render.triangles;
      draw();
      const held = pixels(renderer);
      const timings: { bounded: boolean; synchronizedRenderMs: number }[] = [];
      const completionPixel = new Uint8Array(4);
      // The reference, candidate and held captures already completed both uniform
      // settings with CPU readbacks. They share one compiled shader. Do not add a
      // redundant warmup draw before every sample. Retain all eight measured
      // full-scene draws, alternating order, with an actual completion witness.
      // No speed threshold hides noisy hosts; the ordinary test timeout remains.
      for (let round = 0; round < 4; round++) {
        await progress(`timing-pair-${round + 1}`);
        for (const bounded of round % 2 ? [true, false] : [false, true]) {
          atmosphere.tailError.value = bounded ? LOCAL_FOG_OPTICAL_ERROR / 3 : 0;
          const synchronizedRenderMs = completedDrawMilliseconds(
            renderer.getContext(),
            draw,
            completionPixel,
          );
          timings.push({ bounded, synchronizedRenderMs });
        }
      }
      atmosphere.tailError.value = LOCAL_FOG_OPTICAL_ERROR / 3;
      draw();
      observations.push({
        mode,
        difference: difference(reference, candidate),
        held: difference(candidate, held),
        restored: difference(candidate, pixels(renderer)),
        countsEqual,
        calls,
        triangles,
        before,
        after: resources(renderer),
        timings,
      });
    }
    await progress('complete');
    return {
      scope:
        'Controlled asset-loaded full-scene ray comparisons; completed draw plus one-pixel CPU readback is not game FPS or GPU-only time',
      timingCompletion: 'rgba8-cpu-readback-1x1' as const,
      sourceUnchanged: frame.every((v, i) => Object.is(v, original[i])),
      authored: view.stats().authoredDriver,
      sigma: atmosphere.sigma.value,
      observations,
      images,
      glError: renderer.getContext().getError(),
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}

/** Independent scalar/product-exponential control for the vectorized production
 * quadrature. The control changes only that helper, never geometry or weather. */
export function fogQuadratureGPU() {
  const { renderer, scene, camera, draw, dispose } = studio();
  const atmosphere = new LocalAtmosphere(new Track());
  const p = atmosphere.pockets[0];
  const candidate = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const control = candidate.clone();
  atmosphere.installMaterial(candidate);
  atmosphere.installMaterial(control);
  const compiled = control.onBeforeCompile;
  const key = control.customProgramCacheKey();
  control.onBeforeCompile = (shader, renderer) => {
    compiled.call(control, shader, renderer);
    const pattern = /float apexPocketSamples\([\s\S]*?(?=float apexPocketIntegral)/;
    if (!pattern.test(shader.fragmentShader))
      throw new Error('Missing production quadrature helper');
    shader.fragmentShader = shader.fragmentShader.replace(
      pattern,
      `
      float scalarDensity(vec3 position, vec4 volume, float inverseHeight) {
        vec2 delta=position.xz-volume.xy;
        return exp(-3.*dot(delta,delta)*volume.z)*exp(-max(0.,position.y-volume.w)*inverseHeight);
      }
      float apexPocketSamples(vec3 start, vec3 segment, vec4 volume, float inverseHeight, vec4 nodes, vec4 weights) {
        return scalarDensity(start+segment*nodes.x,volume,inverseHeight)*weights.x+
          scalarDensity(start+segment*nodes.y,volume,inverseHeight)*weights.y+
          scalarDensity(start+segment*nodes.z,volume,inverseHeight)*weights.z+
          scalarDensity(start+segment*nodes.w,volume,inverseHeight)*weights.w;
      }
    `,
    );
  };
  control.customProgramCacheKey = () => key + '|independent-scalar-control';
  const geometry = new T.PlaneGeometry(360, 100);
  const plane = new T.Mesh(geometry, candidate);
  scene.add(plane);
  scene.fog = new T.Fog(0x182e46, 100000, 200000);
  atmosphere.sigma.value = 0.00275;
  // Disable tail pruning to exercise all eight original quadrature nodes.
  atmosphere.tailError.value = 0;
  const rows = [];
  try {
    for (const mode of ['low', 'high', 'long'] as const) {
      const target = new T.Vector3(p.x + (mode === 'long' ? 400 : 100), p.floor + 1, p.z);
      if (mode === 'low') camera.position.set(p.x - 110, p.floor + 2, p.z + 60);
      else if (mode === 'high') camera.position.set(p.x, p.floor + 180, p.z + 220);
      else camera.position.set(p.x - 1400, p.floor + 3, p.z);
      camera.lookAt(target);
      plane.position.copy(target);
      plane.lookAt(camera.position);
      plane.material = control;
      const reference = draw();
      plane.material = candidate;
      const actual = draw(),
        held = draw();
      atmosphere.sigma.value = 0;
      const disabled = draw();
      atmosphere.sigma.value = 0.00275;
      rows.push({
        mode,
        comparison: difference(reference.pixels, actual.pixels),
        held: difference(actual.pixels, held.pixels),
        negative: difference(actual.pixels, disabled.pixels),
        image: actual.image,
        calls: actual.calls,
      });
    }
    return {
      rows,
      glError: renderer.getContext().getError(),
      scope:
        'Scalar versus vectorized production fog quadrature; component validation, not race FPS',
    };
  } finally {
    geometry.dispose();
    candidate.dispose();
    control.dispose();
    dispose();
  }
}
