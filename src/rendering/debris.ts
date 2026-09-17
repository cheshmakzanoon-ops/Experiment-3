import * as T from 'three';
import { CAR_STRIDE, D, DEBRIS_BASE, DEBRIS_STRIDE, H, carBase } from '../simulation/protocol.ts';
import { loft } from './geometry.ts';

/** Reuses one draw call for the bounded physical fragment pool. No particles
 * invent crashes: every active instance is an actual worker-owned component. */
export class DebrisView {
  readonly mesh: T.InstancedMesh;
  private transform = new T.Object3D();
  constructor() {
    const geometry = loft(
      [
        [-0.2, 0, 0.85, 0.015],
        [0, 0.025, 0.97, 0.025],
        [0.2, 0.04, 0.86, 0.01],
      ],
      16,
    );
    this.mesh = new T.InstancedMesh(
      geometry,
      new T.MeshStandardMaterial({ color: 0x20292a, roughness: 0.48, metalness: 0.2 }),
      48,
    );
    this.mesh.name = 'Physical detached components';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  }
  update(frame: Float32Array) {
    let count = 0;
    const cars = Math.min(12, Math.max(0, Math.round(frame[H.CARS])));
    if (frame.length < carBase(cars - 1) + CAR_STRIDE)
      throw new Error('Incomplete debris snapshot');
    for (let car = 0; car < cars; car++)
      for (let slot = 0; slot < 4; slot++) {
        const p = carBase(car) + DEBRIS_BASE + slot * DEBRIS_STRIDE;
        if (!frame[p + D.ACTIVE]) continue;
        this.transform.position.set(frame[p + D.X], frame[p + D.Y], frame[p + D.Z]);
        this.transform.rotation.set(frame[p + D.ROTATION], frame[p + D.ROTATION] * 0.35, 0);
        this.transform.scale.set(frame[p + D.KIND] === 2 ? 0.85 : 1, 1, 1);
        this.transform.updateMatrix();
        this.mesh.setMatrixAt(count++, this.transform.matrix);
      }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
