import { describe, expect, it } from 'vitest';
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
    const p = host.simulation.track.points[0];
    expect(Math.hypot(positions[3] - positions[0], positions[5] - positions[2])).toBeCloseTo(
      p.width * 2,
      4,
    );
    view.render(host.frame);
    expect(view.entrants[0].position.y).toBe(host.frame[carBase(0) + F.Y]);
  } finally {
    view.dispose();
    engine.dispose();
  }
  expect(view.scene.isDisposed).toBe(true);
});
