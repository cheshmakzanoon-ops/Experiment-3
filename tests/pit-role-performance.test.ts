import { expect, it } from 'vitest';
import * as T from 'three';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { A32JackPose } from '../src/rendering/a32-jack-pose.ts';
import { decodePitJacks, PIT_JACKS } from '../src/rendering/a32-pit-jacks.ts';
import { PitCrewView, serviceWheelOffset } from '../src/rendering/pit-crew.ts';
import { pitJackClearance, PitFootwork, PitWheelTask } from '../src/rendering/pit-footwork.ts';
import {
  PIT_ROLE_ACTIONS,
  PitRolePerformance,
  type PitRole,
} from '../src/rendering/pit-role-performance.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import {
  H,
  F,
  W,
  HEADER,
  CAR_STRIDE,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import source from '../src/rendering/crew-performance.geometry.json' with { type: 'json' };

const roles = Object.keys(PIT_ROLE_ACTIONS) as PitRole[];
function frame(clock: number, cars = 1) {
  const f = new Float32Array(HEADER + cars * CAR_STRIDE);
  f[H.CARS] = cars;
  for (let car = 0; car < cars; car++) {
    const b = carBase(car);
    f[b + F.QW] = 1;
    f[b + F.X] = car * 7;
    f[b + F.Y] = 0.6;
    f[b + F.PIT_CLOCK] = clock;
    f[b + F.PIT_PHASE] = clock < 0.8 ? 2 : clock < 2.2 ? 3 : clock < 3.5 ? 4 : 5;
    f[b + F.JACK_HEIGHT] =
      clock < 3.5
        ? Math.min(0.19, Math.max(0, clock - 0.8) * 0.16)
        : Math.max(0, 0.19 - (clock - 3.5) * 0.16);
    for (let w = 0; w < 4; w++) f[b + WHEEL_BASE + w * WHEEL_STRIDE + W.LENGTH] = 0.3;
  }
  return f;
}
function buffers(view: PitCrewView) {
  const body = view.root.children[0] as T.InstancedMesh;
  const shader = {
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
    uniforms: {},
  };
  (body.material as T.Material).onBeforeCompile(
    shader as T.WebGLProgramParametersWithUniforms,
    {} as T.WebGLRenderer,
  );
  const uniforms = shader.uniforms as Record<string, { value: T.DataTexture }>;
  const bones = uniforms.crewBones.value.image.data as Float32Array;
  return Array.from(bones);
}

it('exports distinct removal, installation, both jack and release performances on the retained rig', () => {
  expect(Object.keys(source.clips)).toHaveLength(14);
  const hashes = roles.map((role) =>
    createHash('sha256')
      .update(JSON.stringify(source.clips[PIT_ROLE_ACTIONS[role].action]))
      .digest('hex'),
  );
  expect(new Set(hashes).size).toBe(6);
  for (const role of roles) {
    const clip = source.clips[PIT_ROLE_ACTIONS[role].action];
    expect(clip.duration).toBe(5.2);
    expect(clip.frames).toHaveLength(157);
    expect(clip.frames[0]).not.toEqual(clip.frames[45]);
  }
});

it('uses all six authored roles in actual uploaded service bones, without changing geometry or adding draws', () => {
  const view = new PitCrewView(),
    camera = new T.Vector3();
  const geometries = view.root.children.map((o) => (o as T.Mesh).geometry);
  try {
    for (const t of [0, 0.45, 0.8, 1.1, 1.7, 2.19, 2.2, 2.7, 3.3, 3.5, 4.2, 5.19, 11]) {
      const f = frame(t),
        before = f.slice();
      view.update(f, camera);
      const d = view.diagnostics();
      expect(d.actors).toBe(15);
      expect(f).toEqual(before);
      for (const role of roles) {
        const actors = d.roles.filter((r) => r.role === role);
        expect(actors).toHaveLength(['gun', 'remove', 'install'].includes(role) ? 4 : 1);
        for (const actor of actors) {
          expect(actor.action).toBe(PIT_ROLE_ACTIONS[role].action);
          expect(actor.actionTime).toBeCloseTo(Math.min(t, 5.2), 5);
          expect(actor.reachable).toEqual([true, true]);
          expect(actor.feetReachable).toEqual([true, true]);
          expect(actor.wristError).toBeLessThan(1e-5);
          expect(actor.gripError).toBeLessThan(1e-5);
          expect(actor.planted.some(Boolean)).toBe(true);
        }
      }
      expect(view.summary().activeDrawBatches).toBeLessThanOrEqual(7);
      expect(view.summary().boneTextureBytes).toBe(172800);
      expect(view.root.children.map((o) => (o as T.Mesh).geometry)).toEqual(geometries);
    }
  } finally {
    view.dispose();
  }
});

it('keeps a fixed support foot while translating and turning tyre handlers, gun operators and release personnel', () => {
  const feet = new PitFootwork(),
    route = new PitWheelTask();
  const actor = new T.Object3D();
  for (const role of ['gun', 'remove', 'install', 'release'] as const)
    for (const wheel of [0, 1, 2, 3]) {
      let previous: { feet: number[][]; planted: boolean[] } | undefined;
      for (let i = 0; i <= 1040; i++) {
        const t = i / 200,
          phase = t < 0.8 ? 2 : t < 2.2 ? 3 : t < 3.5 ? 4 : 5;
        const r = route.set(role, wheel, phase, t, 0, -0.25, -0.43);
        actor.position.copy(r.root);
        actor.rotation.set(0, r.yaw, 0);
        actor.updateMatrix();
        feet.set(
          role,
          wheel,
          phase,
          t,
          0,
          -0.43,
          role === 'remove' || role === 'install' ? 0.11 : 0.15,
          actor.matrix,
        );
        expect(feet.planted.some(Boolean), `${role}/${wheel}/${t}`).toBe(true);
        for (const foot of [0, 1] as const) {
          expect(feet.feet[foot].y).toBeGreaterThanOrEqual(-0.375 - 1e-9);
          if (previous?.planted[foot] && feet.planted[foot])
            expect(
              feet.feet[foot].distanceTo(new T.Vector3(...previous.feet[foot])),
              `${role}/${wheel}/${t}/${foot}`,
            ).toBeLessThan(1e-7);
        }
        previous = { feet: feet.feet.map((p) => p.toArray()), planted: [...feet.planted] };
      }
    }
});

it('holds at the current service phase and never loops a traffic-blocked release', () => {
  const p = new PitRolePerformance();
  for (const role of roles) {
    p.sample(role, 3, 99, 0.4);
    expect(p.sampler.time).toBe(2.2);
    p.sample(role, 4, 99, 0.4);
    expect(p.sampler.time).toBe(3.5);
    p.sample(role, 5, 5.2, 0.4);
    const held = p.sampler.rotations.map((q) => q.toArray());
    p.sample(role, 5, 125, 0.4);
    expect(p.sampler.rotations.map((q) => q.toArray())).toEqual(held);
  }
  for (const clock of [-1, NaN, Infinity])
    expect(() => p.sample('release', 5, clock, 0.08)).toThrow();
  expect(() => p.sample('remove', 1, 0.5, 0.35)).toThrow();
  expect(serviceWheelOffset(3, 1.9, 100)).toBe(0);
  expect(serviceWheelOffset(3, 1.9, 0)).toBeGreaterThan(0);
});

it('seeks all service roles without history, including holds, LOD changes and twelve simultaneous teams', () => {
  const view = new PitCrewView(),
    cam = new T.Vector3();
  try {
    const first = frame(1.85, 12);
    view.update(first, cam);
    const bones = buffers(view);
    const roles = view.diagnostics().roles;
    expect(roles).toHaveLength(180);
    view.update(frame(30, 12), cam);
    view.update(frame(0.3, 12), new T.Vector3(85, 0, 0));
    view.update(first, cam);
    expect(buffers(view)).toEqual(bones);
    expect(view.diagnostics().roles).toEqual(roles);
    const builds = view.summary().poseBuilds;
    view.update(first, cam);
    expect(view.summary().poseBuilds).toBe(builds);
    view.update(first, cam, false);
    expect(view.activeActors).toBe(0);
  } finally {
    view.dispose();
  }
});

it('performs all six roles during an actual requested stop, with unchanged snapshots and recorded rewinds', () => {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  sim.autoPlayer = true;
  sim.cars[0].pitRequested = true;
  const view = new PitCrewView(),
    camera = new T.Vector3(),
    recorded: Float32Array[] = [];
  const seen = new Set<string>();
  try {
    for (let tick = 0; tick < 220 * 120; tick++) {
      sim.step(1 / 120);
      const car = sim.cars[0];
      if (tick % 12 === 0 && car.pitPhase >= 2 && car.pitPhase <= 5) {
        const f = sim.makeFrame(),
          before = f.slice();
        camera.fromArray(f, carBase(0));
        view.update(f, camera);
        expect(f).toEqual(before);
        for (const actor of view.diagnostics().roles) {
          expect(actor.action).toBe(PIT_ROLE_ACTIONS[actor.role].action);
          expect(actor.reachable).toEqual([true, true]);
          expect(actor.feetReachable).toEqual([true, true]);
          seen.add(actor.role);
        }
        recorded.push(before);
      }
      if (car.pitStops === 1 && !car.inPit) break;
    }
    expect(sim.cars[0].pitStops).toBe(1);
    expect(sim.cars[0].inPit).toBe(false);
    expect([...seen].sort()).toEqual([...roles].sort());
    expect(recorded.length).toBeGreaterThan(40);
    for (const index of [5, 15, 25, 35]) {
      const f = recorded[index];
      camera.fromArray(f, carBase(0));
      view.update(f, camera);
      const pose = buffers(view);
      view.update(recorded.at(-1)!, camera);
      view.update(f, camera);
      expect(buffers(view)).toEqual(pose);
    }
  } finally {
    view.dispose();
  }
}, 30000);

it('lowers the real physical jack before release without changing the exchange instant or minimum service', () => {
  for (const circuit of ['aurel', 'vellamar'] as const) {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, mode: 'practice', opponents: 0 });
    const car = sim.cars[0],
      original = [...car.tires];
    sim.autoPlayer = true;
    car.pitRequested = true;
    let exchange = false,
      lowered = false,
      departed = false;
    for (let tick = 0; tick < 260 * 120; tick++) {
      sim.step(1 / 120);
      if (!exchange && car.tires[0] !== original[0]) {
        exchange = true;
        expect(car.pitPhase).toBe(4);
        expect(car.pitClock).toBeGreaterThanOrEqual(2.2);
        expect(car.pitClock).toBeLessThan(2.22);
        expect(car.tires.every((tyre, i) => tyre !== original[i])).toBe(true);
      }
      if (car.pitPhase === 5 && car.jackHeight === 0) lowered = true;
      if (car.pitPhase === 6) {
        expect(lowered).toBe(true);
        expect(car.jackHeight).toBe(0);
        expect(car.pitClock).toBeGreaterThanOrEqual(5.2);
        departed = true;
      }
      if (car.pitStops === 1 && !car.inPit) break;
    }
    expect({ exchange, lowered, departed }).toEqual({
      exchange: true,
      lowered: true,
      departed: true,
    });
    expect(car.pitStops).toBe(1);
    expect(car.inPit).toBe(false);
  }
}, 30000);

it('clears both real authored jacks only while lowered, with fixed support and reachable hands', async () => {
  const loader = new GLTFLoader().register(() => ({
    name: 'PIT_TEAM_CPU_TEXTURE_STUB',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
  const jacks = await decodePitJacks(
    new Uint8Array(readFileSync(`public/${PIT_JACKS.url}`)),
    loader,
  );
  const view = new PitCrewView(),
    camera = new T.Vector3(),
    feet = new PitFootwork();
  view.installPitJacks(jacks);
  view.setPitJackFits(0, {
    front: [0, -0.3559, 2.8],
    rear: [0, -0.313, -2.25],
    source: 'supplied-player',
  });
  try {
    for (let i = 0; i <= 100; i++) {
      const clock = 4.5 + i / 100,
        f = frame(clock);
      view.update(f, camera);
      for (const a of view.diagnostics().roles.filter((a) => a.role.endsWith('jack'))) {
        expect(a.reachable, `${a.role}/${clock}`).toEqual([true, true]);
        expect(a.feetReachable, `${a.role}/${clock}`).toEqual([true, true]);
        expect(a.planted.some(Boolean)).toBe(true);
        expect(a.gripError).toBeLessThan(1e-5);
        const x = a.root[12];
        expect(Math.abs(x)).toBeCloseTo(
          pitJackClearance(5, f[carBase(0) + F.PIT_CLOCK], f[carBase(0) + F.JACK_HEIGHT]),
          6,
        );
      }
    }
    expect(pitJackClearance(5, 5.2, 0.001)).toBe(0);
    expect(pitJackClearance(4, 5.2, 0)).toBe(0);
    expect(pitJackClearance(5, 4.6, 0)).toBe(0);
    expect(pitJackClearance(5, 5.2, 0)).toBe(1.55);
    for (const role of ['front', 'rear'] as const) {
      const target = (role === 'front' ? [0, -0.3559, 2.8] : [0, -0.313, -2.25]) as [
        number,
        number,
        number,
      ];
      const a = new A32JackPose().set(role, target, -0.43),
        b = new A32JackPose().set(role, target, -0.43).withdraw(1.1);
      for (let i = 0; i < 4; i++)
        expect(b.parts[i].elements[12] - a.parts[i].elements[12]).toBeCloseTo(1.1, 8);
      expect(b.contact.x - a.contact.x).toBe(1.1);
      expect(b.grips[0].x - a.grips[0].x).toBeCloseTo(1.1, 8);
      let previous: { positions: T.Vector3[]; planted: boolean[] } | undefined;
      for (let i = 0; i <= 130; i++) {
        feet.set(
          role === 'front' ? 'front-jack' : 'rear-jack',
          -1,
          5,
          4.6 + i / 200,
          0,
          -0.43,
          0.14,
          new T.Matrix4(),
        );
        for (const f of [0, 1] as const)
          if (previous?.planted[f] && feet.planted[f])
            expect(feet.feet[f].distanceTo(previous.positions[f])).toBeLessThan(1e-7);
        previous = { positions: feet.feet.map((p) => p.clone()), planted: [...feet.planted] };
      }
    }
  } finally {
    view.dispose();
    jacks.dispose();
  }
});

it('retains the shared meshes and all nine existing authored key definitions', () => {
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  expect(hash(source.meshes)).toBe(
    'e73e9e875c5363423e77db1f9409c3025410f646d7f346cdbd742c07bee4a6bf',
  );
  const author = readFileSync('scripts/author-crew-performance.py', 'utf8');
  const keys = author.slice(author.indexOf('IDLE='), author.indexOf('ACTIONS=')).trim();
  expect(createHash('sha256').update(keys).digest('hex')).toBe(
    '940f9e77d64ec2c6f264df2b19e530e761656c02a3eadd789d451faa933e4a01',
  );
});
