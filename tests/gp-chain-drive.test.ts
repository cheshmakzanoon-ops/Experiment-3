import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  gpChainLoad,
  gpChainPin,
  gpChainSag,
  GPChainDrive,
} from '../src/rendering/gp-chain-drive.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
} from '../src/simulation/protocol.ts';
import { ChainLoop } from '../src/rendering/chain-geometry.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const material = () => new T.MeshStandardMaterial();
const positions = (mesh: T.InstancedMesh) => {
  const m = new T.Matrix4();
  const items: string[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    items.push([m.elements[12], m.elements[13], m.elements[14]].map((n) => n.toFixed(5)).join(','));
  }
  return items.sort();
};

describe('GP-R1 high-detail instanced, replay-deterministic chain drive', () => {
  it('machines five open carrier windows and deep wrench sockets into the rotating sprocket', () => {
    const m = material(),
      chain = new GPChainDrive(0.575, m, m, m);
    const gear = chain.sprocket;
    gear.updateMatrixWorld(true);
    const face = (radius: number, angle: number) =>
      new T.Raycaster(
        new T.Vector3(gear.position.x + 0.1, radius * Math.sin(angle), -radius * Math.cos(angle)),
        new T.Vector3(-1, 0, 0),
      ).intersectObject(gear)[0];
    expect(face(0.01, 0)).toBeUndefined();
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 * i) / 5;
      expect(face(0.07, a + Math.PI / 5)).toBeUndefined();
      expect(face(0.099, a + Math.PI / 5).point.x - gear.position.x).toBeCloseTo(0.007, 6);
      expect(face(0.058, a).point.x - gear.position.x).toBeCloseTo(0.007, 6);
      expect(face(0.063, a).point.x - gear.position.x).toBeCloseTo(0.0115, 6);
    }
    const wall = new T.Raycaster(
      new T.Vector3(gear.position.x - 0.04, 0.07, 0),
      new T.Vector3(0, -1, 0),
    ).intersectObject(gear)[0];
    expect(wall.point.y).toBeGreaterThan(0.028);
    expect(wall.point.y).toBeLessThan(0.034);
    for (const mesh of [chain.rollers, chain.plates]) mesh.dispose();
    for (const mesh of [chain.rollers, chain.plates, chain.sprocket]) mesh.geometry.dispose();
    m.dispose();
  });
  it('puts the free length on the return span under drive and on the upper span on overrun', () => {
    const loop = new ChainLoop(0.575, 0.106, 0.046, 0.115);
    const sample = (d: number, load: number) =>
      loop.sample(d, new T.Vector3(), gpChainSag(load, true), gpChainSag(load, false));
    const U = loop.straightLength,
      A = loop.rearArcLength;
    expect(sample(U * 0.5, 1).y - sample(U * 0.5, -1).y).toBeCloseTo(0.016, 7);
    expect(sample(1.5 * U + A, -1).y - sample(1.5 * U + A, 1).y).toBeCloseTo(0.016, 7);
    for (const d of [0, U, U + 0.5 * A, U + A, 2 * U + A, loop.length - 0.01])
      expect(sample(d, 1).distanceTo(sample(d, -1))).toBeLessThan(1e-9);
    const pathLength = (load: number) => {
      let length = 0,
        previous = sample(0, load);
      for (let i = 1; i <= 1600; i++) {
        const next = sample((i * loop.length) / 1600, load);
        length += previous.distanceTo(next);
        previous = next;
      }
      return length;
    };
    expect(Math.abs(pathLength(1) - pathLength(-1))).toBeLessThan(0.000035);
    expect(Math.abs(pathLength(1) - pathLength(0))).toBeLessThan(0.000035);
  });
  it('reads signed plate torque in manual mode and separates automatic overrun from the foot brake', () => {
    const f = new Float32Array(CAR_STRIDE);
    const rear = WHEEL_BASE + 2 * WHEEL_STRIDE;
    f[F.ENGINE_TORQUE] = 100;
    expect(gpChainLoad(f, 0)).toBe(1);
    f[F.ENGINE_TORQUE] = 0;
    f[rear + W.FX] = -850;
    expect(gpChainLoad(f, 0)).toBe(-1);
    f[BIKE_BASE + B.REAR_BRAKE] = 0.8;
    expect(gpChainLoad(f, 0)).toBe(0);
    f[F.ENGINE_TORQUE] = 120;
    f[F.CLUTCH_PEDAL] = 1;
    expect(gpChainLoad(f, 0)).toBe(0);
    f[F.CLUTCH_ENGAGEMENT] = 1;
    f[F.CLUTCH_PEDAL] = 0;
    f[F.CLUTCH_TORQUE] = -27.5;
    expect(gpChainLoad(f, 0)).toBe(-0.5);
  });
  it('keeps both pin heads closed and the full barrel visible in twenty triangles', () => {
    const geometry = gpChainPin(),
      m = material(),
      mesh = new T.Mesh(geometry, m);
    expect(geometry.index!.count / 3).toBe(20);
    for (const side of [-1, 1]) {
      const end = new T.Raycaster(
        new T.Vector3(0.0003, side, 0.0007),
        new T.Vector3(0, -side, 0),
      ).intersectObject(mesh)[0];
      expect(end?.point.y).toBeCloseTo(side * 0.01275, 6);
      expect(end?.face?.normal.y).toBeCloseTo(side, 6);
    }
    const barrel = new T.Raycaster(new T.Vector3(1, 0, 0), new T.Vector3(-1, 0, 0)).intersectObject(
      mesh,
    )[0];
    expect(barrel?.point.x).toBeCloseTo(0.004, 6);
    geometry.dispose();
    m.dispose();
  });
  it('keeps the pin-lobed plate dimensions and the complete production chain inside its triangle budget', () => {
    const spec = VEHICLES.gpr1.bike!,
      arm = Math.hypot(spec.rearWheelRadius - spec.cgHeight + 0.13, -spec.cgToRear + 0.2),
      a = new GPChainDrive(arm, material(), material(), material());
    const plate = a.plates.geometry;
    plate.computeBoundingBox();
    const size = plate.boundingBox!.getSize(new T.Vector3()),
      centre = plate.boundingBox!.getCenter(new T.Vector3());
    expect(size.x).toBeCloseTo(0.0028, 7);
    expect(size.y).toBeCloseTo(0.0086, 7);
    expect(size.z).toBeCloseTo(0.015875 + 2 * 0.0043, 7);
    expect(centre.length()).toBeLessThan(1e-8);
    const normal = plate.getAttribute('normal');
    for (let i = 0; i < normal.count; i++)
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
    let expanded = 0;
    for (const mesh of [a.rollers, a.plates, a.sprocket]) {
      expanded +=
        ((mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3) *
        (mesh instanceof T.InstancedMesh ? mesh.count : 1);
    }
    expect(expanded).toBeLessThan(14000);
    expect((plate.index?.count ?? plate.getAttribute('position').count) / 3).toBeLessThanOrEqual(
      44,
    );
    for (const mesh of [a.rollers, a.plates, a.sprocket]) {
      if (mesh instanceof T.InstancedMesh) mesh.dispose();
      mesh.geometry.dispose();
    }
  });
  it('uses two instanced draws, a single 42-tooth metal sprocket and no transient clones', () => {
    const a = new GPChainDrive(0.52, material(), material(), material());
    expect(a.root.children).toEqual([a.rollers, a.plates]);
    expect(a.rollers.count).toBe(a.links);
    expect(a.plates.count).toBe(a.links * 2);
    expect(a.links).toBeGreaterThan(70);
    expect(a.sprocket.geometry.getAttribute('position').count).toBeGreaterThan(300);
    expect(a.root.name).toContain('animated');
    expect(a.rollers.castShadow).toBe(true);
    expect(a.plates.receiveShadow).toBe(true);
    for (const mesh of [a.rollers, a.plates, a.sprocket]) mesh.geometry.dispose();
  });
  it('replay seek returns to the same exact link positions and wheel modulo poses', () => {
    const a = new GPChainDrive(0.52, material(), material(), material());
    a.update(1.123);
    const original = Array.from(a.rollers.instanceMatrix.array);
    a.update(3.5);
    a.update(1.123);
    expect(Array.from(a.rollers.instanceMatrix.array)).toEqual(original);
    a.update(0);
    const atZero = positions(a.rollers);
    a.update(Math.PI * 2);
    expect(positions(a.rollers)).toEqual(atZero);
    for (const mesh of [a.rollers, a.plates, a.sprocket]) mesh.geometry.dispose();
  });
  it('bounds invalid swingarm geometry and guards against non-finite phase', () => {
    expect(() => new GPChainDrive(NaN, material(), material(), material())).toThrow(
      'Invalid GP motorcycle swingarm length',
    );
    const a = new GPChainDrive(0.52, material(), material(), material());
    a.update(Number.NaN);
    a.update(Number.POSITIVE_INFINITY);
    for (const value of a.rollers.instanceMatrix.array) expect(Number.isFinite(value)).toBe(true);
    for (const mesh of [a.rollers, a.plates, a.sprocket]) mesh.geometry.dispose();
  });
});
