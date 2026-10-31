import { Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { carBase, W, WHEEL_BASE, WHEEL_STRIDE } from '../../simulation/protocol.ts';
import {
  contactHubLength,
  sampleWheelContact,
  wheelContactPose,
} from '../../rendering/wheel-contact.ts';

/** Original authored wheel nodes, driven exclusively by measured snapshots.
 * This ports rigid hub/steer/camber/spin motion, not tyre deformation or blur. */
export class ExistingPlayerWheels {
  private readonly wheels: TransformNode[];
  private readonly spins: TransformNode[];
  private readonly contact = wheelContactPose();
  private readonly poses = Array.from({ length: 4 }, () => ({
    y: 0,
    steer: 0,
    camber: 0,
    spin: 0,
  }));
  private disposed = false;
  constructor(nodes: readonly TransformNode[]) {
    const one = (name: string) => {
      const matches = nodes.filter((node) => node.name === name);
      if (matches.length !== 1) throw new Error(`Expected one authored wheel node: ${name}`);
      return matches[0];
    };
    this.wheels = [0, 1, 2, 3].map((i) => one(`PLAYER_WHEEL_${i}`));
    this.spins = [0, 1, 2, 3].map((i) => one(`PLAYER_SPIN_${i}`));
    for (let i = 0; i < 4; i++) {
      if (this.spins[i].parent !== this.wheels[i])
        throw new Error('Invalid authored wheel hierarchy');
    }
  }
  apply(frame: Float32Array) {
    if (this.disposed) throw new Error('Wheel adapter is disposed');
    const o = carBase(0);
    // Validate every wheel before mutating any scene node.
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE,
        pose = this.poses[i];
      const contact = sampleWheelContact(frame, frame, o, i, 1, this.contact);
      pose.y = 0.05 + 0.25 - contactHubLength(contact, frame, frame, p, 1);
      pose.steer = frame[p + W.STEER];
      pose.camber = -frame[p + W.CAMBER];
      pose.spin = frame[p + W.ROTATION];
      if (![pose.y, pose.steer, pose.camber, pose.spin].every(Number.isFinite))
        throw new Error('Invalid wheel snapshot');
    }
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i],
        spin = this.spins[i],
        pose = this.poses[i];
      wheel.position.y = pose.y;
      // Equivalent to the original Three XYZ Euler(0, steer, -camber).
      wheel.rotationQuaternion ??= Quaternion.Identity();
      Quaternion.RotationYawPitchRollToRef(pose.steer, 0, pose.camber, wheel.rotationQuaternion);
      spin.rotationQuaternion ??= Quaternion.Identity();
      Quaternion.RotationYawPitchRollToRef(0, pose.spin, 0, spin.rotationQuaternion);
    }
    // Read back the applied Babylon node, so integration diagnostics observe
    // presentation state rather than merely echoing the input snapshot.
    const applied = this.spins[0].rotationQuaternion!;
    return 2 * Math.atan2(applied.x, applied.w);
  }
  dispose() {
    this.disposed = true;
  } // Container, not adapter, owns scene nodes.
}
