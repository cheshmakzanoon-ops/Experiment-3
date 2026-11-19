import * as T from 'three';
import { BikeShells } from '../../src/rendering/bike.ts';
import { sampleChassisPose } from '../../src/rendering/snapshot-interpolation.ts';
import { installCarGrounding } from '../../src/rendering/studio/car-grounding.ts';
import { StudioFrame, studioUniforms } from '../../src/rendering/studio/studio-frame.ts';
import { BikeVehicle } from '../../src/simulation/bike-vehicle.ts';
import { controls, DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import {
  BC,
  H,
  PROTOCOL_VERSION,
  WHEEL_CONTACT_BASE,
  WHEEL_CONTACT_SIZE,
  carBase,
  hasRoadBikeContact,
  snapshotIncompatibility,
  wheelContactBase,
} from '../../src/simulation/protocol.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { pixelDifference } from './pixel-difference.ts';

const WIDTH = 480,
  HEIGHT = 320,
  o = carBase(0);

/** Actual solved snapshots, never hand-authored suspension/marker values.
 * Exported separately so CI can verify preparation without a WebGL context. */
export function prepareRoadBikeFrames() {
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    opponents: 0,
    vehicles: ['gpr1'],
    setup: { ...DEFAULT_OPTIONS.setup },
  });
  const bike = simulation.cars[0] as BikeVehicle;
  bike.place(simulation.track, simulation.track.length - 100, 0);
  simulation.setInput(controls());
  for (let i = 0; i < 120; i++) simulation.step(1 / 120);
  const supported = simulation.makeFrame();
  bike.body.velocity.y += 5;
  for (let i = 0; i < 20; i++) simulation.step(1 / 120);
  const airborne = simulation.makeFrame();
  if (!bike.roadSuspension.airborne) throw new Error('Impulse did not produce real road flight');
  let landed: Float32Array | undefined;
  for (let i = 0; i < 160; i++) {
    simulation.step(1 / 120);
    if (
      bike.roadSuspension.frontLoad + bike.roadSuspension.rearLoad >
      bike.dynamics.mass * 9.81 * 1.15
    ) {
      landed = simulation.makeFrame();
      break;
    }
  }
  if (!landed) throw new Error('Physical landing impulse was not recorded');
  const frames = { supported, airborne, landed };
  for (const [name, frame] of Object.entries(frames)) {
    if (!hasRoadBikeContact(frame, o) || snapshotIncompatibility(frame))
      throw new Error(`Invalid active road snapshot: ${name}`);
  }
  return frames;
}

/** Production bike/rider materials and grounding on a bounded receiving plane.
 * This supplements, rather than substitutes for, the full application capture. */
export function capture() {
  const frames = prepareRoadBikeFrames(),
    renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }),
    gl = renderer.getContext();
  renderer.setSize(WIDTH, HEIGHT);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  document.body.style.cssText = 'margin:0;background:#1d2630';
  document.body.replaceChildren(renderer.domElement);
  const shaderErrors: string[] = [],
    glErrors: number[] = [],
    images: Record<string, string> = {};
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    shaderErrors.push(
      [
        context.getProgramInfoLog(program),
        context.getShaderInfoLog(vertex),
        context.getShaderInfoLog(fragment),
      ].join('\n'),
    );
  };
  const scene = new T.Scene();
  scene.background = new T.Color(0x1d2630);
  const sun = new T.DirectionalLight(0xffe5ce, 3),
    ambient = new T.HemisphereLight(0xc4dcff, 0x433c34, 2.5),
    shells = new BikeShells(),
    host = { root: new T.Object3D() },
    camera = new T.PerspectiveCamera(42, WIDTH / HEIGHT, 0.05, 50),
    top = new T.OrthographicCamera(-3, 3, 2, -2, 0.05, 30),
    studio = new StudioFrame(),
    groundGeometry = new T.PlaneGeometry(8, 8),
    groundMaterial = new T.MeshStandardMaterial({ color: 0x858383, roughness: 0.95 }),
    ground = new T.Mesh(groundGeometry, groundMaterial),
    centre = new T.Vector3(),
    normal = new T.Vector3(),
    scratch = new T.Vector3();
  installCarGrounding(groundMaterial);
  for (let wheel = 0; wheel < 4; wheel += 2) {
    const p = wheelContactBase(o, wheel);
    centre.add(scratch.fromArray(frames.supported, p + BC.X));
    normal.add(scratch.fromArray(frames.supported, p + BC.NORMAL_X));
  }
  centre.multiplyScalar(0.5);
  normal.normalize();
  ground.position.copy(centre);
  ground.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
  camera.position.copy(centre).add(new T.Vector3(4.3, 2.4, 4.5));
  camera.lookAt(centre.clone().add(new T.Vector3(0, 0.9, 0)));
  top.position.copy(centre).add(new T.Vector3(0, 10, 0));
  top.up.set(0, 0, -1);
  top.lookAt(centre);
  sun.position.copy(centre).add(new T.Vector3(-4, 9, 5));
  sun.target.position.copy(centre);
  scene.add(ground, shells.root, sun, sun.target, ambient);

  const read = () => {
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    for (let error = gl.getError(); error !== gl.NO_ERROR; error = gl.getError())
      glErrors.push(error);
    return pixels;
  };
  const draw = (frame: Float32Array, view: T.Camera, bikes = true) => {
    sampleChassisPose(frame, frame, o, 1, host.root.position, host.root.quaternion);
    shells.update(frame, frame, 1, [host], camera, 'high', 0);
    shells.root.visible = bikes;
    scene.updateMatrixWorld(true);
    view.updateMatrixWorld(true);
    studio.update(frame, view, sun, view === camera ? 'active-bike' : 'active-ground');
    renderer.render(scene, view);
    return read();
  };
  const probe = (without: Uint8Array, withTyres: Uint8Array, point: T.Vector4) => {
    scratch.set(point.x, point.z, point.y).project(top);
    const x = Math.round((scratch.x * 0.5 + 0.5) * WIDTH),
      y = Math.round((scratch.y * 0.5 + 0.5) * HEIGHT);
    let darkness = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const offset = ((y + dy) * WIDTH + x + dx) * 4;
        for (let c = 0; c < 3; c++) darkness += without[offset + c] - withTyres[offset + c];
      }
    return darkness / 27;
  };
  const describe = (frame: Float32Array) => {
    const root = shells.drawnRoot(0)!;
    // BikeModel attaches its actual sprung group first. Inspect the production
    // graph rather than posing a second independently constructed model.
    const sprung = root.children[0],
      tyres: { wheel: number; vertices: number; clearance: number; expected: number }[] = [];
    let finite = true,
      meshes = 0;
    root.traverse((object) => {
      finite &&= object.matrixWorld.elements.every(Number.isFinite);
      if (!(object instanceof T.Mesh)) return;
      meshes++;
      if (Array.isArray(object.material) || object.material.name !== 'Slick tyre: fine grain')
        return;
      let front = false;
      for (let at: T.Object3D | null = object; at && at !== root; at = at.parent)
        front ||= at.name === 'GP front wheel spin';
      const wheel = front ? 0 : 2,
        p = wheelContactBase(o, wheel),
        n = new T.Vector3().fromArray(frame, p + BC.NORMAL_X),
        point = new T.Vector3().fromArray(frame, p + BC.X),
        positions = object.geometry.getAttribute('position');
      let clearance = Infinity;
      for (let i = 0; i < positions.count; i++) {
        scratch.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).sub(point);
        clearance = Math.min(clearance, n.dot(scratch));
      }
      tyres.push({
        wheel,
        vertices: positions.count,
        clearance,
        expected: frame[p + BC.GAP] * n.y,
      });
    });
    const rotation = sprung.getWorldQuaternion(new T.Quaternion());
    return {
      time: frame[H.TIME],
      marked: hasRoadBikeContact(frame, o),
      finite,
      meshes,
      sprungPositionError: sprung.getWorldPosition(scratch).distanceTo(host.root.position),
      sprungRotationError: 1 - Math.abs(rotation.dot(host.root.quaternion)),
      tyres: tyres.sort((a, b) => a.wheel - b.wheel),
      contactWeights: [
        studioUniforms.studioGpFront.value[0].w,
        studioUniforms.studioGpRear.value[0].w,
      ],
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  };
  try {
    // Capture the model's FIRST presentation before any spring history exists.
    // Reuse its exact authored textures so the later pixel comparison isolates
    // replay restoration from a second independent creation of the artwork.
    // The subsequent earlier supported snapshot resets this cold state before
    // the ordinary supported -> airborne -> landed sequence begins.
    const coldSeek = draw(frames.airborne, camera),
      coldSeekReference = describe(frames.airborne);
    images['airborne-cold-seek'] = renderer.domElement.toDataURL('image/png');
    const observations = [],
      stagePixels: Record<string, Uint8Array> = {};
    for (const [name, frame] of Object.entries(frames)) {
      const grounded = draw(frame, top, false),
        front = studioUniforms.studioGpFront.value[0].clone(),
        rear = studioUniforms.studioGpRear.value[0].clone();
      studioUniforms.studioGpFront.value[0].w = studioUniforms.studioGpRear.value[0].w = 0;
      renderer.render(scene, top);
      const noTyreTerm = read();
      // Restore only by the production writer on the next draw.
      const pixels = draw(frame, camera);
      stagePixels[name] = pixels;
      images[name] = renderer.domElement.toDataURL('image/png');
      const observation = describe(frame);
      observations.push({
        name,
        ...observation,
        tyreDarkness: [probe(noTyreTerm, grounded, front), probe(noTyreTerm, grounded, rear)],
      });
    }
    // A backward seek restarts the rider's spring body at equilibrium. Compare
    // it with the independently captured cold state, retaining the continuous
    // history difference in the report and the exact zero-pixel gate.
    const flight = draw(frames.airborne, camera);
    images['airborne-rewind'] = renderer.domElement.toDataURL('image/png');
    const held = draw(frames.airborne, camera),
      legacy = frames.airborne.slice();
    legacy.fill(0, o + WHEEL_CONTACT_BASE, o + WHEEL_CONTACT_BASE + WHEEL_CONTACT_SIZE);
    const wrong = draw(legacy, camera),
      legacyControl = describe(legacy);
    images['legacy-pose-control'] = renderer.domElement.toDataURL('image/png');
    const restored = draw(frames.airborne, camera);
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      width: WIDTH,
      height: HEIGHT,
      protocol: PROTOCOL_VERSION,
      observations,
      differences: {
        flight: pixelDifference(stagePixels.supported, stagePixels.airborne),
        landing: pixelDifference(stagePixels.airborne, stagePixels.landed),
        continuousToColdSeek: pixelDifference(stagePixels.airborne, coldSeek),
        rewind: pixelDifference(coldSeek, flight),
        held: pixelDifference(flight, held),
        restored: pixelDifference(flight, restored),
        legacy: pixelDifference(flight, wrong),
      },
      coldSeekReference,
      legacyControl,
      backend: {
        vendor: String(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)),
        renderer: String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
      },
      webgl2: renderer.capabilities.isWebGL2,
      shaderErrors,
      glErrors,
      contextAlive: !gl.isContextLost(),
      physicalHardwareValidated: false,
      images,
    };
  } finally {
    shells.disposeAll();
    groundGeometry.dispose();
    groundMaterial.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
