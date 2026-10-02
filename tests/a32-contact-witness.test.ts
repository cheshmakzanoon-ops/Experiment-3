import { expect, it } from 'vitest';
import * as T from 'three';
import { measureA32Contact } from '../e2e/fixtures/a32-contact-witness.ts';
import { A32JackPose, type JackRole } from '../src/rendering/a32-jack-pose.ts';

const fit = [0, -0.3559, 2.8] as const;
const ground = new T.Vector3(0, -0.43, 3);

it('keeps the original precise contact requirement before clearance, including a still-raised jack', () => {
  for (const role of ['front', 'rear'] as const)
    for (const [phase, clock, height] of [
      [2, 0.3, 0],
      [3, 1.5, 0.19],
      [4, 3.3, 0.19],
      [5, 4.6, 0],
      [5, 9, 0.001],
    ]) {
      const floor = ground.clone().setY(-0.43 - height);
      const row = measureA32Contact(role, phase, clock, height, new T.Vector3(...fit), fit, floor);
      expect(row.state).toBe('contact');
      expect(row.error).toBe(0);
      expect(row.carContactError).toBe(0);
      expect(row.floorError).toBe(0);
      const early = new T.Vector3(...fit).add(new T.Vector3(0.05, 0, 0));
      expect(measureA32Contact(role, phase, clock, height, early, fit, floor).error).toBeCloseTo(
        0.05,
      );
    }
});

it('measures actual native pad and ground sockets against independent start/mid/end clearance anchors', () => {
  for (const role of ['front', 'rear'] as const) {
    const sign = role === 'front' ? 1 : -1;
    const fit = (role === 'front' ? [0, -0.3559, 2.8] : [0, -0.313, -2.25]) as [
      number,
      number,
      number,
    ];
    for (const [clock, distance] of [
      [4.72, 0],
      [4.935, 0.775],
      [5.15, 1.55],
      [20, 1.55],
    ]) {
      const pose = new A32JackPose().set(role, fit, -0.43).withdraw(sign * distance);
      const row = measureA32Contact(role, 5, clock, 0, pose.contact, fit, pose.wheels[0]);
      expect(row.error).toBeLessThan(1e-10);
      expect(row.floorError).toBeLessThan(1e-10);
      expect(row.expectedOffset).toBeCloseTo(sign * distance, 10);
      expect(row.carContactError).toBeCloseTo(distance, 10);
    }
  }
});

it('rejects missing, reversed, early, vertical and longitudinal withdrawal errors instead of widening tolerances', () => {
  const samples = [
    { phase: 5, time: 5.15, height: 0, delta: [0, 0, 0] },
    { phase: 5, time: 5.15, height: 0, delta: [-1.55, 0, 0] },
    { phase: 4, time: 5.15, height: 0, delta: [1.55, 0, 0] },
    { phase: 5, time: 5.15, height: 0.01, delta: [1.55, 0, 0] },
    { phase: 5, time: 5.15, height: 0, delta: [1.55, 0.01, 0] },
    { phase: 5, time: 5.15, height: 0, delta: [1.55, 0, 0.01] },
  ];
  for (const s of samples) {
    const actual = new T.Vector3(...fit).add(new T.Vector3(...s.delta));
    expect(
      measureA32Contact('front', s.phase, s.time, s.height, actual, fit, ground).error,
    ).toBeGreaterThan(1e-5);
  }
  const correctPad = new T.Vector3(...fit).add(new T.Vector3(1.55, 0, 0));
  expect(
    measureA32Contact(
      'front',
      5,
      5.15,
      0,
      correctPad,
      fit,
      ground.clone().add(new T.Vector3(0, 0.01, 0)),
    ).floorError,
  ).toBeCloseTo(0.01);
});

it('rejects invalid witness inputs rather than turning them into passing NaN comparisons', () => {
  for (const value of [NaN, Infinity, -1])
    expect(() =>
      measureA32Contact('front', 5, value, 0, new T.Vector3(...fit), fit, ground),
    ).toThrow();
  expect(() =>
    measureA32Contact('invalid' as JackRole, 5, 5, 0, new T.Vector3(...fit), fit, ground),
  ).toThrow();
  expect(() =>
    measureA32Contact('front', 5, 5, 0, new T.Vector3(NaN, 0, 0), fit, ground),
  ).toThrow();
});

it('accepts real uploaded jack matrices through lifting, lowering and full withdrawal on both circuits', async () => {
  const { readFileSync } = await import('node:fs');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { decodePitJacks, PIT_JACKS } = await import('../src/rendering/a32-pit-jacks.ts');
  const { PitCrewView } = await import('../src/rendering/pit-crew.ts');
  const { Simulation } = await import('../src/simulation/world.ts');
  const { DEFAULT_OPTIONS } = await import('../src/simulation/config.ts');
  const { F, carBase } = await import('../src/simulation/protocol.ts');
  for (const circuit of ['aurel', 'vellamar'] as const) {
    const loader = new GLTFLoader().register(() => ({
      name: 'A32_CONTACT_WITNESS_TEXTURE_STUB',
      loadTexture: () =>
        Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
    }));
    const jacks = await decodePitJacks(
      new Uint8Array(readFileSync(`public/${PIT_JACKS.url}`)),
      loader,
    );
    const crew = new PitCrewView();
    const fits = {
      front: [0, -0.3559, 2.8],
      rear: [0, -0.313, -2.25],
      source: 'supplied-player',
    } as const;
    crew.installPitJacks(jacks);
    crew.setPitJackFits(0, fits);
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit,
      mode: 'practice',
      opponents: 0,
      seed: 1887,
    });
    sim.autoPlayer = true;
    sim.cars[0].pitRequested = true;
    const camera = new T.Vector3();
    const car = new T.Object3D();
    const rows: ReturnType<typeof measureA32Contact>[] = [];
    let next = 0.3;
    try {
      for (let tick = 0; tick < 260 * 120; tick++) {
        sim.step(1 / 120);
        const vehicle = sim.cars[0];
        if (vehicle.pitPhase < 2 || vehicle.pitPhase > 5) continue;
        if (vehicle.pitClock < next && vehicle.pitClock < 5.15) continue;
        const frame = sim.makeFrame(),
          before = frame.slice(),
          o = carBase(0);
        camera.fromArray(frame, o + F.X);
        crew.update(frame, camera);
        car.position.copy(camera);
        car.quaternion.fromArray(frame, o + F.QX).normalize();
        car.updateMatrix();
        const inverse = car.matrix.clone().invert();
        for (const [slot, role] of [
          [0, 'rear'],
          [1, 'front'],
        ] as const) {
          const padMatrix = new T.Matrix4().fromArray(jacks.matrices, (slot * 4 + 2) * 16);
          const baseMatrix = new T.Matrix4().fromArray(jacks.matrices, slot * 4 * 16);
          const prefix = `SOCKET_A32_${role.toUpperCase()}`;
          const actual = jacks.prototype
            .getObjectByName(`${prefix}_CONTACT`)!
            .position.clone()
            .applyMatrix4(padMatrix)
            .applyMatrix4(inverse);
          const ground = jacks.prototype
            .getObjectByName(`${prefix}_GROUND`)!
            .position.clone()
            .applyMatrix4(baseMatrix)
            .applyMatrix4(inverse);
          const row = measureA32Contact(
            role,
            frame[o + F.PIT_PHASE],
            frame[o + F.PIT_CLOCK],
            frame[o + F.JACK_HEIGHT],
            actual,
            fits[role],
            ground,
          );
          expect(row.error, `${circuit}/${role}/${row.clock}`).toBeLessThan(1e-5);
          expect(row.floorError).toBeLessThan(1e-5);
          rows.push(row);
        }
        expect(frame).toEqual(before);
        next += 0.28;
        if (vehicle.pitPhase === 5 && vehicle.pitClock >= 5.15) break;
      }
      for (const role of ['front', 'rear']) {
        const part = rows.filter((r) => r.role === role);
        expect(part.some((r) => r.state === 'contact' && r.height > 0.18)).toBe(true);
        expect(part.some((r) => r.phase === 5 && r.height > 1e-6)).toBe(true);
        expect(part.some((r) => r.carContactError > 0.05 && r.carContactError < 0.2)).toBe(true);
        expect(part.some((r) => Math.abs(r.observedOffset) > 1.54999)).toBe(true);
      }
    } finally {
      crew.dispose();
      jacks.dispose();
    }
  }
}, 30000);
