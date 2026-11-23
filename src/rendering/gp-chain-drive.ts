import * as T from 'three';
import { clamp, smooth } from '../core/math.ts';
import { B, BIKE_BASE, F, W, WHEEL_BASE, WHEEL_STRIDE } from '../simulation/protocol.ts';
import { ChainLoop, chainLinkPlateGeometry } from './chain-geometry.ts';

/** Original GP prototype drivetrain, in metres, +Z forward and X along the axle.
 * REF 018 supplies chain/plate layering; REF 087 supplies rear assembly context.
 * Dimensions and tooth counts are authored game values, not measured from a still.
 *
 * Two instanced draws retain the individual rollers and waisted side plates.
 * The caller owns the wheel-driven sprocket, swingarm transform and disposal.
 * No source frame, material, wheel transform or wall-clock state is modified.
 */
const TAU = Math.PI * 2;
const REAR_TEETH = 42;
const FRONT_TEETH = 18;
const CHAIN_PITCH = 0.015875;
const REAR_RADIUS = CHAIN_PITCH / (2 * Math.sin(Math.PI / REAR_TEETH));
const FRONT_RADIUS = CHAIN_PITCH / (2 * Math.sin(Math.PI / FRONT_TEETH));
const X = 0.115;
const FREE_SPAN_SAG = 0.016;

/** Signed presentation load, positive when the countershaft drives the wheel.
 * A manual clutch reports signed plate torque. Automatic snapshots report crank
 * output and tyre force separately. Use the negative rear force as evidence of
 * engine braking only while the foot brake is released. */
export function gpChainLoad(frame: Float32Array, car: number) {
  const manual = frame[car + F.CLUTCH_PEDAL] > 0 || frame[car + F.CLUTCH_ENGAGEMENT] > 0;
  let load: number;
  if (manual) {
    load = frame[car + F.CLUTCH_TORQUE] / 55;
  } else {
    const rear = car + WHEEL_BASE + 2 * WHEEL_STRIDE;
    const rearBrake = frame[car + BIKE_BASE + B.REAR_BRAKE];
    const overrun = Math.min(0, frame[rear + W.FX]) * (1 - smooth(0, 0.25, rearBrake));
    load = frame[car + F.ENGINE_TORQUE] / 55 + overrun / 850;
  }
  return Number.isFinite(load) ? clamp(load, -1, 1) : 0;
}

/** To first order the excess arc length of a shallow free span scales with sag
 * squared. Redistribute that fixed reserve as drive torque changes sign. */
export function gpChainSag(load: number, upper: boolean) {
  const share = smooth(-1, 1, upper ? -load : load);
  return FREE_SPAN_SAG * Math.sqrt(share);
}

/** The small cold-headed steel pins have flat peened ends. Independent face
 * normals keep those ends flat and the roller cylindrical. The convex caps
 * triangulate from the perimeter, avoiding two centre fans per moving pin. */
export function gpChainPin() {
  const radius = 0.004,
    half = 0.0255 / 2,
    sides = 6;
  const pos: number[] = [],
    normal: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (const sign of [-1, 1])
    for (let i = 0; i <= sides; i++) {
      const a = (2 * Math.PI * i) / sides,
        x = Math.cos(a),
        z = Math.sin(a);
      pos.push(radius * x, sign * half, radius * z);
      normal.push(x, 0, z);
      uv.push(i / sides, (sign + 1) / 2);
    }
  for (let i = 0; i < sides; i++) {
    const j = i + sides + 1;
    index.push(i, j, j + 1, i, j + 1, i + 1);
  }
  for (const sign of [-1, 1]) {
    const start = pos.length / 3;
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i) / sides,
        x = Math.cos(a),
        z = Math.sin(a);
      pos.push(radius * x, sign * half, radius * z);
      normal.push(0, sign, 0);
      uv.push(0.5 + 0.5 * x, 0.5 + 0.5 * z);
    }
    for (let i = 1; i < sides - 1; i++)
      if (sign > 0) index.push(start, start + i + 1, start + i);
      else index.push(start, start + i, start + i + 1);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

function sprocketGeometry() {
  const shape = new T.Shape();
  // Six stations per 2.2 mm tooth retain the crown and root exactly. The
  // between-station sag is below 0.30 mm, even in the chain close-up.
  for (let i = 0; i <= REAR_TEETH * 6; i++) {
    const angle = (TAU * i) / (REAR_TEETH * 6);
    const radius = REAR_RADIUS - 0.003 + 0.0022 * Math.cos(REAR_TEETH * angle);
    const a = radius * Math.cos(angle),
      b = radius * Math.sin(angle);
    if (i === 0) shape.moveTo(a, b);
    else shape.lineTo(a, b);
  }
  const hole = new T.Path();
  hole.absarc(0, 0, 0.069, 0, TAU, true);
  shape.holes.push(hole);
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: 0.007,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 12,
  });
  geometry.rotateY(Math.PI / 2);
  geometry.computeBoundingSphere();
  return geometry;
}

export class GPChainDrive {
  readonly root = new T.Group();
  readonly sprocket: T.Mesh;
  readonly rollers: T.InstancedMesh;
  readonly plates: T.InstancedMesh;
  readonly links: number;
  private readonly loop: ChainLoop;
  private readonly spacing: number;
  private readonly qRoller = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(0, 0, 1),
    -Math.PI / 2,
  );
  private readonly qLink = new T.Quaternion();
  private readonly axis = new T.Vector3(1, 0, 0);
  private readonly p = new T.Vector3();
  private readonly next = new T.Vector3();
  private readonly midpoint = new T.Vector3();
  private readonly tangent = new T.Vector3();
  private readonly matrix = new T.Matrix4();
  private readonly one = new T.Vector3(1, 1, 1);
  private readonly linkScale = new T.Vector3(1, 1, 1);
  private lastWheelPhase = Number.NaN;
  private lastLoad = Number.NaN;

  constructor(arm: number, steel: T.Material, chainSide: T.Material, aluminium: T.Material) {
    if (!Number.isFinite(arm) || arm < 0.3 || arm > 1.1)
      throw new Error('Invalid GP motorcycle swingarm length');
    // Keep both sprocket wraps and tangent points fixed at every load.
    this.loop = new ChainLoop(arm, REAR_RADIUS, FRONT_RADIUS, X);
    // Even count closes the alternating inner/outer plate pattern at the seam.
    // The shallow free spans share the same excess length throughout a load reversal.
    this.links = 2 * Math.round(this.loop.length / CHAIN_PITCH / 2);
    this.spacing = this.loop.length / this.links;
    this.root.name = 'GP prototype animated steel chain (articulated with swingarm)';
    this.rollers = new T.InstancedMesh(gpChainPin(), steel, this.links);
    this.rollers.name = 'Steel chain pins and rollers';
    this.plates = new T.InstancedMesh(
      chainLinkPlateGeometry(CHAIN_PITCH),
      chainSide,
      this.links * 2,
    );
    this.plates.name = 'Paired articulated link plates';
    const envelope = new T.Box3(
      new T.Vector3(X - 0.016, -REAR_RADIUS - 0.012, -arm - REAR_RADIUS - 0.012),
      new T.Vector3(X + 0.016, REAR_RADIUS + 0.012, FRONT_RADIUS + 0.012),
    );
    for (const mesh of [this.rollers, this.plates]) {
      mesh.castShadow = mesh.receiveShadow = true;
      // Immutable conservative bounds cover every link and phase. Do not
      // disable culling or recompute an instance-wide sphere on each frame.
      mesh.boundingBox = envelope.clone();
      mesh.boundingSphere = envelope.getBoundingSphere(new T.Sphere());
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.root.add(mesh);
    }
    const gear = new T.Mesh(sprocketGeometry(), aluminium);
    gear.name = 'Forged 42-tooth rear drive sprocket';
    gear.position.x = X - 0.0035;
    gear.castShadow = gear.receiveShadow = true;
    this.sprocket = gear;
    this.root.userData.referenceRevision = 'gp-r3.1-chain';
    this.update(0);
  }

  update(rearRotation: number, load = 0) {
    // Reduce before multiplying: even a finite MAX_VALUE must not overflow
    // to an infinite link index. A full revolution permutes 42 (even) links.
    const angle = Number.isFinite(rearRotation) ? ((rearRotation % TAU) + TAU) % TAU : 0;
    const tension = Number.isFinite(load) ? clamp(load, -1, 1) : 0;
    if (angle === this.lastWheelPhase && tension === this.lastLoad) return;
    this.lastWheelPhase = angle;
    this.lastLoad = tension;
    const upperSag = gpChainSag(tension, true);
    const lowerSag = gpChainSag(tension, false);
    // This loop traverses the rear sprocket clockwise in YZ; wheel.rotation.x
    // is anticlockwise. The old positive sign drove the chain backwards.
    const phase = -(angle / TAU) * REAR_TEETH;
    this.loop.sample(phase * this.spacing, this.p, upperSag, lowerSag);
    for (let i = 0; i < this.links; i++) {
      this.loop.sample((i + 1 + phase) * this.spacing, this.next, upperSag, lowerSag);
      this.tangent.subVectors(this.next, this.p);
      this.midpoint.addVectors(this.p, this.next).multiplyScalar(0.5);
      this.qLink.setFromAxisAngle(this.axis, Math.atan2(-this.tangent.y, this.tangent.z));
      this.linkScale.z = this.tangent.length() / CHAIN_PITCH;
      this.matrix.compose(this.p, this.qRoller, this.one);
      this.rollers.setMatrixAt(i, this.matrix);
      for (let side = 0; side < 2; side++) {
        this.midpoint.x = X + (side * 2 - 1) * (i % 2 ? 0.0104 : 0.0076);
        this.matrix.compose(this.midpoint, this.qLink, this.linkScale);
        this.plates.setMatrixAt(i * 2 + side, this.matrix);
      }
      this.p.copy(this.next);
    }
    this.rollers.instanceMatrix.needsUpdate = true;
    this.plates.instanceMatrix.needsUpdate = true;
  }
}
