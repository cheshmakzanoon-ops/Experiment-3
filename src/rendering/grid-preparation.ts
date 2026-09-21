import { tailoredCrewGeometry, crewHelmetGeometry, installCrewFabric } from './crew-geometry.ts';
import * as T from 'three';
import { clamp } from '../core/math.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';

/** Blankets clear before the first red light and staff before the second.
 * Derived from race time, so pause/replay/seek cannot leave stale grid props.
 * These are presentation props, not a tire-temperature or grip override. */
export function gridPreparation(time: number, phase: number, speed: number) {
  if (![time, phase, speed].every(Number.isFinite) || phase >= 2 || speed > 0.5 || time < 0)
    return { blankets: false, crew: false, withdrawal: 1 };
  return { blankets: time < 0.85, crew: time < 1.8, withdrawal: clamp(time / 0.85, 0, 1) };
}
export class GridPreparationView {
  readonly root = new T.Group();
  readonly blankets: T.InstancedMesh;
  readonly straps: T.InstancedMesh;
  private bodies: T.InstancedMesh;
  private helmets: T.InstancedMesh;
  private limbs: T.InstancedMesh;
  private transform = new T.Object3D();
  private car = new T.Object3D();
  constructor() {
    this.blankets = new T.InstancedMesh(
      new T.CylinderGeometry(0.385, 0.385, 1, 24),
      new T.MeshStandardMaterial({ color: 0x151a20, roughness: 0.98 }),
      48,
    );
    this.straps = new T.InstancedMesh(
      new T.CylinderGeometry(0.391, 0.391, 0.027, 24, 1, true),
      new T.MeshStandardMaterial({ color: 0xdac779, roughness: 0.91 }),
      96,
    );
    this.bodies = new T.InstancedMesh(
      tailoredCrewGeometry().scale(0.16, 0.72, 0.16),
      installCrewFabric(new T.MeshStandardMaterial({ color: 0x26474f, roughness: 0.95 })),
      24,
    );
    this.helmets = new T.InstancedMesh(
      crewHelmetGeometry().scale(0.12, 0.135, 0.12),
      new T.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        metalness: 0.05,
        roughness: 0.36,
      }),
      24,
    );
    this.limbs = new T.InstancedMesh(
      tailoredCrewGeometry().scale(0.072, 0.62, 0.072),
      installCrewFabric(new T.MeshStandardMaterial({ color: 0x26474f, roughness: 0.95 })),
      96,
    );
    const bodyGeometry = this.bodies.geometry;
    // Morph coordinates precede the constructor's scale; bake the chest pose explicitly.
    bodyGeometry.setAttribute('position', bodyGeometry.morphAttributes.position![0].clone());
    bodyGeometry.setAttribute('normal', bodyGeometry.morphAttributes.normal![0].clone());
    bodyGeometry.morphAttributes = {};
    bodyGeometry.scale(0.16, 0.72, 0.16);
    this.limbs.geometry.morphAttributes = {};
    this.root.name = 'Grid tire blankets and preparation staff · reference 047';
    this.root.add(this.blankets, this.straps, this.bodies, this.helmets, this.limbs);
    for (const mesh of [this.blankets, this.straps, this.bodies, this.helmets, this.limbs]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    }
  }
  private place(
    mesh: T.InstancedMesh,
    x: number,
    y: number,
    z: number,
    scale: number,
    wheel = false,
  ) {
    this.transform.position.set(x, y, z);
    this.transform.rotation.set(0, 0, wheel ? Math.PI / 2 : 0);
    this.transform.scale.set(1, scale, 1);
    this.transform.updateMatrix();
    this.transform.matrix.premultiply(this.car.matrix);
    mesh.setMatrixAt(mesh.count++, this.transform.matrix);
  }
  update(frame: Float32Array, camera: T.Vector3, enabled = true) {
    const meshes = [this.blankets, this.straps, this.bodies, this.helmets, this.limbs];
    for (const mesh of meshes) mesh.count = 0;
    for (let id = 0; enabled && id < Math.min(12, frame[H.CARS]); id++) {
      const o = carBase(id);
      const state = gridPreparation(frame[H.TIME], frame[H.PHASE], frame[o + F.SPEED]);
      if (!state.crew && !state.blankets) continue;
      this.car.position.fromArray(frame, o + F.X);
      if (this.car.position.distanceToSquared(camera) > 120 ** 2) continue;
      this.car.quaternion.fromArray(frame, o + F.QX);
      this.car.updateMatrix();
      if (state.blankets)
        WHEEL_POSITIONS.forEach(([x, y, z], wheel) => {
          const shift = Math.sign(x) * state.withdrawal * 0.5;
          const hubY = y - (frame[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LENGTH] || 0.25);
          const width = wheel < 2 ? 0.34 : 0.42;
          this.place(this.blankets, x + shift, hubY, z, width, true);
          for (const band of [-1, 1])
            this.place(this.straps, x + shift + band * width * 0.32, hubY, z, 1, true);
        });
      if (state.crew)
        for (const side of [-1, 1]) {
          const x = side * (1.8 + state.withdrawal * 1.8);
          this.place(this.bodies, x, 0.31, 0.4, 1);
          this.place(this.helmets, x, 0.83, 0.4, 1);
          for (const sign of [-1, 1]) {
            this.place(this.limbs, x + sign * 0.1, -0.19, 0.4, 1);
            this.place(this.limbs, x + sign * 0.23, 0.24, 0.4, 0.83);
          }
        }
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }
  diagnostics() {
    return { blankets: this.blankets.count, staff: this.bodies.count };
  }
}
