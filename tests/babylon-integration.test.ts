import { describe, expect, it } from 'vitest';
import { Epsilon } from '@babylonjs/core/Maths/math.constants.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { SimulationComponent } from '../src/engine/simulation-component.ts';
import { applySimulationSnapshot } from '../src/engine/babylon/snapshot-bridge.ts';
import { DEFAULT_OPTIONS, controls } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { F, carBase } from '../src/simulation/protocol.ts';

const options = { ...DEFAULT_OPTIONS, mode: 'practice' as const, opponents: 0 };
describe('Babylon engine / existing simulation component boundary', () => {
  it('preserves the original physics snapshots across different rendering cadences', () => {
    const host = new SimulationComponent(options),
      direct = new Simulation(options);
    const input = { ...controls(), throttle: 0.6, steer: 0.05 };
    host.setInput(input);
    direct.setInput(input);
    for (let i = 0; i < 60; i++) host.advance(1 / 60);
    for (let i = 0; i < 120; i++) direct.step(1 / 120);
    expect(host.simulation.tick).toBe(120);
    expect(host.frame).toEqual(direct.makeFrame());
    const highRefresh = new SimulationComponent(options);
    highRefresh.setInput(input);
    for (let i = 0; i < 144; i++) highRefresh.advance(1 / 144);
    expect(highRefresh.frame).toEqual(host.frame);
  });
  it('freezes on pause, releases held inputs and bounds background catch-up', () => {
    const host = new SimulationComponent(options);
    host.setInput({ ...controls(), throttle: 1 });
    host.setPaused(true);
    expect(host.advance(60)).toBe(0);
    expect(host.simulation.tick).toBe(0);
    expect(host.simulation.cars[0].input.throttle).toBe(0);
    host.setPaused(false);
    expect(host.advance(60)).toBe(12);
    expect(host.droppedSeconds).toBeCloseTo(59.9);
    expect(() => host.advance(NaN)).toThrow();
    expect(() => host.advance(-1)).toThrow();
  });
  it('moves actual Babylon nodes without mutating snapshots or enabling another physics engine', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    try {
      const node = new TransformNode('entrant', scene);
      const host = new SimulationComponent(options);
      const before = host.frame.slice();
      applySimulationSnapshot(host.frame, [node]);
      const o = carBase(0);
      expect(node.position.asArray()).toEqual([before[o + F.X], before[o + F.Y], before[o + F.Z]]);
      expect(node.rotationQuaternion!.length()).toBeCloseTo(1);
      expect(host.frame).toEqual(before);
      const position = node.position.clone();
      host.frame[o + F.X] = NaN;
      expect(() => applySimulationSnapshot(host.frame, [node])).toThrow('Non-finite');
      expect(node.position.equals(position)).toBe(true);
      expect(() => applySimulationSnapshot(before, [])).toThrow('entrant count');
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});

it('constructs and disposes the Babylon scene using the actual contact-surface width', async () => {
  const { BabylonCircuitScene } = await import('../src/engine/babylon/circuit-scene.ts');
  const engine = new NullEngine();
  const host = new SimulationComponent(options);
  const view = new BabylonCircuitScene(engine, host.simulation.track, 1);
  try {
    expect(view.scene.useRightHandedSystem).toBe(true);
    const road = view.scene.getMeshByName('existing-physics-track')!;
    const positions = road.getVerticesData('position')!;
    expect(road.getVerticesData('normal')![1]).toBeGreaterThan(0.9);
    const p = host.simulation.track.points[0];
    expect(Math.hypot(positions[3] - positions[0], positions[5] - positions[2])).toBeCloseTo(
      p.width * 2,
      4,
    );
    for (let i = 0; i < host.simulation.track.points.length; i++) {
      const point = host.simulation.track.points[i],
        offset = i * 6;
      expect(positions[offset + 1]).toBeCloseTo(
        point.y - point.bank * Math.min(point.width, 12) + 0.01,
        4,
      );
      expect(positions[offset + 4]).toBeCloseTo(
        point.y + point.bank * Math.min(point.width, 12) + 0.01,
        4,
      );
    }
    view.render(host.frame);
    expect(view.entrants[0].position.y).toBe(host.frame[carBase(0) + F.Y]);
  } finally {
    view.dispose();
    engine.dispose();
  }
  expect(view.scene.isDisposed).toBe(true);
});

it('does not drop a gear-change edge between high-refresh render frames or repeat it across substeps', () => {
  const host = new SimulationComponent(options),
    direct = new Simulation(options);
  host.setInput({ ...controls(), shift: 1 });
  expect(host.advance(1 / 240)).toBe(0);
  host.setInput(controls());
  expect(host.advance(1 / 240)).toBe(1);
  direct.setInput({ ...controls(), shift: 1 });
  direct.step(1 / 120);
  for (let i = 0; i < 11; i++) {
    host.advance(1 / 120);
    direct.setInput(controls());
    direct.step(1 / 120);
  }
  expect(host.frame).toEqual(direct.makeFrame());
});

it('keeps the chase camera behind a stopped vehicle instead of snapping to world north', async () => {
  const { BabylonCircuitScene } = await import('../src/engine/babylon/circuit-scene.ts');
  const engine = new NullEngine(),
    host = new SimulationComponent(options);
  const view = new BabylonCircuitScene(engine, host.simulation.track, 1),
    o = carBase(0);
  try {
    host.frame[o + F.VX] = host.frame[o + F.VZ] = 0;
    host.frame[o + F.QX] = host.frame[o + F.QZ] = 0;
    host.frame[o + F.QY] = host.frame[o + F.QW] = Math.SQRT1_2; // Nose points +X.
    const before = host.frame.slice();
    view.render(host.frame);
    expect(view.camera.position.x).toBeCloseTo(host.frame[o + F.X] - 12, 6);
    // TargetCamera.setTarget adds its documented epsilon when camera and
    // target share Z. Preserve that framework behavior, not a loose tolerance.
    expect(view.camera.position.z).toBeCloseTo(host.frame[o + F.Z] + Epsilon, 6);
    expect(host.frame).toEqual(before);
    // Preserve the existing velocity-following behavior at driving speed.
    host.frame[o + F.VZ] = 10;
    view.render(host.frame);
    expect(view.camera.position.x).toBeCloseTo(host.frame[o + F.X], 6);
    expect(view.camera.position.z).toBeCloseTo(host.frame[o + F.Z] - 12, 6);
    host.frame[o + F.VZ] = 0;
    view.render(host.frame);
    expect(view.camera.position.x).toBeCloseTo(host.frame[o + F.X] - 12, 6);
    // A vertical chassis has no horizontal forward projection. Retain the
    // last meaningful heading, rather than choosing an arbitrary direction.
    host.frame[o + F.QY] = 0;
    host.frame[o + F.QX] = host.frame[o + F.QW] = Math.SQRT1_2;
    view.render(host.frame);
    expect(view.camera.position.x).toBeCloseTo(host.frame[o + F.X] - 12, 6);
  } finally {
    view.dispose();
    engine.dispose();
  }
});
