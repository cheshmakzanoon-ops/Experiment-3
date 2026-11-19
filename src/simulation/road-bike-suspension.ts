import { clamp, G, lerp } from '../core/math.ts';

/** A two-contact sprung chassis. The planar rider/tyre controller supplies
 * longitudinal forces; this solver supplies its actual unilateral support.
 * Wheels follow the sampled surface only while within suspension reach.
 * There is no attractive road force: an unloaded chassis follows a ballistic
 * trajectory until a spring can compress again. This is a reduced heave /
 * pitch model, not an unsprung-mass or fully spatial motorcycle model. */
export interface RoadBikeSuspensionSpec {
  mass: number;
  pitchInertia: number;
  frontArm: number;
  rearArm: number;
  frontRate: number;
  rearRate: number;
  frontTravel: number;
  rearTravel: number;
  frontPreload: number;
  rearPreload: number;
  frontDamping: number;
  rearDamping: number;
}

export interface RoadBikeSuspensionStep {
  mass: number;
  /** CG height over the tyre crown line after the current lean geometry. */
  rideHeight: number;
  frontHeight: number;
  rearHeight: number;
  /** Heights at the predicted end of the planar integration interval. */
  nextFrontHeight: number;
  nextRearHeight: number;
  frontForce: number;
  rearForce: number;
  cgHeight: number;
  downforce: number;
  downforceFront: number;
}

const MAX_STEP = 1 / 480;
const DAMPING_RATIO = 0.9;

export class RoadBikeSuspension {
  height = 0;
  velocity = 0;
  pitch = 0;
  pitchRate = 0;
  acceleration = 0;
  frontLoad = 0;
  rearLoad = 0;
  frontCompression = 0;
  rearCompression = 0;
  frontGap = 0;
  rearGap = 0;
  /** Total horizontal braking force (N) at the current pose's rear-lift
   * equilibrium, before the rider aid's existing safety margin. This is a
   * geometric limit, not normal support or permission to brake in flight. */
  rearLiftForce = 0;
  private readonly frontSag: number;
  private readonly rearSag: number;
  private readonly frontDamper: number;
  private readonly rearDamper: number;
  private frontMomentArm = 0;
  private rearMomentArm = 0;

  constructor(readonly spec: RoadBikeSuspensionSpec) {
    const length = spec.frontArm + spec.rearArm;
    // A fixed reference sag defines the mechanical extension length. Fuel
    // burn changes the forces and equilibrium, never the length of a fork.
    this.frontSag = (spec.mass * G * spec.rearArm) / (length * spec.frontRate);
    this.rearSag = (spec.mass * G * spec.frontArm) / (length * spec.rearRate);
    const frontMass = 1 / (1 / spec.mass + spec.frontArm ** 2 / spec.pitchInertia);
    const rearMass = 1 / (1 / spec.mass + spec.rearArm ** 2 / spec.pitchInertia);
    this.frontDamper =
      2 * DAMPING_RATIO * Math.sqrt(spec.frontRate * frontMass) * spec.frontDamping;
    this.rearDamper = 2 * DAMPING_RATIO * Math.sqrt(spec.rearRate * rearMass) * spec.rearDamping;
  }

  get airborne() {
    return this.frontLoad <= 1e-6 && this.rearLoad <= 1e-6;
  }

  /** Placement is an explicit state boundary, not a landing. */
  reset(frontHeight: number, rearHeight: number, rideHeight: number, velocity = 0) {
    const s = this.spec,
      length = s.frontArm + s.rearArm;
    this.pitch = Math.asin(clamp((frontHeight - rearHeight) / length, -0.5, 0.5));
    this.pitchRate = this.acceleration = 0;
    this.height =
      lerp(rearHeight, frontHeight, s.rearArm / length) +
      rideHeight * Math.cos(this.pitch) +
      lerp(s.rearPreload, s.frontPreload, s.rearArm / length);
    this.velocity = velocity;
    this.frontLoad = (s.mass * G * s.rearArm) / length;
    this.rearLoad = (s.mass * G * s.frontArm) / length;
    this.frontCompression = clamp(this.frontSag - s.frontPreload, 0, s.frontTravel);
    this.rearCompression = clamp(this.rearSag - s.rearPreload, 0, s.rearTravel);
    this.frontGap = this.rearGap = 0;
    // The next force step derives this from the current mass, aero and lean.
    this.rearLiftForce = 0;
  }

  step(q: RoadBikeSuspensionStep, dt: number) {
    if (!(dt > 0 && dt <= 0.05)) throw new Error('Invalid road bike suspension timestep');
    const s = this.spec,
      count = Math.ceil(dt / MAX_STEP),
      h = dt / count,
      frontRate = (q.nextFrontHeight - q.frontHeight) / dt,
      rearRate = (q.nextRearHeight - q.rearHeight) / dt;
    for (let i = 0; i < count; i++) {
      this.contacts(
        q.rideHeight,
        lerp(q.frontHeight, q.nextFrontHeight, i / count),
        lerp(q.rearHeight, q.nextRearHeight, i / count),
        frontRate,
        rearRate,
      );
      this.acceleration = (this.frontLoad + this.rearLoad - q.downforce) / q.mass - G;
      // A tyre in the air cannot keep applying the preceding step's drive
      // or brake moment. The planar solver limits the new force to these
      // contacts before advancing its speed and yaw.
      const tyreMoment =
        ((this.frontLoad > 0 ? q.frontForce : 0) + (this.rearLoad > 0 ? q.rearForce : 0)) *
        q.cgHeight;
      const aeroMoment =
        q.downforce *
        ((1 - q.downforceFront) * s.rearArm - q.downforceFront * s.frontArm) *
        Math.cos(this.pitch);
      const angularAcceleration =
        (this.frontLoad * this.frontMomentArm +
          this.rearLoad * this.rearMomentArm +
          tyreMoment +
          aeroMoment) /
        s.pitchInertia;
      this.height += this.velocity * h + 0.5 * this.acceleration * h * h;
      this.velocity += this.acceleration * h;
      this.pitch += this.pitchRate * h + 0.5 * angularAcceleration * h * h;
      this.pitchRate += angularAcceleration * h;
    }
    this.contacts(q.rideHeight, q.nextFrontHeight, q.nextRearHeight, frontRate, rearRate);
    this.acceleration = (this.frontLoad + this.rearLoad - q.downforce) / q.mass - G;
    // At rear lift Nf = mg + downforce and Nr = 0. Balance the SAME pitch
    // moments as the chassis above. Fork dive shortens the normal-force arm;
    // retaining the upright limit then kept braking a tipped bike over.
    // At pitch zero this reduces to staticRear * wheelbase / cgHeight.
    const aeroMoment =
      q.downforce *
      ((1 - q.downforceFront) * s.rearArm - q.downforceFront * s.frontArm) *
      Math.cos(this.pitch);
    this.rearLiftForce =
      q.cgHeight > 1e-6
        ? Math.max(0, ((q.mass * G + q.downforce) * this.frontMomentArm + aeroMoment) / q.cgHeight)
        : 0;
  }

  private contacts(
    rideHeight: number,
    frontHeight: number,
    rearHeight: number,
    frontRate: number,
    rearRate: number,
  ) {
    const s = this.spec,
      sin = Math.sin(this.pitch),
      cos = Math.cos(this.pitch),
      frontExtension = rideHeight + this.frontSag,
      rearExtension = rideHeight + this.rearSag,
      frontCompression = frontHeight - (this.height + s.frontArm * sin - frontExtension * cos),
      rearCompression = rearHeight - (this.height - s.rearArm * sin - rearExtension * cos);
    this.frontMomentArm = s.frontArm * cos + frontExtension * sin;
    this.rearMomentArm = -s.rearArm * cos + rearExtension * sin;
    this.frontLoad = this.force(
      frontCompression,
      frontRate - this.velocity - this.frontMomentArm * this.pitchRate,
      s.frontRate,
      this.frontDamper,
      s.frontPreload,
      s.frontTravel,
    );
    this.rearLoad = this.force(
      rearCompression,
      rearRate - this.velocity - this.rearMomentArm * this.pitchRate,
      s.rearRate,
      this.rearDamper,
      s.rearPreload,
      s.rearTravel,
    );
    this.frontCompression = clamp(frontCompression, 0, s.frontTravel);
    this.rearCompression = clamp(rearCompression, 0, s.rearTravel);
    this.frontGap = Math.max(0, -frontCompression);
    this.rearGap = Math.max(0, -rearCompression);
  }

  private force(
    compression: number,
    rate: number,
    spring: number,
    damper: number,
    preload: number,
    travel: number,
  ) {
    if (compression < 0) return 0;
    // Progressive bump rubber absorbs a landing beyond nominal fork/shock
    // stroke; compression telemetry stops at the mechanical suspension
    // travel, while the residual deflection represents rubber/tyre compliance.
    const bump = Math.max(0, compression - travel);
    return Math.max(
      0,
      spring * (compression + preload + 8 * bump + 120 * bump * bump) + damper * rate,
    );
  }
}
