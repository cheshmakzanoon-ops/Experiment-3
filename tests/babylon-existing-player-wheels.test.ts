import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Quaternion, Euler } from 'three';
import { ExistingPlayerWheels } from '../src/engine/babylon/existing-player-wheels.ts';
import { SimulationComponent } from '../src/engine/simulation-component.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import {
  carBase,
  C,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  WHEEL_CONTACT_BASE,
  wheelContactBase,
} from '../src/simulation/protocol.ts';
import {
  contactHubLength,
  sampleWheelContact,
  wheelContactPose,
} from '../src/rendering/wheel-contact.ts';

function fixture() {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const wheels = [0, 1, 2, 3].map((i) => new TransformNode(`PLAYER_WHEEL_${i}`, scene));
  const spins = wheels.map((wheel, i) => {
    wheel.position.set(i % 2 ? 0.83 : -0.83, 0.05, i < 2 ? 1.82 : -1.62);
    const spin = new TransformNode(`PLAYER_SPIN_${i}`, scene);
    spin.parent = wheel;
    return spin;
  });
  const frame = new SimulationComponent({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' })
    .frame;
  return { engine, scene, wheels, spins, frame, nodes: [...wheels, ...spins] };
}
describe('authored Babylon wheel motion', () => {
  it('matches legacy rigid wheel transforms, preserves physics and freezes with identical snapshots', () => {
    const f = fixture();
    try {
      const adapter = new ExistingPlayerWheels(f.nodes),
        o = carBase(0);
      for (let i = 0; i < 4; i++) {
        const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
        f.frame[p + W.STEER] = (i - 1.5) * 0.12;
        f.frame[p + W.CAMBER] = (i % 2 ? -1 : 1) * 0.04;
        f.frame[p + W.ROTATION] = i * 2.3 - 4;
      }
      const before = f.frame.slice();
      adapter.apply(f.frame);
      for (let i = 0; i < 4; i++) {
        const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
        const legacy = new Quaternion().setFromEuler(
          new Euler(0, f.frame[p + W.STEER], -f.frame[p + W.CAMBER], 'XYZ'),
        );
        const actual = f.wheels[i].rotationQuaternion!;
        for (const axis of ['x', 'y', 'z', 'w'] as const)
          expect(actual[axis]).toBeCloseTo(legacy[axis], 12);
        expect(f.spins[i].rotationQuaternion!.x).toBeCloseTo(
          Math.sin(f.frame[p + W.ROTATION] / 2),
          12,
        );
        expect(f.spins[i].rotationQuaternion!.y).toBe(0);
        expect(f.spins[i].rotationQuaternion!.z).toBe(0);
        expect(f.spins[i].rotationQuaternion!.w).toBeCloseTo(
          Math.cos(f.frame[p + W.ROTATION] / 2),
          12,
        );
        expect(f.wheels[i].position.y).toBeCloseTo(
          0.3 -
            contactHubLength(
              sampleWheelContact(f.frame, f.frame, o, i, 1, wheelContactPose()),
              f.frame,
              f.frame,
              p,
              1,
            ),
          12,
        );
        expect(f.wheels[i].position.x).toBe(i % 2 ? 0.83 : -0.83);
        expect(f.wheels[i].position.z).toBe(i < 2 ? 1.82 : -1.62);
      }
      const transforms = f.nodes.map((n) => n.computeWorldMatrix(true).asArray().slice());
      adapter.apply(f.frame);
      expect(f.nodes.map((n) => n.computeWorldMatrix(true).asArray().slice())).toEqual(transforms);
      expect(f.frame).toEqual(before);
      adapter.dispose();
      adapter.dispose();
      expect(() => adapter.apply(f.frame)).toThrow('disposed');
      expect(f.wheels.every((n) => !n.isDisposed())).toBe(true);
    } finally {
      f.scene.dispose();
      f.engine.dispose();
    }
  });
  it('uses measured hub travel and falls back to legacy suspension without inventing spin', () => {
    const f = fixture();
    try {
      const adapter = new ExistingPlayerWheels(f.nodes),
        o = carBase(0),
        p = o + WHEEL_BASE;
      f.frame[o + WHEEL_CONTACT_BASE] = 1;
      const c = wheelContactBase(o, 0);
      f.frame[c + C.HUB_LENGTH] = 0.18;
      f.frame[c + C.NORMAL_X] = f.frame[c + C.NORMAL_Z] = 0;
      f.frame[c + C.NORMAL_Y] = 1;
      f.frame[c + C.RADIAL] = 0;
      f.frame[p + W.LENGTH] = 0.23;
      f.frame[p + W.OMEGA] = 100;
      f.frame[p + W.ROTATION] = 0;
      adapter.apply(f.frame);
      expect(f.wheels[0].position.y).toBeCloseTo(0.12, 7);
      expect(f.spins[0].rotationQuaternion!.x).toBe(0);
      f.frame[o + WHEEL_CONTACT_BASE] = 0;
      adapter.apply(f.frame);
      expect(f.wheels[0].position.y).toBeCloseTo(0.07, 7);
      expect(f.spins[0].rotationQuaternion!.x).toBe(0);
    } finally {
      f.scene.dispose();
      f.engine.dispose();
    }
  });
  it('rejects malformed rigs and invalid snapshots without partially moving wheels', () => {
    const f = fixture();
    try {
      expect(() => new ExistingPlayerWheels(f.nodes.slice(1))).toThrow('Expected one');
      expect(() => new ExistingPlayerWheels([...f.nodes, f.wheels[0]])).toThrow('Expected one');
      f.spins[3].parent = f.wheels[0];
      expect(() => new ExistingPlayerWheels(f.nodes)).toThrow('hierarchy');
      f.spins[3].parent = f.wheels[3];
      const adapter = new ExistingPlayerWheels(f.nodes);
      adapter.apply(f.frame);
      const before = f.wheels.map((n) => n.position.asArray());
      const rotations = f.nodes.map((n) => n.rotationQuaternion!.asArray());
      f.frame[carBase(0) + WHEEL_BASE + 3 * WHEEL_STRIDE + W.STEER] = NaN;
      expect(() => adapter.apply(f.frame)).toThrow('Invalid wheel snapshot');
      expect(f.wheels.map((n) => n.position.asArray())).toEqual(before);
      expect(f.nodes.map((n) => n.rotationQuaternion!.asArray())).toEqual(rotations);
      expect(() => adapter.apply(new Float32Array(0))).toThrow('Invalid wheel snapshot');
    } finally {
      f.scene.dispose();
      f.engine.dispose();
    }
  });
});
