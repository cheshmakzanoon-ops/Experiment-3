import * as T from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { BikeModel, BikeShells, GP_ONBOARD } from '../src/rendering/bike.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { GpTyreContactProjector } from '../src/rendering/gp-tyre-contacts.ts';
import {
  GP_GLOVE_GRIP,
  GP_BOOT_PEG,
  GP_FOOTPEG_RADIUS,
} from '../src/rendering/gp-rider-contact.ts';
import { sampleChassisPose } from '../src/rendering/snapshot-interpolation.ts';
import { sampleWheelContact, wheelContactPose } from '../src/rendering/wheel-contact.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { controls, DEFAULT_OPTIONS, type Setup } from '../src/simulation/config.ts';
import {
  B,
  BC,
  BIKE_BASE,
  F,
  H,
  R,
  RACE_BASE,
  ROAD_BIKE_CONTACT,
  WHEEL_CONTACT_BASE,
  WHEEL_CONTACT_SIZE,
  carBase,
  hasRoadBikeContact,
  snapshotIncompatibility,
  wheelContactBase,
} from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import { writeWheelContact } from '../src/simulation/wheel-contact-state.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';

function stubCanvas() {
  const noop = () => undefined;
  class Canvas {
    width = 256;
    height = 256;
    getContext() {
      return new Proxy(
        {
          canvas: this,
          measureText: () => ({ width: 30 }),
          createLinearGradient: () => ({ addColorStop: noop }),
          createRadialGradient: () => ({ addColorStop: noop }),
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        },
        { get: (target, key) => Reflect.get(target, key) ?? noop },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('preserves physical flight clearance, landing support and fixed road shadows through hold, seek and all LODs', () => {
  stubCanvas();
  const { sim, bike } = fixture(),
    pose = spyPose(),
    shells = new BikeShells();
  bike.body.velocity.y += 5;
  for (let i = 0; i < 20; i++) sim.step(1 / 120);
  const flying = sim.makeFrame();
  expect(bike.roadSuspension.airborne).toBe(true);
  expect(bike.roadSuspension.frontGap).toBeGreaterThan(0.1);
  try {
    const first = render(shells, pose, flying).model;
    checkContacts(flying, first);
    for (let i = 0; i < 2; i++) {
      const foot = first.rider.root.getObjectByName(`GP ${i === 0 ? 'left' : 'right'} foot`)!,
        peg = first.rider.pegs[i].clone();
      peg.y += GP_FOOTPEG_RADIUS;
      expect(
        foot.localToWorld(new T.Vector3(...GP_BOOT_PEG)).distanceTo(first.sprung.localToWorld(peg)),
      ).toBeLessThan(1e-7);
    }
    const held = first.sprung.matrixWorld.toArray();
    for (const distance of [70, 300, 0]) {
      const model = render(shells, pose, flying, flying, 1, distance).model;
      checkContacts(flying, model, distance === 300 ? 0.025 : 0.005);
      expect(model.sprung.matrixWorld.toArray()).toEqual(held);
    }
    let landing: Float32Array | undefined;
    for (let i = 0; i < 160; i++) {
      sim.step(1 / 120);
      if (
        bike.roadSuspension.frontLoad + bike.roadSuspension.rearLoad >
        bike.dynamics.mass * 9.81 * 1.15
      ) {
        landing = sim.makeFrame();
        break;
      }
    }
    expect(landing).toBeDefined();
    checkContacts(landing!, render(shells, pose, landing!).model);
    const restored = render(shells, pose, flying).model;
    expect(restored.sprung.matrixWorld.toArray()).toEqual(held);
    checkContacts(flying, restored);
  } finally {
    shells.disposeAll();
  }
});

it('interpolates recorded road geometry with the same chassis clock and keeps marker transitions discrete', () => {
  stubCanvas();
  const { sim, bike } = fixture(),
    a = sim.makeFrame();
  bike.body.velocity.y -= 1;
  for (let i = 0; i < 4; i++) sim.step(1 / 120);
  const b = sim.makeFrame(),
    presented = new PresentedFrame(),
    pose = spyPose(),
    shells = new BikeShells();
  try {
    const middle = presented.sample(a, b, 0.4);
    expect(snapshotIncompatibility(middle)).toBeNull();
    const model = render(shells, pose, a, b, 0.4).model;
    checkContacts(middle, model);
    const original = model.root.matrixWorld.toArray();
    render(shells, pose, b);
    expect(render(shells, pose, a, b, 0.4).model.root.matrixWorld.toArray()).toEqual(original);
    const old = a.slice();
    old.fill(0, o + WHEEL_CONTACT_BASE, o + WHEEL_CONTACT_BASE + WHEEL_CONTACT_SIZE);
    // Global weather/time still advances; this entrant holds its old frame.
    expect(presented.sample(old, b, 0.8).subarray(o)).toEqual(old.subarray(o));
    const legacy = render(shells, pose, old).model;
    expect(legacy.rider.ground.plane).toBeUndefined();
    expect(render(shells, pose, a).model.sprung.position.length()).toBe(0);
  } finally {
    shells.disposeAll();
  }
});

it('does not reinterpret car, MX, stand, placement, malformed or separated poses as a road sprung frame', () => {
  const { sim, bike } = fixture(),
    frame = sim.makeFrame();
  expect(frame[o + WHEEL_CONTACT_BASE]).toBe(ROAD_BIKE_CONTACT);
  for (let wheel = 0; wheel < 4; wheel++)
    expect(sampleWheelContact(frame, frame, o, wheel, 1, wheelContactPose()).valid).toBe(false);
  for (const corrupt of [
    (f: Float32Array) => {
      f[o + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
    },
    (f: Float32Array) => {
      f[o + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
    },
    (f: Float32Array) => {
      f[o + BIKE_BASE + B.STATE] = 3;
    },
    (f: Float32Array) => {
      f[wheelContactBase(o, 0) + BC.NORMAL_Y] = 0;
    },
    (f: Float32Array) => {
      f[wheelContactBase(o, 2) + BC.GAP] = -1;
    },
    (f: Float32Array) => {
      f[o + F.IN_PIT] = 1;
      f[o + F.PIT_PHASE] = 3;
      f[o + F.SPEED] = 0;
    },
  ]) {
    const invalid = frame.slice();
    corrupt(invalid);
    expect(hasRoadBikeContact(invalid, o)).toBe(false);
    expect(snapshotIncompatibility(invalid)).toMatch(/invalid wheel contact/);
    expect(() => new PresentedFrame().sample(invalid, invalid, 1)).toThrow(
      /Invalid road motorcycle/,
    );
  }
  bike.inPit = true;
  bike.pitPhase = 3;
  bike.speed = 0;
  writeWheelContact(frame, o, bike);
  expect(frame[o + WHEEL_CONTACT_BASE]).toBe(0);
  bike.inPit = false;
  bike.place(sim.track, 0);
  writeWheelContact(frame, o, bike);
  expect(frame[o + WHEEL_CONTACT_BASE]).toBe(0);
});

it('round-trips the explicit pose through both recorders and validates full-session capture', async () => {
  const { sim } = fixture(),
    frame = sim.makeFrame(),
    recorder = new ReplayRecorder(1, 1);
  recorder.append(frame);
  const a = recorder.makeFrame(),
    b = recorder.makeFrame();
  recorder.sample(0, a, b);
  expect(hasRoadBikeContact(a, o)).toBe(true);
  expect(a.subarray(o + BIKE_BASE, o + BIKE_BASE + 20)).toEqual(
    frame.subarray(o + BIKE_BASE, o + BIKE_BASE + 20),
  );
  expect(a.subarray(o + WHEEL_CONTACT_BASE)).toEqual(frame.subarray(o + WHEEL_CONTACT_BASE));
  const pages = new Map<number, ReplayPage>(),
    store: ReplayPageStore = {
      put: async (page) => {
        pages.set(page.id, structuredClone(page));
      },
      get: async (id) => structuredClone(pages.get(id)!),
      dispose: async () => {
        pages.clear();
      },
    },
    replay = new SessionReplay(1, store, undefined, 2),
    originals: Float32Array[] = [];
  try {
    for (let i = 0; i < 24; i++) {
      for (let step = 0; step < 8; step++) sim.step(1 / 120);
      const next = sim.makeFrame();
      originals.push(next);
      replay.append(next);
      if (i % 2) await replay.settle();
    }
    await replay.settle();
    expect(replay.error).toBeNull();
    expect(replay.diagnostics().cached).not.toContain(0);
    for (const index of [1, 15, 3, 1]) {
      replay.prepareSeek((index + 0.5) / 15);
      await replay.settle();
      expect(replay.sample((index + 0.5) / 15, a, b)).not.toBeNull();
      expect(a).toEqual(originals[index]);
      expect(b).toEqual(originals[index + 1]);
      expect(hasRoadBikeContact(a, o)).toBe(true);
    }
    const invalid = originals.at(-1)!.slice();
    invalid[H.TIME] += 1;
    invalid[o + RACE_BASE + R.VEHICLE] = 0;
    replay.append(invalid);
    expect(replay.error).toMatch(/Invalid replay snapshot/);
  } finally {
    await replay.dispose();
  }
});

it('keeps preload, lean and rider road clearance in the physical chassis frame', () => {
  stubCanvas();
  const { sim, bike } = fixture('gpr1', { frontPreload: 0.012, rearPreload: 0.006 }),
    pose = spyPose(),
    shells = new BikeShells();
  bike.dynamics.speed = 18;
  bike.dynamics.lean = 0.72;
  bike.dynamics.riderOffset = 0.16;
  sim.step(1 / 120);
  const frame = sim.makeFrame();
  expect(bike.riding).toBe(true);
  expect(bike.dynamics.lean).toBeGreaterThan(0.6);
  try {
    const { model } = render(shells, pose, frame);
    checkContacts(frame, model);
    const plane = model.rider.ground.plane!;
    expect(plane).toBeDefined();
    const world = new T.Vector3(),
      normal = new T.Vector3(),
      point = new T.Vector3();
    normal
      .fromArray(frame, wheelContactBase(o, 0) + BC.NORMAL_X)
      .add(world.fromArray(frame, wheelContactBase(o, 2) + BC.NORMAL_X))
      .normalize();
    point
      .fromArray(frame, wheelContactBase(o, 0) + BC.X)
      .add(world.fromArray(frame, wheelContactBase(o, 2) + BC.X))
      .multiplyScalar(0.5);
    const local = new T.Vector3(0.1, -0.2, 0.3);
    world.copy(local).applyMatrix4(model.sprung.matrixWorld).sub(point);
    expect(plane.distanceToPoint(local)).toBeCloseTo(normal.dot(world), 6);
    for (const label of ['left', 'right']) {
      const joint = model.rider.root.getObjectByName(`GP ${label} shin`)!;
      model.sprung.worldToLocal(joint.getWorldPosition(world));
      expect(plane.distanceToPoint(world)).toBeGreaterThan(0.015);
    }
  } finally {
    shells.disposeAll();
  }
});

function fixture(vehicle = 'gpr1', setup: Partial<Setup> = {}) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    opponents: 0,
    vehicles: [vehicle],
    setup: { ...DEFAULT_OPTIONS.setup, ...setup },
  });
  const bike = sim.cars[0] as BikeVehicle;
  bike.place(sim.track, sim.track.length - 100, 0);
  sim.setInput(controls());
  for (let i = 0; i < 120; i++) sim.step(1 / 120);
  return { sim, bike };
}
const o = carBase(0);
type Posed = Pick<BikeModel, 'root' | 'sprung' | 'rider' | 'definition'> & {
  m: { rubber: T.Material; fairingWear: { value: number } };
  frontSpin: T.Group;
  rearSpin: T.Group;
};
it.each(['gpr1', 'gpr2'])('%s restores recorded fairing wear through LOD changes, pit repair and replay', (id) => {
  stubCanvas();
  const { sim, bike } = fixture(id), pose = spyPose(), shells = new BikeShells();
  try {
    const intact = sim.makeFrame();
    bike.frontHealth = 0.65;
    sim.step(1 / 120);
    const worn = sim.makeFrame();
    const uniform = render(shells, pose, intact).model.m.fairingWear;
    expect(uniform.value).toBe(0);
    for (const distance of [0, 70, 300]) {
      expect(render(shells, pose, worn, worn, 1, distance).model.m.fairingWear).toBe(uniform);
      expect(uniform.value).toBeCloseTo(0.5);
    }
    render(shells, pose, intact, worn, 0.5);
    expect(uniform.value).toBeCloseTo(0.25);
    bike.repairFrontWing(2);
    sim.step(1 / 120);
    render(shells, pose, sim.makeFrame());
    expect(uniform.value).toBe(0);
    render(shells, pose, worn);
    expect(uniform.value).toBeCloseTo(0.5);
    const legacy = intact.slice();
    legacy[o + F.FRONT_HEALTH] = 0;
    render(shells, pose, legacy);
    expect(uniform.value).toBe(0);
  } finally {
    shells.disposeAll();
  }
});

function spyPose() {
  return vi.spyOn(BikeModel.prototype, 'pose');
}
function render(
  shells: BikeShells,
  pose: ReturnType<typeof spyPose>,
  a: Float32Array,
  b = a,
  t = 1,
  distance = 0,
) {
  const host = { root: new T.Object3D() },
    camera = new T.PerspectiveCamera(58, 16 / 9);
  sampleChassisPose(a, b, o, t, host.root.position, host.root.quaternion);
  camera.position.copy(host.root.position).add(new T.Vector3(0, 0, distance));
  shells.update(a, b, t, [host], camera, 'high', distance === 0 ? 0 : -1);
  const model = pose.mock.contexts.at(-1) as unknown as Posed;
  model.root.updateMatrixWorld(true);
  return { model, host };
}
function geometryClearance(
  spin: T.Group,
  rubber: T.Material,
  normal: T.Vector3,
  road: T.Vector3,
  axle: number,
) {
  let lowest = Infinity,
    vertices = 0;
  const shader = {
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as T.WebGLProgramParametersWithUniforms;
  rubber.onBeforeCompile(shader, {} as T.WebGLRenderer);
  const point = new T.Vector3(), bind = new T.Vector3(), localNormal = new T.Vector3();
  spin.traverse((object) => {
    if (!(object instanceof T.Mesh) || object.material !== rubber) return;
    const positions = object.geometry.getAttribute('position'),
      profile = object.geometry.getAttribute('gpTyreBind'),
      indent = (shader.uniforms.gpFootSquash?.value as T.Vector2 | undefined)?.getComponent(axle) ?? 0,
      plane = shader.uniforms[axle ? 'gpFootRear' : 'gpFootFront']?.value as T.Vector4 | undefined;
    if (plane && profile && indent > 0.00001) {
      localNormal.set(plane.x, plane.y, plane.z);
      expect(localNormal.dot(normal)).toBeCloseTo(1, 6);
      localNormal.transformDirection(new T.Matrix4().copy(object.matrixWorld).invert());
    }
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).sub(road);
      let clearance = normal.dot(point);
      if (plane && profile && profile.getW(i) > 0.025 && indent > 0.00001) {
        bind.fromBufferAttribute(profile, i);
        const h = localNormal.dot(bind) + plane.w;
        // Signed clearance of the flat footprint, with a rounded shoulder of
        // width 2r. Sidewall bulge lies entirely within the road plane.
        const r = Math.max(0.0001, 0.32 * indent);
        if (h <= -r) clearance -= h;
        else if (h < r) clearance += (r - h) ** 2 / (4 * r);
      }
      lowest = Math.min(lowest, clearance);
      vertices++;
    }
  });
  expect(vertices).toBeGreaterThan(100);
  return lowest;
}
function checkContacts(frame: Float32Array, model: Posed, tolerance = 0.004) {
  const projector = new GpTyreContactProjector(),
    front = new T.Vector4(),
    rear = new T.Vector4(),
    shape = new T.Vector4();
  if (model.definition.classId === 'gp-bike') {
    const arm = model.root.getObjectByName('GP tapered carbon rear swingarm')!,
      spec = model.definition.bike!,
      length = Math.hypot(spec.rearWheelRadius - spec.cgHeight + 0.13, spec.cgToRear - 0.2),
      end = new T.Vector3(0, 0, -length).applyMatrix4(arm.matrixWorld),
      axle = model.rearSpin.getWorldPosition(new T.Vector3());
    expect(axle.distanceTo(arm.getWorldPosition(new T.Vector3()))).toBeCloseTo(length, 8);
    expect(axle.distanceTo(end)).toBeLessThan(1e-7);
    expect(arm.scale.toArray()).toEqual([1, 1, 1]);
  }
  projector.project(
    frame,
    o,
    model.definition,
    model.root.position,
    model.root.quaternion,
    0,
    front,
    rear,
    shape,
  );
  for (const i of [0, 1]) {
    const p = wheelContactBase(o, i * 2),
      normal = new T.Vector3().fromArray(frame, p + BC.NORMAL_X),
      road = new T.Vector3().fromArray(frame, p + BC.X),
      expected = frame[p + BC.GAP] * normal.y,
      clearance = geometryClearance(
        i === 0 ? model.frontSpin : model.rearSpin,
        model.m.rubber,
        normal,
        road,
        i,
      ),
      patch = i === 0 ? front : rear;
    // Actual tyre vertices independently constrain the shared hub/shadow math.
    expect(clearance).toBeGreaterThanOrEqual(expected - 0.0001);
    expect(clearance).toBeLessThan(expected + tolerance);
    expect(normal.dot(new T.Vector3(patch.x, patch.z, patch.y).sub(road))).toBeCloseTo(0, 6);
    if (frame[p + BC.GAP] > 0.075) expect(patch.w).toBe(0);
    if (frame[p + BC.GAP] < 0.001) expect(patch.w).toBe(1);
  }
}

it.each(['gpr1', 'gpr2', 'sbk1000', 'ss600'])(
  'presents %s live sprung chassis and actual wheel geometry exactly once',
  (vehicle) => {
    stubCanvas();
    const { sim, bike } = fixture(vehicle);
    bike.body.velocity.y -= 1;
    for (let i = 0; i < 12; i++) sim.step(1 / 120);
    expect(bike.riding).toBe(true);
    const frame = sim.makeFrame();
    expect(hasRoadBikeContact(frame, o)).toBe(true);
    const pose = spyPose();
    const shells = new BikeShells();
    try {
      const { model, host } = render(shells, pose, frame);
      const actual = model.sprung.getWorldPosition(new T.Vector3());
      expect(actual.distanceTo(host.root.position)).toBeLessThan(1e-6);
      const rotation = model.sprung.getWorldQuaternion(new T.Quaternion());
      expect(1 - Math.abs(rotation.dot(host.root.quaternion))).toBeLessThan(1e-6);
      checkContacts(frame, model);
      expect(
        model.rider.root.getWorldPosition(new T.Vector3()).distanceTo(host.root.position),
      ).toBeLessThan(1e-6);
      if (model.definition.classId === 'gp-bike') {
        const eye = new T.Vector3(),
          direction = new T.Vector3();
        shells.onboard(host.root, eye, direction, false, model.definition);
        expect(
          model.sprung.worldToLocal(eye).distanceTo(new T.Vector3(...GP_ONBOARD.eye)),
        ).toBeLessThan(1e-7);
        for (let i = 0; i < 2; i++) {
          const hand = model.rider.root.getObjectByName(`GP ${i === 0 ? 'left' : 'right'} hand`)!;
          const grip = model.sprung.localToWorld(model.rider.grips[i].clone());
          expect(hand.localToWorld(new T.Vector3(...GP_GLOVE_GRIP)).distanceTo(grip)).toBeLessThan(
            1e-7,
          );
        }
      }
    } finally {
      shells.disposeAll();
    }
  },
);
