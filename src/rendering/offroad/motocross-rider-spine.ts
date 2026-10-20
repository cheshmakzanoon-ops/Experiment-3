import * as T from 'three';
import { clamp, smooth } from '../../core/math.ts';
import type { RiderPose } from '../rider.ts';

const finite = (value: number | undefined) => (Number.isFinite(value) ? value! : 0);

/** A loose jersey follows the pelvis, lumbar region and chest independently.
 * References 004/009/070 show the standing/compressed hip hinge; 005 retains
 * a curved back above bent legs, and 014/024 balance the shoulders over a banked
 * bike. These bounded presentation angles are authored from those poses,
 * not motion-capture measurements or additional physical rider forces. */
export class MotocrossRiderSpine {
  readonly lumbar = new T.Group();
  readonly chest = new T.Group();
  readonly skeleton: T.Skeleton;
  private readonly euler = new T.Euler();
  private readonly pivot = new T.Vector3();
  private readonly offset = new T.Vector3();

  constructor(
    parent: T.Group,
    private readonly pelvis: T.Group,
  ) {
    this.lumbar.name = 'Motocross lumbar spine';
    this.chest.name = 'Motocross upper chest';
    parent.add(this.lumbar, this.chest);
    const bones = [pelvis, this.lumbar, this.chest].map((frame, i) => {
      const bone = new T.Bone();
      bone.name = ['Motocross pelvis skin', 'Motocross lumbar skin', 'Motocross chest skin'][i];
      frame.add(bone);
      return bone;
    });
    this.skeleton = new T.Skeleton(
      bones,
      bones.map(() => new T.Matrix4()),
    );
  }

  /** Convert only the existing jersey and its neck liner. The separate
   * trouser waistband remains on the pelvis. Vertex/triangle counts and
   * material batches are unchanged; no animation vertex uploads are needed. */
  bind(mesh: T.Mesh) {
    mesh.updateMatrix();
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix),
      position = geometry.getAttribute('position'),
      indices = new Uint16Array(position.count * 4),
      weights = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i),
        upper = y >= 0.23,
        weight = upper ? smooth(0.23, 0.39, y) : smooth(0.07, 0.23, y);
      indices.set(upper ? [1, 2, 0, 0] : [0, 1, 0, 0], i * 4);
      weights.set([1 - weight, weight, 0, 0], i * 4);
    }
    geometry.setAttribute('skinIndex', new T.BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new T.BufferAttribute(weights, 4));
    const skin = new T.SkinnedMesh(geometry, mesh.material);
    skin.name = mesh.name;
    skin.castShadow = mesh.castShadow;
    skin.receiveShadow = mesh.receiveShadow;
    skin.bind(this.skeleton, new T.Matrix4());
    // Conservative local bounds include the complete bounded bend, including
    // replayed poses far from the world origin and the original neck liner.
    skin.boundingBox = new T.Box3(new T.Vector3(-0.4, -0.12, -0.4), new T.Vector3(0.4, 0.75, 0.4));
    skin.boundingSphere = new T.Sphere(new T.Vector3(0, 0.3, 0), 0.75);
    mesh.removeFromParent();
    mesh.geometry.dispose();
    this.pelvis.add(skin);
    return skin;
  }

  ride(pose: RiderPose, position: T.Vector3, pitch: number, yaw: number, roll: number) {
    const standing = clamp(finite(pose.standing), 0, 1),
      compression = smooth(0.04, 1, finite(pose.compression)),
      body = clamp(finite(pose.body), -1, 1),
      lean = clamp(finite(pose.lean), -1.3, 1.3),
      steer = clamp(finite(pose.steer), -0.5, 0.5),
      // A standing rider distributes flexion above the hip hinge; landing
      // compression rounds the lumbar region without collapsing the neck.
      flex =
        0.035 +
        standing * (0.105 + compression * 0.05) +
        Math.max(body, 0) * 0.035 -
        Math.max(-body, 0) * 0.015,
      twist = clamp(lean * 0.12 + steer * 0.09, -0.14, 0.14) * (1 - standing * 0.3),
      sideBend = clamp(lean * 0.11, -0.12, 0.12);
    this.pelvis.position.copy(position);
    this.pelvis.quaternion.setFromEuler(
      this.euler.set(pitch - flex, yaw - twist, roll - sideBend, 'ZYX'),
    );
    this.chest.quaternion.setFromEuler(this.euler.set(pitch, yaw, roll, 'ZYX'));
    this.lumbar.quaternion.copy(this.pelvis.quaternion).slerp(this.chest.quaternion, 0.52);
    this.placeFrame(this.lumbar, this.pelvis, 0.14);
    this.placeFrame(this.chest, this.lumbar, 0.31);
  }

  /** Recovery uses the existing slide, stand and remount animations. All
   * frames are reset explicitly so rewinding never retains riding flexion. */
  reset() {
    for (const frame of [this.lumbar, this.chest]) {
      frame.position.copy(this.pelvis.position);
      frame.quaternion.copy(this.pelvis.quaternion);
    }
  }

  private placeFrame(frame: T.Group, previous: T.Group, height: number) {
    this.pivot.set(0, height, 0).applyQuaternion(previous.quaternion).add(previous.position);
    this.offset.set(0, height, 0).applyQuaternion(frame.quaternion);
    frame.position.copy(this.pivot).sub(this.offset);
  }

  dispose() {
    this.skeleton.dispose();
  }
}

const gaze = new T.Euler();
const gazeFrame = new T.Quaternion();
/** Look through the corner instead of following a countersteered handlebar.
 * The helmet uses the rider-root frame after removing chest articulation.
 * Slow steering still turns the gaze at the gate; road speed blends toward
 * chassis lean. Pitch retains the existing partial landing stabilization. */
export function motocrossHeadFrame(
  pose: RiderPose,
  chest: T.Quaternion,
  gazePitch: number,
  target: T.Quaternion,
) {
  const speed = Number.isFinite(pose.speed) ? Math.max(0, pose.speed!) : 15,
    travelling = smooth(2, 10, speed),
    lean = clamp(finite(pose.lean), -1.3, 1.3),
    yaw = clamp(lean * 0.5 * travelling + finite(pose.steer) * 0.85 * (1 - travelling), -0.6, 0.6);
  gaze.set(0.3 + clamp(finite(pose.tuck), 0, 1) * 0.12 + gazePitch, yaw, lean * 0.84, 'YXZ');
  target.copy(chest).invert().multiply(gazeFrame.setFromEuler(gaze));
  return target;
}
