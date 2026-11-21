import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { FestivalTrails } from '../src/rendering/open-world/festival-trails.ts';
import { HorizonGuidance } from '../src/rendering/open-world/horizon-guidance.ts';
import { Effects, PARTICLE_KIND } from '../src/rendering/effects.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { vehicleIndex, VEHICLES } from '../src/simulation/vehicles.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { resolveEvents } from '../src/simulation/open-world/festival-events.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import { ROAD_CLASSES } from '../src/simulation/open-world/region-data.ts';

function slidingFrame(time: number, z: number, vehicle = 'tc1') {
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.TIME] = time;
  frame[H.CARS] = 1;
  frame[o + F.QW] = 1;
  frame[o + F.Y] = 1;
  frame[o + F.Z] = z;
  frame[o + F.SPEED] = 25;
  frame[o + F.VZ] = 25;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
    frame[p + W.LOAD] = 2000;
    frame[p + W.SLIP] = 0.5;
    frame[p + W.SLIP_POWER] = 12000;
    frame[p + W.RADIUS] = 0.3;
    frame[p + W.LENGTH] = 0.3;
  }
  return frame;
}

describe('festival contact presentation', () => {
  it('breaks teleport ribbons, clears future marks on time reversal and keeps a bounded pool', () => {
    const trails = new FestivalTrails(),
      ground = () => 0;
    trails.update(slidingFrame(10, 0), ground);
    trails.update(slidingFrame(10.1, 1), ground);
    expect(trails.segments).toBe(4);
    const changed = trails.root.geometry.getAttribute('position') as T.BufferAttribute;
    expect(changed.updateRanges).toEqual([{ start: 0, count: 48 }]);
    trails.update(slidingFrame(10.2, 1000), ground);
    expect(trails.segments).toBe(4);
    const p = trails.root.geometry.getAttribute('position');
    expect(Math.max(...Array.from(p.array).slice(0, 48))).toBeLessThan(10);
    trails.update(slidingFrame(1, 0), ground);
    expect(trails.segments).toBe(0);
    expect(trails.root.geometry.drawRange.count).toBe(0);
    for (let i = 1; i <= 400; i++) trails.update(slidingFrame(1 + i * 0.1, i), ground);
    expect(trails.segments).toBe(trails.capacity);
    expect(trails.root.geometry.drawRange.count).toBe(trails.capacity * 6);
    trails.dispose();
  });
  it('lays the same metre-spaced trace at 30, 60 and 144 Hz and uploads the touched vertices', () => {
    function run(hz: number) {
      const trail = new FestivalTrails();
      for (let tick = 0; tick <= hz; tick++) {
        const f = slidingFrame(2 + tick / hz, (24.25 * tick) / hz, 'sc7');
        for (let w = 1; w < 4; w++) f[carBase(0) + WHEEL_BASE + w * WHEEL_STRIDE + W.LOAD] = 0;
        trail.update(f, (x, z) => x * 0.12 + z * 0.035);
      }
      expect(trail.segments).toBe(37);
      const position = trail.root.geometry.getAttribute('position') as T.BufferAttribute;
      const result = Array.from(position.array.slice(0, trail.segments * 12));
      expect(result[4] - result[1]).toBeCloseTo(0.12 * (result[3] - result[0]), 5);
      trail.dispose();
      return result;
    }
    const reference = run(30);
    for (const hz of [60, 144]) run(hz).forEach((n, i) => expect(n).toBeCloseTo(reference[i], 5));
  });
  it('shares both cambered edges through a corner and restarts cleanly after unloading', () => {
    const trail = new FestivalTrails();
    const radius = 9,
      ground = (x: number, z: number) => 0.15 * x - 0.08 * z;
    for (let i = 0; i <= 30; i++) {
      const a = i * 0.05,
        f = slidingFrame(2 + i / 30, radius * Math.sin(a), 'rh3');
      f[carBase(0) + F.X] = radius * (1 - Math.cos(a));
      for (let w = 1; w < 4; w++) f[carBase(0) + WHEEL_BASE + w * WHEEL_STRIDE + W.LOAD] = 0;
      trail.update(f, ground);
    }
    const position = trail.root.geometry.getAttribute('position') as T.BufferAttribute;
    expect(trail.segments).toBeGreaterThan(14);
    for (let i = 1; i < trail.segments; i++) {
      const start = 12 * i;
      for (let j = 0; j < 6; j++)
        expect(position.array[start + j]).toBe(position.array[start - 6 + j]);
      for (let j = 0; j < 4; j++) {
        const v = start + j * 3,
          a = position.array;
        expect(a[v + 1] - ground(a[v], a[v + 2])).toBeCloseTo(0.016, 5);
      }
    }
    const released = slidingFrame(3.1, 12);
    for (let w = 0; w < 4; w++) released[carBase(0) + WHEEL_BASE + w * WHEEL_STRIDE + W.LOAD] = 0;
    const count = trail.segments;
    trail.update(released, ground);
    trail.update(slidingFrame(3.2, 12, 'rh3'), ground);
    expect(trail.segments).toBe(count);
    trail.dispose();
  });
  it('leaves wet, loose and unloaded contacts unmarked and draws only two bike tracks', () => {
    const ground = () => 0;
    for (const [channel, value] of [
      [W.WATER, 0.6],
      [W.SURFACE, MATERIAL.DIRT],
      [W.LOAD, 0],
    ] as const) {
      const trails = new FestivalTrails();
      for (let i = 0; i < 3; i++) {
        const frame = slidingFrame(i * 0.1, i);
        for (let w = 0; w < 4; w++)
          frame[carBase(0) + WHEEL_BASE + w * WHEEL_STRIDE + channel] = value;
        trails.update(frame, ground);
      }
      expect(trails.segments).toBe(0);
      trails.dispose();
    }
    const bike = Object.values(VEHICLES).find((v) => v.dynamicsKind === 'bike')!;
    const trails = new FestivalTrails();
    trails.update(slidingFrame(1, 0, bike.id), ground);
    trails.update(slidingFrame(1.1, 1, bike.id), ground);
    expect(trails.segments).toBe(2);
    trails.dispose();
  });
  it('uses venue wheel contacts and loose-surface colours without duplicating bike telemetry', () => {
    const effects = new Effects(),
      samples: number[] = [];
    effects.contactEnabled = (_frame, _car, wheel) => wheel % 2 === 0;
    effects.contactOffset = (_frame, _car, wheel, _plume, target) => {
      samples.push(wheel);
      target.set(0, -0.6, wheel < 2 ? 1 : -1);
      return -0.6;
    };
    effects.looseColours = new Map([[MATERIAL.MUD, [0.2, 0.15, 0.1] as const]]);
    const frame = slidingFrame(1, 0);
    for (let w = 0; w < 4; w++)
      frame[carBase(0) + WHEEL_BASE + w * WHEEL_STRIDE + W.SURFACE] = MATERIAL.MUD;
    effects.update(frame, 0.1);
    expect(effects.diagnostics().spawned[PARTICLE_KIND.DUST]).toBeGreaterThan(0);
    expect(new Set(samples)).toEqual(new Set([0, 2]));
    expect(effects.diagnostics().spawned[PARTICLE_KIND.SMOKE]).toBe(0);
    effects.clear();
  });
});

describe('festival route guidance', () => {
  it('conforms its chevrons to grade/camber, keeps flags beyond shoulders and resets after travel', () => {
    const world = openWorld(),
      event = resolveEvents(world).find((e) => e.spec.id === 'coast-to-summit')!;
    const guidance = new HorizonGuidance(),
      point = pathPoint(),
      matrix = new T.Matrix4(),
      vertex = new T.Vector3();
    const ground = (x: number, z: number) => 20 + x * 0.06 + z * 0.09;
    event.path.at(30, point);
    guidance.update(
      event,
      { x: point.x, z: point.z },
      new T.Vector3(point.x, point.y, point.z),
      20,
      ground,
    );
    const arrows = guidance.root.getObjectByName(
      'Road-following route chevrons',
    ) as T.InstancedMesh;
    expect(arrows.count).toBeGreaterThan(0);
    const positions = arrows.geometry.getAttribute('position');
    for (let i = 0; i < arrows.count; i++) {
      arrows.getMatrixAt(i, matrix);
      for (let j = 0; j < positions.count; j++) {
        vertex.fromBufferAttribute(positions, j).applyMatrix4(matrix);
        expect(vertex.y - ground(vertex.x, vertex.z)).toBeCloseTo(0.045, 3);
      }
    }
    for (const name of ['Left checkpoint flag', 'Right checkpoint flag']) {
      const flag = guidance.root.getObjectByName(name)!;
      const safeWidth =
        point.halfWidth + ROAD_CLASSES[event.path.network.edges[point.edge].roadClass].shoulder;
      expect(Math.hypot(flag.position.x - point.x, flag.position.z - point.z)).toBeGreaterThan(
        safeWidth + 0.5,
      );
    }
    event.path.at(event.path.finishDistance * 0.8, point);
    guidance.reset();
    guidance.update(event, null, new T.Vector3(point.x, point.y, point.z), 20, ground);
    arrows.getMatrixAt(0, matrix);
    vertex.setFromMatrixPosition(matrix);
    expect(Math.hypot(vertex.x - point.x, vertex.z - point.z)).toBeLessThan(20);
    guidance.dispose();
  });
});
