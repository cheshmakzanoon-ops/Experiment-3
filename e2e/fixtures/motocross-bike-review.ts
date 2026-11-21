import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BikeMaterials, BikeShells, bikeOnboardFov, staticSag } from '../../src/rendering/bike.ts';
import { FarShadow } from '../../src/rendering/far-shadow.ts';
import { MxRecoveryPose } from '../../src/rendering/offroad/motocross-recovery.ts';
import { MxArenaBikeLight } from '../../src/rendering/offroad/mx-arena-bike-light.ts';
import { DirtBikeModel } from '../../src/rendering/offroad/dirt-bike-model.ts';
import { mudUniforms } from '../../src/rendering/offroad/mud.ts';
import { VEHICLES, vehicleIndex, type VehicleDefinition } from '../../src/simulation/vehicles.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  HEADER,
  H,
  F,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  carBase,
} from '../../src/simulation/protocol.ts';
import type { RiderDetail } from '../../src/rendering/rider.ts';
import { inspectMotocrossCockpit } from './motocross-cockpit-contract.ts';
import { inspectMotocrossRiderContacts } from './motocross-rider-contact-contract.ts';

export interface MotocrossPoseSample {
  standing?: number;
  startBrace?: number;
  time?: number;
  dab?: number;
  body?: number;
  lean?: number;
  /** Render-frame X angle, positive nose-down. */
  pitch?: number;
  /** Height above the fixture floor for controlled airborne-pose inspection. */
  elevation?: number;
  heldShadow?: boolean;
  steer?: number;
  mud?: number;
  wet?: number;
  brake?: number;
  throttle?: number;
  rearBrake?: number;
  forkOffset?: number;
  shockOffset?: number;
  speed?: number;
  gLong?: number;
  leanRate?: number;
  supportG?: number;
  frontRotation?: number;
  rearRotation?: number;
  frontOmega?: number;
  rearOmega?: number;
  frontWear?: number;
  rearWear?: number;
  frontWater?: number;
  rearWater?: number;
  /** Separated rider channels and their own world-space support triangle. */
  recovery?: {
    pelvis: readonly [number, number, number];
    normal: readonly [number, number, number];
    planeConstant: number;
    heading: number;
    tumble: number;
    clock: number;
  };
  /** Sample roof irradiance at a controlled entrant position for the indoor review. */
  arenaPosition?: readonly [number, number, number];
}

/** Prescribe the recorded chassis for synthetic suspension samples supported
 * on level ground. Production snapshots already carry this heave and pitch;
 * changing travel under a stationary nominal root instead describes a wheel
 * driven through the floor. Solve the two fixed-reference contact gaps,
 * without sampling the rendered mesh or correcting its ground clearance. */
export function motocrossInspectionChassis(
  definition: VehicleDefinition,
  fork: number,
  shock: number,
) {
  const b = definition.bike!,
    sag = staticSag(definition),
    front = T.MathUtils.clamp(fork, 0, b.forkTravel),
    rear = T.MathUtils.clamp(shock, 0, b.shockTravel),
    frontHeight = b.cgHeight + sag.fork,
    rearHeight = b.cgHeight + sag.shock,
    difference = frontHeight - rearHeight,
    wheelbase = definition.spec.wheelbase,
    pitch =
      Math.asin(T.MathUtils.clamp((rear - front) / Math.hypot(wheelbase, difference), -0.6, 0.6)) +
      Math.atan2(difference, wheelbase);
  return {
    pitch,
    height: b.cgToRear * Math.sin(pitch) + rearHeight * Math.cos(pitch) - rear,
  };
}

// In the fixed side camera the front axle is in the left half of the frame
// and the rear axle is in the right. Independent hashes catch a swapped axle
// even when both the rolling and the locked full-frame images look different.
function sideWheelHashes(pixels: Uint8Array, width: number) {
  const halves = [2166136261, 2166136261];
  const halfRow = width * 2; // half a scanline of RGBA8
  for (let row = 0; row < pixels.length; row += 2 * halfRow) {
    for (const part of [0, 1]) {
      const start = row + part * halfRow;
      let hash = halves[part];
      for (let i = start; i < start + halfRow; i++) hash = Math.imul(hash ^ pixels[i], 16777619);
      halves[part] = hash >>> 0;
    }
  }
  return { front: halves[0], rear: halves[1] };
}

/** Actual production DirtBikeModel in a controlled inspection scene. The
 * production geometry, materials, suspension and rider IK are unmodified. */
export function captureMotocrossBike(
  id = 'mx450',
  detail: RiderDetail = 'high',
  view = 'three-quarter',
  samples: readonly MotocrossPoseSample[] = [{}],
  groundSurvey?: { vertices: number[]; indices: number[] },
  entrant = 0,
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
  scene.background = new T.Color(0xbac7cf);
  const pmrem = new T.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.08);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.7;
  const sun = new T.DirectionalLight(0xffedce, 3.1);
  sun.position.set(-3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 15 });
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.008;
  scene.add(sun, new T.HemisphereLight(0xc4def3, 0x635345, 1.1));
  const groundGeometry = groundSurvey ? new T.BufferGeometry() : new T.PlaneGeometry(150, 150);
  if (groundSurvey) {
    groundGeometry.setAttribute('position', new T.Float32BufferAttribute(groundSurvey.vertices, 3));
    groundGeometry.setIndex(groundSurvey.indices);
    groundGeometry.computeVertexNormals();
  }
  const ground = new T.Mesh(
    groundGeometry,
    new T.MeshStandardMaterial({ color: 0x76604a, roughness: 0.97 }),
  );
  if (!groundSurvey) ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const def = VEHICLES[id],
    materials = new BikeMaterials(entrant),
    mud = mudUniforms();
  const model = new DirtBikeModel(def, entrant, detail, materials, mud),
    sag = staticSag(def);
  scene.add(model.root);
  const arenaLight = samples.some((s) => s.arenaPosition) ? new MxArenaBikeLight() : undefined;
  arenaLight?.bind(model.root);
  const grid = { minX: -72, minZ: -70, spanX: 144, spanZ: 140, y: 26, columns: 8, rows: 5 };
  const location = new T.Vector3();
  const camera = new T.PerspectiveCamera(36, 1280 / 800, 0.03, 80);
  if (view === 'side') camera.position.set(3.9, 1.43, 0.06);
  else if (view === 'motion-side') camera.position.set(4.5, 1.68, 0.06);
  else if (view === 'front') camera.position.set(0.38, 1.5, 4.1);
  else if (view === 'rear') camera.position.set(-2.85, 1.9, -3.5);
  else if (view === 'helmet') camera.position.set(0.75, 1.75, 1.2);
  else if (view === 'drivetrain') camera.position.set(1.45, 0.67, -0.54);
  else if (view === 'rear-tyre') camera.position.set(-0.9, 0.76, -1.65);
  else if (view === 'front-tyre') camera.position.set(-0.72, 0.57, 1.65);
  else camera.position.set(-3.05, 1.72, 3.6);
  camera.lookAt(0, view === 'helmet' ? 1.59 : 0.93, 0);
  if (view === 'motion-side') camera.lookAt(0, 1.12, 0);
  if (view === 'drivetrain') camera.lookAt(0.095, 0.38, -0.45);
  if (view === 'rear-tyre') camera.lookAt(0, 0.36, -0.68);
  if (view === 'front-tyre') camera.lookAt(0, 0.36, 0.72);
  if (view === 'bodywork') model.rider.root.visible = false;
  const heldShadows = samples.some((s) => s.heldShadow) ? new FarShadow() : undefined;
  const recovery = new MxRecoveryPose();
  const floor = new T.Plane();
  const floorAxis = new T.Vector3(0, 0, 1);
  const groundRay = new T.Raycaster();
  groundRay.ray.direction.set(0, -1, 0);
  const support = {
    planeAtWorld(point: T.Vector3, result: T.Plane) {
      if (groundSurvey) {
        groundRay.ray.origin.copy(point);
        groundRay.ray.origin.y += 4;
        const hit = groundRay.intersectObject(ground, false)[0];
        if (hit?.face) {
          result.setFromNormalAndCoplanarPoint(hit.face.normal, hit.point);
          return true;
        }
      }
      result.copy(floor);
      return true;
    },
  };
  if (view === 'recovery') {
    camera.position.set(4.6, 1.4, 0.6);
    camera.lookAt(0, 0.79, 0.6);
    model.root.visible = false;
  }
  let triangles = 0,
    finiteGeometry = true;
  const materialsUsed = new Set<string>();
  model.root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    triangles +=
      ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3) *
      (o instanceof T.InstancedMesh ? o.count : 1);
    for (const attribute of Object.values(o.geometry.attributes) as T.BufferAttribute[]) {
      for (const value of attribute.array) if (!Number.isFinite(value)) finiteGeometry = false;
    }
    for (const material of Array.isArray(o.material) ? o.material : [o.material])
      materialsUsed.add(material.name);
  });
  const chainMeshes = [
    'Motocross steel chain pins and rollers',
    'Motocross paired articulated link plates',
  ].map((name) => model.root.getObjectByName(name));
  const inspectChain = () => {
    if (!chainMeshes.every((mesh): mesh is T.InstancedMesh => mesh instanceof T.InstancedMesh))
      return null;
    let hash = 2166136261;
    for (const mesh of chainMeshes) {
      const array = mesh.instanceMatrix.array;
      for (const byte of new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
        hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    }
    return {
      hash,
      counts: chainMeshes.map((mesh) => mesh.count),
      versions: chainMeshes.map((mesh) => mesh.instanceMatrix.version),
      finite: chainMeshes.every((mesh) =>
        Array.from(mesh.instanceMatrix.array).every(Number.isFinite),
      ),
    };
  };
  try {
    return samples.map((sample, sampleIndex) => {
      if (!sample.recovery && model.rider.root.parent !== model.sprung) {
        model.sprung.add(model.rider.root);
        model.rider.root.position.set(0, 0, 0);
        model.rider.root.quaternion.identity();
        if (!groundSurvey) {
          ground.position.set(0, 0, 0);
          ground.rotation.set(-Math.PI / 2, 0, 0);
        }
      }
      arenaLight?.update(
        sample.arenaPosition ? grid : undefined,
        sample.arenaPosition ? location.fromArray(sample.arenaPosition) : location,
      );
      const fork = sag.fork + (sample.forkOffset ?? 0),
        shock = sag.shock + (sample.shockOffset ?? 0),
        chassis = motocrossInspectionChassis(def, fork, shock),
        explicitChassis = sample.pitch !== undefined || sample.elevation !== undefined;
      // Production assigns the chassis quaternion before solving the rider.
      // Explicit airborne inspection inputs remain independent of suspension
      // travel; other samples prescribe a supported chassis from that travel.
      model.root.rotation.set(
        explicitChassis ? (sample.pitch ?? 0) : -chassis.pitch,
        0,
        -(sample.lean ?? 0),
        'YXZ',
      );
      model.pose({
        fork,
        shock,
        steer: sample.steer ?? 0,
        frontRotation: sample.frontRotation ?? 0,
        rearRotation: sample.rearRotation ?? 0,
        frontOmega: sample.frontOmega,
        rearOmega: sample.rearOmega,
        chassisLean: sample.lean ?? 0,
        riderOffset: 0,
        tuck: 0,
        brake: sample.brake ?? 0,
        throttle: sample.throttle ?? 0,
        rearBrake: sample.rearBrake ?? 0,
        discTemp: 0,
        compoundColour: 0xffffff,
        riding: !sample.recovery,
        standing: sample.standing ?? 0,
        startBrace: sample.startBrace,
        time: sample.time,
        dab: sample.dab ?? 0,
        body: sample.body ?? 0,
        mud: sample.mud ?? 0,
        mudWet: sample.wet ?? 0,
        frontWear: sample.frontWear ?? 0,
        rearWear: sample.rearWear ?? 0,
        frontWater: sample.frontWater ?? 0,
        rearWater: sample.rearWater ?? 0,
        speed: sample.speed ?? 0,
        gLong: sample.gLong,
        leanRate: sample.leanRate,
        dirtSupportG: sample.supportG,
      });
      model.root.position.y =
        (explicitChassis ? def.bike!.cgHeight : chassis.height) -
        def.bike!.cgHeight * (1 - Math.cos(sample.lean ?? 0)) +
        0.045 * Math.sin(Math.abs(sample.lean ?? 0)) +
        (sample.elevation ?? 0);
      model.rider.setFirstPerson(view === 'onboard', true);
      if (sample.recovery) {
        const state = sample.recovery;
        scene.add(model.rider.root);
        model.rider.root.visible = true;
        floor.normal.fromArray(state.normal);
        floor.constant = state.planeConstant;
        if (!groundSurvey) {
          ground.position.copy(floor.normal).multiplyScalar(-floor.constant);
          ground.quaternion.setFromUnitVectors(floorAxis, floor.normal);
        }
        if (view === 'recovery') {
          camera.position.z = 0.6 + state.pelvis[2] * 0.72;
          camera.lookAt(0, 0.79, camera.position.z);
        }
        recovery.place(
          model.rider,
          location.fromArray(state.pelvis),
          state.heading,
          'separated',
          state.clock,
          sample.standing ?? 0,
          state.tumble,
          sample.time ?? 0,
          support,
        );
      }
      if (view === 'onboard') {
        const direction = new T.Vector3();
        const frame = new Float32Array(HEADER + CAR_STRIDE),
          slot = carBase(0);
        frame[slot + OFFROAD_BASE + O.STANDING] = sample.standing ?? 0;
        frame[slot + OFFROAD_BASE + O.BODY] = sample.body ?? 0;
        frame[slot + BIKE_BASE + B.STATE] = sample.recovery ? 3 : 0;
        new BikeShells().onboard(
          model.root,
          camera.position,
          direction,
          false,
          def,
          camera.up,
          false,
          frame,
        );
        camera.fov = bikeOnboardFov(sample.speed ?? 0, def);
        camera.lookAt(camera.position.clone().add(direction));
        camera.updateProjectionMatrix();
      }
      scene.updateMatrixWorld(true);
      const cockpit = view === 'onboard' ? inspectMotocrossCockpit(model, camera) : null;
      const contacts = sample.recovery ? [] : inspectMotocrossRiderContacts(model, sample.dab ?? 0);
      // Three r180 builds shadow programs before the first render's light
      // setup. Compile the actual posed scene once to initialize that light
      // state, as the production loader does. Otherwise frame two adds two
      // depth-only variants even on an unchanged baseline bike, which is cold
      // renderer initialization rather than a mud/chain resource allocation.
      // Keep the first measured pixels, all poses and every resource invariant.
      if (sampleIndex === 0) renderer.compile(scene, camera);
      if (sample.heldShadow) {
        heldShadows!.renderHeldShadows(renderer, scene, camera);
        renderer.shadowMap.autoUpdate = false;
      }
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.shadowMap.autoUpdate = true;
      }
      const gl = renderer.getContext(),
        pixels = new Uint8Array(1280 * 800 * 4);
      gl.readPixels(0, 0, 1280, 800, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let hash = 2166136261;
      for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      return {
        image: renderer.domElement.toDataURL('image/png'),
        instance: model.root.uuid,
        hash,
        wheelPixels:
          view === 'side' && (sample.frontOmega !== undefined || sample.rearOmega !== undefined)
            ? sideWheelHashes(pixels, renderer.domElement.width)
            : null,
        triangles,
        submittedTriangles: renderer.info.render.triangles,
        finiteGeometry,
        contacts,
        motion: {
          pelvis: model.rider.root.getObjectByName('Rider torso')!.position.toArray(),
          pelvisQuaternion: model.rider.root.getObjectByName('Rider torso')!.quaternion.toArray(),
          chestQuaternion: model.rider.root
            .getObjectByName('Motocross upper chest')!
            .quaternion.toArray(),
          helmetForward: new T.Vector3(0, 0, 1)
            .applyQuaternion(
              model.rider.root
                .getObjectByName('Rider head and helmet')!
                .getWorldQuaternion(new T.Quaternion()),
            )
            .toArray(),
          frontLever:
            model.root.getObjectByName('Motocross front brake lever pivot')?.rotation.y ?? null,
        },
        cockpit,
        chain: inspectChain(),
        calls: renderer.info.render.calls,
        glError: gl.getError(),
        // A raked wheel's transformed local AABB overstates its radius. Inspect
        // actual transformed vertices, including tread and rider extremities.
        bounds: new T.Box3().setFromObject(model.root, true),
        resources: {
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          programs: renderer.info.programs?.length ?? 0,
        },
        mud: mud.offroadMud.value,
        wetness: mud.offroadMudWet.value,
        materials: [...materialsUsed],
      };
    });
  } finally {
    model.sprung.add(model.rider.root);
    heldShadows?.dispose();
    model.dispose();
    materials.dispose();
    ground.geometry.dispose();
    (ground.material as T.Material).dispose();
    env.dispose();
    room.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** Render one rider before and after the other entrant hands back a shared
 * mesh. This also exercises Three's actual WebGL buffer and VAO disposal. */
export function captureMotocrossFieldSharing() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  const width = 480,
    height = 300;
  renderer.setSize(width, height);
  const scene = new T.Scene(),
    shells = new BikeShells();
  scene.background = new T.Color(0x727d85);
  const sun = new T.DirectionalLight(0xffffff, 2.5);
  sun.position.set(-3, 5, 4);
  scene.add(shells.root, sun, new T.HemisphereLight(0xffffff, 0x605743, 1.2));
  const camera = new T.PerspectiveCamera(44, width / height, 0.05, 50);
  camera.position.set(3.7, 1.8, 3.7);
  camera.lookAt(0, 0.35, 0);
  const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
  frame[H.CARS] = 2;
  const cars = [-1.1, 0.8].map((x, i) => {
    const slot = carBase(i);
    frame[slot + F.QW] = 1;
    frame[slot + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
    const root = new T.Object3D();
    root.position.x = x;
    return { root };
  });
  const present = () => shells.update(frame, frame, 1, cars, camera, 'high', 1);
  const pixels = new Uint8Array(width * height * 4);
  const draw = () => {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261,
      foreground = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] || pixels[i + 2] !== pixels[2])
        foreground++;
      for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ pixels[i + c], 16777619) >>> 0;
    }
    return {
      hash,
      foreground,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      glError: gl.getError(),
    };
  };
  try {
    present();
    const first = shells.drawnRoot(0)!;
    first.visible = false;
    const one = draw();
    first.visible = true;
    const both = draw();
    frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
    present();
    const survivor = draw();
    shells.disposeAll();
    return { one, both, survivor, empty: draw() };
  } finally {
    shells.disposeAll();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
