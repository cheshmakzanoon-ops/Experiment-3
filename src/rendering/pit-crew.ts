import { PIT_CREW_MAX_DISTANCE, PitPoseCache } from './pit-presentation.ts';
import { PitMachinery } from './pit-machinery.ts';
import * as T from 'three';
import { clamp, smooth } from '../core/math.ts';
import {
  F,
  H,
  HEADER,
  CAR_STRIDE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';
import {
  PEOPLE_ASSET,
  CREW_BONES,
  CREW_REST,
  peopleGeometry,
  leftCrewGloveGeometry,
} from './people-asset.ts';
import { CrewPose, installCrewSkin } from './crew-pose.ts';

/** Removal requires an unloaded hub. These offsets are also consumed by the
 * actual FormulaCar wheel, so a crew cannot animate a different service clock. */
export function serviceWheelOffset(phase: number, clock: number, load: number): number {
  if (![phase, clock, load].every(Number.isFinite)) throw new Error('Invalid pit presentation');
  if (load > 50) return 0;
  if (phase === 3) return smooth(1.35, 2.1, clock) * 0.48;
  if (phase === 4) return (1 - smooth(2.2, 3.25, clock)) * 0.48;
  return 0;
}
export const PIT_CREW_PER_CAR = 15;
export const MAX_PIT_CREWS = 12;
const ACTORS = PIT_CREW_PER_CAR * MAX_PIT_CREWS;
const UP = new T.Vector3(0, 1, 0);
const FORWARD = new T.Vector3(0, 0, 1);
const UNIT = new T.Vector3(1, 1, 1);
const CUFF = new T.Vector3(0, -0.067, -0.008);
const GRIP = new T.Vector3(0, 0.034, 0.041);
const palette = [0x244553, 0x315963, 0x334950, 0x455961, 0x304c62].map((c) => new T.Color(c));
export type PitRole = 'gun' | 'remove' | 'install' | 'front-jack' | 'rear-jack' | 'release';
interface ActorEvidence {
  car: number;
  role: PitRole;
  wheel: number;
  reachable: boolean[];
  wristError: number;
  gripError: number;
  floorY: number;
  root: number[];
}

/** Fifteen task-specific, Blender-authored actors per stopped car, with one
 * shared bone atlas and bounded instanced batches. No per-actor draw calls,
 * wall-clock animation, new simulation state or asynchronous primitive swap. */
export class PitCrewView {
  readonly root = new T.Group();
  private readonly boneData = new Float32Array(ACTORS * CREW_BONES * 16);
  private readonly bones = new T.DataTexture(
    this.boneData,
    4 * CREW_BONES,
    ACTORS,
    T.RGBAFormat,
    T.FloatType,
  );
  private readonly cloth: readonly [T.InstancedMesh, T.InstancedMesh];
  private readonly heads: T.InstancedMesh;
  private readonly gloves: readonly [T.InstancedMesh, T.InstancedMesh];
  private readonly guns: T.InstancedMesh;
  private readonly tires: T.InstancedMesh;
  private readonly jacks: T.InstancedMesh;
  private readonly handles: T.InstancedMesh;
  private readonly signals: T.InstancedMesh;
  private readonly machinery: PitMachinery;
  private readonly batches: readonly T.InstancedMesh[];
  private readonly slots: readonly [T.InstancedBufferAttribute, T.InstancedBufferAttribute];
  private readonly pose = new CrewPose();
  private readonly car = new T.Object3D();
  private readonly actor = new T.Object3D();
  private readonly prop = new T.Object3D();
  private readonly matrix = new T.Matrix4();
  private readonly gloveMatrices = [new T.Matrix4(), new T.Matrix4()];
  private readonly wrists = [new T.Vector3(), new T.Vector3()];
  private readonly grips = [new T.Vector3(), new T.Vector3()];
  private readonly orientations = [new T.Quaternion(), new T.Quaternion()];
  private readonly target = new T.Vector3();
  private readonly direction = new T.Vector3();
  private readonly local = new T.Vector3();
  private readonly rotation = new T.Quaternion();
  private readonly actorWorld = new T.Matrix4();
  private readonly records: ActorEvidence[] = [];
  private readonly cache = new PitPoseCache();
  private actorSlot = 0;
  activeCrews = 0;
  activeActors = 0;

  constructor() {
    this.bones.generateMipmaps = false;
    this.bones.minFilter = this.bones.magFilter = T.NearestFilter;
    this.bones.name = 'Aurel state-driven crew bones';
    this.bones.needsUpdate = true;
    this.slots = [0, 1].map(() =>
      new T.InstancedBufferAttribute(new Float32Array(ACTORS), 1).setUsage(T.DynamicDrawUsage),
    ) as [T.InstancedBufferAttribute, T.InstancedBufferAttribute];
    const makeCloth = (role: 'crew_high' | 'crew_mid', i: 0 | 1) => {
      const g = peopleGeometry(role);
      g.setAttribute('crewSlot', this.slots[i]);
      const material = new T.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.9,
      });
      material.userData.weatherSurface = 'fabric';
      installCrewSkin(material, this.bones, ACTORS, true);
      const batch = new T.InstancedMesh(g, material, ACTORS);
      const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
      installCrewSkin(depth, this.bones, ACTORS, false);
      batch.customDepthMaterial = depth;
      // Point-light shadows must use the same bones as the normal/shadow pass.
      const distance = new T.MeshDistanceMaterial();
      installCrewSkin(distance, this.bones, ACTORS, false);
      batch.customDistanceMaterial = distance;
      return batch;
    };
    this.cloth = [makeCloth('crew_high', 0), makeCloth('crew_mid', 1)];
    this.heads = this.batch(peopleGeometry('helmet'), ACTORS, 0.35, 0.08);
    this.gloves = [
      this.batch(leftCrewGloveGeometry(), ACTORS, 0.85),
      this.batch(peopleGeometry('glove'), ACTORS, 0.85),
    ];
    this.guns = this.batch(peopleGeometry('wheel_gun'), MAX_PIT_CREWS * 4, 0.37, 0.55);
    this.tires = this.batch(peopleGeometry('spare_tire'), MAX_PIT_CREWS * 8, 0.9);
    this.jacks = this.batch(peopleGeometry('jack_base'), MAX_PIT_CREWS * 2, 0.4, 0.65);
    this.handles = this.batch(
      new T.CylinderGeometry(0.018, 0.018, 1, 10),
      MAX_PIT_CREWS * 7,
      0.42,
      0.5,
    );
    this.signals = this.batch(
      new T.CylinderGeometry(0.14, 0.14, 0.018, 24).rotateX(Math.PI / 2),
      MAX_PIT_CREWS,
      0.6,
    );
    (this.handles.material as T.MeshStandardMaterial).color.setHex(0x838e91);
    (this.signals.material as T.MeshStandardMaterial).color.setHex(0xd3aa4d);
    this.batches = [
      ...this.cloth,
      this.heads,
      ...this.gloves,
      this.guns,
      this.tires,
      this.jacks,
      this.handles,
      this.signals,
    ];
    this.machinery = new PitMachinery(
      [
        { mesh: this.guns, perCrew: 4 },
        { mesh: this.jacks, perCrew: 2 },
        { mesh: this.handles, perCrew: 7 },
        { mesh: this.signals, perCrew: 1 },
      ],
      MAX_PIT_CREWS,
    );
    this.root.name = 'Authored state-driven pit personnel';
    this.root.userData.authoredPeople = PEOPLE_ASSET;
    for (const batch of this.batches) {
      batch.count = 0;
      batch.frustumCulled = false; // per-car distance rejection below; bones exceed rest bounds
      batch.castShadow = true;
      batch.receiveShadow = true;
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
      if (![this.guns, this.jacks, this.handles, this.signals].includes(batch))
        this.root.add(batch);
    }
    this.root.add(this.machinery);
  }
  private batch(geometry: T.BufferGeometry, count: number, roughness: number, metalness = 0) {
    return new T.InstancedMesh(
      geometry,
      new T.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: !!geometry.getAttribute('color'),
        roughness,
        metalness,
      }),
      count,
    );
  }
  private put(batch: T.InstancedMesh, local: T.Matrix4) {
    if (batch.count >= batch.instanceMatrix.count) throw new Error('Pit crew capacity exceeded');
    this.matrix.multiplyMatrices(this.car.matrix, local);
    batch.setMatrixAt(batch.count++, this.matrix);
  }
  private propAt(batch: T.InstancedMesh, position: T.Vector3, quaternion?: T.Quaternion) {
    this.prop.position.copy(position);
    this.prop.quaternion.copy(quaternion ?? this.rotation.identity());
    this.prop.scale.copy(UNIT);
    this.prop.updateMatrix();
    this.put(batch, this.prop.matrix);
    return this.prop.matrix;
  }
  private tube(a: T.Vector3, b: T.Vector3, radius = 1) {
    this.direction.copy(b).sub(a);
    const length = this.direction.length();
    this.prop.position.copy(a).add(b).multiplyScalar(0.5);
    this.prop.quaternion.setFromUnitVectors(UP, this.direction.normalize());
    this.prop.scale.set(radius, Math.max(length, 1e-4), radius);
    this.prop.updateMatrix();
    this.put(this.handles, this.prop.matrix);
  }
  private hand(i: number, grip: T.Vector3, orientation: T.Quaternion) {
    // The glove's curled fingers have a measured local grip centre; its cuff
    // supplies the skin's wrist target rather than stretching arms to props.
    this.grips[i].copy(grip);
    this.orientations[i].copy(orientation);
    this.local.copy(GRIP).applyQuaternion(orientation);
    this.target.copy(grip).sub(this.local);
    this.gloveMatrices[i].compose(this.target, orientation, UNIT);
    this.wrists[i].copy(CUFF).applyMatrix4(this.gloveMatrices[i]);
  }
  private person(
    car: number,
    role: PitRole,
    wheel: number,
    x: number,
    floor: number,
    z: number,
    yaw: number,
    hip: number,
    lean: number,
    detail: 0 | 1,
    spread = 0.15,
  ) {
    this.actor.position.set(x, floor, z);
    this.actor.rotation.set(0, yaw, 0);
    this.actor.scale.copy(UNIT);
    this.actor.updateMatrix();
    this.pose.set(this.actor.matrix, hip, lean, this.wrists, spread);
    this.pose.write(this.boneData, this.actorSlot);
    const cloth = this.cloth[detail];
    this.slots[detail].setX(cloth.count, this.actorSlot++);
    cloth.setColorAt(
      cloth.count,
      palette[(car * 7 + wheel + (role === 'gun' ? 1 : 2)) % palette.length],
    );
    this.put(cloth, this.actor.matrix);
    this.actorWorld.multiplyMatrices(this.car.matrix, this.actor.matrix);
    this.prop.position.copy(this.pose.joints[2]);
    this.prop.quaternion.copy(this.pose.rotations[2]);
    this.prop.scale.copy(UNIT);
    this.prop.updateMatrix();
    this.prop.matrix.premultiply(this.actor.matrix);
    this.put(this.heads, this.prop.matrix);
    let wristError = 0,
      gripError = 0;
    for (let i = 0; i < 2; i++) {
      this.put(this.gloves[i], this.gloveMatrices[i]);
      const fore = i === 0 ? 4 : 7;
      wristError = Math.max(
        wristError,
        this.pose.endpoint(fore, CREW_REST[fore + 1], this.local).distanceTo(this.wrists[i]),
      );
      gripError = Math.max(
        gripError,
        this.local.copy(GRIP).applyMatrix4(this.gloveMatrices[i]).distanceTo(this.grips[i]),
      );
    }
    // Small CPU witnesses are retained for inspection; they are not art approval.
    this.records.push({
      car,
      role,
      wheel,
      reachable: [...this.pose.reachable],
      wristError,
      gripError,
      floorY: floor,
      root: this.actorWorld.toArray(),
    });
    this.activeActors++;
  }
  update(frame: Float32Array, camera: T.Vector3, visible = true) {
    const count = frame[H.CARS];
    if (
      !Number.isInteger(count) ||
      count < 0 ||
      count > MAX_PIT_CREWS ||
      frame.length < HEADER + count * CAR_STRIDE ||
      !Number.isFinite(camera.x + camera.y + camera.z)
    )
      throw new Error('Invalid pit crew frame');
    if (!this.cache.prepare(frame, camera, visible)) return;
    for (const batch of this.batches) batch.count = 0;
    this.records.length = 0;
    this.actorSlot = this.activeActors = this.activeCrews = 0;
    for (let id = 0; id < count && visible; id++) {
      const o = carBase(id),
        phase = frame[o + F.PIT_PHASE],
        clock = frame[o + F.PIT_CLOCK];
      if (!Number.isFinite(phase + clock + frame[o + F.SPEED]))
        throw new Error('Invalid pit crew state');
      if (this.cache.levels[id] < 0) continue;
      this.car.position.set(frame[o + F.X], frame[o + F.Y], frame[o + F.Z]);
      const distance = this.car.position.distanceTo(camera);
      if (distance > PIT_CREW_MAX_DISTANCE) continue;
      this.car.quaternion.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      if (
        !Number.isFinite(
          this.car.position.lengthSq() +
            this.car.quaternion.lengthSq() +
            clock +
            frame[o + F.JACK_HEIGHT],
        ) ||
        this.car.quaternion.lengthSq() < 0.5
      )
        throw new Error('Invalid pit crew transform');
      this.car.quaternion.normalize();
      this.car.updateMatrix();
      this.activeCrews++;
      const floor = -0.43 - frame[o + F.JACK_HEIGHT],
        detail = distance < 45 ? 0 : 1;
      const clear = phase === 5 ? smooth(3.7, 5.1, clock) * 0.44 : 0;
      for (let wheel = 0; wheel < 4; wheel++) {
        const [hubX, , hubZ] = WHEEL_POSITIONS[wheel],
          side = Math.sign(hubX);
        const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        if (!Number.isFinite(frame[p + W.LENGTH]) || frame[p + W.LENGTH] < 0)
          throw new Error('Invalid crew wheel contact');
        const length = frame[p + W.LENGTH] || 0.25,
          hubY = 0.05 - length;
        const off = serviceWheelOffset(phase, clock, frame[p + W.LOAD]);
        const yaw = (-side * Math.PI) / 2;
        const gunAway =
          phase === 3
            ? smooth(1.0, 1.35, clock)
            : phase === 4
              ? 1 - smooth(3.05, 3.4, clock)
              : phase === 5
                ? smooth(3.5, 3.9, clock)
                : 0;
        const socket = new T.Vector3(hubX + side * (0.21 + 0.28 * gunAway + clear), hubY, hubZ);
        const gunRotation = new T.Quaternion().setFromAxisAngle(UP, yaw);
        const gunMatrix = this.propAt(this.guns, socket, gunRotation).clone();
        this.hand(
          0,
          new T.Vector3(0, -0.083, -0.203).applyMatrix4(gunMatrix),
          gunRotation.clone().multiply(new T.Quaternion().setFromAxisAngle(FORWARD, Math.PI / 2)),
        );
        this.hand(
          1,
          new T.Vector3(0, 0, -0.1).applyMatrix4(gunMatrix),
          gunRotation.clone().multiply(new T.Quaternion().setFromAxisAngle(UP, -Math.PI / 2)),
        );
        this.person(
          id,
          'gun',
          wheel,
          hubX + side * (0.87 + 0.28 * gunAway + clear),
          floor,
          hubZ,
          yaw,
          clamp(hubY - floor + 0.08, 0.2, 0.38),
          0.85,
          detail,
        );
        // Removal and installation actors occupy separate fore/aft stations.
        // The mounted wheel is still rendered by FormulaCar, never duplicated.
        for (const install of [false, true]) {
          const station = install ? 1 : -1;
          // Approach/clearance are bounded by the actual service clock. At
          // 2.2 s the simulation exchanges compounds: the old carried wheel
          // and new mounted wheel meet the same withdrawal endpoint. Nothing
          // depends on previous render frames, including a replay rewind.
          const engagement = install
            ? phase < 4
              ? smooth(1.35, 2.2, clock)
              : phase === 4
                ? 1
                : 1 - smooth(3.5, 4.15, clock)
            : phase < 3
              ? smooth(0.2, 0.8, clock)
              : phase === 3
                ? 1
                : 1 - smooth(2.2, 2.9, clock);
          const transferOffset = (install && phase < 4) || (!install && phase >= 4) ? 0.48 : off;
          const center = new T.Vector3(
            hubX + side * (0.98 + clear),
            floor + 0.41,
            hubZ + station * 0.8,
          );
          center.lerp(new T.Vector3(hubX + side * (0.21 + transferOffset), hubY, hubZ), engagement);
          const hasSpare = install ? phase < 4 : phase >= 4;
          if (hasSpare) this.propAt(this.tires, center);
          // Hands touch the sidewall at two points on the carried/working wheel.
          const actorX = center.x + side * (0.45 - 0.05 * engagement),
            actorZ = center.z + station * (0.3 + 0.5 * engagement);
          const actorYaw = Math.atan2(center.x - actorX, center.z - actorZ);
          const q = new T.Quaternion().setFromAxisAngle(UP, actorYaw);
          for (let hand = 0; hand < 2; hand++) {
            // Approach-side grips: a mechanic beside a tyre cannot reach its
            // opposite fore/aft edge through the wheel. Slide along the real
            // sidewall arc while approaching, rather than through its centre.
            const carryAngle = side * (hand === 0 ? -1 : 1) * Math.atan2(0.26, 0.12);
            const workAngle = station * (hand === 0 ? 0.6 : 1.25);
            const angle = carryAngle + (workAngle - carryAngle) * engagement;
            const radius = Math.hypot(0.26, 0.12);
            const grip = center
              .clone()
              .add(new T.Vector3(side * 0.1, Math.cos(angle) * radius, Math.sin(angle) * radius));
            this.hand(hand, grip, q);
          }
          const workingHip = clamp(hubY - floor + 0.04, 0.24, 0.43);
          this.person(
            id,
            install ? 'install' : 'remove',
            wheel,
            actorX,
            floor,
            actorZ,
            actorYaw,
            0.43 + (workingHip - 0.43) * engagement,
            0.35 + 0.5 * engagement,
            detail,
            0.11,
          );
        }
      }
      for (const end of [-1, 1]) {
        const lift = clamp(frame[o + F.JACK_HEIGHT], 0, 0.22);
        const jack = new T.Vector3(0, floor, end * 2.05);
        this.propAt(
          this.jacks,
          jack,
          new T.Quaternion().setFromAxisAngle(UP, end > 0 ? Math.PI : 0),
        );
        const base = new T.Vector3(0, floor + 0.23, end * 2.05);
        const top = new T.Vector3(0, floor + 0.23 + lift, end * 2.05);
        this.tube(base, top, 1.9);
        const bar = new T.Vector3(0, floor + 0.9 - lift, end * 2.76);
        this.tube(new T.Vector3(0, floor + 0.09, end * 2.05), bar);
        this.tube(
          bar.clone().add(new T.Vector3(-0.17, 0, 0)),
          bar.clone().add(new T.Vector3(0.17, 0, 0)),
        );
        const yaw = end > 0 ? Math.PI : 0,
          q = new T.Quaternion().setFromAxisAngle(UP, yaw);
        for (let h = 0; h < 2; h++)
          this.hand(
            h,
            bar.clone().add(new T.Vector3((h ? 1 : -1) * (end > 0 ? -1 : 1) * 0.12, 0, 0)),
            q,
          );
        this.person(
          id,
          end > 0 ? 'front-jack' : 'rear-jack',
          -1,
          0,
          floor,
          end * 3.2,
          yaw,
          0.69,
          0.42,
          detail,
          0.14,
        );
      }
      const signX = 2.7 + clear,
        signZ = 2.7;
      const q = new T.Quaternion().setFromAxisAngle(UP, -Math.PI / 2);
      const grip = new T.Vector3(signX, floor + 0.96, signZ - 0.2);
      this.tube(
        grip.clone().add(new T.Vector3(0, -0.36, 0)),
        grip.clone().add(new T.Vector3(0, 0.48, 0)),
      );
      this.propAt(this.signals, grip.clone().add(new T.Vector3(0, 0.48, 0)), q);
      for (let h = 0; h < 2; h++)
        this.hand(
          h,
          grip.clone().add(new T.Vector3(0, h * 0.12, 0)),
          q.clone().multiply(new T.Quaternion().setFromAxisAngle(FORWARD, Math.PI / 2)),
        );
      this.person(id, 'release', -1, signX + 0.42, floor, signZ, -Math.PI / 2, 0.84, 0.08, detail);
    }
    this.machinery.update(this.activeCrews);
    this.root.visible = this.activeCrews > 0;
    if (this.activeActors) this.bones.needsUpdate = true;
    this.slots.forEach((slot, i) => {
      slot.clearUpdateRanges();
      if (this.cloth[i].count) {
        slot.addUpdateRange(0, this.cloth[i].count);
        slot.needsUpdate = true;
      }
    });
    for (const batch of this.batches) {
      batch.instanceMatrix.clearUpdateRanges();
      batch.instanceColor?.clearUpdateRanges();
      if (!batch.count) continue;
      batch.instanceMatrix.addUpdateRange(0, batch.count * 16);
      batch.instanceMatrix.needsUpdate = true;
      if (batch.instanceColor) {
        batch.instanceColor.addUpdateRange(0, batch.count * 3);
        batch.instanceColor.needsUpdate = true;
      }
    }
    this.cache.commit();
  }
  actorCountFor(car: number) {
    let count = 0;
    for (const record of this.records) if (record.car === car) count++;
    return count;
  }
  summary() {
    let unreachableArms = 0,
      maxWristError = 0,
      maxGripError = 0;
    for (const record of this.records) {
      unreachableArms += record.reachable.filter((r) => !r).length;
      maxWristError = Math.max(maxWristError, record.wristError);
      maxGripError = Math.max(maxGripError, record.gripError);
    }
    return {
      ...PEOPLE_ASSET,
      poseBuilds: this.cache.builds,
      poseReuses: this.cache.reuses,
      crews: this.activeCrews,
      actors: this.activeActors,
      nearActors: this.cloth[0].count,
      midActors: this.cloth[1].count,
      activeDrawBatches: this.root.children.filter((b) => (b as T.InstancedMesh).count > 0).length,
      boneTextureBytes: this.boneData.byteLength,
      machineryTextureBytes: this.machinery.instanceMatrix.array.byteLength,
      unreachableArms,
      maxWristError,
      maxGripError,
    };
  }
  diagnostics() {
    return {
      ...PEOPLE_ASSET,
      poseBuilds: this.cache.builds,
      poseReuses: this.cache.reuses,
      crews: this.activeCrews,
      actors: this.activeActors,
      activeDrawBatches: this.root.children.filter((b) => (b as T.InstancedMesh).count > 0).length,
      boneTextureBytes: this.boneData.byteLength,
      machineryTextureBytes: this.machinery.instanceMatrix.array.byteLength,
      counts: this.batches.map((b) => b.count),
      roles: this.records.map((r) => ({ ...r, root: [...r.root], reachable: [...r.reachable] })),
    };
  }
  /** The renderer's general traversal owns geometry/material disposal. */
  dispose() {
    this.bones.dispose();
    this.machinery.dispose();
    // These four meshes are bounded transform writers, not rendered children.
    // The palette batch owns copied geometry; dispose its source prototypes here.
    for (const batch of [this.guns, this.jacks, this.handles, this.signals]) {
      batch.geometry.dispose();
      (batch.material as T.Material).dispose();
      batch.dispose();
    }
  }
}
