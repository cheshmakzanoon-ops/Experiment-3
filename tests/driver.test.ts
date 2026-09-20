import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { ArmPose, DriverActions, DriverRig } from '../src/rendering/driver.ts';

describe('articulated driver', () => {
  it('maintains fixed limb lengths and reachable wrists through the entire steering range', () => {
    const steering = new T.Group();
    steering.position.set(0, 0.115, 0.22);
    steering.rotation.x = 0.12;
    const rig = new DriverRig(steering);
    for (let angle = -1.4; angle <= 1.4; angle += 0.04) {
      steering.rotation.z = angle;
      rig.update(10 + angle, 4, 1);
      const joints = rig.diagnostics();
      for (const arm of joints) {
        expect(arm.reachable).toBe(true);
        expect(arm.upperLength).toBeCloseTo(0.37, 10);
        expect(arm.lowerLength).toBeCloseTo(0.36, 10);
        expect(arm.shoulder).toEqual([arm.side * 0.16, 0.015, -0.48]);
        expect(Math.abs(arm.elbow[0])).toBeLessThan(0.34);
        expect(arm.elbow.every(Number.isFinite)).toBe(true);
      }
    }
  });
  it('does not move shoulder anchors with wheel rotation, car position or world orientation', () => {
    const parent = new T.Group(),
      steering = new T.Group();
    steering.position.set(0, 0.115, 0.22);
    parent.add(steering);
    const rig = new DriverRig(steering);
    parent.add(rig.root);
    parent.position.set(200, 3, -50);
    parent.rotation.y = 1.9;
    rig.update(1, 3, 1);
    const before = rig.diagnostics();
    steering.rotation.z = 1;
    rig.update(1.05, 3, 1);
    const after = rig.diagnostics();
    expect(after[0].shoulder).toEqual(before[0].shoulder);
    expect(after[0].wrist).not.toEqual(before[0].wrist);
  });
  it('pulls the correct paddle for observed shifts, returns smoothly, and resets on replay seeks', () => {
    const actions = new DriverActions();
    actions.sample(4, 3, 1);
    expect(actions.up).toBe(0);
    actions.sample(4.02, 4, 1);
    expect(actions.up).toBe(1);
    expect(actions.down).toBe(0);
    actions.sample(4.1, 4, 1);
    expect(actions.up).toBeCloseTo(0.5);
    actions.sample(4.12, 3, 2);
    expect(actions.down).toBe(1);
    expect(actions.button).toBe(1);
    actions.sample(1, 2, 0);
    expect([actions.up, actions.down, actions.button]).toEqual([0, 0, 0]);
    actions.sample(10, 6, 2);
    expect(actions.up).toBe(0);
  });
  it('reports unreachable targets and handles degenerate elbow poles without NaN', () => {
    const pose = new ArmPose(),
      shoulder = new T.Vector3();
    pose.solve(shoulder, new T.Vector3(0, 0, 10), new T.Vector3(0, 0, 4), 0.37, 0.36);
    expect(pose.reachable).toBe(false);
    expect(pose.elbow.length()).toBeCloseTo(0.37, 10);
    expect(pose.wrist.length()).toBeLessThan(0.73);
    pose.solve(shoulder, new T.Vector3(), new T.Vector3(), 0.37, 0.36);
    expect(pose.elbow.toArray().every(Number.isFinite)).toBe(true);
    expect(() => pose.solve(shoulder, new T.Vector3(NaN), new T.Vector3(), 1, 1)).toThrow();
    expect(() => pose.solve(shoulder, new T.Vector3(), new T.Vector3(), 0, 1)).toThrow();
  });
});
