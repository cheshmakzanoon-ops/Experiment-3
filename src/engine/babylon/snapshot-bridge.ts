import { Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { CAR_STRIDE, HEADER, H, F, carBase } from '../../simulation/protocol.ts';

/** Babylon uses right-handed scene coordinates to match the existing SI world.
 * Transform transfer is read-only. Babylon physics must not double-integrate it. */
export function applySimulationSnapshot(frame: Float32Array, nodes: readonly TransformNode[]) {
  if (frame.length !== HEADER + nodes.length * CAR_STRIDE || frame[H.CARS] !== nodes.length)
    throw new Error('Snapshot/scene entrant count differs');
  // Validate the entire transfer before changing any node (no half-updated scene).
  for (let i = 0; i < nodes.length; i++) {
    const o = carBase(i);
    for (let f = F.X; f <= F.QW; f++)
      if (!Number.isFinite(frame[o + f])) throw new Error('Non-finite simulation pose');
    const norm = Math.hypot(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
    if (norm < 1e-8) throw new Error('Invalid simulation orientation');
  }
  for (let i = 0; i < nodes.length; i++) {
    const o = carBase(i),
      node = nodes[i];
    node.position.set(frame[o + F.X], frame[o + F.Y], frame[o + F.Z]);
    node.rotationQuaternion ??= new Quaternion();
    node.rotationQuaternion
      .set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW])
      .normalize();
  }
}
