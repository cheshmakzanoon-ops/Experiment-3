import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';
import { completedDrawMilliseconds } from './completed-draw.ts';

/** Fixed-camera survey of the shipping scene. The default path uses the normal
 * asynchronous production factory and retained player/garage assets. The explicit
 * offline mode is supplementary local shader evidence, never startup validation. */
export async function surveyStartFinish(lighting: 'day' | 'sunset' | 'night', offline = false) {
  console.info('[venue-survey] simulate');
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    opponents: 11,
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 1887,
  });
  sim.autoPlayer = true;
  for (let i = 0; i < 8 * 120; i++) sim.step(1 / 120);
  const frame = sim.makeFrame(),
    original = frame.slice(),
    water = sim.track.water.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:1280px;height:720px';
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  const graphics = { ...graphicsPreset('medium'), resolutionScale: 1 };
  console.info('[venue-survey] construct');
  const view = offline
    ? new RacingRenderer(canvas, sim.track)
    : await RacingRenderer.create(
        canvas,
        sim.track,
        () => {},
        () => false,
        { quality: 'medium', graphics },
      );
  if (!view) throw new Error('Cancelled venue survey');
  const gl = view.renderer.getContext(),
    pixel = new Uint8Array(4),
    pixels = new Uint8Array(1280 * 720 * 4);
  const images: {
    name: string;
    image: string;
    calls: number;
    triangles: number;
    range: number;
    lit: number;
    cpuCompletionMs: number;
  }[] = [];
  const updatePeople = (f: Float32Array) => {
    view.circuit.startFinish?.update(f, view.camera, lighting === 'night');
    view.circuit.staff.update(f, view.camera.position, true);
    for (const c of view.circuit.crowdClusters)
      c.update(f[H.TIME], view.camera.position, f[H.RAIN], f, view.camera.fov, view.camera.aspect);
  };
  let boardSurface: {
    samples: number;
    changed: number;
    peakDelta: number;
    width: number;
    height: number;
    dynamic: boolean;
  } | null = null;
  const render = () =>
    completedDrawMilliseconds(gl, () => view.renderer.render(view.scene, view.camera), pixel);
  const camera = (eye: number[], target: number[], fov: number) => {
    view.camera.position.copy(view.circuit.at(eye[0], eye[1], eye[2]));
    view.camera.lookAt(view.circuit.at(target[0], target[1], target[2]));
    view.camera.fov = fov;
    view.camera.updateProjectionMatrix();
    updatePeople(frame);
  };
  const capture = (name: string) => {
    console.info('[venue-survey] capture', name);
    view.renderer.info.reset();
    const cpuCompletionMs = render();
    gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let min = 255,
      max = 0,
      lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const v = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (v > 2) lit++;
    }
    images.push({
      name,
      image: canvas.toDataURL('image/png'),
      calls: view.renderer.info.render.calls,
      triangles: view.renderer.info.render.triangles,
      range: max - min,
      lit: lit / (1280 * 720),
      cpuCompletionMs,
    });
  };
  try {
    console.info('[venue-survey] constructed');
    view.setQuality('medium', graphics);
    view.lighting = lighting;
    console.info('[venue-survey] initial draw');
    view.draw(frame, frame, 1, 1 / 60);
    console.info('[venue-survey] drawn');
    const left = sim.track.boundary(55, -1);
    const surveys = [
      { name: 'start-finish-wide', eye: [8, -2, 5], target: [55, -left - 12, 4], fov: 58 },
      { name: 'grandstand-front', eye: [55, -8, 4.6], target: [55, -left - 11, 3.8], fov: 54 },
      { name: 'audience', eye: [42, -left - 4, 3.8], target: [48, -left - 9, 3.4], fov: 50 },
      {
        name: 'live-board',
        eye: [-12, -2, 5.5],
        target: [-12, -sim.track.boundary(sim.track.length - 12, -1) - 10, 6.2],
        fov: 42,
      },
      {
        name: 'fence-mounts',
        eye: [105, -left + 2.4, 2],
        target: [100, -left - 0.3, 1.7],
        fov: 42,
      },
    ];
    for (const s of surveys) {
      camera(s.eye, s.target, s.fov);
      capture(s.name);
      if (s.name === 'live-board') {
        const face = view.scene.getObjectByName('A18 live race-information face') as
          | T.Mesh<T.PlaneGeometry, T.MeshStandardMaterial>
          | undefined;
        if (face) {
          // Independent visible-surface negative control. Whole-frame brightness
          // can pass while a copied, stale display canvas remains completely black.
          const material = face.material;
          const map = material.map!,
            emissiveMap = material.emissiveMap;
          const color = material.color.clone(),
            emissive = material.emissive.clone();
          const displayed = pixels.slice(),
            blanked = new Uint8Array(pixels.length);
          try {
            material.map = material.emissiveMap = null;
            material.color.set(0);
            material.emissive.set(0);
            material.needsUpdate = true;
            render();
            gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, blanked);
          } finally {
            material.map = map;
            material.emissiveMap = emissiveMap;
            material.color.copy(color);
            material.emissive.copy(emissive);
            material.needsUpdate = true;
          }
          let samples = 0,
            changed = 0,
            peakDelta = 0;
          const point = new T.Vector3();
          // Only the interior of the actual display, excluding sky and housing.
          for (let row = 0; row < 64; row++)
            for (let column = 0; column < 64; column++) {
              point
                .set(((column + 0.5) / 64 - 0.5) * 7.6, ((row + 0.5) / 64 - 0.5) * 3.9, 0)
                .applyMatrix4(face.matrixWorld)
                .project(view.camera);
              const x = Math.floor((point.x + 1) * 640),
                y = Math.floor((point.y + 1) * 360);
              if (x < 0 || x >= 1280 || y < 0 || y >= 720) continue;
              const pixel = (y * 1280 + x) * 4;
              const delta = Math.max(
                ...[0, 1, 2].map((c) => Math.abs(displayed[pixel + c] - blanked[pixel + c])),
              );
              samples++;
              if (delta > 24) changed++;
              peakDelta = Math.max(peakDelta, delta);
            }
          boardSurface = {
            samples,
            changed,
            peakDelta,
            width: map.image.width,
            height: map.image.height,
            dynamic: map.userData.dynamic === true,
          };
          render();
        }
      }
    }
    const post = view.circuit.trackInfrastructure.marshalPosts[0];
    view.camera.position.set(post.x + 4, post.y + 2, post.z + 4);
    view.camera.lookAt(post.x, post.y + 1.0, post.z);
    view.camera.fov = 45;
    view.camera.updateProjectionMatrix();
    updatePeople(frame);
    capture('marshal');
    const marshal = {
      active: view.circuit.staff.active,
      gripError: view.circuit.staff.maxGripError,
      unreachable: view.circuit.staff.unreachable,
    };
    // CPU and GPU poses are deterministic under arbitrary seek. Play actual
    // simulated timestamps, then return to the held start-of-survey snapshot.
    camera(surveys[2].eye, surveys[2].target, surveys[2].fov);
    const heldPixel = new Uint8Array(pixels.length);
    render();
    gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, heldPixel);
    const heldBoard = view.circuit.startFinish?.diagnostics().boardUpdates;
    for (let i = 0; i < 4; i++) updatePeople(frame);
    const heldBoardStable = view.circuit.startFinish?.diagnostics().boardUpdates === heldBoard;
    const before = { ...view.renderer.info.memory };
    let waterUnchanged = water.every((v, i) => v === sim.track.water[i]);
    for (let i = 0; i < 12; i++) {
      for (let step = 0; step < 15; step++) sim.step(1 / 120);
      const currentWater = sim.track.water.slice();
      updatePeople(sim.makeFrame());
      render();
      waterUnchanged &&= currentWater.every((v, i) => v === sim.track.water[i]);
    }
    updatePeople(frame);
    render();
    gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let rewindMaxError = 0;
    for (let i = 0; i < pixels.length; i++)
      rewindMaxError = Math.max(rewindMaxError, Math.abs(pixels[i] - heldPixel[i]));
    // Both hierarchy and seat detail follow the physical camera without creating geometry.
    const near = view.camera.position.clone();
    view.camera.position.add(new T.Vector3(1000, 0, 1000));
    updatePeople(frame);
    const far = view.circuit.startFinish?.diagnostics();
    view.camera.position.copy(near);
    updatePeople(frame);
    render();
    return {
      lighting,
      offline,
      images,
      sourceUnchanged: frame.every((v, i) => v === original[i]),
      waterUnchanged,
      heldBoardStable,
      before,
      after: { ...view.renderer.info.memory },
      rewindMaxError,
      far,
      venue: view.circuit.startFinish?.diagnostics(),
      marshal,
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
      hardwareValidated: false,
      boardSurface,
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}

/** Explicit synthetic signal/shader controls, NOT a simulated race observation.
 * Exercises the full marshal colour and both shadow programs while preserving
 * the original nearest-car/flag selection and exact hand-to-pole constraint. */
export async function probeMarshalShaders() {
  const { MarshalStaffView } = await import('../../src/rendering/marshal-staff.ts');
  const { FLAG } = await import('../../src/simulation/marshal.ts');
  const { F, carBase } = await import('../../src/simulation/protocol.ts');
  const view = new MarshalStaffView([
    { kind: 'marshal', s: 0, side: 1, lateral: 20, x: 0, y: 0, z: 0, yaw: 0 },
  ]);
  const scene = new T.Scene();
  scene.background = new T.Color(0x5d7181);
  scene.add(view.root);
  scene.add(new T.HemisphereLight(0xcde5ff, 0x66533e, 1.8));
  const sun = new T.DirectionalLight(0xffe6c0, 3);
  sun.position.set(3, 7, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  scene.add(sun);
  const point = new T.PointLight(0x9fcdff, 30, 12);
  point.position.set(-3, 3, 2);
  point.castShadow = true;
  point.shadow.mapSize.set(256, 256);
  scene.add(point);
  const floor = new T.Mesh(
    new T.PlaneGeometry(12, 12).rotateX(-Math.PI / 2),
    new T.MeshStandardMaterial({ color: 0x929088, roughness: 0.85 }),
  );
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new T.PerspectiveCamera(42, 960 / 600, 0.03, 30);
  camera.position.set(-4, 2.4, 3.5);
  camera.lookAt(0, 1.1, 0);
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(960, 600);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  document.body.append(renderer.domElement);
  const gl = renderer.getContext(),
    pixel = new Uint8Array(4),
    buffer = new Uint8Array(960 * 600 * 4);
  const frame = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 }).makeFrame(),
    base = carBase(0);
  const samples: {
    signal: number;
    flagCount: number;
    active: number;
    gripError: number;
    unreachable: number;
    sum: number;
    image: string;
  }[] = [];
  try {
    for (const signal of [FLAG.GREEN, FLAG.YELLOW, FLAG.DOUBLE_YELLOW, FLAG.BLUE, FLAG.CHEQUERED]) {
      frame[H.FLAG] = signal;
      frame[base + F.LOCAL_FLAG] = signal;
      frame[base + F.S] = 0;
      frame[H.TIME] = 1.25;
      const original = frame.slice();
      view.update(frame, camera.position);
      completedDrawMilliseconds(gl, () => renderer.render(scene, camera), pixel);
      gl.readPixels(0, 0, 960, 600, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
      if (!frame.every((v, i) => v === original[i]))
        throw new Error('Marshal mutated its signal input');
      samples.push({
        signal,
        flagCount: view.flags.count,
        active: view.active,
        gripError: view.maxGripError,
        unreachable: view.unreachable,
        sum: buffer.reduce((s, v) => s + v, 0),
        image: renderer.domElement.toDataURL('image/png'),
      });
    }
    return {
      samples,
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
      syntheticSignalControls: true,
    };
  } finally {
    scene.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        for (const m of [o.material].flat()) m.dispose();
        o.customDepthMaterial?.dispose();
        o.customDistanceMaterial?.dispose();
        if (o instanceof T.InstancedMesh) o.dispose();
      }
    });
    sun.shadow.dispose();
    point.shadow.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
}
