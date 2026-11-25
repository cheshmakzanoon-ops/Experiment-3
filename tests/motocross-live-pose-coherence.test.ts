import * as T from 'three';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { BikeShells } from '../src/rendering/bike.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine } from '../src/simulation/offroad/jump-rig.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import {
  B, BIKE_BASE, F, H, MX_MOTION, O, OFFROAD_BASE, W, WHEEL_BASE, WHEEL_STRIDE, carBase,
} from '../src/simulation/protocol.ts';
import { surfaceSample } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

beforeAll(() => {
  const context = new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 10 }) : () => undefined,
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
});
afterAll(() => vi.unstubAllGlobals());

const car = carBase(0), hz = 120, dt = 1 / hz;
const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, value));
const unit = new T.Vector3(1, 1, 1), up = new T.Vector3(0, 1, 0);
const rake = 0.47, axleOffset = 0.022, forkLength = 0.92;

/** Independent algebra of the existing authored mounts. This does not call
 * MotocrossAxles.hub/rearHub/lowerY or pose a second model as its oracle.
 * Stroke is vertical in the bike frame: the rake adds fore/aft travel, and
 * the rear axle follows a fixed-length arm about (0, -0.36, -0.15). */
function rig(definition: VehicleDefinition, fork: number, shock: number, steer: number, matrix: T.Matrix4) {
  const b = definition.bike!, sag = factoryBikeSag(definition);
  const df = clamp(fork, b.forkTravel) - sag.fork;
  const rearY = b.rearWheelRadius - b.cgHeight + clamp(shock, b.shockTravel) - sag.shock;
  const armLength = Math.hypot(b.rearWheelRadius - b.cgHeight + 0.36, b.cgToRear - 0.15);
  const front = new T.Vector3(
    axleOffset * Math.sin(steer),
    b.frontWheelRadius - b.cgHeight + df + Math.sin(rake) * axleOffset * (Math.cos(steer) - 1),
    b.cgToFront - Math.tan(rake) * df + Math.cos(rake) * axleOffset * (Math.cos(steer) - 1),
  ).applyMatrix4(matrix);
  const rear = new T.Vector3(0, rearY,
    -0.15 - Math.sqrt(armLength ** 2 - (rearY + 0.36) ** 2)).applyMatrix4(matrix);
  const frontAxis = new T.Vector3(Math.cos(steer),
    -Math.sin(rake) * Math.sin(steer), -Math.cos(rake) * Math.sin(steer)).transformDirection(matrix);
  const rearAxis = new T.Vector3(1, 0, 0).transformDirection(matrix);
  return { hubs: [front, rear], axes: [frontAxis, rearAxis], armLength };
}

function frameMatrix(frame: Float32Array) {
  return new T.Matrix4().compose(new T.Vector3().fromArray(frame, car + F.X),
    new T.Quaternion().fromArray(frame, car + F.QX), unit);
}

/** Rounded-tread support against the normal at the FORCE patch, without
 * assuming the authored hub's horizontal location equals that patch. */
function support(hub: T.Vector3, axle: T.Vector3, normal: T.Vector3, radius: number, width: number) {
  const lateral = normal.dot(axle), crown = width * 1.15;
  const side = Math.max(-width / crown, Math.min(width / crown, lateral));
  const radial = normal.clone().addScaledVector(axle, -lateral).normalize();
  return hub.clone().addScaledVector(radial, -(radius - crown + crown * Math.sqrt(1 - side ** 2)))
    .addScaledVector(axle, -crown * side);
}

function capture(sim: Simulation, bike: DirtBikeVehicle, tick: number) {
  const b = bike.definition.bike!, sag = factoryBikeSag(bike.definition);
  const sin = Math.sin(bike.pitch), cos = Math.cos(bike.pitch);
  const gaps = [
    bike.contacts[0].height - (bike.cgY + b.cgToFront * sin - (b.cgHeight + sag.fork) * cos),
    bike.contacts[2].height - (bike.cgY - b.cgToRear * sin - (b.cgHeight + sag.shock) * cos),
  ];
  const fork = clamp(gaps[0], b.forkTravel), shock = clamp(gaps[1], b.shockTravel);
  expect(bike.fork).toBeCloseTo(fork, 11);
  expect(bike.shock).toBeCloseTo(shock, 11);
  // These traces use neutral manual body input, so riderBody is exactly the
  // automatic posture. The visible root intentionally adds 0.06*body to the
  // physical 2-DOF pitch and lowers its CG when rolling on the tyre crown.
  expect(bike.input.riderLean ?? 0).toBe(0);
  const lean = bike.dynamics.lean + Math.asin(Math.max(-1, Math.min(1,
    b.crownRadius * Math.sin(bike.dynamics.lean) / (b.cgHeight - b.crownRadius))));
  const position = new T.Vector3(bike.dynamics.x,
    bike.cgY - (b.cgHeight - b.crownRadius) * (1 - Math.cos(lean)), bike.dynamics.z);
  const orientation = new T.Quaternion().setFromAxisAngle(up, bike.dynamics.heading + bike.airYaw)
    .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -(bike.pitch + bike.riderBody * 0.06)))
    .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), -lean));
  expect(position.distanceTo(new T.Vector3(bike.body.position.x, bike.body.position.y, bike.body.position.z)))
    .toBeLessThan(1e-11);
  const body = bike.body.orientation;
  expect(Math.hypot(orientation.x - body.x, orientation.y - body.y,
    orientation.z - body.z, orientation.w - body.w)).toBeLessThan(1e-12);
  const matrix = new T.Matrix4().compose(position, orientation, unit);
  const expected = rig(bike.definition, fork, shock, bike.dynamics.steer, matrix);
  const frame = sim.makeFrame();
  // The ordinary production frame writer observes an adapter driven directly
  // by rideLine; only its publication clock is supplied by this test rig.
  frame[H.TIME] = tick * dt;
  return { frame, expected, matrix, fork, shock, gaps,
    incoming: [bike.compressionFront, bike.compressionRear], bodyPitch: bike.riderBody * 0.06 };
}

function presenter(definition: VehicleDefinition) {
  const shells = new BikeShells(), view = new PresentedFrame();
  shells.prefitDirtService = false;
  const host = { root: new T.Object3D() }, camera = new T.PerspectiveCamera(58, 16 / 9);
  const sag = factoryBikeSag(definition), b = definition.bike!;
  let maximumRigError = 0, calls = 0;
  const show = (a: Float32Array, z: Float32Array, alpha: number, distance = 60) => {
    const shown = view.sample(a, z, alpha);
    host.root.position.fromArray(shown, car + F.X);
    host.root.quaternion.fromArray(shown, car + F.QX);
    camera.position.copy(host.root.position).add(new T.Vector3(0, 0, distance));
    shells.update(a, z, alpha, [host], camera, 'high', -1);
    const model = shells.motocrossPresentation(0)!;
    expect(shells.drawnRoot(0)).toBe(model.root);
    model.root.updateMatrixWorld(true);
    expect(model.sprung.matrixWorld.elements).toEqual(model.root.matrixWorld.elements);
    expect(model.root.position.toArray()).toEqual(host.root.position.toArray());
    expect(model.root.quaternion.toArray()).toEqual(host.root.quaternion.toArray());
    const front = model.root.getObjectByName('Motocross front spinning wheel')!;
    const rear = model.root.getObjectByName('Motocross rear suspension hub')!;
    const lower = model.root.getObjectByName('Motocross sliding fork lowers')!;
    const arm = model.root.getObjectByName('Motocross articulated swingarm')!;
    const fork = shown[car + BIKE_BASE + B.FORK], shock = shown[car + BIKE_BASE + B.SHOCK];
    const steer = shown[car + BIKE_BASE + B.STEER];
    const expected = rig(definition, fork, shock, steer, frameMatrix(shown));
    const hubs = [front.getWorldPosition(new T.Vector3()), rear.getWorldPosition(new T.Vector3())];
    for (let axle = 0; axle < 2; axle++) {
      const node = axle ? rear : front;
      const axis = new T.Vector3(1, 0, 0).transformDirection(node.matrixWorld);
      maximumRigError = Math.max(maximumRigError, hubs[axle].distanceTo(expected.hubs[axle]));
      expect(axis.distanceTo(expected.axes[axle])).toBeLessThan(1e-7);
      expect(hubs[axle].distanceTo(expected.hubs[axle])).toBeLessThan(1e-7);
    }
    expect(new T.Vector3(0, 0, -expected.armLength).applyMatrix4(arm.matrixWorld).distanceTo(hubs[1]))
      .toBeLessThan(1e-10);
    // Inspect the actual articulated joints, rather than merely trusting the
    // scalar handed to pose(). F32 PresentedFrame rounding is the only delta.
    const strokes = [sag.fork + (lower.position.y + forkLength) * Math.cos(rake),
      rear.position.y - (b.rearWheelRadius - b.cgHeight) + sag.shock];
    for (const [axle, field, wheel, travel] of [
      [0, B.FORK, 0, b.forkTravel], [1, B.SHOCK, 2, b.shockTravel],
    ]) {
      expect(strokes[axle]).toBeGreaterThanOrEqual(-1e-15);
      expect(strokes[axle]).toBeLessThanOrEqual(travel + 1e-15);
      expect(Math.abs(strokes[axle] - clamp(shown[car + BIKE_BASE + field], travel))).toBeLessThan(2e-8);
      for (const duplicate of [wheel, wheel + 1]) {
        const offset = car + WHEEL_BASE + duplicate * WHEEL_STRIDE;
        expect(shown[offset + W.COMPRESSION]).toBe(shown[car + BIKE_BASE + field]);
        expect(shown[offset + W.LENGTH] + shown[offset + W.COMPRESSION]).toBeCloseTo(travel + 0.2, 6);
      }
    }
    calls++;
    return { hubs, strokes, detail: model.detail,
      matrices: [model.root, model.sprung, lower, front, arm, rear].flatMap(node => node.matrixWorld.toArray()) };
  };
  return { show, dispose: () => shells.disposeAll(), metrics: () => ({ maximumRigError, calls }) };
}

const cases = (['mx250', 'mx450'] as const).flatMap(vehicle =>
  (['valley-ridge-mx', 'arena-nord-sx'] as const).flatMap(circuit =>
    (['jump', 'whoops'] as const).map(feature => ({ vehicle, circuit, feature })),
  ),
);

it.each(cases)('$vehicle $circuit $feature carries the current pose into real joints at both publication rates', ({
  vehicle, circuit, feature,
}) => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, vehicles: [vehicle], opponents: 0,
    ruleset: 'motocross-moto', mode: 'practice' });
  const bike = sim.cars[0] as DirtBikeVehicle, definition = bike.definition, b = definition.bike!;
  const track = sim.track, course = offroadCourse(track.circuit)!;
  const jump = course.jumps.find(item => item.name === (circuit === 'valley-ridge-mx' ? 'RIDGE TABLE' : 'TABLETOP'))!;
  const whoops = course.rough.find(item => item.kind === 'whoops')!;
  const speed = feature === 'jump' ? circuit === 'valley-ridge-mx' ? 13.5 : 13 : 8;
  bike.place(track, (feature === 'jump' ? jump.start : whoops.from) - 12);
  bike.dynamics.speed = speed;
  bike.gear = 3;
  const trace: ReturnType<typeof capture>[] = [];
  let airborne = 0, oneAxle = 0, takeoffs = 0, landings = 0, bodyPitch = 0;
  let maximumPitch = 0, maximumLean = 0, maximumSteer = 0;
  let incomingDifference = 0, filteredRigDifference = 0, supportPlaneDifference = 0, terrainDifference = 0;
  let worstSupport: Record<string, unknown> = {};
  let supportSamples = 0, filteredFork = bike.fork, filteredShock = bike.shock;
  const terrain = surfaceSample();
  for (let tick = 0; tick <= 6 * hz; tick++) {
    if (tick) {
      const flew = bike.airborne;
      if (!flew) rideLine(bike, track, feature === 'jump' && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
        ? Math.max(speed, bike.dynamics.speed) : speed);
      bike.step(dt, track);
      takeoffs += Number(!flew && bike.airborne);
      landings += Number(flew && !bike.airborne);
    }
    expect(bike.riding).toBe(true);
    const recorded = capture(sim, bike, tick);
    trace.push(recorded);
    airborne += Number(bike.airborne);
    oneAxle += Number((bike.forceFront > 0) !== (bike.forceRear > 0));
    bodyPitch = Math.max(bodyPitch, Math.abs(recorded.bodyPitch));
    maximumPitch = Math.max(maximumPitch, Math.abs(bike.pitch));
    maximumLean = Math.max(maximumLean, Math.abs(bike.dynamics.lean));
    maximumSteer = Math.max(maximumSteer, Math.abs(bike.dynamics.steer));
    incomingDifference = Math.max(incomingDifference, Math.abs(recorded.fork - recorded.incoming[0]),
      Math.abs(recorded.shock - recorded.incoming[1]));
    const blend = 1 - Math.exp(-dt / 0.02);
    filteredFork += (recorded.fork - filteredFork) * blend;
    filteredShock += (recorded.shock - filteredShock) * blend;
    const filtered = rig(definition, filteredFork, filteredShock, bike.dynamics.steer, recorded.matrix);
    for (let axle = 0; axle < 2; axle++) {
      filteredRigDifference = Math.max(filteredRigDifference,
        filtered.hubs[axle].distanceTo(recorded.expected.hubs[axle]));
      const contact = bike.contacts[axle * 2], travel = axle ? b.shockTravel : b.forkTravel;
      if (bike.airborne || (axle ? bike.forceRear : bike.forceFront) <= 1 ||
          recorded.gaps[axle] <= 0 || recorded.gaps[axle] >= travel) continue;
      const normal = new T.Vector3(contact.normal.x, contact.normal.y, contact.normal.z).normalize();
      const heading = bike.dynamics.heading + bike.airYaw, arm = axle ? -b.cgToRear : b.cgToFront;
      const forcePoint = new T.Vector3(bike.dynamics.x + Math.sin(heading) * arm, contact.height,
        bike.dynamics.z + Math.cos(heading) * arm);
      const patch = support(recorded.expected.hubs[axle], recorded.expected.axes[axle], normal,
        axle ? b.rearWheelRadius : b.frontWheelRadius, axle ? 0.06 : 0.042);
      supportPlaneDifference = Math.max(supportPlaneDifference, Math.abs(patch.clone().sub(forcePoint).dot(normal)));
      track.sample(patch.x, patch.z, terrain, contact.height);
      if (Math.abs(patch.y - terrain.height) > terrainDifference) {
        terrainDifference = Math.abs(patch.y - terrain.height);
        // Decompose the existing drawing/reduced-force mismatch: first use
        // the physical heave/pitch, then add the recorded posture/crown root
        // mapping. Neither term is a time delay in the outgoing stroke.
        const physicalMatrix = new T.Matrix4().compose(
          new T.Vector3(bike.dynamics.x, bike.cgY, bike.dynamics.z),
          new T.Quaternion().setFromAxisAngle(up, heading).multiply(
            new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -bike.pitch)), unit);
        const physicalRig = rig(definition, recorded.fork, recorded.shock, bike.dynamics.steer, physicalMatrix);
        const physicalPatch = support(physicalRig.hubs[axle], physicalRig.axes[axle], normal,
          axle ? b.rearWheelRadius : b.frontWheelRadius, axle ? 0.06 : 0.042);
        worstSupport = { tick, axle: axle ? 'rear' : 'front', pitch: bike.pitch, bodyPitch: recorded.bodyPitch,
          lean: bike.dynamics.lean, steer: bike.dynamics.steer, stroke: axle ? recorded.shock : recorded.fork,
          load: axle ? bike.forceRear : bike.forceFront, normal: normal.toArray(), forcePoint: forcePoint.toArray(),
          hub: recorded.expected.hubs[axle].toArray(), patch: patch.toArray(), terrainHeight: terrain.height,
          signedTerrainGap: patch.y - terrain.height,
          geometryNormalGap: physicalPatch.clone().sub(forcePoint).dot(normal),
          postureAndCrownNormalGap: patch.clone().sub(physicalPatch).dot(normal) };
      }
      supportSamples++;
    }
  }
  expect(bike.dynamics.crashes).toBe(0);
  expect(airborne).toBeGreaterThan(10);
  expect(oneAxle).toBeGreaterThan(5);
  expect(takeoffs).toBeGreaterThan(0);
  expect(landings).toBeGreaterThan(0);
  expect(bodyPitch).toBeGreaterThan(0.001);
  expect(incomingDifference).toBeGreaterThan(0.005);
  expect(filteredRigDifference).toBeGreaterThan(0.005);
  expect(supportSamples).toBeGreaterThan(100);

  const draw = presenter(definition);
  const results = new Map<number, ReturnType<typeof draw.show>[]>();
  const focus = new Set<number>();
  let nativeError = 0, recovered = 0, recoveredError = 0, envelopeError = 0;
  const accuracy: { publication: number; mean: number; maximum: number; worst: Record<string, unknown> }[] = [];
  try {
    for (const publication of [30, 60]) {
      const stride = hz / publication, samples: ReturnType<typeof draw.show>[] = [];
      let error = 0, maximum = 0;
      let worst: Record<string, unknown> = {};
      for (let tick = 1; tick < trace.length; tick++) {
        const end = Math.ceil(tick / stride) * stride, start = end - stride;
        const a = trace[start].frame, z = trace[end].frame, alpha = (tick - start) / stride;
        const actual = draw.show(a, z, alpha);
        samples.push(actual);
        expect(actual.detail).toBe('mid');
        for (let axle = 0; axle < 2; axle++) {
          const distance = actual.hubs[axle].distanceTo(trace[tick].expected.hubs[axle]);
          error += distance;
          if (distance > maximum) {
            maximum = distance;
            const frontLoad = car + WHEEL_BASE + W.LOAD;
            const rearLoad = car + WHEEL_BASE + 2 * WHEEL_STRIDE + W.LOAD;
            worst = { tick, axle: axle ? 'rear' : 'front', alpha,
              airborne: [a[car + OFFROAD_BASE + O.AIRBORNE], z[car + OFFROAD_BASE + O.AIRBORNE]],
              frontLoaded: [a[frontLoad] > 1, z[frontLoad] > 1], rearLoaded: [a[rearLoad] > 1, z[rearLoad] > 1],
              bottom: [a[car + OFFROAD_BASE + O.BOTTOM], z[car + OFFROAD_BASE + O.BOTTOM]],
              landingSpeed: [a[car + OFFROAD_BASE + O.LANDING_SPEED], z[car + OFFROAD_BASE + O.LANDING_SPEED]] };
          }
          if (tick === end) nativeError = Math.max(nativeError, distance);
          if (publication !== 30 || tick === end) continue;
          const field = car + BIKE_BASE + (axle ? B.SHOCK : B.FORK);
          const lo = Math.min(a[field], z[field]), hi = Math.max(a[field], z[field]);
          const truth = axle ? trace[tick].shock : trace[tick].fork, observed = actual.strokes[axle];
          if ((truth < lo - 1e-5 && observed < lo - 1e-5) || (truth > hi + 1e-5 && observed > hi + 1e-5)) {
            recovered++;
            recoveredError += Math.abs(truth - observed);
            envelopeError += truth < lo ? lo - truth : truth - hi;
            if (focus.size < 2) focus.add(end);
          }
        }
        if (publication === 30 && focus.size < 4 &&
            (a[car + OFFROAD_BASE + O.AIRBORNE] !== z[car + OFFROAD_BASE + O.AIRBORNE] ||
            (a[car + WHEEL_BASE + W.LOAD] > 1) !== (z[car + WHEEL_BASE + W.LOAD] > 1))) focus.add(end);
      }
      accuracy.push({ publication, mean: error / (samples.length * 2), maximum, worst });
      results.set(publication, samples);
    }
    // The exact publication endpoints are physical poses (including F32 root
    // quantisation), not filtered descendants of earlier model updates.
    expect(nativeError).toBeLessThan(5e-5);
    expect(recovered).toBeGreaterThan(2);
    expect(recoveredError).toBeLessThan(envelopeError);
    expect(accuracy[1].mean).toBeLessThan(accuracy[0].mean);
    let commonDifference = 0;
    for (let tick = 1; tick < trace.length; tick++) {
      const thirty = results.get(30)![tick - 1], sixty = results.get(60)![tick - 1];
      for (let axle = 0; axle < 2; axle++) commonDifference = Math.max(commonDifference,
        thirty.hubs[axle].distanceTo(sixty.hubs[axle]));
      if (tick % 4 === 0) expect(thirty.matrices).toEqual(sixty.matrices);
    }
    expect(focus.size).toBeGreaterThanOrEqual(2);
    for (const end of [...focus].reverse()) {
      const a = trace[end - 4].frame, z = trace[end].frame;
      for (const fraction of [0.125, 0.5, 0.875]) {
        const reference = draw.show(a, z, fraction);
        for (const [distance, detail] of [[2, 'high'], [500, 'far'], [60, 'mid']] as const) {
          const again = draw.show(a, z, fraction, distance);
          expect(again.detail).toBe(detail);
          expect(again.matrices).toEqual(reference.matrices);
        }
        // An unrelated endpoint and out-of-order query must not leave a
        // second suspension filter, LOD history or render-time clock behind.
        draw.show(trace.at(-1)!.frame, trace.at(-1)!.frame, 0.37);
        expect(draw.show(a, z, fraction).matrices).toEqual(reference.matrices);
        expect(draw.show(a, z, fraction).matrices).toEqual(reference.matrices);
      }
      expect(draw.show(z, z, 0.37).matrices).toEqual(draw.show(a, z, 1).matrices);
    }
    expect(trace.every(({ frame }) => Number.isFinite(frame[car + MX_MOTION.FORK_RATE]))).toBe(true);
    if (process.env.MX_POSE_REPORT) console.info(JSON.stringify({ vehicle, circuit, feature,
      ...draw.metrics(), nativeError, recovered, recoveredError, envelopeError, bodyPitch,
      incomingDifference, filteredRigDifference, supportPlaneDifference, terrainDifference, supportSamples,
      airborne, oneAxle, takeoffs, landings, maximumPitch, maximumLean, maximumSteer,
      worstSupport, commonDifference, accuracy }));
  } finally {
    draw.dispose();
  }
});
