import * as T from 'three';
import { clamp, smooth } from '../core/math.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';

/** Phase-local tire translation in metres. Removal requires an unloaded hub;
 * the service clock is authoritative and seekable, not a visual-only timer. */
export function serviceWheelOffset(phase: number, clock: number, load: number): number {
  if (![phase, clock, load].every(Number.isFinite)) throw new Error('Invalid pit presentation');
  if (load > 50) return 0;
  if (phase === 3) return smooth(1.35, 2.1, clock) * 0.48;
  if (phase === 4) return (1 - smooth(2.2, 3.25, clock)) * 0.48;
  return 0;
}
/** Four kneeling mechanics and two jack operators. Reusable instanced spheres
 * and cylinders preserve rounded silhouettes without hundreds of draw calls.
 * Only physically stopped, servicing cars get a crew; approach/release do not.
 */
export class PitCrewView {
  readonly root = new T.Group();
  private readonly cloth: T.InstancedMesh;
  private readonly heads: T.InstancedMesh;
  private readonly gloves: T.InstancedMesh;
  private readonly tools: T.InstancedMesh;
  private transform = new T.Object3D();
  private car = new T.Object3D();
  private from = new T.Vector3();
  private to = new T.Vector3();
  private direction = new T.Vector3();
  private vertical = new T.Vector3(0, 1, 0);
  private counts = [0, 0, 0, 0];
  activeCrews = 0;
  constructor() {
    this.cloth = new T.InstancedMesh(
      new T.CylinderGeometry(1, 1, 1, 12),
      new T.MeshStandardMaterial({ color: 0x294851, roughness: 0.94 }),
      12 * 48,
    );
    this.heads = new T.InstancedMesh(
      new T.SphereGeometry(1, 16, 12),
      new T.MeshStandardMaterial({ color: 0xd6d2bc, roughness: 0.5 }),
      12 * 6,
    );
    this.gloves = new T.InstancedMesh(
      new T.SphereGeometry(1, 12, 8),
      new T.MeshStandardMaterial({ color: 0x151d1f, roughness: 0.96 }),
      12 * 12,
    );
    this.tools = new T.InstancedMesh(
      new T.CylinderGeometry(1, 1, 1, 12),
      new T.MeshStandardMaterial({ color: 0x8b9697, metalness: 0.75, roughness: 0.35 }),
      12 * 14,
    );
    this.root.add(this.cloth, this.heads, this.gloves, this.tools);
    this.root.name = 'Physical pit service crew';
    for (const batch of [this.cloth, this.heads, this.gloves, this.tools]) {
      batch.count = 0;
      batch.frustumCulled = false;
      batch.castShadow = true;
      batch.receiveShadow = true;
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
    }
  }
  private shape(
    batch: T.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ) {
    this.transform.position.set(x, y, z);
    this.transform.rotation.set(0, 0, 0);
    this.transform.scale.set(sx, sy, sz);
    this.transform.updateMatrix();
    this.transform.matrix.premultiply(this.car.matrix);
    batch.setMatrixAt(this.counts[index]++, this.transform.matrix);
  }
  private segment(
    batch: T.InstancedMesh,
    index: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    radius: number,
  ) {
    this.from.set(ax, ay, az);
    this.to.set(bx, by, bz);
    this.direction.copy(this.to).sub(this.from);
    const length = this.direction.length();
    this.transform.position.copy(this.from).add(this.to).multiplyScalar(0.5);
    this.transform.quaternion.setFromUnitVectors(
      this.vertical,
      this.direction.multiplyScalar(1 / Math.max(length, 1e-8)),
    );
    this.transform.scale.set(radius, length, radius);
    this.transform.updateMatrix();
    this.transform.matrix.premultiply(this.car.matrix);
    batch.setMatrixAt(this.counts[index]++, this.transform.matrix);
  }
  update(frame: Float32Array, camera: T.Vector3, visible = true) {
    this.counts.fill(0);
    this.activeCrews = 0;
    for (let id = 0; id < frame[H.CARS] && visible; id++) {
      const o = carBase(id),
        phase = frame[o + F.PIT_PHASE];
      if (phase < 2 || phase > 5 || frame[o + F.SPEED] > 0.5) continue;
      this.car.position.set(frame[o + F.X], frame[o + F.Y], frame[o + F.Z]);
      if (this.car.position.distanceToSquared(camera) > 160 * 160) continue;
      this.car.quaternion.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      this.car.updateMatrix();
      this.activeCrews++;
      const floor = -0.43 - frame[o + F.JACK_HEIGHT];
      const clock = frame[o + F.PIT_CLOCK];
      for (let wheel = 0; wheel < 4; wheel++) {
        const [hubX, , hubZ] = WHEEL_POSITIONS[wheel],
          side = Math.sign(hubX),
          p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        const off = serviceWheelOffset(phase, clock, frame[p + W.LOAD]);
        const x = hubX + side * (0.68 + off * 0.3),
          z = hubZ - 0.2;
        const shoulderX = x - side * 0.055,
          shoulderY = floor + 0.78;
        this.segment(this.cloth, 0, x, floor + 0.35, z, shoulderX, shoulderY, z + 0.06, 0.135);
        this.shape(
          this.heads,
          1,
          shoulderX - side * 0.08,
          floor + 0.96,
          z + 0.12,
          0.115,
          0.135,
          0.12,
        );
        for (const sign of [-1, 1]) {
          this.segment(
            this.cloth,
            0,
            x,
            floor + 0.4,
            z + sign * 0.09,
            x - side * 0.25,
            floor + 0.16,
            z + sign * 0.14,
            0.072,
          );
          this.segment(
            this.cloth,
            0,
            x - side * 0.25,
            floor + 0.16,
            z + sign * 0.14,
            x + side * 0.03,
            floor + 0.07,
            z + sign * 0.16,
            0.06,
          );
          const handX = hubX + side * (0.22 + off),
            handY = 0.05 - (frame[p + W.LENGTH] || 0.25),
            handZ = hubZ + sign * 0.1;
          this.segment(
            this.cloth,
            0,
            shoulderX,
            shoulderY,
            z + sign * 0.12,
            x - side * 0.2,
            floor + 0.53,
            z + sign * 0.2,
            0.047,
          );
          this.segment(
            this.cloth,
            0,
            x - side * 0.2,
            floor + 0.53,
            z + sign * 0.2,
            handX,
            handY,
            handZ,
            0.037,
          );
          this.shape(this.gloves, 2, handX, handY, handZ, 0.045, 0.045, 0.065);
        }
        const gunY = 0.05 - (frame[p + W.LENGTH] || 0.25);
        this.segment(
          this.tools,
          3,
          hubX + side * (0.21 + off),
          gunY,
          hubZ,
          hubX + side * (0.43 + off),
          gunY,
          hubZ,
          0.037,
        );
      }
      for (const end of [-1, 1]) {
        const z = end * 2.9,
          x = end * 0.12;
        this.segment(this.cloth, 0, x, floor + 0.62, z, x, floor + 1.17, z - end * 0.2, 0.14);
        this.shape(this.heads, 1, x, floor + 1.34, z - end * 0.23, 0.115, 0.135, 0.12);
        for (const side of [-1, 1]) {
          this.segment(
            this.cloth,
            0,
            x + side * 0.09,
            floor + 0.65,
            z,
            x + side * 0.11,
            floor + 0.08,
            z + end * 0.18,
            0.065,
          );
          this.segment(
            this.cloth,
            0,
            x + side * 0.13,
            floor + 1.12,
            z - end * 0.18,
            x + side * 0.09,
            floor + 0.53,
            z - end * 0.48,
            0.047,
          );
          this.shape(
            this.gloves,
            2,
            x + side * 0.09,
            floor + 0.53,
            z - end * 0.48,
            0.045,
            0.055,
            0.045,
          );
        }
        const lift = clamp(frame[o + F.JACK_HEIGHT], 0, 0.22);
        this.segment(
          this.tools,
          3,
          0,
          floor + 0.06,
          end * 2.05,
          0,
          floor + 0.06 + lift,
          end * 2.05,
          0.09,
        );
        this.segment(
          this.tools,
          3,
          0,
          floor + 0.06,
          end * 2.05,
          x,
          floor + 0.55,
          z - end * 0.48,
          0.025,
        );
      }
    }
    for (const [index, batch] of [this.cloth, this.heads, this.gloves, this.tools].entries()) {
      if (this.counts[index] > batch.instanceMatrix.count)
        throw new Error('Pit crew capacity exceeded');
      batch.count = this.counts[index];
      batch.instanceMatrix.needsUpdate = true;
    }
  }
}
