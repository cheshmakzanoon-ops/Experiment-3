import * as T from 'three';
import { inspectBikeCockpit } from './bike-cockpit-contract.ts';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BikeMaterials,
  BikeModel,
  BikeShells,
  bikeOnboardFov,
  staticSag,
  type BikePoseValues,
} from '../../src/rendering/bike.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { H } from '../../src/simulation/protocol.ts';
import { VEHICLES } from '../../src/simulation/vehicles.ts';

/** Isolated production BikeModel, not a replacement game or promotional render. */
export function captureBikeSequence(
  view = 'three-quarter',
  detail: 'high' | 'mid' | 'far' = 'high',
  id = 'gpr1',
  samples: readonly {
    wet: boolean;
    time: number;
    /** Explicit optical control only; omitted samples use the real material. */
    windscreen?: 'production' | 'legacy-volume';
    /** Replayable front-lever input; other pose channels remain fixed. */
    frontBrake?: number;
    /** Explicit production-model pose controls for contact/recovery review. */
    pose?: Partial<
      Pick<BikePoseValues, 'chassisLean' | 'riderOffset' | 'tuck' | 'steer' | 'fork' | 'shock'>
    >;
    recovery?: 0 | 1 | 2;
  }[] = [{ wet: false, time: 2 }],
) {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1280, 800);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color('#aab9c6');
  const pmrem = new T.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.06);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.55;
  const sun = new T.DirectionalLight(0xfff0d9, 3.1);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 15 });
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.012;
  scene.add(sun, new T.HemisphereLight(0xc9e4ff, 0x514737, 1.3));
  const def = VEHICLES[id],
    materials = new BikeMaterials(0);
  const bike = new BikeModel(def, 0, detail, materials, true);
  const productionScreenThickness = materials.screen.thickness;
  const sag = staticSag(def);
  const pose: BikePoseValues = {
    fork: sag.fork,
    shock: sag.shock,
    steer: 0,
    frontRotation: 0,
    rearRotation: 0,
    chassisLean: view === 'corner' || view === 'rider-corner' ? 0.88 : 0,
    riderOffset: view === 'corner' || view === 'rider-corner' ? 0.18 : 0,
    tuck: 0.75,
    brake: 0.05,
    rearBrake: 0,
    discTemp: 280,
    compoundColour: 0xffffff,
    riding: true,
    speed: 42,
    gear: 4,
    rpm: 12200,
  };
  bike.pose(pose);
  bike.root.position.y = def.bike!.cgHeight;
  if (view === 'corner' || view === 'rider-corner') {
    bike.root.rotation.z = -0.88;
    bike.root.position.y *= Math.cos(0.88);
  }
  const weather = new WeatherPresentation();
  weather.install(bike.root);
  const weatherFrame = new Float32Array(128);
  scene.add(bike.root);
  if (view === 'bodywork') bike.rider.root.visible = false;
  const floor = new T.Mesh(
    new T.PlaneGeometry(200, 200),
    new T.MeshStandardMaterial({ color: 0x45494d, roughness: 0.91 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new T.PerspectiveCamera(38, 1280 / 800, 0.03, 80);
  if (view === 'side') camera.position.set(3.7, 1.35, 0.1);
  else if (view === 'front') camera.position.set(0.18, 1.1, 3.7);
  else if (view === 'rear') camera.position.set(-2.5, 1.8, -3.0);
  else if (view === 'rider-corner') camera.position.set(2.8, 1.65, 3.35);
  else camera.position.set(-2.8, 1.65, 3.35);
  camera.lookAt(0, 0.68, 0);
  // Inspect the actual garment skin at a useful reference-photo distance.
  // These views keep the same BikeModel, light, materials and riding pose.
  if (view === 'rider-rear' || view === 'rider-side') {
    camera.position.set(
      ...((view === 'rider-rear' ? [-1.45, 1.65, -1.85] : [2.35, 1.45, 0]) as [
        number,
        number,
        number,
      ]),
    );
    camera.lookAt(0, view === 'rider-rear' ? 1.03 : 1, view === 'rider-rear' ? -0.15 : -0.08);
    camera.fov = 32;
    camera.updateProjectionMatrix();
  }
  if (view === 'rear-chassis') {
    // Same production model and lighting; a mechanical camera that exposes
    // the undertray, rear arm, axle and damper without a detached display rig.
    camera.position.set(1.35, 0.8, -1.62);
    camera.lookAt(0, 0.53, -0.37);
    camera.fov = 35;
    camera.updateProjectionMatrix();
  }
  if (view === 'right-grip' || view === 'left-grip' || view === 'right-peg') {
    const index = view === 'left-grip' ? 0 : 1,
      peg = view === 'right-peg',
      focus = (peg ? bike.rider.pegs[index] : bike.rider.grips[index]).clone();
    bike.rider.root.localToWorld(focus);
    camera.position.copy(focus).add(new T.Vector3(index === 0 ? 0.48 : -0.48, 0.3, -0.32));
    camera.lookAt(focus.add(new T.Vector3(0, peg ? 0.04 : -0.04, -0.04)));
    camera.fov = 36;
    camera.updateProjectionMatrix();
  }
  if (view === 'rider-recovery') {
    camera.position.set(-3.5, 1.7, 0.15);
    camera.lookAt(0, 1.5, 0);
    camera.fov = 42;
    camera.updateProjectionMatrix();
  }
  if (view === 'onboard') {
    bike.rider.setFirstPerson(true);
    const direction = new T.Vector3();
    new BikeShells().onboard(bike.root, camera.position, direction, false, def);
    camera.fov = bikeOnboardFov(42, def);
    camera.lookAt(camera.position.clone().add(direction));
    camera.updateProjectionMatrix();
  }
  if (view === 'brake-lever') {
    // Macro mechanical inspection, explicitly separate from the riding eye.
    // Keep the complete real model, including its glove, fairing and steering.
    const lever = bike.root.getObjectByName('GP front-brake lever pivot');
    if (!lever) throw new Error('The selected model has no articulated GP lever');
    const focus = lever.getWorldPosition(new T.Vector3());
    camera.position.copy(focus).add(new T.Vector3(-0.34, 0.3, 0.12));
    camera.lookAt(focus.add(new T.Vector3(-0.055, -0.005, -0.025)));
    camera.fov = 36;
    camera.updateProjectionMatrix();
  }
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  // Instancing shares storage, not triangle submission. Count every link,
  // keeping the existing model budget meaningful after procedural instancing.
  let triangles = 0;
  bike.root.traverse((o) => {
    if (o instanceof T.Mesh)
      triangles +=
        ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3) *
        (o instanceof T.InstancedMesh ? o.count : 1);
  });
  const resources = () => ({
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
  });
  try {
    // Match production shader preparation before observing resource stability.
    // compile() renders no extra frames and changes no source snapshots.
    renderer.compile(scene, camera);
    // Production prepares real scene draws before presenting a race. In this
    // isolated fixture, measure that preparation with the exact same dry pose
    // and uniforms three times; do not attribute a cold second-draw program to
    // weather. Keep the first transition visible in the attached diagnostics.
    weatherFrame[H.TIME] = 2;
    const preparationSource = weatherFrame.slice();
    weather.update(weatherFrame);
    let previousPrograms = new Set<number>();
    const preparation = Array.from({ length: 3 }, (_, i) => {
      renderer.render(scene, camera);
      const programs = renderer.info.programs ?? [];
      const addedPrograms =
        i === 0
          ? []
          : programs
              .filter((program) => !previousPrograms.has(program.id))
              .map(({ name, cacheKey }) => ({ name, cacheKey }));
      previousPrograms = new Set(programs.map((program) => program.id));
      return {
        wet: false,
        time: 2,
        sourceFrameUnchanged: weatherFrame.every((value, j) => value === preparationSource[j]),
        resources: resources(),
        addedPrograms,
      };
    });
    return samples.map((sample) => {
      const samplePose = { ...pose, ...sample.pose, brake: sample.frontBrake ?? pose.brake };
      bike.pose(samplePose);
      bike.root.rotation.z = -samplePose.chassisLean;
      bike.root.position.y = def.bike!.cgHeight * Math.cos(samplePose.chassisLean);
      if (sample.recovery !== undefined) bike.rider.separated(sample.recovery, 0.6, sample.time);
      // Reproduce the previous GP volume setting on this SAME real curved
      // windscreen, display, camera and renderer. Production samples restore
      // the authored material value rather than prescribing the candidate.
      materials.screen.thickness =
        sample.windscreen === 'legacy-volume' ? 0.002 : productionScreenThickness;
      weatherFrame[H.TIME] = sample.time;
      weatherFrame[H.RAIN] = sample.wet ? 20 : 0;
      weatherFrame[H.WATER] = sample.wet ? 0.6 : 0;
      const source = weatherFrame.slice();
      weather.update(weatherFrame);
      renderer.render(scene, camera);
      const image = renderer.domElement.toDataURL('image/png');
      const pixels = new Uint8Array(1280 * 800 * 4);
      renderer
        .getContext()
        .readPixels(
          0,
          0,
          1280,
          800,
          renderer.getContext().RGBA,
          renderer.getContext().UNSIGNED_BYTE,
          pixels,
        );
      let hash = 2166136261;
      for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      const result = {
        image,
        instance: bike.root.uuid,
        sourceFrameUnchanged: weatherFrame.every((value, i) => value === source[i]),
        resources: resources(),
        preparation,
        hash,
        cockpit: view === 'onboard' ? inspectBikeCockpit(bike.root, camera) : null,
        frontBrake: sample.frontBrake ?? pose.brake,
        riderPose: {
          lean: samplePose.chassisLean,
          offset: samplePose.riderOffset,
          tuck: samplePose.tuck,
          steer: samplePose.steer,
          fork: samplePose.fork,
          shock: samplePose.shock,
          recovery: sample.recovery ?? null,
        },
        frontBrakeLever: (() => {
          const lever = bike.root.getObjectByName('GP front-brake lever pivot');
          return lever
            ? { angle: lever.rotation.y, world: lever.getWorldPosition(new T.Vector3()).toArray() }
            : null;
        })(),
        windscreen: {
          mode: sample.windscreen ?? 'production',
          thickness: materials.screen.thickness,
          ior: materials.screen.ior,
          transmission: materials.screen.transmission,
          opacity: materials.screen.opacity,
          transparent: materials.screen.transparent,
        },
        weather: weather.diagnostics(),
        triangles,
        submittedTriangles: renderer.info.render.triangles,
        calls: renderer.info.render.calls,
        glError: renderer.getContext().getError(),
        backend: (() => {
          const context = renderer.getContext(),
            extension = context.getExtension('WEBGL_debug_renderer_info');
          return extension ? String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null;
        })(),
        bounds: new T.Box3().setFromObject(bike.root),
      };
      return result;
    });
  } finally {
    bike.dispose();
    materials.dispose();
    floor.geometry.dispose();
    (floor.material as T.Material).dispose();
    weather.dispose();
    env.dispose();
    room.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** Compatibility wrapper; sequence tests deliberately retain the same instance. */
export function captureBike(
  view = 'three-quarter',
  detail: 'high' | 'mid' | 'far' = 'high',
  id = 'gpr1',
  wet = false,
) {
  return captureBikeSequence(view, detail, id, [{ wet, time: 2 }])[0];
}
