import { openWorld } from '../src/simulation/open-world/world.ts';
import { OpenWorldTrack } from '../src/simulation/open-world/open-world-track.ts';
import { surfaceSample } from '../src/simulation/track.ts';
import * as T from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TrafficCars, TRAFFIC_CAPACITY } from '../src/rendering/traffic-cars.ts';
import {
  TRAFFIC_VISUAL_PROFILES,
  trafficBodyGeometry,
} from '../src/rendering/traffic-car-geometry.ts';
import {
  AmbientTraffic,
  TF,
  TRAFFIC_FLAG,
  TRAFFIC_HEADER,
  TRAFFIC_STRIDE,
  TRAFFIC_VERSION,
} from '../src/simulation/open-world/ambient-traffic.ts';
import { VEHICLES, vehicleIndex, type VehicleDefinition } from '../src/simulation/vehicles.ts';

const machines = [VEHICLES.rh3, VEHICLES.rs5];
type Pose = {
  id: number;
  machine: VehicleDefinition;
  x: number;
  z: number;
  yaw?: number;
  brake?: number;
  flags?: number;
  distance?: number;
  curvature?: number;
  pitch?: number;
  roll?: number;
};
function block(poses: Pose[], time = 0) {
  const data = new Float32Array(TRAFFIC_HEADER + poses.length * TRAFFIC_STRIDE);
  data[0] = poses.length;
  data[1] = time;
  data[2] = TRAFFIC_VERSION;
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i],
      offset = TRAFFIC_HEADER + i * TRAFFIC_STRIDE;
    data[offset + TF.CURVATURE] = p.curvature ?? 0;
    data[offset + TF.PITCH] = p.pitch ?? 0;
    data[offset + TF.ROLL] = p.roll ?? 0;
    data[offset + TF.ID] = p.id;
    data[offset + TF.VEHICLE] = vehicleIndex(p.machine.id);
    data[offset + TF.X] = p.x;
    data[offset + TF.Y] = 3;
    data[offset + TF.Z] = p.z;
    data[offset + TF.QY] = Math.sin((p.yaw ?? 0) / 2);
    data[offset + TF.QW] = Math.cos((p.yaw ?? 0) / 2);
    data[offset + TF.BRAKE] = p.brake ?? 0;
    data[offset + TF.FLAGS] = p.flags ?? 0;
    data[offset + TF.DISTANCE] = p.distance ?? 0;
  }
  return data;
}
const batches = (cars: TrafficCars) =>
  cars.root.children.filter((m): m is T.InstancedMesh => m instanceof T.InstancedMesh);
const bodyBatches = (cars: TrafficCars) => batches(cars).filter((m) => m !== cars.wheels);
const matrixAt = (mesh: T.InstancedMesh, index: number) => {
  const m = new T.Matrix4();
  mesh.getMatrixAt(index, m);
  return m;
};

describe('festival traffic visual geometry', () => {
  it('reduces the wheel batch only while every tyre is small on screen, including after photo zoom and seek', () => {
    const cars = new TrafficCars(),
      camera = new T.PerspectiveCamera(55, 16 / 9, 0.1, 5000);
    const pose = block([{ id: 1, machine: VEHICLES.rh3, x: 0, z: 0, distance: 5 }]);
    const near = cars.wheels.geometry;
    const render = (z: number, zoom = 1) => {
      camera.position.set(0, 3, z);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      cars.update(null, pose, 1, 0, 1, camera, 720);
      return cars.wheels.geometry;
    };
    expect(render(4)).toBe(near);
    const matrices = cars.wheels.instanceMatrix.array.slice(0, 64);
    const far = render(150);
    expect(far).not.toBe(near);
    expect(far.getAttribute('position').count).toBeLessThan(
      near.getAttribute('position').count * 0.32,
    );
    expect(cars.wheels.instanceMatrix.array.slice(0, 64)).toEqual(matrices);
    expect(render(150, 8)).toBe(near);
    expect(render(150)).toBe(far);
    expect(render(3)).toBe(near);
    expect(cars.root.children).toHaveLength(5);
    cars.dispose();
  });

  it('keeps a nearby car detailed without promoting the other 23 sets of wheels', () => {
    const cars = new TrafficCars(), cam = new T.PerspectiveCamera(55, 16 / 9, 0.1, 5000);
    cam.position.set(0, 1, 0);
    const poses = Array.from({ length: 24 }, (_, i) => ({
      id: i + 1, machine: machines[i % 2], x: i === 13 ? 0 : i * 1.6, z: i === 13 ? 3 : 140 + i,
      distance: i * 0.73, yaw: i * 0.05,
    }));
    const snapshots = block(poses);
    cars.update(null, snapshots, 1, 0.5, 0);
    const detailed = cars.diagnostics.wheelTriangles;
    const expected = Array.from({ length: 96 }, (_, i) => matrixAt(cars.wheels, i));
    cars.update(null, snapshots, 1, 0.5, 0, cam, 720);
    const far = cars.root.getObjectByName('Ambient traffic distant wheels (instanced)') as T.InstancedMesh;
    expect(cars.diagnostics.batches).toBe(6);
    expect(cars.wheels.count).toBe(4);
    expect(far.count).toBe(92);
    expect(cars.diagnostics.wheelTriangles / detailed).toBeLessThan(0.35);
    for (let i = 0; i < 4; i++) expect(matrixAt(cars.wheels, i).elements).toEqual(expected[52 + i].elements);
    for (let i = 0; i < 92; i++) expect(matrixAt(far, i).elements).toEqual(expected[i < 52 ? i : i + 4].elements);
    const reordered = block([...poses].reverse());
    cars.update(null, reordered, 1, 0.5, 0, cam, 720);
    expect(cars.wheels.count).toBe(4);
    for (let i = 0; i < 4; i++) expect(matrixAt(cars.wheels, i).elements).toEqual(expected[52 + i].elements);
    cam.position.set(2000, 400, 2000);
    cars.update(null, reordered, 1, 0.5, 0, cam, 720);
    expect(cars.wheels.count).toBe(96);
    expect(far.parent).toBeNull();
    expect(cars.diagnostics.batches).toBe(5);
    const released = vi.fn();
    far.addEventListener('dispose', released);
    cars.dispose();
    expect(released).toHaveBeenCalledTimes(1);
  });

  it('keeps five bounded batches and the previous per-car triangle budget while adding independent wheels', () => {
    const cars = new TrafficCars(),
      meshes = batches(cars),
      diagnostics = cars.diagnostics;
    expect(meshes).toHaveLength(5);
    expect(diagnostics.profiles).toBe(10);
    expect(diagnostics.morphTargets).toBe(9);
    expect(diagnostics.morphPayloadBytes).toBeLessThan(1_800_000);
    expect(diagnostics.trianglesPerCar).toBeLessThan(6000);
    for (const mesh of meshes) {
      expect(mesh.frustumCulled).toBe(false);
      for (const attr of [
        ...Object.values(mesh.geometry.attributes),
        ...Object.values(mesh.geometry.morphAttributes).flat(),
      ])
        for (const n of attr.array) expect(Number.isFinite(n)).toBe(true);
    }
    for (const mesh of bodyBatches(cars)) {
      expect(mesh.geometry.morphAttributes.position).toHaveLength(9);
      expect(mesh.geometry.morphAttributes.normal).toHaveLength(9);
      for (const attr of mesh.geometry.morphAttributes.position!)
        expect(attr.count).toBe(mesh.geometry.getAttribute('position').count);
      expect(mesh.morphTexture!.image.width).toBe(10);
      expect(mesh.morphTexture!.image.height).toBe(TRAFFIC_CAPACITY);
    }
    const glass = meshes.find((mesh) => mesh.name.includes('glazing'))!;
    expect(glass.material).not.toBe(cars.bodies.material);
    expect(cars.wheels.material).not.toBe(cars.bodies.material);
    expect(glass.instanceColor).toBeNull();
    expect(cars.wheels.instanceColor).toBeNull();
    expect(cars.wheels.castShadow).toBe(true);
    expect((cars.bodies.material as T.MeshPhysicalMaterial).clearcoat).toBeGreaterThan(0);
    cars.dispose();
  });

  it('preserves every visible corner across all ten compressed traffic morphs and the curved lamp circuits', () => {
    const cars = new TrafficCars();
    try {
      for (const [i, profile] of TRAFFIC_VISUAL_PROFILES.entries()) {
        const source = trafficBodyGeometry(profile);
        for (const [batch, key] of ['paint', 'glazing', 'trim', 'lamps'].entries()) {
          const part = source[key as keyof typeof source],
            g = bodyBatches(cars)[batch].geometry;
          const order = g.index!;
          expect(order.count).toBe(part.getAttribute('position').count);
          for (const name of ['position', 'normal'] as const) {
            const actual = i ? g.morphAttributes[name]![i - 1] : g.getAttribute(name);
            const expected = part.getAttribute(name);
            let max = 0;
            for (let j = 0; j < order.count; j++) {
              const k = order.getX(j);
              max = Math.max(
                max,
                Math.abs(expected.getX(j) - actual.getX(k)),
                Math.abs(expected.getY(j) - actual.getY(k)),
                Math.abs(expected.getZ(j) - actual.getZ(k)),
              );
            }
            expect(max, profile.vehicle.id + ' ' + key + ' ' + name).toBe(0);
          }
          part.dispose();
        }
      }
      expect(cars.diagnostics.morphPayloadBytes).toBeLessThan(1_050_000);
    } finally {
      cars.dispose();
    }
  });

  it('seats the stop lenses and bumper insert in front of every pressed tail panel', () => {
    const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
    try {
      for (const profile of TRAFFIC_VISUAL_PROFILES) {
        const g = trafficBodyGeometry(profile),
          s = profile.sheet,
          v = profile.vehicle;
        const paint = new T.Mesh(g.paint, material),
          trim = new T.Mesh(g.trim, material),
          lamps = new T.Mesh(g.lamps, material);
        const half = s.width / 2,
          wide = s.lamps.rear === 'bar' || s.lamps.rear === 'strip';
        const width = wide ? half * 0.61 : 0.32,
          lit = width * (wide ? 0.286 : 0.205);
        const centre = half * 0.78 - width * 0.48;
        const tail = v.wheelPositions[2][2] - s.overhang[1];
        const ray = new T.Raycaster();
        const first = (x: number, y: number) => {
          ray.set(new T.Vector3(x, y - v.halfExtents[1], tail - 0.5), new T.Vector3(0, 0, 1));
          return ray.intersectObjects([paint, trim, lamps], false)[0]?.object;
        };
        for (const side of [-1, 1]) {
          for (const unit of [-1, 0, 1])
            for (const within of [-0.31, 0, 0.31])
              expect(
                first(side * centre + unit * width * 0.295 + lit * within, s.tail - 0.105),
                v.id + ' stop lens',
              ).toBe(lamps);
          for (const station of [0.15, 0.42, 0.7])
            expect(
              first(station * half * side, s.floor + (s.tail - s.floor) * 0.25),
              v.id + ' bumper',
            ).toBe(trim);
        }
        for (const part of Object.values(g)) part.dispose();
      }
    } finally {
      material.dispose();
    }
  });

  it('uses the existing original sheets for distinct cabins, a pickup bed and registry-aligned open wheel arches', () => {
    const roofLengths = new Map<string, number>();
    for (const profile of TRAFFIC_VISUAL_PROFILES) {
      const geometry = trafficBodyGeometry(profile),
        def = profile.vehicle;
      const body = new T.Mesh(geometry.paint, new T.MeshBasicMaterial());
      body.updateMatrixWorld();
      const centreY = def.spec.wheelRadius - def.halfExtents[1];
      for (const side of [-1, 1])
        for (const wheel of [0, 2])
          for (const height of [0.1, def.spec.wheelRadius * 0.85]) {
            const ray = new T.Raycaster(
              new T.Vector3(side * 3, centreY + height, def.wheelPositions[wheel][2]),
              new T.Vector3(-side, 0, 0),
            );
            expect(
              ray.intersectObject(body),
              `${def.id} must not paint over its tyre aperture`,
            ).toHaveLength(0);
          }
      const middleZ = (def.wheelPositions[0][2] + def.wheelPositions[2][2]) / 2;
      const sillRay = new T.Raycaster(
        new T.Vector3(3, centreY + 0.05, middleZ),
        new T.Vector3(-1, 0, 0),
      );
      expect(sillRay.intersectObject(body).length, def.id).toBeGreaterThan(0);
      const bounds = geometry.paint.boundingBox!;
      expect(bounds.min.y, def.id).toBeGreaterThanOrEqual(-def.halfExtents[1]);
      expect(bounds.max.y, def.id).toBeCloseTo(
        profile.sheet.roof - def.halfExtents[1] - 0.024 / 9,
        2,
      );
      const cabin = profile.sheet.cabin;
      roofLengths.set(def.id, (cabin[2] - cabin[1]) * def.spec.wheelbase);
      for (const g of Object.values(geometry)) g.dispose();
      body.material.dispose();
    }
    expect(roofLengths.get('rh3')).toBeGreaterThan(roofLengths.get('rs5')!);
    expect(roofLengths.get('rp6')).toBeLessThan(roofLengths.get('rh3')!);
    expect(roofLengths.get('rd2')).toBe(0);
  });

  it('selects each turning car’s front and rear amber lenses independently and gives hazards both sides', () => {
    const cars = new TrafficCars();
    const frame = block([
      { id: 1, machine: machines[0], x: 0, z: 0, flags: TRAFFIC_FLAG.LEFT },
      { id: 2, machine: machines[1], x: 4, z: 0, flags: TRAFFIC_FLAG.RIGHT },
      { id: 3, machine: machines[0], x: 8, z: 0, flags: TRAFFIC_FLAG.RIGHT | TRAFFIC_FLAG.HAZARD },
    ]);
    cars.update(null, frame, 1, 0, 96);
    const side = cars.lamps.geometry.getAttribute('trafficSignalSide');
    expect([0, 1, 2].map((i) => side.getX(i))).toEqual([1, -1, 0]);
    const colour = new T.Color();
    for (let i = 0; i < 3; i++) {
      cars.lamps.getColorAt(i, colour);
      expect(colour.b).toBe(3);
    }
    const optics = cars.lamps.geometry;
    const position = optics.getAttribute('position'), circuit = optics.getAttribute('trafficLampCircuit');
    const sites = new Set<string>();
    for (let i = 0; i < circuit.count; i++) {
      if (circuit.getX(i) === 2) sites.add([Math.sign(position.getX(i)), Math.sign(position.getZ(i))].join(','));
    }
    expect(sites.size).toBe(4);
    const shader = { vertexShader: T.ShaderLib.basic.vertexShader } as T.WebGLProgramParametersWithUniforms;
    (cars.lamps.material as T.Material).onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.vertexShader).toContain('position.x * trafficSignalSide < 0.0');
    cars.dispose();
  });

  it('poses each body batch from the same id-matched snapshot and retains brake/hazard mapping', () => {
    const cars = new TrafficCars();
    const older = block([
      { id: 7, machine: machines[0], x: 0, z: 4 },
      { id: 42, machine: machines[1], x: 20, z: 8 },
    ]);
    const newer = block([
      { id: 42, machine: machines[1], x: 28, z: 16, yaw: Math.PI / 2, flags: TRAFFIC_FLAG.HAZARD },
      { id: 7, machine: machines[0], x: 8, z: 12, brake: 0.6 },
    ]);
    cars.update(older, newer, 0.25, 0, 0);
    const position = new T.Vector3(),
      orientation = new T.Quaternion(),
      scale = new T.Vector3();
    for (const mesh of bodyBatches(cars)) {
      expect(mesh.count).toBe(2);
      for (let i = 0; i < 2; i++) {
        matrixAt(mesh, i).decompose(position, orientation, scale);
        expect(position.x).toBeCloseTo(i === 0 ? 22 : 2, 5);
        expect(position.y).toBeCloseTo(3, 5);
        expect(position.z).toBeCloseTo(i === 0 ? 10 : 6, 5);
        const yaw = i === 0 ? Math.PI / 8 : 0;
        expect(
          Math.abs(
            orientation.dot(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw)),
          ),
        ).toBeCloseTo(1, 5);
        for (const axis of scale.toArray()) expect(axis).toBeCloseTo(1, 6);
      }
    }
    expect(cars.wheels.count).toBe(8);
    const colour = new T.Color();
    cars.lamps.getColorAt(0, colour);
    expect(colour.r).toBeCloseTo(0.38, 5);
    expect(colour.g).toBeCloseTo(0.28, 5);
    expect(colour.b).toBeCloseTo(3, 5);
    cars.lamps.getColorAt(1, colour);
    expect(colour.r).toBeCloseTo(0.38, 5);
    expect(colour.g).toBeCloseTo(2.6, 5);
    expect(colour.b).toBeCloseTo(0.12, 5);
    // The same held frame keeps its blink phase, even with a different render clock.
    cars.update(older, newer, 0.25, 1, 37.3);
    cars.lamps.getColorAt(0, colour);
    expect(colour.r).toBeCloseTo(2.53, 5);
    expect(colour.b).toBeCloseTo(3, 5);
    older[1] = newer[1] = 0.55;
    cars.update(older, newer, 0.25, 1, 0);
    cars.lamps.getColorAt(0, colour);
    expect(colour.b).toBeCloseTo(0.12, 5);
    const optics = cars.lamps.geometry;
    const channels = optics.getAttribute('trafficLampCircuit');
    expect(channels.count).toBe(optics.getAttribute('position').count);
    expect(new Set(channels.array)).toEqual(new Set([0, 1, 2]));
    for (let i = 0; i < channels.count; i++) {
      const z = optics.getAttribute('position').getZ(i);
      if (channels.getX(i) === 0) expect(z).toBeGreaterThan(0);
      if (channels.getX(i) === 1) expect(z).toBeLessThan(0);
    }
    // The reordered sedan retains its own silhouette; the hatch is the base.
    const target = new T.Mesh(cars.bodies.geometry);
    cars.bodies.getMorphAt(0, target);
    expect(target.morphTargetInfluences![0]).toBe(1);
    cars.bodies.getMorphAt(1, target);
    expect(target.morphTargetInfluences!.every((x) => x === 0)).toBe(true);
    (target.material as T.Material).dispose();
    cars.dispose();
  });

  it('puts all wheels at the registry axles with circular tyres and the correct forward rolling sign', () => {
    const cars = new TrafficCars(),
      def = VEHICLES.rp6,
      radius = def.spec.wheelRadius;
    const frame = block([{ id: 1, machine: def, x: 0, z: 0, distance: (radius * Math.PI) / 2 }]);
    cars.update(null, frame, 1, 0, 0);
    const p = new T.Vector3(),
      q = new T.Quaternion(),
      scale = new T.Vector3();
    for (let i = 0; i < 4; i++) {
      matrixAt(cars.wheels, i).decompose(p, q, scale);
      expect(p.x).toBeCloseTo(def.wheelPositions[i][0], 6);
      expect(p.z).toBeCloseTo(def.wheelPositions[i][2], 6);
      expect(p.y - radius).toBeCloseTo(3 - def.halfExtents[1], 6);
      expect(scale.y).toBeCloseTo(radius, 6);
      expect(scale.z).toBeCloseTo(radius, 6);
      // With +Z forward, +X wheel rotation moves a bottom marker toward -Z.
      const bottom = new T.Vector3(0, -1, 0).applyQuaternion(q);
      expect(bottom.z).toBeCloseTo(-1, 5);
    }
    cars.dispose();
  });

  it('derives Ackermann front steering from movement while rear axles stay straight', () => {
    const cars = new TrafficCars(),
      def = VEHICLES.rs5;
    const a = block(
      [{ id: 1, machine: def, x: 0, z: 0, yaw: 0, distance: 10, curvature: 0.06 }],
      1,
    );
    const b = block(
      [{ id: 1, machine: def, x: 0.1, z: 2, yaw: 0.12, distance: 12, curvature: 0.06 }],
      1.2,
    );
    cars.update(a, b, 1, 0, 1.2);
    const axis = new T.Vector3(1, 0, 0),
      q = new T.Quaternion(),
      p = new T.Vector3(),
      scale = new T.Vector3();
    const headings: number[] = [];
    for (let i = 0; i < 4; i++) {
      matrixAt(cars.wheels, i).decompose(p, q, scale);
      const axle = axis.clone().applyQuaternion(q);
      headings.push(Math.atan2(-axle.z, axle.x) - 0.12);
    }
    expect(headings[0]).toBeGreaterThan(0);
    expect(headings[1]).toBeGreaterThan(headings[0]); // inner left tyre steers farther
    expect(headings[1]).toBeLessThanOrEqual(def.spec.maxSteer);
    expect(headings[2]).toBeCloseTo(0, 6);
    expect(headings[3]).toBeCloseTo(0, 6);
    cars.dispose();
  });

  it('has identical wheel matrices on held frames, reordered ids and a fresh replay seek', () => {
    const cars = new TrafficCars(),
      replay = new TrafficCars(),
      def = machines[0];
    const a = block([{ id: 5, machine: def, x: 0, z: 0, distance: 20 }], 2);
    const b = block([{ id: 5, machine: def, x: 0, z: 2, distance: 22 }], 2.2);
    cars.update(a, b, 0.4, 0, 2.1);
    const held = Array.from(cars.wheels.instanceMatrix.array.slice(0, 64));
    cars.update(a, b, 0.4, 1, 1000);
    expect(Array.from(cars.wheels.instanceMatrix.array.slice(0, 64))).toEqual(held);
    cars.update(
      null,
      block([{ id: 99, machine: machines[1], x: 90, z: 200, distance: 50 }]),
      1,
      0,
      2000,
    );
    cars.update(a, b, 0.4, 0, 0);
    replay.update(a, b, 0.4, 0, 0);
    expect(Array.from(cars.wheels.instanceMatrix.array.slice(0, 64))).toEqual(held);
    expect(Array.from(replay.wheels.instanceMatrix.array.slice(0, 64))).toEqual(held);
    cars.dispose();
    replay.dispose();
  });

  it('preserves sprung body motion, tyre contact and recorded steering on a single held frame', () => {
    const cars = new TrafficCars(),
      def = VEHICLES.sc7;
    const frame = block(
      [{ id: 31, machine: def, x: 5, z: 7, curvature: 0.065, pitch: 0.026, roll: -0.04 }],
      12,
    );
    const neutral = frame.slice();
    neutral[TRAFFIC_HEADER + TF.PITCH] = neutral[TRAFFIC_HEADER + TF.ROLL] = 0;
    cars.update(null, neutral, 1, 0, 0);
    const wheels = Array.from({ length: 4 }, (_, wheel) => matrixAt(cars.wheels, wheel));
    const ground = 3 - Math.max(0.5, def.halfExtents[1]);
    for (const w of wheels) {
      const v = new T.Vector3().setFromMatrixPosition(w);
      expect(v.y - def.spec.wheelRadius).toBeCloseTo(ground, 5);
    }
    cars.update(null, frame, 1, 0, 999);
    const bodyPose = matrixAt(cars.bodies, 0),
      tilt = new T.Quaternion();
    bodyPose.decompose(new T.Vector3(), tilt, new T.Vector3());
    expect(
      Math.abs(tilt.dot(new T.Quaternion().setFromEuler(new T.Euler(0.026, 0, -0.04, 'ZXY')))),
    ).toBeCloseTo(1, 6);
    for (let w = 0; w < 4; w++)
      expect(matrixAt(cars.wheels, w).elements).toEqual(wheels[w].elements);
    const frontForward = new T.Vector3(0, 0, 1).transformDirection(wheels[0]);
    expect(frontForward.x).toBeGreaterThan(0.1);
    cars.update(frame, frame, 0.2, 0, -4);
    expect(matrixAt(cars.bodies, 0).elements).toEqual(bodyPose.elements);
    // Version two stores the same identity, wheel phase and road pose without the sprung fields.
    const v2 = frame.slice(0, TRAFFIC_HEADER + 13);
    v2[2] = 2;
    cars.update(null, v2, 1, 0, 0);
    expect(cars.count).toBe(1);
    expect(matrixAt(cars.bodies, 0).elements).toEqual(
      new T.Matrix4().makeTranslation(5, ground + def.halfExtents[1], 7).elements.map(Math.fround),
    );
    cars.dispose();
  });

  it('places the tyres from real low-car traffic snapshots on the cambered carriageway', () => {
    const world = openWorld(),
      net = world.network;
    const edge = net.edges.find((e) => e.roadClass === 'highway' && e.length > 800)!;
    const road = new OpenWorldTrack(world),
      traffic = new AmbientTraffic(net, 37, { maxCars: 0, perTile: 0 });
    const entry = traffic.place(edge.index, 1, edge.length * 0.4, 0, 'sc7');
    const cars = new TrafficCars(),
      frame = traffic.writeSnapshot();
    cars.update(null, frame, 1, 0, 0);
    for (let i = 0; i < 4; i++) {
      const bottom = new T.Vector3(0, -1, 0).applyMatrix4(matrixAt(cars.wheels, i));
      const contact = road.sample(bottom.x, bottom.z, surfaceSample(), entry.position.y);
      expect(Math.abs(bottom.y - contact.height), `wheel ${i}`).toBeLessThan(0.025);
    }
    cars.dispose();
  });

  it('keeps capacity, rejects old/truncated frames, clears absent traffic and disposes every owned asset once', () => {
    const cars = new TrafficCars(),
      meshes = batches(cars);
    const full = block(
      Array.from({ length: TRAFFIC_CAPACITY + 3 }, (_, i) => ({
        id: i,
        machine: machines[0],
        x: i * 10,
        z: 0,
      })),
    );
    cars.update(null, full, 1, 1, 0);
    expect(cars.count).toBe(TRAFFIC_CAPACITY);
    for (const mesh of bodyBatches(cars)) expect(mesh.count).toBe(TRAFFIC_CAPACITY);
    expect(cars.wheels.count).toBe(TRAFFIC_CAPACITY * 4);
    const stale = full.slice();
    stale[2] = 1;
    for (const invalid of [null, stale, full.subarray(0, full.length - 1)]) {
      cars.update(null, invalid, 1, 1, 0);
      expect(cars.count).toBe(0);
      for (const mesh of meshes) expect(mesh.count).toBe(0);
    }
    let geometryDisposals = 0,
      materialDisposals = 0,
      morphDisposals = 0;
    for (const mesh of meshes) {
      mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
      (mesh.material as T.Material).addEventListener('dispose', () => materialDisposals++);
      mesh.morphTexture?.addEventListener('dispose', () => morphDisposals++);
    }
    cars.dispose();
    expect(geometryDisposals).toBe(5);
    expect(materialDisposals).toBe(5);
    expect(morphDisposals).toBe(4);
    expect(cars.root.children).toHaveLength(0);
  });
});
