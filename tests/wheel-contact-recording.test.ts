import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import { Vec3 } from '../src/core/math.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { sampleWheelContact, wheelContactPose } from '../src/rendering/wheel-contact.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import {
  C,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  PROTOCOL_VERSION,
  WHEEL_CONTACT_BASE,
  WHEEL_CONTACT_SIZE,
  WHEEL_CONTACT_STRIDE,
  carBase,
  snapshotIncompatibility,
  wheelContactBase,
} from '../src/simulation/protocol.ts';
import type { Vehicle } from '../src/simulation/vehicle.ts';
import { writeWheelContact } from '../src/simulation/wheel-contact-state.ts';
import { Simulation } from '../src/simulation/world.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';

const car = carBase(0);

/** Distinct measured states on every wheel, including a bank, steer, camber
 * and authored axle offset. Three's quaternion transforms independently verify
 * the solver-to-renderer contact-frame mapping. */
function measuredContact(vehicle: Vehicle) {
  const q = new Quaternion().setFromEuler(new Euler(0.13, 0.4, -0.2));
  Object.assign(vehicle.body.orientation, { x: q.x, y: q.y, z: q.z, w: q.w });
  vehicle.body.orientation.rotate(new Vec3(0, 1, 0), vehicle.up);
  for (let wheel = 0; wheel < 4; wheel++) {
    const tire = vehicle.tires[wheel],
      normal = new Vector3(0.13 + wheel * 0.02, 1, -0.06).normalize(),
      hubLength = vehicle.spec.restLength - wheel * 0.006;
    vehicle.hub.contact[wheel] = 1;
    vehicle.hub.travel[wheel] = wheel * 0.006;
    vehicle.wheelSteering[wheel] = 0.08 * (wheel + 1);
    vehicle.wheelCamber[wheel] = -0.04 + 0.005 * wheel;
    vehicle.contacts[wheel].normal.set(normal.x, normal.y, normal.z);
    tire.load = 3000 + wheel * 200;
    tire.deflection = 0.01 + wheel * 0.002;
    tire.longitudinalDeflection = (wheel - 1.5) * 0.003;
    tire.lateralDeflection = (1.5 - wheel) * 0.005;
    const origin = vehicle.origins[wheel];
    origin.set(wheel, 1, -wheel);
    vehicle.contactPoints[wheel].set(
      origin.x - vehicle.up.x * hubLength - normal.x * (0.3 + wheel * 0.002),
      origin.y - vehicle.up.y * hubLength - normal.y * (0.3 + wheel * 0.002),
      origin.z - vehicle.up.z * hubLength - normal.z * (0.3 + wheel * 0.002),
    );
  }
}

function checkMeasured(frame: Float32Array, vehicle: Vehicle) {
  expect(frame[car + WHEEL_CONTACT_BASE]).toBe(15);
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = wheelContactBase(car, wheel),
      tire = vehicle.tires[wheel],
      rest =
        vehicle.spec.restLength +
        (wheel < 2 ? vehicle.setup.frontRide - 0.065 : vehicle.setup.rearRide - 0.075);
    expect(frame[p + C.LONGITUDINAL]).toBe(Math.fround(tire.longitudinalDeflection));
    expect(frame[p + C.LATERAL]).toBe(Math.fround(tire.lateralDeflection));
    expect(frame[p + C.RADIAL]).toBe(Math.fround(tire.deflection));
    expect(frame[p + C.HUB_LENGTH]).toBeCloseTo(rest - vehicle.hub.travel[wheel], 7);
    const wheelRotation = new Quaternion(
      vehicle.body.orientation.x,
      vehicle.body.orientation.y,
      vehicle.body.orientation.z,
      vehicle.body.orientation.w,
    )
      .multiply(
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), vehicle.wheelSteering[wheel]),
      )
      .multiply(
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -vehicle.wheelCamber[wheel]),
      );
    const normal = new Vector3().fromArray(frame, p + C.NORMAL_X).applyQuaternion(wheelRotation);
    const road = vehicle.contacts[wheel].normal;
    expect(normal.x).toBeCloseTo(road.x, 6);
    expect(normal.y).toBeCloseTo(road.y, 6);
    expect(normal.z).toBeCloseTo(road.z, 6);
    const axle = new Vector3(
      vehicle.origins[wheel].x,
      vehicle.origins[wheel].y,
      vehicle.origins[wheel].z,
    ).addScaledVector(
      new Vector3(vehicle.up.x, vehicle.up.y, vehicle.up.z),
      -frame[p + C.HUB_LENGTH],
    );
    const point = vehicle.contactPoints[wheel];
    const distance = axle.sub(new Vector3(point.x, point.y, point.z)).dot(normal);
    expect(frame[p + C.PLANE_DISTANCE]).toBeCloseTo(distance, 6);
  }
}

class Pages implements ReplayPageStore {
  pages = new Map<number, ReplayPage>();
  async put(page: ReplayPage) {
    this.pages.set(page.id, structuredClone(page));
  }
  async get(id: number) {
    const page = this.pages.get(id);
    if (!page) throw new Error('Missing replay page');
    return structuredClone(page);
  }
  async dispose() {
    this.pages.clear();
  }
}

function pose(index: number) {
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  frame[H.TIME] = 5 + index / 15;
  frame[car + F.QW] = 1;
  frame[car + WHEEL_CONTACT_BASE] = 15;
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = wheelContactBase(car, wheel);
    frame[p + C.LONGITUDINAL] = (index - 12) * 0.0004 + wheel * 0.0001;
    frame[p + C.LATERAL] = (12 - index) * 0.0003 - wheel * 0.0001;
    frame[p + C.RADIAL] = 0.01 + wheel * 0.002;
    frame[p + C.HUB_LENGTH] = 0.23 - wheel * 0.003;
    frame[p + C.NORMAL_Y] = 1;
    frame[p + C.PLANE_DISTANCE] = 0.325 - wheel * 0.002;
  }
  return frame;
}

describe('measured wheel contact recording', () => {
  it('writes physical displacement, rim position and road planes through the race writer', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
    measuredContact(sim.cars[0]);
    checkMeasured(sim.makeFrame(), sim.cars[0]);
  });

  it('writes the same physical contact through the festival writer', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'rh3', traffic: false });
    measuredContact(sim.cars[0]);
    checkMeasured(sim.makeFrame(), sim.cars[0]);
  });

  it('clears loaded banked contact immediately on placement, before another solver step', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
    const vehicle = sim.cars[0];
    for (let i = 0; i < 48; i++) sim.step(1 / 120);
    expect(vehicle.tires.some((tire) => tire.load > 1)).toBe(true);
    measuredContact(vehicle);
    expect(sim.makeFrame()[wheelContactBase(car, 0) + C.RADIAL]).toBeGreaterThan(0);
    for (const contact of vehicle.contacts) contact.normal.set(1, 0, 0);
    vehicle.place(sim.track, 0);
    const frame = sim.makeFrame();
    expect(frame[car + WHEEL_CONTACT_BASE]).toBe(15);
    for (let wheel = 0; wheel < 4; wheel++) {
      const p = wheelContactBase(car, wheel);
      expect(Array.from(frame.subarray(p, p + 3))).toEqual([0, 0, 0]);
      expect(Array.from(frame.subarray(p + C.NORMAL_X, p + C.NORMAL_Z + 1))).toEqual([0, 1, 0]);
      const rest =
        vehicle.spec.restLength +
        (wheel < 2 ? vehicle.setup.frontRide - 0.065 : vehicle.setup.rearRide - 0.075);
      expect(frame[p + C.HUB_LENGTH]).toBe(Math.fround(rest));
      expect(frame[p + C.PLANE_DISTANCE]).toBe(Math.fround(vehicle.tires[wheel].radius));
    }
  });

  it.each([
    ['gpr1', 'aurel'],
    ['mx450', 'valley-ridge-mx'],
  ] as const)(
    'does not label %s inherited car states as motorcycle measurements',
    (vehicle, circuit) => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        opponents: 0,
        mode: 'practice',
        vehicles: [vehicle],
        circuit,
      });
      const frame = sim.makeFrame();
      expect(
        Array.from(
          frame.subarray(car + WHEEL_CONTACT_BASE, car + WHEEL_CONTACT_BASE + WHEEL_CONTACT_SIZE),
        ),
      ).toEqual(Array(WHEEL_CONTACT_SIZE).fill(0));
    },
  );

  it('invalid physical data clears its wheel record without poisoning other wheels', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 });
    measuredContact(sim.cars[0]);
    const frame = sim.makeFrame();
    sim.cars[0].tires[1].lateralDeflection = NaN;
    writeWheelContact(frame, car, sim.cars[0]);
    expect(frame[car + WHEEL_CONTACT_BASE]).toBe(13);
    const p = wheelContactBase(car, 1);
    expect(Array.from(frame.subarray(p, p + WHEEL_CONTACT_STRIDE))).toEqual(
      Array(WHEEL_CONTACT_STRIDE).fill(0),
    );
    expect(Array.from(frame.subarray(car + WHEEL_CONTACT_BASE)).every(Number.isFinite)).toBe(true);
  });

  it('preserves the appended block in compact replay and rejects the earlier protocol', () => {
    const a = pose(0),
      b = pose(1),
      replay = new ReplayRecorder(1, 2);
    replay.append(a);
    replay.append(b);
    const left = replay.makeFrame(),
      right = replay.makeFrame();
    replay.sample(replay.duration / 2, left, right);
    const start = car + WHEEL_CONTACT_BASE;
    expect(left.subarray(start)).toEqual(a.subarray(start));
    expect(right.subarray(start)).toEqual(b.subarray(start));
    expect(PROTOCOL_VERSION).toBe(15);
    expect(snapshotIncompatibility(a, 14)).toContain('v14 is not supported');
  });

  it('reloads exact displacement and plane state across evicted page seams and reordered seeks', async () => {
    const pages = new Pages(),
      replay = new SessionReplay(1, pages, undefined, 2),
      originals: Float32Array[] = [];
    try {
      for (let i = 0; i < 24; i++) {
        const frame = pose(i);
        originals.push(frame.slice());
        replay.append(frame);
        if (i % 2 === 1) await replay.settle();
      }
      await replay.settle();
      expect(replay.diagnostics().cached).not.toContain(0);
      const a = replay.makeFrame(),
        b = replay.makeFrame();
      for (const index of [1, 15, 3, 1]) {
        replay.prepareSeek((index + 0.5) / 15);
        await replay.settle();
        expect(replay.sample((index + 0.5) / 15, a, b)).not.toBeNull();
        expect(a).toEqual(originals[index]);
        expect(b).toEqual(originals[index + 1]);
      }
    } finally {
      await replay.dispose();
    }
  });

  it('interpolates measured strains with bounded reversal, normalized planes, and replacement boundaries', () => {
    const a = pose(0),
      b = pose(1),
      p = wheelContactBase(car, 0);
    b[p + C.LONGITUDINAL] = -a[p + C.LONGITUDINAL];
    b[p + C.LATERAL] = -a[p + C.LATERAL];
    b[p + C.NORMAL_X] = 0.6;
    b[p + C.NORMAL_Y] = 0.8;
    const originalA = a.slice(),
      originalB = b.slice(),
      contact = wheelContactPose();
    sampleWheelContact(a, b, car, 0, 0.5, contact);
    expect(contact.valid).toBe(true);
    expect(contact.longitudinal).toBe(0);
    expect(contact.lateral).toBe(0);
    expect(Math.hypot(contact.normalX, contact.normalY, contact.normalZ)).toBeCloseTo(1, 12);
    const displayed = new PresentedFrame().sample(a, b, 0.5);
    expect(displayed[p + C.LONGITUDINAL]).toBe(0);
    expect(displayed[p + C.NORMAL_X]).toBe(Math.fround(contact.normalX));
    expect(a).toEqual(originalA);
    expect(b).toEqual(originalB);
    b[car + F.COMPOUND] = 1;
    sampleWheelContact(a, b, car, 0, 0.99, contact);
    expect(contact.longitudinal).toBe(a[p + C.LONGITUDINAL]);
    sampleWheelContact(a, b, car, 0, 1, contact);
    expect(contact.longitudinal).toBe(b[p + C.LONGITUDINAL]);
    b[car + F.X] = 100;
    sampleWheelContact(a, b, car, 0, 0.99, contact);
    expect(contact.hubLength).toBe(a[p + C.HUB_LENGTH]);
    expect(contact.normalX).toBe(a[p + C.NORMAL_X]);
  });

  it('holds an unknown endpoint and clears invalid directions or nonfinite strain', () => {
    const a = pose(0),
      b = pose(1),
      p = wheelContactBase(car, 0),
      out = wheelContactPose();
    b[car + WHEEL_CONTACT_BASE] = 14;
    expect(sampleWheelContact(a, b, car, 0, 0.5, out).longitudinal).toBe(a[p + C.LONGITUDINAL]);
    expect(sampleWheelContact(a, b, car, 0, 1, out)).toEqual(wheelContactPose());
    b[car + WHEEL_CONTACT_BASE] = 15;
    b[p + C.NORMAL_Y] = 0;
    b[p + C.NORMAL_X] = 1;
    expect(sampleWheelContact(a, b, car, 0, 1, out).valid).toBe(false);
    b[p + C.NORMAL_Y] = 1;
    b[p + C.LATERAL] = NaN;
    expect(sampleWheelContact(a, b, car, 0, 1, out)).toEqual(wheelContactPose());
  });
});
