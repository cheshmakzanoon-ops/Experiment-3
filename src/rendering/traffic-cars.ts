import * as T from 'three';
import {
  TF,
  TRAFFIC_FLAG,
  TRAFFIC_HEADER,
  TRAFFIC_STRIDE,
  TRAFFIC_VERSION,
} from '../simulation/open-world/ambient-traffic.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import { installSpecularIBL } from './studio/ibl-energy.ts';
import {
  TRAFFIC_BODY_PARTS,
  TRAFFIC_VISUAL_PROFILES,
  trafficMorphGeometry,
  trafficWheelGeometry,
  distantTrafficWheelGeometry,
} from './traffic-car-geometry.ts';

/** Most ambient cars drawn at once (the simulation caps the field lower). */
export const TRAFFIC_CAPACITY = 48;
const PAINT = [
  0xd8dde2, 0x1f2a36, 0x8a1c1c, 0x2f5d8c, 0x3d3f42, 0xb7a27a, 0x24553a, 0xe2e2da, 0x6b6f76,
  0x7a2f55,
];
const X_AXIS = new T.Vector3(1, 0, 0),
  Y_AXIS = new T.Vector3(0, 1, 0);

/** Three optical circuits share one instanced draw. Pigment comes from the
 * lens vertices. The instance stores independent running, stop and signal
 * intensities in its RGB components instead of tinting the whole car. */
function trafficLampMaterial() {
  const material = new T.MeshBasicMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float trafficLampCircuit;\nattribute float trafficSignalSide;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
  float drive = trafficLampCircuit < 0.5 ? instanceColor.r
              : trafficLampCircuit < 1.5 ? instanceColor.g : instanceColor.b;
  if (trafficLampCircuit > 1.5 && position.x * trafficSignalSide < 0.0) drive = 0.12;
  vColor.xyz = color * drive;
#endif`,
      );
  };
  material.customProgramCacheKey = () => 'festival-traffic-optics-v2';
  return material;
}

/** Version 2 contains the same first thirteen fields. Its wheel travel and
 * poses can still be played after v3 added chassis movement. */
function frameStride(block: Float32Array | null) {
  return block?.[2] === TRAFFIC_VERSION ? TRAFFIC_STRIDE : block?.[2] === 2 ? 13 : 0;
}
/** Versioned auxiliary frames are independently validated: a stale worker or
 * truncated block must never become NaN transforms or be read at a new stride. */
function blockCount(block: Float32Array | null) {
  const stride = frameStride(block);
  if (!stride || !block || block.length < TRAFFIC_HEADER) return 0;
  const count = block[0];
  if (!Number.isInteger(count) || count < 0 || block.length !== TRAFFIC_HEADER + count * stride)
    return 0;
  return Math.min(TRAFFIC_CAPACITY, count);
}

/** Four native morph-instanced body materials and one wheel draw per occupied
 * level of detail. Mixed near/far fields add at most one wheel draw. Morph profiles have fixed topology and
 * are capped by an explicit palette rather than growing with the registry. */
export class TrafficCars {
  readonly root = new T.Group();
  readonly bodies: T.InstancedMesh;
  readonly lamps: T.InstancedMesh;
  readonly wheels: T.InstancedMesh;
  private readonly signalSide = new T.InstancedBufferAttribute(new Float32Array(TRAFFIC_CAPACITY), 1).setUsage(T.DynamicDrawUsage);
  private readonly nearWheel = trafficWheelGeometry();
  private readonly farWheel = distantTrafficWheelGeometry();
  private readonly farWheels: T.InstancedMesh;
  private readonly nearMask = new Uint8Array(TRAFFIC_CAPACITY);
  private previousNear = new Set<number>();
  private nearNow = new Set<number>();
  private readonly bodyBatches: readonly T.InstancedMesh[];
  private readonly batches: readonly T.InstancedMesh[];
  private readonly morph: T.Mesh;
  private readonly matrix = new T.Matrix4();
  private readonly wheelMatrix = new T.Matrix4();
  private readonly position = new T.Vector3();
  private readonly previous = new T.Vector3();
  private readonly wheelPosition = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private readonly qa = new T.Quaternion();
  private readonly wheelQuaternion = new T.Quaternion();
  private readonly sprungPosition = new T.Vector3();
  private readonly pivotOffset = new T.Vector3();
  private readonly sprungOrientation = new T.Quaternion();
  private readonly localSpring = new T.Quaternion();
  private readonly springEuler = new T.Euler(0, 0, 0, 'ZXY');
  private readonly steerQuaternion = new T.Quaternion();
  private readonly rollQuaternion = new T.Quaternion();
  private readonly scale = new T.Vector3(1, 1, 1);
  private readonly wheelScale = new T.Vector3();
  private readonly colour = new T.Color();
  private readonly index = new Map<number, number>();
  private readonly profiles = new Map(TRAFFIC_VISUAL_PROFILES.map((p, i) => [p.index, i]));
  count = 0;

  constructor() {
    this.root.name = 'Ambient traffic';
    const geometry = trafficMorphGeometry();
    this.bodies = new T.InstancedMesh(
      geometry.paint,
      new T.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.34,
        metalness: 0.22,
        clearcoat: 0.8,
        clearcoatRoughness: 0.2,
      }),
      TRAFFIC_CAPACITY,
    );
    this.bodies.name = 'Ambient traffic bodies (instanced)';
    this.bodies.castShadow = this.bodies.receiveShadow = true;
    const glazing = new T.InstancedMesh(
      geometry.glazing,
      new T.MeshPhysicalMaterial({
        color: 0x293b42,
        vertexColors: true,
        roughness: 0.13,
        metalness: 0.04,
        clearcoat: 1,
        clearcoatRoughness: 0.065,
        ior: 1.52,
      }),
      TRAFFIC_CAPACITY,
    );
    glazing.name = 'Ambient traffic glazing (instanced)';
    const fixtures = new T.InstancedMesh(
      geometry.trim,
      new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.56,
        metalness: 0.18,
        side: T.DoubleSide,
      }),
      TRAFFIC_CAPACITY,
    );
    fixtures.name = 'Ambient traffic trim (instanced)';
    fixtures.castShadow = fixtures.receiveShadow = true;
    geometry.lamps.setAttribute('trafficSignalSide', this.signalSide);
    this.lamps = new T.InstancedMesh(geometry.lamps, trafficLampMaterial(), TRAFFIC_CAPACITY);
    this.lamps.name = 'Ambient traffic lamps (instanced)';
    this.wheels = new T.InstancedMesh(
      this.nearWheel,
      new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.64, metalness: 0.16 }),
      TRAFFIC_CAPACITY * 4,
    );
    this.wheels.name = 'Ambient traffic wheels (instanced)';
    this.wheels.castShadow = this.wheels.receiveShadow = true;
    this.farWheels = new T.InstancedMesh(this.farWheel, this.wheels.material, TRAFFIC_CAPACITY * 4);
    this.farWheels.name = 'Ambient traffic distant wheels (instanced)';
    this.farWheels.castShadow = this.farWheels.receiveShadow = true;
    this.farWheels.frustumCulled = false;
    this.farWheels.count = 0;
    this.farWheels.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.bodyBatches = [this.bodies, glazing, fixtures, this.lamps];
    this.batches = [...this.bodyBatches, this.wheels];
    this.morph = new T.Mesh(geometry.paint, this.bodies.material);
    // Allocate the whole 48-instance morph texture before setting draw counts
    // to zero. Allocating on the first update would size it to that frame.
    for (const mesh of this.bodyBatches) mesh.setMorphAt(0, this.morph);
    for (const mesh of this.batches) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.root.add(mesh);
    }
    for (let i = 0; i < TRAFFIC_CAPACITY; i++) {
      this.bodies.setColorAt(i, this.colour.setRGB(1, 1, 1));
      this.lamps.setColorAt(i, this.colour);
    }
    installSpecularIBL(this.root);
  }

  /** Pose, wheel phase and signal cadence follow the recorded traffic clocks. */
  update(
    a: Float32Array | null,
    b: Float32Array | null,
    alpha: number,
    night: number,
    time: number,
    camera?: T.PerspectiveCamera,
    viewportHeight = 720,
  ) {
    const n = blockCount(b);
    if (!n || !b) {
      for (const mesh of this.batches) mesh.count = 0;
      this.farWheels.count = 0;
      this.farWheels.removeFromParent();
      this.previousNear.clear();
      this.count = 0;
      return;
    }
    // Use tyre size in projected pixels, including photo zoom. Keep hysteresis
    // by vehicle ID, so field reordering cannot change a wheel's geometry.
    const proj = camera?.projectionMatrix.elements;
    const pixels = proj && viewportHeight > 0
      ? viewportHeight * proj[5] * 0.5 * Math.hypot(1, 1 / proj[0], 1 / proj[5]) : 0;
    let nearCount = 0;
    this.nearNow.clear();
    const blend = Number.isFinite(alpha) ? T.MathUtils.clamp(alpha, 0, 1) : 1;
    const previousCount = blockCount(a),
      oldStride = frameStride(a),
      stride = frameStride(b);
    const timeB = Number.isFinite(b[1]) ? b[1] : time;
    const signalTime =
      a && previousCount && Number.isFinite(a[1]) ? a[1] + (timeB - a[1]) * blend : timeB;
    this.index.clear();
    if (a)
      for (let k = 0; k < previousCount; k++)
        this.index.set(a[TRAFFIC_HEADER + k * oldStride + TF.ID], k);
    for (let k = 0; k < n; k++) {
      const o = TRAFFIC_HEADER + k * stride,
        id = b[o + TF.ID],
        previous = this.index.get(id);
      const p = previous === undefined || !a ? -1 : TRAFFIC_HEADER + previous * oldStride;
      this.position.set(b[o + TF.X], b[o + TF.Y], b[o + TF.Z]);
      this.quaternion.set(b[o + TF.QX], b[o + TF.QY], b[o + TF.QZ], b[o + TF.QW]).normalize();
      let distance = b[o + TF.DISTANCE];
      let curvature = stride === TRAFFIC_STRIDE ? b[o + TF.CURVATURE] : 0;
      let pitch = stride === TRAFFIC_STRIDE ? b[o + TF.PITCH] : 0;
      let roll = stride === TRAFFIC_STRIDE ? b[o + TF.ROLL] : 0;
      if (p >= 0 && a && a[p + TF.VEHICLE] === b[o + TF.VEHICLE]) {
        this.previous.set(a[p + TF.X], a[p + TF.Y], a[p + TF.Z]);
        this.qa.set(a[p + TF.QX], a[p + TF.QY], a[p + TF.QZ], a[p + TF.QW]).normalize();
        const travelled = distance - a[p + TF.DISTANCE];
        // Heading comes from each body's forward vector; bank and pitch do
        // not masquerade as steer, and atan2 wraps the +/-pi seam correctly.
        if (stride === TRAFFIC_STRIDE) {
          const oldCurvature = oldStride === TRAFFIC_STRIDE ? a[p + TF.CURVATURE] : curvature;
          curvature = T.MathUtils.lerp(oldCurvature, curvature, blend);
          pitch = T.MathUtils.lerp(
            oldStride === TRAFFIC_STRIDE ? a[p + TF.PITCH] : 0,
            pitch,
            blend,
          );
          roll = T.MathUtils.lerp(oldStride === TRAFFIC_STRIDE ? a[p + TF.ROLL] : 0, roll, blend);
        } else {
          const ax = 2 * (this.qa.x * this.qa.z + this.qa.w * this.qa.y);
          const az = 1 - 2 * (this.qa.x * this.qa.x + this.qa.y * this.qa.y);
          const bx =
            2 * (this.quaternion.x * this.quaternion.z + this.quaternion.w * this.quaternion.y);
          const bz =
            1 - 2 * (this.quaternion.x * this.quaternion.x + this.quaternion.y * this.quaternion.y);
          if (Math.abs(travelled) > 0.002)
            curvature = Math.atan2(bx * az - bz * ax, ax * bx + az * bz) / travelled;
        }
        distance = a[p + TF.DISTANCE] + travelled * blend;
        this.position.copy(this.previous.lerp(this.position, blend));
        this.quaternion.copy(this.qa.slerp(this.quaternion, blend));
      }
      const vehicleIndex = Math.round(b[o + TF.VEHICLE]),
        def = vehicleAt(vehicleIndex);
      // The palette is fixed. A newly added car gets the nearest existing
      // footprint, never an unbounded set of additional GPU morph targets.
      let profileIndex = this.profiles.get(vehicleIndex);
      if (profileIndex === undefined) {
        profileIndex = 0;
        let best = Infinity;
        for (let i = 0; i < TRAFFIC_VISUAL_PROFILES.length; i++) {
          const d = TRAFFIC_VISUAL_PROFILES[i].vehicle.halfExtents;
          const error =
            Math.abs(d[0] - def.halfExtents[0]) +
            Math.abs(d[1] - def.halfExtents[1]) +
            Math.abs(d[2] - def.halfExtents[2]);
          if (error < best) {
            best = error;
            profileIndex = i;
          }
        }
        this.profiles.set(vehicleIndex, profileIndex);
      }
      const profile = TRAFFIC_VISUAL_PROFILES[profileIndex];
      // Existing traffic profiles are already in physical metres. Fallback
      // content scales its whole reference car, keeping wheels in its arches.
      this.scale.set(
        def.halfExtents[0] / profile.vehicle.halfExtents[0],
        def.halfExtents[1] / profile.vehicle.halfExtents[1],
        def.halfExtents[2] / profile.vehicle.halfExtents[2],
      );
      // Snapshots store the collision-box centre vertically over the road.
      // The render origin uses the sheet's true half-height along the road
      // normal. This also seats the low hypercars on their tyres on a bank.
      const halfHeight = def.halfExtents[1];
      const normalY = 1 - 2 * (this.quaternion.x ** 2 + this.quaternion.z ** 2);
      this.position.y += halfHeight / Math.max(0.4, normalY) - Math.max(0.5, halfHeight);
      const pivotY = def.spec.linkCentreHeight - halfHeight;
      this.localSpring.setFromEuler(this.springEuler.set(pitch, 0, roll, 'ZXY'));
      this.sprungOrientation.copy(this.quaternion).multiply(this.localSpring);
      this.sprungPosition.set(0, pivotY, 0).applyQuaternion(this.quaternion).add(this.position);
      this.pivotOffset.set(0, pivotY, 0).applyQuaternion(this.sprungOrientation);
      this.sprungPosition.sub(this.pivotOffset);
      this.matrix.compose(this.sprungPosition, this.sprungOrientation, this.scale);
      const weights = this.morph.morphTargetInfluences!;
      weights.fill(0);
      if (profileIndex > 0) weights[profileIndex - 1] = 1;
      for (const mesh of this.bodyBatches) {
        mesh.setMatrixAt(k, this.matrix);
        mesh.setMorphAt(k, this.morph);
      }
      this.bodies.setColorAt(
        k,
        this.colour.setHex(PAINT[Math.abs(Math.round(id) * 7919) % PAINT.length]),
      );
      const flags = b[o + TF.FLAGS],
        hazard = (flags & TRAFFIC_FLAG.HAZARD) !== 0;
      const side = hazard ? 0 : flags & TRAFFIC_FLAG.LEFT ? 1 : flags & TRAFFIC_FLAG.RIGHT ? -1 : 0;
      // The hazard circuit drives both sides. Ordinary signals have a stable
      // per-vehicle phase and continue blinking during a stationary queue.
      const flash = hazard
        ? Math.floor(signalTime * 2.5) % 2 === 0
        : side !== 0 && Math.floor(signalTime * 2.5 + (id * 0.377) % 2) % 2 === 0;
      this.signalSide.setX(k, side);
      const head = 0.38 + night * 2.15;
      const tail = b[o + TF.BRAKE] > 0.05 ? 2.6 : 0.28 + night * 0.58;
      this.lamps.setColorAt(k, this.colour.setRGB(head, tail, flash ? 3 : 0.12));
      const wheelDef = profile.vehicle,
        radius = wheelDef.spec.wheelRadius;
      const threshold = this.previousNear.has(id) ? 9 : 12;
      const reach = radius * this.scale.y * pixels / threshold + def.halfExtents[2] + 0.8;
      const near = !camera || !pixels || this.position.distanceToSquared(camera.position) <= reach * reach;
      this.nearMask[k] = Number(near);
      if (near) {
        this.nearNow.add(id);
        nearCount++;
      }
      const phase = T.MathUtils.euclideanModulo(distance / (radius * this.scale.y), Math.PI * 2);
      this.rollQuaternion.setFromAxisAngle(X_AXIS, phase);
      for (let wheel = 0; wheel < 4; wheel++) {
        const [x, , z] = wheelDef.wheelPositions[wheel];
        const steer =
          wheel < 2
            ? T.MathUtils.clamp(
                Math.atan2(def.spec.wheelbase * curvature, 1 - x * this.scale.x * curvature),
                -def.spec.maxSteer,
                def.spec.maxSteer,
              )
            : 0;
        this.steerQuaternion.setFromAxisAngle(Y_AXIS, steer);
        this.wheelQuaternion
          .copy(this.quaternion)
          .multiply(this.steerQuaternion)
          .multiply(this.rollQuaternion);
        this.wheelPosition
          .set(x, radius - wheelDef.halfExtents[1], z)
          .multiply(this.scale)
          .applyQuaternion(this.quaternion)
          .add(this.position);
        const width = profile.sheet.wheels.width[wheel < 2 ? 0 : 1];
        // Equal radial scale keeps tyres circular even on long/tall bodies.
        this.wheelScale.set(width * this.scale.x, radius * this.scale.y, radius * this.scale.y);
        this.wheelMatrix.compose(this.wheelPosition, this.wheelQuaternion, this.wheelScale);
        this.wheels.setMatrixAt(k * 4 + wheel, this.wheelMatrix);
      }
    }
    this.count = n;
    for (const mesh of this.bodyBatches) {
      mesh.count = n;
      mesh.morphTexture!.needsUpdate = true;
    }
    const previous = this.previousNear;
    this.previousNear = this.nearNow;
    this.nearNow = previous;
    this.wheels.geometry = nearCount ? this.nearWheel : this.farWheel;
    if (nearCount > 0 && nearCount < n) {
      // All four authoritative transforms are already in snapshot order.
      // Compact the near entries forward in place and copy the distant ones
      // to their lighter batch. The read cursor always stays ahead of writes.
      const main = this.wheels.instanceMatrix.array as Float32Array;
      const distant = this.farWheels.instanceMatrix.array as Float32Array;
      let nearRow = 0, farRow = 0;
      for (let k = 0; k < n; k++) {
        const start = k * 64;
        if (this.nearMask[k]) {
          if (nearRow !== k) main.copyWithin(nearRow * 64, start, start + 64);
          nearRow++;
        } else {
          distant.set(main.subarray(start, start + 64), farRow * 64);
          farRow++;
        }
      }
      this.wheels.count = nearCount * 4;
      this.farWheels.count = (n - nearCount) * 4;
      this.farWheels.instanceMatrix.needsUpdate = true;
      if (!this.farWheels.parent) this.root.add(this.farWheels);
    } else {
      this.wheels.count = n * 4;
      this.farWheels.count = 0;
      this.farWheels.removeFromParent();
    }
    for (const mesh of this.batches) mesh.instanceMatrix.needsUpdate = true;
    this.bodies.instanceColor!.needsUpdate = true;
    this.lamps.instanceColor!.needsUpdate = true;
    this.signalSide.needsUpdate = true;
  }

  /** Auditable upper bounds, independent of traffic density or frame time. */
  get diagnostics() {
    const vertices = Object.fromEntries(
      TRAFFIC_BODY_PARTS.map((part, i) => [
        part,
        this.bodyBatches[i].geometry.getAttribute('position').count,
      ]),
    );
    const bodyVertices = Object.values(vertices).reduce((a, b) => a + b, 0);
    return {
      batches: this.batches.length + Number(this.farWheels.count > 0),
      wheelTriangles: (this.wheels.count * this.wheels.geometry.getAttribute('position').count +
        this.farWheels.count * this.farWheel.getAttribute('position').count) / 3,
      profiles: TRAFFIC_VISUAL_PROFILES.length,
      morphTargets: TRAFFIC_VISUAL_PROFILES.length - 1,
      vertices,
      wheelVertices: this.wheels.geometry.getAttribute('position').count,
      trianglesPerCar:
        (this.bodyBatches.reduce((sum, mesh) => sum + mesh.geometry.index!.count, 0) +
          this.wheels.geometry.getAttribute('position').count * 4) /
        3,
      // Three's native position + normal targets use two RGBA32F texels per
      // vertex; instance weights use one R32F texel per profile and instance.
      morphPayloadBytes:
        bodyVertices * (TRAFFIC_VISUAL_PROFILES.length - 1) * 8 * 4 +
        this.bodyBatches.length * TRAFFIC_CAPACITY * TRAFFIC_VISUAL_PROFILES.length * 4,
    };
  }

  dispose() {
    this.root.removeFromParent();
    for (const mesh of this.batches) {
      if (mesh !== this.wheels) mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
      // InstancedMesh.dispose also releases its owned morphTexture.
      mesh.dispose();
    }
    this.farWheels.removeFromParent();
    this.farWheels.dispose();
    this.previousNear.clear();
    this.nearNow.clear();
    this.nearWheel.dispose();
    this.farWheel.dispose();
    this.root.clear();
    this.index.clear();
  }
}
