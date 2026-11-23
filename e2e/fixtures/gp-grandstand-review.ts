import * as T from 'three';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../../src/simulation/protocol.ts';
import { PHASE } from '../../src/simulation/race.ts';
import { Track } from '../../src/simulation/track.ts';
import { buildGrandstand, standFrame, standMaterials } from '../../src/rendering/grandstand.ts';
import { venuePlan } from '../../src/rendering/venue-plan.ts';
import type { CrowdCluster } from '../../src/rendering/crowd.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { studioUniforms } from '../../src/rendering/studio/studio-frame.ts';
import { installShadowFilter, sunPenumbraScale } from '../../src/rendering/studio/shadow-filter.ts';
import { gpSunShadowSpread } from '../../src/rendering/gp-photographic-light.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';

/** Count submitted geometry after the production crowd has selected its LODs.
 * Matrix hashes also catch changed occupancy/placements in the baseline check.
 * Seat colours intentionally differ between venues and are not layout data. */
function geometryBudget(root: T.Object3D, staticOnly = false) {
  let triangles = 0,
    meshes = 0,
    instances = 0,
    matrixHash = 2166136261;
  root.traverseVisible((object) => {
    if (!(object instanceof T.Mesh)) return;
    const instanced = object instanceof T.InstancedMesh;
    if (staticOnly && instanced) return;
    const count = instanced ? object.count : 1,
      geometry = object.geometry as T.BufferGeometry;
    triangles += ((geometry.index?.count ?? geometry.getAttribute('position').count) / 3) * count;
    meshes++;
    if (instanced) {
      instances += count;
      const array = object.instanceMatrix.array,
        words = new Uint32Array(array.buffer, array.byteOffset, count * 16);
      for (const word of words) matrixHash = Math.imul(matrixHash ^ word, 16777619);
    }
  });
  return { triangles, meshes, instances, matrixHash: matrixHash >>> 0 };
}

/** Actual production grandstands, seats and audience on their authored sites.
 * Each scene is recentered for a consistent architectural view. This bounded
 * fixture verifies WebGL materials, held/weather/reset frames and resources;
 * it is not a full-venue gameplay capture or device frame-rate benchmark. */
const venues = ['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const;

/** Measure the existing PCSS filter in road-space centimetres. Two edges at
 * the same world X represent a high canopy and a plate close to the ground.
 * Hold the incident energy fixed to isolate the change in source size. */
export function captureGpShadowEdges() {
  installShadowFilter();
  const width = 640,
    height = 320,
    metresAcross = 3.2;
  const renderer = new T.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  const camera = new T.OrthographicCamera(-1.6, 1.6, 0.8, -0.8, 0.02, 30);
  camera.position.set(0, 15, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const sun = new T.DirectionalLight(0xffffff, 2);
  sun.position.set(0, 20, 0);
  sun.castShadow = true;
  // The same 3.71 cm world texels as the production 76 m / 2048 near map.
  sun.shadow.mapSize.set(256, 256);
  Object.assign(sun.shadow.camera, {
    left: -4.75,
    right: 4.75,
    top: 4.75,
    bottom: -4.75,
    near: 1,
    far: 28,
  });
  sun.shadow.camera.up.set(0, 0, -1);
  sun.shadow.bias = -0.000015;
  const receiver = new T.Mesh(
    new T.PlaneGeometry(4, 2).rotateX(-Math.PI / 2),
    new T.MeshStandardMaterial({ color: 0x858585, roughness: 1 }),
  );
  receiver.receiveShadow = true;
  scene.add(sun, sun.target, receiver, new T.AmbientLight(0xffffff, 0.26));
  const beam = new T.BoxGeometry(3, 0.04, 0.72);
  const hidden = new T.MeshStandardMaterial({ colorWrite: false, depthWrite: false });
  for (const [y, z] of [
    [8, -0.4],
    [0.08, 0.4],
  ]) {
    const caster = new T.Mesh(beam, hidden);
    caster.castShadow = true;
    caster.position.set(-1.5, y, z);
    scene.add(caster);
  }
  const gl = renderer.getContext();
  const pixels = new Uint8Array(width * height * 4);
  function edgeWidth(row: number) {
    const profile = new Float64Array(width);
    for (let x = 0; x < width; x++) {
      for (let y = row - 10; y <= row + 10; y++) profile[x] += pixels[(y * width + x) * 4];
      profile[x] /= 21;
    }
    const dark = profile[100],
      range = profile[540] - dark;
    const crossing = (fraction: number) =>
      profile.findIndex((value) => value >= dark + range * fraction);
    return ((crossing(0.9) - crossing(0.1)) * metresAcross) / width;
  }
  try {
    const shots = [];
    for (const [name, spread] of [
      ['sun', gpSunShadowSpread(0.12, 0)],
      ['thin-cloud', gpSunShadowSpread(0.55, 0)],
      ['shower', gpSunShadowSpread(0.98, 17)],
      ['held', gpSunShadowSpread(0.98, 17)],
      ['rewound', gpSunShadowSpread(0.12, 0)],
    ] as const) {
      sun.shadow.radius = sunPenumbraScale(sun.shadow.camera, spread);
      renderer.render(scene, camera);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let hash = 2166136261;
      for (let i = 0; i < pixels.length; i += 4) hash = Math.imul(hash ^ pixels[i], 16777619);
      shots.push({
        name,
        canopy: edgeWidth(240),
        foot: edgeWidth(80),
        hash: hash >>> 0,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        image: renderer.domElement.toDataURL('image/png'),
      });
    }
    return { shots, glError: gl.getError() };
  } finally {
    sun.shadow.dispose();
    disposePhase27Scene(scene);
    renderer.dispose();
  }
}

export async function captureGpGrandstands(
  ids: readonly (typeof venues)[number][] = venues,
  view: 'architecture' | 'trackside' = 'architecture',
) {
  installShadowFilter();
  const width = 1000,
    height = 650,
    renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  document.body.style.margin = '0';
  document.body.append(renderer.domElement);
  const camera = new T.PerspectiveCamera(42, width / height, 0.3, 350),
    pixels = new Uint8Array(width * height * 4),
    resources = () => ({ ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 });
  const captures: {
    venue: string;
    image: string;
    label: string;
    site: { s: number; side: number; length: number };
    architectureBatches: number;
    architecture: { triangles: number; baselineTriangles: number; addedTriangles: number };
    structure: ReturnType<typeof geometryBudget>;
    retained: {
      seats: ReturnType<typeof geometryBudget>;
      crowd: ReturnType<typeof geometryBudget>;
    };
    baseline: {
      structure: ReturnType<typeof geometryBudget>;
      retained: {
        seats: ReturnType<typeof geometryBudget>;
        crowd: ReturnType<typeof geometryBudget>;
      };
      render: ReturnType<typeof read>;
    };
    seats: number;
    crowdClusters: number;
    gaze: number[];
    states: ReturnType<typeof read>[];
    afterDispose: ReturnType<typeof resources>;
    weather: ReturnType<WeatherPresentation['diagnostics']>;
  }[] = [];
  function read(name: string) {
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth,
      h = gl.drawingBufferHeight;
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261,
      coloured = 0;
    for (let i = 0; i < w * h * 4; i += 4) {
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 3) coloured++;
      for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ pixels[i + c], 16777619);
    }
    return {
      name,
      hash: hash >>> 0,
      coloured,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      resources: resources(),
      glError: gl.getError(),
    };
  }
  try {
    for (const id of ids) {
      const track = new Track('clear', false, undefined, CIRCUITS[id]),
        site =
          venuePlan(track).grandstands.find((s) => s.s === 40) ?? venuePlan(track).grandstands[0],
        frame = standFrame(track, site),
        materials = standMaterials(track),
        scene = new T.Scene(),
        content = new T.Group(),
        props = new T.Group(),
        audience = new T.Group(),
        clusters: CrowdCluster[] = [],
        weather = new WeatherPresentation();
      scene.background = new T.Color(0xb8cbd7);
      scene.add(new T.HemisphereLight(0xe0eaff, 0x6e7355, 1.5));
      const sun = new T.DirectionalLight(0xffefda, 3.6);
      sun.position.set(-site.side * 35, 60, -38);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      Object.assign(sun.shadow.camera, {
        left: -70,
        right: 70,
        top: 65,
        bottom: -65,
        near: 1,
        far: 180,
      });
      sun.shadow.normalBias = 0.025;
      sun.shadow.radius = sunPenumbraScale(sun.shadow.camera);
      scene.add(sun);
      const stand = buildGrandstand(track, props, audience, site, materials, clusters);
      stand.updateWorldMatrix(true, true);
      content.matrix.copy(stand.matrixWorld).invert();
      content.matrixAutoUpdate = false;
      content.add(props, audience);
      scene.add(content);
      // A real sampled apron grounds the independent foundation heights; no
      // flattened stage hides the elevation differences along the actual site.
      const ground = new T.PlaneGeometry(120, 170, 24, 34).rotateX(-Math.PI / 2),
        position = ground.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i),
          z = position.getZ(i),
          wx = frame.x + Math.cos(frame.yaw) * x + Math.sin(frame.yaw) * z,
          wz = frame.z - Math.sin(frame.yaw) * x + Math.cos(frame.yaw) * z;
        position.setY(i, frame.ground(wx, wz) - frame.y - 0.02);
      }
      ground.computeVertexNormals();
      const apron = new T.Mesh(
        ground,
        new T.MeshStandardMaterial({ color: 0x66754c, roughness: 1 }),
      );
      apron.receiveShadow = true;
      scene.add(apron);
      if (view === 'trackside') {
        camera.position.set(-site.side * 6.8, 1.85, -12.5);
        camera.lookAt(site.side * 4.6, 2.1, 0);
      } else {
        camera.position.set(-site.side * 61, 15.5, -66);
        camera.lookAt(site.side * 4.4, 3.1, 0);
      }
      camera.updateMatrixWorld(true);
      scene.updateMatrixWorld(true);
      studioUniforms.studioTime.value = 12;
      studioUniforms.studioFrameDt.value = 0;
      studioUniforms.studioWind.value.set(1.7, -0.8, 12, 0.3);
      for (const cluster of clusters)
        cluster.update(12, camera.position, 0, undefined, camera.fov, camera.aspect);
      weather.install(scene);
      weather.surface.value.set(0, 12, 0, 0);
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
      const states = [read('dry')],
        image = renderer.domElement.toDataURL('image/png');
      renderer.render(scene, camera);
      states.push(read('held'));
      weather.surface.value.set(1, 12, 20, 0.8);
      sun.shadow.radius = sunPenumbraScale(sun.shadow.camera, gpSunShadowSpread(0.98, 20));
      renderer.render(scene, camera);
      states.push(read('wet'));
      renderer.render(scene, camera);
      states.push(read('wet-held'));
      weather.surface.value.set(0, 12, 0, 0);
      sun.shadow.radius = sunPenumbraScale(sun.shadow.camera);
      renderer.render(scene, camera);
      states.push(read('restored'));
      const architecture = stand.children.find((child) => child.userData.gpGrandstand)!,
        seats = stand.getObjectByName(`Seats ${site.s}m`) as T.InstancedMesh,
        label = materials.sign.userData.venueLabel as string,
        weatherState = weather.diagnostics(),
        structure = geometryBudget(stand, true),
        retained = { seats: geometryBudget(seats), crowd: geometryBudget(audience) };
      // Keep the traffic response, clock, camera and shadows identical. Only
      // the head turn changes between the first and second pictures.
      const pass = new Float32Array(HEADER + CAR_STRIDE);
      pass[H.CARS] = 1;
      pass[H.PHASE] = PHASE.RACING;
      pass[carBase(0) + F.SPEED] = 45;
      pass[carBase(0) + F.X] = -site.side * 15;
      pass[carBase(0) + F.Z] = 17;
      // Keep the established shadow field fixed to isolate the shader's
      // visible head turn. The roof and seating checks still run at 1000×650.
      renderer.setSize(width / 2, height / 2, false);
      renderer.shadowMap.autoUpdate = false;
      const gaze = [false, true, true].map((enabled) => {
        for (const cluster of clusters)
          cluster.update(12, camera.position, 0, pass, camera.fov, camera.aspect, enabled);
        renderer.render(scene, camera);
        return read('gp spectator gaze').hash;
      });
      renderer.setSize(width, height, false);
      renderer.shadowMap.autoUpdate = true;
      // Measure the unchanged generic builder with the same physical track,
      // camera, seat/crowd population, LOD selection and lighting. Aggregate
      // triangle counts are dominated by the existing crowd, so a guessed
      // total-scene cap cannot identify an architectural regression.
      const legacyTrack = Object.create(track) as Track,
        legacyProps = new T.Group(),
        legacyAudience = new T.Group(),
        legacyClusters: CrowdCluster[] = [];
      Object.defineProperty(legacyTrack, 'circuit', {
        value: { ...track.circuit, id: 'aurel' },
      });
      const legacyStand = buildGrandstand(
        legacyTrack,
        legacyProps,
        legacyAudience,
        site,
        materials,
        legacyClusters,
      );
      content.add(legacyProps, legacyAudience);
      props.visible = false;
      audience.visible = false;
      scene.updateMatrixWorld(true);
      for (const cluster of legacyClusters)
        cluster.update(12, camera.position, 0, undefined, camera.fov, camera.aspect);
      renderer.render(scene, camera);
      const baseline = {
        structure: geometryBudget(legacyStand, true),
        retained: {
          seats: geometryBudget(legacyStand.getObjectByName(`Seats ${site.s}m`)!),
          crowd: geometryBudget(legacyAudience),
        },
        render: read('legacy-baseline'),
      };
      weather.dispose();
      disposePhase27Scene(scene);
      // The source audience material is a template; its cloned LOD materials
      // are owned by the scene. Release the unattached template explicitly.
      materials.people.dispose();
      scene.clear();
      renderer.render(scene, camera);
      captures.push({
        venue: id,
        image,
        label,
        site,
        architectureBatches: architecture.children.length,
        architecture: {
          triangles: geometryBudget(architecture).triangles,
          // Includes the generic aisle boxes replaced by each GP terrace.
          baselineTriangles:
            baseline.structure.triangles -
            structure.triangles +
            geometryBudget(architecture).triangles,
          addedTriangles: structure.triangles - baseline.structure.triangles,
        },
        structure,
        retained,
        baseline,
        seats: seats.count,
        crowdClusters: clusters.length,
        gaze,
        states,
        afterDispose: resources(),
        weather: weatherState,
      });
    }
    return { captures, glError: renderer.getContext().getError() };
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
}
