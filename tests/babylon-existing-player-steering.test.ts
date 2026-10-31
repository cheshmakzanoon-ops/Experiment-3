import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { ExistingPlayerSteering } from '../src/engine/babylon/existing-player-steering.ts';
import { F, HEADER, CAR_STRIDE, carBase } from '../src/simulation/protocol.ts';
function fixture() {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    driver = new TransformNode('driver', scene);
  new FreeCamera('test-camera', Vector3.Zero(), scene);
  const group = new AnimationGroup('PLAYER_STEERING', scene);
  const track = new Animation('original-clip', 'position.x', 60, Animation.ANIMATIONTYPE_FLOAT);
  track.setKeys([
    { frame: 20, value: -1 },
    { frame: 50, value: 0 },
    { frame: 80, value: 1 },
  ]);
  group.addTargetedAnimation(track, driver);
  return { engine, scene, driver, group };
}
it('samples the actual Babylon animation at neutral and both steering locks without changing snapshots', () => {
  const { engine, scene, driver, group } = fixture();
  const pose = new ExistingPlayerSteering([group]),
    frame = new Float32Array(HEADER + CAR_STRIDE);
  for (const [steer, expected] of [
    [0, 0],
    [1, 1],
    [-1, -1],
    [0, 0],
  ]) {
    frame[carBase(0) + F.STEER] = steer;
    const before = frame.slice();
    expect(pose.apply(frame)).toBeCloseTo((expected + 1) / 2, 12);
    expect(driver.position.x).toBeCloseTo(expected, 12);
    expect(frame).toEqual(before);
    expect(group.isPlaying).toBe(false);
    scene.render();
    scene.render();
    expect(driver.position.x).toBeCloseTo(expected, 12);
  }
  frame[carBase(0) + F.STEER] = NaN;
  expect(() => pose.apply(frame)).toThrow('Invalid supplied');
  expect(driver.position.x).toBe(0);
  pose.dispose();
  expect(() => pose.apply(frame)).toThrow('disposed');
  scene.dispose();
  engine.dispose();
});
it('rejects a missing or ambiguous clip before starting any animation', () => {
  const { engine, scene, group } = fixture();
  expect(() => new ExistingPlayerSteering([])).toThrow('one authored');
  expect(() => new ExistingPlayerSteering([group, group])).toThrow('one authored');
  expect(group.animatables).toHaveLength(0);
  scene.dispose();
  engine.dispose();
});
