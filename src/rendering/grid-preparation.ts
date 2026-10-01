import { CREW_KIT_COLOURS, installCrewHelmetFinish } from './crew-geometry.ts';
import { peopleGeometry } from './people-asset.ts';
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
/** Car-local height of the grid surface, and of the helmet centre above it. */
const CREW_FLOOR = -0.52;
const CREW_HELMET_HEIGHT = 1.64;
export class GridPreparationView {
  readonly root = new T.Group();
  readonly blankets: T.InstancedMesh;
  readonly straps: T.InstancedMesh;
  private bodies: T.InstancedMesh;
  private helmets: T.InstancedMesh;
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
    // The Blender-authored crew (the same people asset as the pit crew), in
    // its standing bind pose with team kit vertex colours and a real helmet.
    const kit = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9 });
    kit.userData.weatherSurface = 'fabric';
    this.bodies = new T.InstancedMesh(peopleGeometry('crew_mid'), kit, 24);
    // Allocated up front so the instancing-colour shader variant never changes.
    this.bodies.instanceColor = new T.InstancedBufferAttribute(new Float32Array(24 * 3).fill(1), 3);
    const helmet = new T.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.35,
    });
    installCrewHelmetFinish(helmet);
    this.helmets = new T.InstancedMesh(peopleGeometry('helmet'), helmet, 24);
    this.root.name = 'Grid tire blankets and preparation staff · reference 047';
    this.root.add(this.blankets, this.straps, this.bodies, this.helmets);
    for (const mesh of [this.blankets, this.straps, this.bodies, this.helmets]) {
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
    yaw = 0,
  ) {
    this.transform.position.set(x, y, z);
    this.transform.rotation.set(0, yaw, wheel ? Math.PI / 2 : 0);
    this.transform.scale.set(1, scale, 1);
    this.transform.updateMatrix();
    this.transform.matrix.premultiply(this.car.matrix);
    mesh.setMatrixAt(mesh.count++, this.transform.matrix);
  }
  update(frame: Float32Array, camera: T.Vector3, enabled = true) {
    const meshes = [this.blankets, this.straps, this.bodies, this.helmets];
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
          // Beside the cockpit, feet on the grid (car origin is ~0.52 m up),
          // facing the car and stepping back as the blankets come off.
          const x = side * (1.8 + state.withdrawal * 1.8);
          this.bodies.setColorAt(
            this.bodies.count,
            CREW_KIT_COLOURS[(id * 2 + (side + 1) / 2) % CREW_KIT_COLOURS.length],
          );
          this.place(this.bodies, x, CREW_FLOOR, 0.4, 1, false, -side * Math.PI * 0.5);
          this.place(
            this.helmets,
            x,
            CREW_FLOOR + CREW_HELMET_HEIGHT,
            0.4,
            1,
            false,
            -side * Math.PI * 0.5,
          );
        }
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    this.bodies.instanceColor!.needsUpdate = true;
  }
  diagnostics() {
    return { blankets: this.blankets.count, staff: this.bodies.count };
  }
}
