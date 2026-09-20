import * as T from 'three';
import { clamp, mod } from '../core/math.ts';
import { F, H, carBase } from '../simulation/protocol.ts';
import { yellowFlag } from '../simulation/marshal.ts';
import { trackPoint, type Track } from '../simulation/track.ts';

export type GuideMode = 'off' | 'corners' | 'full';
export type GuideCue = 'accelerate' | 'lift' | 'brake' | 'caution';
export const GUIDE_MARKERS = 64;
export const GUIDE_SPACING = 4;

/** Advisory presentation only. It neither reads an AI driver's commands nor
 * writes input, track state, RNG, tire forces or lap timing. Speeds are an
 * intentionally conservative geometric estimate, not an optimal-lap claim. */
export class GuideRoute {
  readonly points: Float32Array;
  readonly speeds: Float32Array;
  readonly step: number;
  constructor(readonly track: Track) {
    const count = Math.ceil(track.length / GUIDE_SPACING);
    this.step = track.length / count;
    this.points = new Float32Array(count * 3);
    this.speeds = new Float32Array(count);
    const p = trackPoint();
    for (let i = 0; i < count; i++) {
      track.at(i * this.step, p);
      // Keep the cue on the road centre, not a purported collision-free passing
      // line. Following arrows never gives priority over another car.
      this.points.set([p.x, p.y + 0.045, p.z], i * 3);
      this.speeds[i] = Math.min(78, Math.sqrt(12 / Math.max(0.0003, Math.abs(p.curvature))));
    }
    // Two closed-loop sweeps let a braking envelope cross the start/finish seam.
    for (let i = count * 2 - 1; i >= 0; i--) {
      const here = i % count,
        next = (here + 1) % count;
      this.speeds[here] = Math.min(
        this.speeds[here],
        Math.sqrt(this.speeds[next] ** 2 + 2 * 7 * this.step),
      );
    }
  }
  index(station: number) {
    return Math.floor(mod(station, this.track.length) / this.step) % this.speeds.length;
  }
  speed(station: number, water: number, cautionSpeed = 0) {
    if (![station, water, cautionSpeed].every(Number.isFinite)) return 0;
    const wetScale = 1 - clamp(water, 0, 2) * 0.23;
    const target = this.speeds[this.index(station)] * wetScale;
    return cautionSpeed > 0 ? Math.min(target, cautionSpeed) : target;
  }
}
export function guideCue(speed: number, target: number, caution = false): GuideCue {
  if (caution) return 'caution';
  if (!Number.isFinite(speed + target) || target <= 0 || speed > target + 3) return 'brake';
  return speed > target - 3 ? 'lift' : 'accelerate';
}
export class DrivingGuide {
  readonly mesh: T.InstancedMesh;
  readonly route: GuideRoute;
  mode: GuideMode = 'off';
  cue: GuideCue = 'accelerate';
  targetSpeed = 0;
  private transform = new T.Object3D();
  private color = new T.Color();
  private point = trackPoint();
  private normal = new T.Vector3();
  private forward = new T.Vector3();
  private right = new T.Vector3();
  private basis = new T.Matrix4();
  constructor(track: Track) {
    this.route = new GuideRoute(track);
    const geometry = new T.BufferGeometry();
    // Chevron silhouette remains meaningful without colour discrimination.
    geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute(
        [-0.64, 0, -0.9, 0, 0, -0.48, 0, 0, 0.95, 0, 0, -0.48, 0.64, 0, -0.9, 0, 0, 0.95],
        3,
      ),
    );
    geometry.computeVertexNormals();
    this.mesh = new T.InstancedMesh(
      geometry,
      new T.MeshBasicMaterial({
        color: 0xffffff,
        side: T.DoubleSide,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
      GUIDE_MARKERS,
    );
    this.mesh.name = 'Advisory braking chevrons · references 034 037 070 072 074 089 097';
    this.mesh.userData.excludeMotionBlur = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.count = 0;
  }
  update(frame: Float32Array, allowed = true, colorblind = false) {
    this.mesh.count = 0;
    this.targetSpeed = 0;
    const o = carBase(0);
    if (
      !allowed ||
      this.mode === 'off' ||
      frame.length <= o + F.RETIRED ||
      frame[H.CARS] < 1 ||
      frame[H.PHASE] !== 2 ||
      frame[o + F.IN_PIT] ||
      frame[o + F.RETIRED] ||
      frame[o + F.FINISH]
    )
      return;
    const station = frame[o + F.S],
      speed = frame[o + F.SPEED],
      water = frame[H.WATER];
    if (![station, speed, water].every(Number.isFinite)) return;
    this.route.track.at(station, this.point);
    const forward = frame[o + F.VX] * this.point.tx + frame[o + F.VZ] * this.point.tz;
    if (speed > 3 && forward < -1) return; // never encourage wrong-way driving
    if (Math.abs(frame[o + F.LATERAL]) > this.point.width + 2) return;
    const flag = frame[o + F.LOCAL_FLAG];
    const caution = yellowFlag(flag);
    const limit = caution ? Math.max(1, frame[o + F.CAUTION_SPEED] || 12) : 0;
    this.targetSpeed = this.route.speed(station, water, limit);
    this.cue = guideCue(speed, this.targetSpeed, caution);
    const first = this.route.index(station) + 2;
    for (let i = 0; i < GUIDE_MARKERS; i++) {
      const index = (first + i) % this.route.speeds.length;
      const s = index * this.route.step;
      const target = this.route.speed(s, water, limit);
      if (this.mode === 'corners' && target > 62 && !caution) continue;
      this.route.track.at(s, this.point);
      const cue = guideCue(speed, target, caution);
      this.transform.position.set(this.point.x, this.point.y + 0.045, this.point.z);
      this.normal
        .set(
          -this.point.tx * this.point.gradient - this.point.nx * this.point.bank,
          1,
          -this.point.tz * this.point.gradient - this.point.nz * this.point.bank,
        )
        .normalize();
      this.forward.set(this.point.tx, this.point.gradient, this.point.tz).normalize();
      this.right.crossVectors(this.normal, this.forward).normalize();
      this.basis.makeBasis(this.right, this.normal, this.forward);
      this.transform.quaternion.setFromRotationMatrix(this.basis);
      this.transform.scale.set(1, 1, cue === 'brake' ? 1.25 : 1);
      this.transform.updateMatrix();
      this.mesh.setMatrixAt(this.mesh.count, this.transform.matrix);
      this.color.setHex(
        cue === 'brake'
          ? colorblind
            ? 0xffdb4d
            : 0xff4840
          : cue === 'lift' || cue === 'caution'
            ? 0xffb347
            : colorblind
              ? 0x46c6ff
              : 0x77e0ad,
      );
      this.mesh.setColorAt(this.mesh.count++, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  diagnostics() {
    return {
      mode: this.mode,
      markers: this.mesh.count,
      targetKph: this.targetSpeed * 3.6,
      cue: this.cue,
    };
  }
}
