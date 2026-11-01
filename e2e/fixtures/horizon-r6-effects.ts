/** Bounded optics review, excluded from the shipped entry point.
 * Real OpenWorldSimulation controls produce every recorded chassis/wheel
 * channel. The same EffectPlayback, Festival contacts and fixed particle pool
 * are rendered with only dryCloudDetail off/on. The ground is a bounded patch
 * of the actual carved terrain; this is not a full-world beauty screenshot,
 * human playtest, or a target-device performance measurement. */
import * as T from 'three';
import { clamp } from '../../src/core/math.ts';
import { controls } from '../../src/simulation/config.ts';
import { OpenWorldSimulation } from '../../src/simulation/open-world/session.ts';
import { RouteDriver } from '../../src/simulation/open-world/route-driver.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import { MATERIAL } from '../../src/simulation/surface-material.ts';
import { Effects, PARTICLE_KIND } from '../../src/rendering/effects.ts';
import { EffectPlayback } from '../../src/rendering/effect-playback.ts';
import {
  createFestivalContactOffset,
  festivalContactEnabled,
  festivalDiffuserEnabled,
} from '../../src/rendering/open-world/festival-contacts.ts';
import { pixelDifference } from './pixel-difference.ts';

declare const __APEX_SOURCE_FINGERPRINT__: string;
declare const __APEX_SOURCE_COMMIT__: string | null;

const WIDTH = 960,
  HEIGHT = 600,
  DT = 1 / 120,
  SAMPLE_EVERY = 4;
const CASES = {
  smoke: {
    vehicle: 'rd2',
    weather: 'clear',
    event: 'kestrel-drift',
    kind: PARTICLE_KIND.SMOKE,
    seconds: 50,
  },
  dust: {
    vehicle: 'tc1',
    weather: 'clear',
    event: 'quarry-drift',
    kind: PARTICLE_KIND.DUST,
    seconds: 18,
  },
  water: {
    vehicle: 'tc1',
    weather: 'rain',
    event: 'runway-launch',
    kind: PARTICLE_KIND.SPRAY,
    seconds: 18,
  },
} as const;
type Scenario = keyof typeof CASES;
type Bounds = { min: [number, number, number]; max: [number, number, number] };
const sourceIdentity = () => ({
  fingerprint: typeof __APEX_SOURCE_FINGERPRINT__ === 'string' ? __APEX_SOURCE_FINGERPRINT__ : null,
  commit: typeof __APEX_SOURCE_COMMIT__ === 'string' ? __APEX_SOURCE_COMMIT__ : null,
});

function festivalEffects(sim: OpenWorldSimulation) {
  const effects = new Effects();
  effects.contactOffset = createFestivalContactOffset((x, z, y) => sim.track.groundHeight(x, z, y));
  effects.contactEnabled = festivalContactEnabled;
  effects.diffuserEnabled = festivalDiffuserEnabled;
  // Same material mapping as FestivalRenderer; dirt is not the circuit's
  // legacy gravel ID. This adapter is necessary for a real Quarry recording.
  effects.looseColours = new Map([
    [MATERIAL.DIRT, [0.43, 0.32, 0.19] as const],
    [MATERIAL.MUD, [0.23, 0.19, 0.14] as const],
    [MATERIAL.SAND, [0.69, 0.59, 0.4] as const],
    [MATERIAL.SNOW, [0.81, 0.85, 0.89] as const],
    [MATERIAL.GRAVEL_ROAD, [0.51, 0.47, 0.39] as const],
  ]);
  return effects;
}

function cloudMesh(effects: Effects) {
  return effects.group.getObjectByName('Lit wheel-water spray clouds') as T.Mesh<
    T.InstancedBufferGeometry,
    T.ShaderMaterial
  >;
}

function particleBounds(effects: Effects, kind: number): Bounds {
  const geometry = cloudMesh(effects).geometry,
    center = geometry.getAttribute('center').array,
    kinds = geometry.getAttribute('kind').array,
    opacity = geometry.getAttribute('opacity').array,
    bounds: Bounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
  for (let i = 0; i < opacity.length; i++)
    if (kinds[i] === kind && opacity[i] > 0.015)
      for (let axis = 0; axis < 3; axis++) {
        bounds.min[axis] = Math.min(bounds.min[axis], center[i * 3 + axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], center[i * 3 + axis]);
      }
  return bounds;
}

function geometryArrays(effects: Effects) {
  return effects.group.children.flatMap((node) => {
    const geometry = (node as T.Mesh).geometry;
    return Object.entries(geometry.attributes).map(([name, attribute]) => ({
      name: `${node.name}/${name}`,
      array: attribute.array,
    }));
  });
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function disposeEffects(effects: Effects) {
  effects.group.traverse((node) => {
    const mesh = node as T.Mesh;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
    else mesh.material?.dispose();
  });
}

/** This export also runs under Node for CPU-only validation when a local
 * Chromium is unavailable. No pose, velocity, tyre state or score is assigned.
 * Event entry uses the production start command; external RouteDriver input
 * is explicitly assisted evidence even when the game autopilot flag is false. */
export function recordHorizonR6Effects(scenario: Scenario) {
  const configuration = CASES[scenario];
  if (!configuration) throw new Error(`Unknown effects scenario: ${String(scenario)}`);
  const started = performance.now(),
    sim = new OpenWorldSimulation({
      vehicle: configuration.vehicle,
      weather: configuration.weather,
      assist: 'raw',
      seed: 73021,
      tileBudget: 12,
      traffic: false,
      session: `horizon-r6-optics-${scenario}`,
    });
  sim.command({ type: 'start', event: configuration.event });
  const car = sim.player,
    event = sim.events.find((candidate) => candidate.spec.id === configuration.event)!;
  if (!event) throw new Error(`Missing review event ${configuration.event}`);
  const driver = new RouteDriver(car, event.path, 0.9, 0, 22),
    input = controls(),
    reference = festivalEffects(sim),
    playback = new EffectPlayback(reference),
    frames: Float32Array[] = [],
    controlsTrace: {
      time: number;
      speedKmh: number;
      steer: number;
      throttle: number;
      brake: number;
      surface: string;
    }[] = [];
  let waveStart = -1,
    peakIndex = -1,
    peakActive = 0,
    peakBounds: Bounds | null = null,
    peakDiagnostics: ReturnType<Effects['diagnostics']> | null = null,
    contactSamples = 0,
    offRoadSeconds = 0,
    finite = true,
    framesUnmodified = true;
  try {
    for (let tick = 0; tick < configuration.seconds / DT; tick++) {
      driver.update(DT, [car]);
      Object.assign(input, car.input);
      // The same bounded weave used by horizon-drift-validation.ts. Throttle,
      // braking and hairpin steering remain the normal route driver's output.
      if (scenario === 'smoke' && (driver.d < 175 || driver.d > 410) && car.speed > 12) {
        if (waveStart < 0) waveStart = sim.time;
        input.steer = clamp(
          input.steer + 0.5 * Math.sin(((sim.time - waveStart) * 2 * Math.PI) / 3.5),
          -1,
          1,
        );
      } else waveStart = -1;
      sim.setInput(input);
      sim.step(DT);
      if (sim.player !== car)
        throw new Error('Review driving unexpectedly recovered/replaced the car');
      if (car.impact > 0.25) contactSamples++;
      if (!sim.track.query.onRoad) offRoadSeconds += DT;
      if (tick % SAMPLE_EVERY === SAMPLE_EVERY - 1) {
        const frame = sim.makeFrame(),
          before = frame.slice();
        playback.update(frame);
        framesUnmodified &&= sameBytes(frame, before);
        finite &&= frame.every(Number.isFinite);
        frames.push(frame);
        const diagnostic = reference.diagnostics(),
          active = diagnostic.active[configuration.kind];
        if (active > peakActive && sim.time > 4) {
          peakActive = active;
          peakIndex = frames.length - 1;
          peakBounds = particleBounds(reference, configuration.kind);
          peakDiagnostics = diagnostic;
        }
        if (frames.length % 6 === 0) {
          const status = sim.status();
          controlsTrace.push({
            time: sim.time,
            speedKmh: status.speedKmh,
            steer: input.steer,
            throttle: input.throttle,
            brake: input.brake,
            surface: status.road.surface,
          });
        }
      }
      if (sim.takeResult() || sim.mode === 'finished') break;
    }
  } finally {
    disposeEffects(reference);
  }
  if (peakIndex < 6 || peakActive < 25 || !peakBounds || !peakDiagnostics)
    throw new Error(
      `Real ${scenario} driving produced no usable contact plume (${peakActive} live)`,
    );
  if (!finite || !framesUnmodified)
    throw new Error('Recorded physics frames were invalid or mutated');
  const indices = [peakIndex - 6, peakIndex, Math.min(frames.length - 1, peakIndex + 6)];
  if (new Set(indices).size !== 3) throw new Error('Need three distinct measured motion samples');
  // Retain the entire prefix so noise, fractional births and cumulative work
  // replay exactly. There is no pre-filled or manually painted contact pool.
  frames.length = indices[2] + 1;
  return {
    sim,
    frames,
    indices,
    peakBounds,
    metadata: {
      scenario,
      configuration,
      sourceIdentity: sourceIdentity(),
      method: {
        normalControlsOnly: true,
        scriptedSteeringAssistance: true,
        humanPlaytest: false,
        productionStartCommand: true,
        assignedPhysicsChannels: false,
        timestep: DT,
        snapshotInterval: DT * SAMPLE_EVERY,
        ground: 'bounded mesh sampled from the actual carved world height',
      },
      cpuRecordingMs: performance.now() - started,
      simulatedSeconds: sim.time,
      recordedFrames: frames.length,
      captureTimes: indices.map((index) => frames[index][H.TIME]),
      peakActive,
      peakDiagnostics,
      finite,
      framesUnmodified,
      contactSamples,
      offRoadSeconds,
      controlsTrace,
    },
  };
}

async function sha256(arrays: readonly ArrayBufferView[]) {
  const bytes = new Uint8Array(arrays.reduce((sum, array) => sum + array.byteLength, 0));
  let offset = 0;
  for (const array of arrays) {
    bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset);
    offset += array.byteLength;
  }
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

function opticalDifference(a: Uint8Array, b: Uint8Array) {
  let absoluteRgb = 0,
    changedByAtLeastTwo = 0;
  for (let i = 0; i < a.length; i += 4) {
    let visibleChange = false;
    for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs(a[i + channel] - b[i + channel]);
      absoluteRgb += difference;
      visibleChange ||= difference >= 2;
    }
    if (visibleChange) changedByAtLeastTwo++;
  }
  return {
    ...pixelDifference(a, b),
    changedByAtLeastTwo,
    meanAbsoluteRgb: absoluteRgb / ((a.length / 4) * 3),
  };
}

export async function captureHorizonR6Effects(scenario: Scenario) {
  const checkpointStarted = performance.now();
  const checkpoint = (stage: string, image?: string) =>
    console.log(
      'R6_EFFECTS_CHECKPOINT',
      JSON.stringify({ scenario, stage, image, elapsedMs: performance.now() - checkpointStarted }),
    );
  checkpoint('recording:begin');
  const recording = recordHorizonR6Effects(scenario);
  checkpoint('recording:complete');
  const { frames, indices, peakBounds, sim } = recording,
    started = performance.now(),
    renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  checkpoint('renderer:created');
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.debug.checkShaderErrors = true;
  document.body.replaceChildren(renderer.domElement);
  const gl = renderer.getContext(),
    shaderErrors: string[] = [],
    glErrors: number[] = [];
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    shaderErrors.push(
      [
        context.getProgramInfoLog(program),
        context.getShaderInfoLog(vertex),
        context.getShaderInfoLog(fragment),
      ].join('\n'),
    );
  };
  const debug = gl.getExtension('WEBGL_debug_renderer_info'),
    rendererName = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    center = new T.Vector3()
      .fromArray(peakBounds.min)
      .add(new T.Vector3().fromArray(peakBounds.max))
      .multiplyScalar(0.5),
    span = Math.hypot(peakBounds.max[0] - peakBounds.min[0], peakBounds.max[2] - peakBounds.min[2]),
    distance = clamp(span * 1.2, 17, 55),
    peakFrame = frames[indices[1]],
    o = carBase(0),
    forward = new T.Vector3(peakFrame[o + F.VX], 0, peakFrame[o + F.VZ]).normalize(),
    side = new T.Vector3(forward.z, 0, -forward.x),
    camera = new T.PerspectiveCamera(43, WIDTH / HEIGHT, 0.1, 220),
    scene = new T.Scene(),
    effects = festivalEffects(sim),
    playback = new EffectPlayback(effects);
  camera.position
    .copy(center)
    .addScaledVector(side, distance * 0.72)
    .addScaledVector(forward, -distance * 0.72);
  camera.position.y += distance * 0.35;
  camera.lookAt(center);
  scene.background = new T.Color(0x8596a5);
  scene.fog = new T.Fog(0x8596a5, 100, 210);
  scene.add(new T.HemisphereLight(0xc3d7ed, 0x514738, 2.2));
  const sun = new T.DirectionalLight(0xffe7c3, 2.6);
  sun.position.copy(center).add(new T.Vector3(-40, 65, 25));
  sun.target.position.copy(center);
  scene.add(sun, sun.target);
  const groundGeometry = new T.PlaneGeometry(150, 150, 40, 40).rotateX(-Math.PI / 2),
    position = groundGeometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = center.x + position.getX(i),
      z = center.z + position.getZ(i);
    position.setXYZ(i, x, sim.track.groundHeight(x, z), z);
  }
  groundGeometry.computeVertexNormals();
  const groundMaterial = new T.MeshStandardMaterial({
      color: scenario === 'dust' ? 0x67533b : 0x363e43,
      roughness: scenario === 'water' ? 0.42 : 0.94,
      metalness: 0,
    }),
    ground = new T.Mesh(groundGeometry, groundMaterial);
  scene.add(ground, effects.group);
  const cloud = cloudMesh(effects),
    arrays = geometryArrays(effects),
    geometry = cloud.geometry,
    material = cloud.material,
    images: { name: string; image: string }[] = [],
    captures: unknown[] = [],
    snapshotsSha256 = await sha256(frames),
    motionHashes: string[] = [];
  const render = (name: string, detail: boolean, visible = true, save = true) => {
    effects.setDryCloudDetail(detail);
    effects.group.visible = visible;
    checkpoint('render:begin', name);
    renderer.render(scene, camera);
    checkpoint('render:complete', name);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    checkpoint('readPixels:begin', name);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    checkpoint('readPixels:complete', name);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) glErrors.push(error);
    if (save) {
      checkpoint('png:begin', name);
      images.push({ name, image: renderer.domElement.toDataURL('image/png') });
      checkpoint('png:complete', name);
    }
    return {
      pixels,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      points: renderer.info.render.points,
      memory: { ...renderer.info.memory },
    };
  };
  const checks: Record<string, boolean> = {
    recordedRealControls: true,
    finitePhysics: recording.metadata.finite,
    noSnapshotMutation: recording.metadata.framesUnmodified,
    threeMotionSamples: true,
  };
  try {
    let captureIndex = 0;
    for (let frameIndex = 0; frameIndex <= indices[2]; frameIndex++) {
      playback.update(frames[frameIndex]);
      if (frameIndex !== indices[captureIndex]) continue;
      const prefix = `${scenario}-${captureIndex}`,
        beforeArrays = geometryArrays(effects).map(({ array }) => array.slice()),
        beforeHash = await sha256(arrays.map(({ array }) => array)),
        beforeDiagnostics = effects.diagnostics(),
        clean = render(`${prefix}-without-particles`, false, false, captureIndex === 1),
        before = render(`${prefix}-before`, false),
        after = render(`${prefix}-after`, true),
        repeat = render(`${prefix}-repeat`, false, true, false),
        difference = opticalDifference(before.pixels, after.pixels),
        effectCoverage = opticalDifference(clean.pixels, before.pixels),
        repeatDifference = opticalDifference(before.pixels, repeat.pixels),
        afterArrays = geometryArrays(effects),
        afterHash = await sha256(afterArrays.map(({ array }) => array));
      motionHashes.push(beforeHash);
      const unchangedArrays = beforeArrays.every((array, index) =>
          sameBytes(array, afterArrays[index].array),
        ),
        sameStorage = arrays.every(({ array }, index) => array === afterArrays[index].array),
        stableDiagnostics =
          JSON.stringify(beforeDiagnostics) === JSON.stringify(effects.diagnostics()),
        visible = effectCoverage.changedByAtLeastTwo > 25,
        desiredOptics =
          scenario === 'water'
            ? difference.changedPixels === 0
            : difference.changedByAtLeastTwo > 15 && difference.maxChannelDelta >= 2;
      checks[`${prefix}: visible measured plume`] = visible;
      checks[`${prefix}: desired optical response`] = desiredOptics;
      checks[`${prefix}: unchanged pool and motion`] =
        unchangedArrays && sameStorage && beforeHash === afterHash && stableDiagnostics;
      checks[`${prefix}: no added draw calls or triangles`] =
        before.calls === after.calls &&
        before.triangles === after.triangles &&
        before.points === after.points;
      checks[`${prefix}: same geometry and material`] =
        geometry === cloud.geometry && material === cloud.material;
      checks[`${prefix}: exact repeated control frame`] = repeatDifference.changedPixels === 0;
      if (captureIndex === 1)
        checks['peak replay matches measured recording'] =
          JSON.stringify(beforeDiagnostics) === JSON.stringify(recording.metadata.peakDiagnostics);
      if (scenario === 'water')
        checks[`${prefix}: spray and rain with no dry particles`] =
          beforeDiagnostics.active[PARTICLE_KIND.SPRAY] > 25 &&
          beforeDiagnostics.active[PARTICLE_KIND.SMOKE] === 0 &&
          beforeDiagnostics.active[PARTICLE_KIND.DUST] === 0;
      captures.push({
        index: captureIndex,
        time: frames[frameIndex][H.TIME],
        diagnostics: beforeDiagnostics,
        poolBytesSha256: beforeHash,
        poolByteLength: arrays.reduce((sum, { array }) => sum + array.byteLength, 0),
        difference,
        effectCoverage,
        repeatDifference,
        before: {
          calls: before.calls,
          triangles: before.triangles,
          points: before.points,
          memory: before.memory,
        },
        after: {
          calls: after.calls,
          triangles: after.triangles,
          points: after.points,
          memory: after.memory,
        },
      });
      captureIndex++;
    }
    checks.threeMotionSamples = new Set(motionHashes).size === 3;
    checks.noSnapshotMutation &&= snapshotsSha256 === (await sha256(frames));
    checks.noShaderErrors = shaderErrors.length === 0;
    checks.noGlErrors = glErrors.length === 0;
    checkpoint('complete');
    return {
      ...recording.metadata,
      rendererName,
      viewport: { width: WIDTH, height: HEIGHT },
      camera: { position: camera.position.toArray(), target: center.toArray(), fov: camera.fov },
      comparison:
        'same-source frozen optics switch; before disables only Festival dry-cloud detail',
      sourceSnapshotsSha256: snapshotsSha256,
      cpuReplayAndReadbackMs: performance.now() - started,
      notTargetDevicePerformance: true,
      checks,
      passed: Object.values(checks).every(Boolean),
      captures,
      shaderErrors,
      glErrors,
      images,
    };
  } finally {
    disposeEffects(effects);
    groundGeometry.dispose();
    groundMaterial.dispose();
    renderer.dispose();
  }
}

if (typeof window !== 'undefined')
  Object.assign(window, { horizonR6Effects: { capture: captureHorizonR6Effects, sourceIdentity } });
