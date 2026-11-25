import * as T from 'three';
import { clamp, smooth } from '../../core/math.ts';
import { ChainLoop, chainLinkPlateGeometry } from '../chain-geometry.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { installMud, type MudUniforms } from './mud.ts';

const TAU = Math.PI * 2;
const CHAIN_PITCH = 0.015875;
const REAR_RADIUS = 0.112;
const FRONT_RADIUS = 0.036;
const REAR_TEETH = 40;
const X = 0.095;

export function motocrossChainLoop(arm: number) {
  return new ChainLoop(arm, REAR_RADIUS, FRONT_RADIUS, X);
}

/** At racing distance the alternating side plates fit inside a pixel. Retain
 * their continuous upper and return runs on the same two sprocket tangents. */
export function distantMotocrossChain(arm: number) {
  const loop = motocrossChainLoop(arm);
  const s = loop.straightLength,
    end = s + loop.rearArcLength;
  const stations = [0, s];
  for (let i = 1; i <= 12; i++) stations.push(s + (loop.rearArcLength * i) / 12);
  stations.push(end + s);
  for (let i = 1; i <= 8; i++) stations.push(end + s + ((loop.length - end - s) * i) / 8);
  const points = stations.map((at) => loop.sample(at, new T.Vector3()));
  // Use the exact wrap vertices. Uniform arc-length resampling would spend
  // most rings on the two straight runs and cut inside the small sprocket.
  const position: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const tangent = new T.Vector3();
  for (let i = 0; i < points.length; i++) {
    const prev = points[i === 0 ? points.length - 2 : i - 1];
    const next = points[i === points.length - 1 ? 1 : i + 1];
    tangent.subVectors(next, prev).normalize();
    const p = points[i];
    for (const [width, depth] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      position.push(
        p.x + width * 0.009,
        p.y + depth * 0.004 * tangent.z,
        p.z - depth * 0.004 * tangent.y,
      );
      uv.push(stations[i] / loop.length, (width + 1) * 0.5);
    }
    if (!i) continue;
    for (let k = 0; k < 4; k++) {
      const a = (i - 1) * 4 + k,
        b = (i - 1) * 4 + ((k + 1) % 4);
      indices.push(a, b, a + 4, b, b + 4, a + 4);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Original MX drivetrain, informed by reference 005/010/012/027/031. Two
 * instanced draws retain 96 rollers and 192 paired plates at both near LODs.
 * Wheel phase comes only from the supplied snapshot, including replay seeks.
 * The authored loop and tooth count are visual values, not measured reference
 * dimensions or a drivetrain simulation. The model owns geometry/disposal;
 * its existing chain material is shared with the wheel's drive sprocket. */
export class MotocrossChainDrive {
  readonly root = new T.Group();
  readonly rollers: T.InstancedMesh;
  readonly plates: T.InstancedMesh;
  readonly links = 96;
  private readonly loop: ChainLoop;
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
  private lastStretch = Number.NaN;
  private lastPull: number | undefined;
  private upperFreeStart = 0;
  private lowerFreeStart = 0;

  constructor(
    private readonly arm: number,
    detail: 'high' | 'mid',
    material: T.MeshStandardMaterial,
    mud: MudUniforms,
  ) {
    if (!Number.isFinite(arm) || arm < 0.3 || arm > 1.1)
      throw new Error('Invalid motocross swingarm length');
    this.loop = motocrossChainLoop(arm);
    this.root.name = 'Motocross wheel-driven articulated chain';
    this.root.userData.referenceRevision = 'motocross-followup-chain';
    this.rollers = new T.InstancedMesh(
      new T.CylinderGeometry(0.0039, 0.0039, 0.0235, detail === 'high' ? 8 : 5),
      material,
      this.links,
    );
    this.rollers.name = 'Motocross steel chain pins and rollers';
    this.plates = new T.InstancedMesh(
      detail === 'high'
        ? chainLinkPlateGeometry(CHAIN_PITCH)
        : new T.BoxGeometry(0.0028, 0.0086, CHAIN_PITCH + 0.0086),
      material,
      this.links * 2,
    );
    this.plates.name = 'Motocross paired articulated link plates';
    for (const mesh of [this.rollers, this.plates]) {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      // Reuse these bounds when the arm changes; no per-frame allocations,
      // whole-instance recomputation or disabled frustum culling.
      mesh.boundingBox = new T.Box3();
      mesh.boundingSphere = new T.Sphere();
      this.root.add(mesh);
    }
    installMud(material, mud);
    // The ordinary mud hook samples mesh-local position. Instanced vertices
    // need their link placement too, otherwise every pin repeats one mask.
    // USE_INSTANCING keeps this shared material's rigid sprocket unchanged.
    chainShaderHook(material, 'motocross-chain-instance-mud-v1', (shader) => {
      injectAfter(
        shader,
        'begin_vertex',
        '#ifdef USE_INSTANCING\nvOffroadMudPos = ( instanceMatrix * vec4( position, 1.0 ) ).xyz;\n#endif',
        'vertex',
      );
    });
    this.update(0);
  }

  /** Start bending after the nylon slider or return shoe, then arrive at
   * the sprocket tangent with zero displacement and slope. The guided runs
   * stay inside their narrow channels throughout drive and overrun. */
  private sample(distance: number, upperSag: number, lowerSag: number, out: T.Vector3) {
    this.loop.sample(distance, out);
    if (upperSag === 0 && lowerSag === 0) return;
    const s = ((distance % this.loop.length) + this.loop.length) % this.loop.length;
    const upperEnd = this.loop.straightLength, lowerEnd = 2 * upperEnd + this.loop.rearArcLength;
    let u: number, sag: number;
    if (s > this.upperFreeStart && s < upperEnd) {
      u = (s - this.upperFreeStart) / (upperEnd - this.upperFreeStart);
      sag = upperSag;
    } else if (s > this.lowerFreeStart && s < lowerEnd) {
      u = (s - this.lowerFreeStart) / (lowerEnd - this.lowerFreeStart);
      sag = lowerSag;
    } else return;
    const shape = 4 * u * (1 - u);
    out.y -= sag * shape * shape;
  }

  update(rearRotation: number, swingarmStretch = 1, chainPull?: number) {
    // The rendered arm follows the actual rear axle. Cancel its non-uniform
    // scale before constructing a newly taut loop; scaling the loop itself
    // would turn both circular wraps into ellipses during suspension travel.
    const stretch =
      Number.isFinite(swingarmStretch) && swingarmStretch >= 0.5 && swingarmStretch <= 1.5
        ? swingarmStretch
        : 1;
    const angle = Number.isFinite(rearRotation) ? ((rearRotation % TAU) + TAU) % TAU : 0;
    const armChanged = stretch !== this.lastStretch;
    const pull = chainPull !== undefined && Number.isFinite(chainPull) ? clamp(chainPull, -1, 1) : undefined;
    if (!armChanged && angle === this.lastWheelPhase && pull === this.lastPull) return;
    if (armChanged) {
      this.lastStretch = stretch;
      this.root.scale.z = 1 / stretch;
      const arm = this.arm * stretch;
      this.loop.setArm(arm);
      const straight = this.loop.straightLength;
      // addMotocrossChainGuides centres the upper runner at 29% of the drive
      // span, and the rear shoe at 21% of the return span measured from the axle.
      this.upperFreeStart = 0.29 * straight + 0.116;
      this.lowerFreeStart = straight + this.loop.rearArcLength + 0.21 * straight + 0.063;
      for (const mesh of [this.rollers, this.plates]) {
        mesh.boundingBox!.min.set(X - 0.016, -REAR_RADIUS - 0.016, -arm - REAR_RADIUS - 0.016);
        mesh.boundingBox!.max.set(X + 0.016, REAR_RADIUS + 0.016, FRONT_RADIUS + 0.016);
        mesh.boundingBox!.getBoundingSphere(mesh.boundingSphere!);
      }
    }
    this.lastWheelPhase = angle;
    this.lastPull = pull;
    // The excess length of a shallow span varies with its deflection squared.
    // Transfer that reserve between loaded and slack runs without a phase clock.
    const drive = pull === undefined ? 0 : smooth(-1, 1, pull);
    const upperSag = pull === undefined ? 0 : 0.014 * Math.sqrt(1 - drive);
    const lowerSag = pull === undefined ? 0 : 0.022 * Math.sqrt(drive);
    const spacing = this.loop.length / this.links;
    // Sampling traverses the rear wrap clockwise in YZ; positive wheel X
    // rotation is anticlockwise, so the phase must move in the opposite sign.
    const phase = -(angle / TAU) * REAR_TEETH;
    this.sample(phase * spacing, upperSag, lowerSag, this.p);
    for (let i = 0; i < this.links; i++) {
      this.sample((i + phase + 1) * spacing, upperSag, lowerSag, this.next);
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
