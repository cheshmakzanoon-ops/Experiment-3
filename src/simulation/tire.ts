import { clamp, G, smooth } from '../core/math.ts';
import { COMPOUNDS, VEHICLE, type Compound } from './config.ts';
import { SURFACE, type SurfaceSample } from './track.ts';
import { updateContamination } from './contamination.ts';
import {
  advanceSinkage,
  groundDrag,
  materialGrip,
  rollingCoefficient,
  rubberGrip,
  sinkageTarget,
  surfaceMaterial,
} from './surface-material.ts';
import {
  camberGrip,
  camberShift,
  carcassStiffness,
  FORMULA_SLICK,
  lateralContact,
  longitudinalContact,
  longitudinalRelaxationLength,
  prepareLateralContact,
  prepareLongitudinalContact,
  prepareSlip,
  pressureGrip,
  relaxationLength,
  relaxSlip,
  slipState,
  transientCombinedForces,
  type TyreConstruction,
} from './tyre-force.ts';
import { advanceWheelTemperatures, hotPressure, type ThermalInputs } from './tyre-thermal.ts';
import { advanceWheelRotation } from './wheel-rotation.ts';
export interface Tire {
  compound: Compound;
  omega: number;
  rotation: number;
  /** Signed whole turns; preserves winding between sparse replay snapshots. */
  turns: number;
  load: number;
  fx: number;
  fy: number;
  slip: number;
  /** Steady-state slip angle of the contact velocity (rad). */
  angle: number;
  surfaceTemp: number;
  carcassTemp: number;
  /** Inflation gas / inner liner temperature: sets the hot pressure (°C). */
  coreTemp: number;
  pressure: number;
  coldPressure: number;
  wear: number;
  dirt: number;
  marblePickup: number;
  flatSpot: number;
  blistering: number;
  graining: number;
  punctured: boolean;
  /** Geometric wheel travel (m, + bump: suspension and tyre deflection) and
   * the wheel-centre distance below its chassis station (m). */
  compression: number;
  length: number;
  discTemp: number;
  water: number;
  surface: number;
  energy: number;
  radius: number;
  /** Unworn rolling radius and wheel inertia of the vehicle it is fitted to. */
  nominalRadius: number;
  inertia: number;
  /** Tyre-family grip relative to the Formula slick construction (1). */
  gripScale: number;
  /** Share of loose-surface (grass/gravel) grip loss the construction
   * recovers (tire-families.ts); absent or 0 for racing slicks. */
  looseGrip?: number;
  /** Carcass construction: slip stiffness, camber, relaxation, pressure laws. */
  construction: TyreConstruction;
  /** Filtered slip-angle diagnostic (rad), retained for telemetry continuity.
   * The force itself uses the elastic contact states below, not this lag. */
  relaxedAngle: number;
  /** Signed longitudinal elastic contact deformation (m), never a visual lag. */
  longitudinalDeflection: number;
  /** Recoverable longitudinal contact-spring energy (J). */
  longitudinalEnergy: number;
  /** Longitudinal sliding/constraint relaxation heat for this substep (W). */
  longitudinalDissipation: number;
  /** Internal material damping/stored-energy release (W); heats carcass
   * without scuffing the tread or assigning internal work to the road. */
  longitudinalRelaxationHeat: number;
  /** Backward-Euler spring loss (W), recorded separately from physical heat. */
  longitudinalNumericalDissipation: number;
  /** Signed lateral slip deformation (m); patch-to-rim displacement is its
   * negative. Elastic lateral force is −Ky*lateralDeflection. */
  lateralDeflection: number;
  /** Recoverable lateral contact-spring energy (J). */
  lateralEnergy: number;
  /** Lateral sliding/projection loss during this substep (W). */
  lateralDissipation: number;
  /** Lateral material damping/reservoir release (W); heats carcass without wear. */
  lateralRelaxationHeat: number;
  /** Lateral backward-Euler spring loss (W), separate from physical heat. */
  lateralNumericalDissipation: number;
  /** Signed power entering the lateral reduction through its equivalent
   * camber-velocity bias (W). This is an explicit geometric boundary port,
   * not a claimed solved camber torque or extra friction heat. */
  camberPower: number;
  /** Road-relative inclination used by the force law (rad, + toward +lateral). */
  inclination: number;
  /** Radial deflection of the carcass (m) and contact-patch length (m). */
  deflection: number;
  patchLength: number;
  /** Ground sinkage (m) on deformable materials. */
  sinkage: number;
  /** Rolling-resistance coefficient and ground drag (N) of this step. */
  rolling: number;
  /** Translational rolling loss on the ground (compaction/roughness), kept
   * separate from carcass hysteresis so soil work cannot heat the tyre. */
  groundRolling: number;
  /** Signed EXTERNAL road moment about the positive wheel axle (N m).
   * Apply this to total chassis/rotor momentum as well as the wheel solve. */
  rollingTorque: number;
  /** Carcass rolling moment work (W); independent of contact slip heat. */
  rollingDissipation: number;
  groundDrag: number;
  /** Fraction of the contact lost to the water film (0 dry … 1 planing). */
  aquaplane: number;
  /** Slip ratio at the force peak for the present load, grip and ground. */
  peakSlip: number;
  /** Combined friction-ellipse utilization (0 free … 1 sliding at the limit). */
  usage: number;
}
/** Peak slip ratio of the Formula slick at nominal load on dry asphalt: the
 * reference for slip thresholds expressed in the former fixed-slip units. */
export const REFERENCE_PEAK_SLIP = 0.25;
/** Scale for a slip threshold calibrated at REFERENCE_PEAK_SLIP. */
export function slipScale(t: Pick<Tire, 'peakSlip'>) {
  return clamp(t.peakSlip / REFERENCE_PEAK_SLIP, 0.35, 1.6);
}
/** Grooved tread depth (mm) when new; slicks have none. */
export const TREAD_DEPTH_MM: Record<Compound, number> = {
  soft: 0,
  medium: 0,
  hard: 0,
  intermediate: 2.5,
  wet: 4,
};
/** Weight of the tread-surface temperature in the grip window; the bulk
 * (carcass) temperature sets the rest of the rubber's viscoelastic state. */
export const GRIP_SURFACE_WEIGHT = 0.3;
export function makeTire(
  compound: Compound,
  pressure = 155,
  nominalRadius: number = VEHICLE.wheelRadius,
  inertia: number = VEHICLE.wheelInertia,
  gripScale = 1,
  looseGrip = 0,
  construction: TyreConstruction = FORMULA_SLICK,
): Tire {
  const temp = COMPOUNDS[compound].ideal - 5;
  return {
    compound,
    omega: 0,
    rotation: 0,
    turns: 0,
    load: 0,
    fx: 0,
    fy: 0,
    slip: 0,
    angle: 0,
    surfaceTemp: temp,
    carcassTemp: temp,
    coreTemp: temp,
    pressure,
    coldPressure: pressure,
    wear: 0,
    dirt: 0,
    marblePickup: 0,
    flatSpot: 0,
    blistering: 0,
    graining: 0,
    punctured: false,
    compression: 0,
    length: 0.25,
    discTemp: 320,
    water: 0,
    surface: 0,
    energy: 0,
    radius: nominalRadius,
    nominalRadius,
    inertia,
    gripScale,
    construction,
    relaxedAngle: 0,
    longitudinalDeflection: 0,
    longitudinalEnergy: 0,
    longitudinalDissipation: 0,
    longitudinalRelaxationHeat: 0,
    longitudinalNumericalDissipation: 0,
    lateralDeflection: 0,
    lateralEnergy: 0,
    lateralDissipation: 0,
    lateralRelaxationHeat: 0,
    lateralNumericalDissipation: 0,
    camberPower: 0,
    inclination: 0,
    deflection: 0,
    patchLength: 0.14,
    sinkage: 0,
    rolling: 0.015,
    groundRolling: 0,
    rollingTorque: 0,
    rollingDissipation: 0,
    groundDrag: 0,
    aquaplane: 0,
    peakSlip: REFERENCE_PEAK_SLIP,
    usage: 0,
    ...(looseGrip > 0 ? { looseGrip } : {}),
  };
}
/** Teleport/recovery starts a new contact; retained patch strain must not
 * apply a force at the new position or be counted as fresh thermal work. */
export function resetTireContact(t: Tire) {
  t.fx = 0;
  t.fy = 0;
  t.energy = 0;
  t.usage = 0;
  t.longitudinalDeflection = 0;
  t.longitudinalEnergy = 0;
  t.longitudinalDissipation = 0;
  t.longitudinalRelaxationHeat = 0;
  t.longitudinalNumericalDissipation = 0;
  t.lateralDeflection = 0;
  t.lateralEnergy = 0;
  t.lateralDissipation = 0;
  t.lateralRelaxationHeat = 0;
  t.lateralNumericalDissipation = 0;
  t.camberPower = 0;
  t.relaxedAngle = 0;
  t.rollingTorque = 0;
  t.rollingDissipation = 0;
}
/** Compatibility for older placement callers; both patch axes must reset. */
export const resetLongitudinalContact = resetTireContact;
/** Surface friction this tyre sees: loose-surface constructions keep part of
 * the grip grass and gravel remove from a slick. */
function surfaceGrip(t: Tire, s: SurfaceSample) {
  const loose = t.looseGrip;
  if (!loose) return s.grip;
  // Grass and gravel everywhere; any loose material only on a terrain venue's
  // own ground, so other dirt, sand or snow samples (the festival world)
  // keep the original rule.
  const recovers =
    s.surface === SURFACE.GRASS ||
    s.surface === SURFACE.GRAVEL ||
    (s.terrain === true && surfaceMaterial(s.surface).loose);
  if (!recovers) return s.grip;
  return s.grip + (1 - s.grip) * loose;
}
export function magic(x: number, stiffness: number, shape = 1.35, curvature = 0.15) {
  const bx = stiffness * x;
  return Math.sin(shape * Math.atan(bx - curvature * (bx - Math.atan(bx))));
}
export function temperatureGrip(compound: Compound, temp: number) {
  const d = temp - COMPOUNDS[compound].ideal;
  return 1 - (d < 0 ? 0.35 : 0.48) * (1 - Math.exp(-((d / (d < 0 ? 45 : 65)) ** 2)));
}
/** Grip-window temperature: tread surface blended with the bulk. */
export function gripTemperature(t: Pick<Tire, 'surfaceTemp' | 'carcassTemp'>) {
  return GRIP_SURFACE_WEIGHT * t.surfaceTemp + (1 - GRIP_SURFACE_WEIGHT) * t.carcassTemp;
}
/** Smooth load/tread/water coupling, not a random aquaplaning event. The water
 * depth the tread cannot evacuate (compound tolerance scaled by remaining
 * groove depth and road macrotexture) sets the depth window; the onset speed
 * rises with the square roots of contact load and inflation pressure (the
 * classic dynamic-hydroplaning law V ∝ √p). A bounded reduced-grip model, not
 * a hydrodynamic contact-patch solver. */
export function aquaplaning(
  compound: Compound,
  load: number,
  waterMm: number,
  speed: number,
  wear = 0,
  pressure = 160,
  textureMm = 0.8,
) {
  if (load <= 0 || waterMm <= 0) return 0;
  const grooves = TREAD_DEPTH_MM[compound] > 0 ? 1 - 0.55 * clamp(wear, 0, 1) : 1,
    drainage = grooves * clamp(0.75 + 0.3125 * textureMm, 0.6, 1.25),
    tolerance = COMPOUNDS[compound].waterTolerance * drainage;
  const onset = Math.sqrt(clamp(load / 2200, 0.25, 4)) * Math.sqrt(clamp(pressure / 160, 0.5, 1.6));
  return (
    smooth(tolerance * 0.7, tolerance * 3 + drainage, waterMm) *
    smooth(24 * onset, 95 * onset, Math.abs(speed))
  );
}
/** Peak friction coefficient μ (excluding camber, which needs the slip
 * direction). Load sensitivity, grip window, water film, aquaplaning, wear,
 * contamination, damage, pressure, rubber/marbles and the ground material. */
export function peakGrip(t: Tire, load: number, s: SurfaceSample, speed: number) {
  const c = COMPOUNDS[t.compound],
    k = t.construction,
    m = surfaceMaterial(s.surface),
    loadRatio = Math.max(load, 100) / k.nominalLoad,
    wetRatio = s.water / (s.water + c.waterTolerance),
    wetPenalty =
      (t.compound === 'wet' ? 0.1 : t.compound === 'intermediate' ? 0.22 : 0.63) * wetRatio,
    hydro = aquaplaning(t.compound, load, s.water, speed, t.wear, t.pressure, m.textureMm),
    ground = materialGrip(m, s.water, s.temp) / m.grip;
  return (
    c.mu *
    t.gripScale *
    loadRatio ** -k.loadSensitivity *
    surfaceGrip(t, s) *
    ground *
    temperatureGrip(t.compound, gripTemperature(t)) *
    (1 - wetPenalty) *
    (1 - hydro * 0.62) *
    (1 - k.wearGripLoss * t.wear) *
    (1 - 0.34 * t.dirt) *
    (1 - 0.08 * t.flatSpot) *
    (1 - 0.18 * t.blistering - 0.12 * t.graining) *
    (t.punctured ? 0.28 : 1) *
    pressureGrip(k, t.pressure) *
    (rubberGrip(m, s.rubber, s.water) - s.marbles * 0.14)
  );
}
export function ellipse(fx: number, fy: number, limit: number, out: { fx: number; fy: number }) {
  if (limit <= 0) {
    out.fx = 0;
    out.fy = 0;
    return;
  }
  const use = Math.hypot(fx, fy) / Math.max(limit, 1);
  out.fx = fx / Math.max(1, use);
  out.fy = fy / Math.max(1, use);
}
const SLIP = slipState();
const LONGITUDINAL = longitudinalContact();
const LATERAL = lateralContact();
const CONTACT_FORCE = { fx: 0, fy: 0 };
const THERMAL: ThermalInputs = {
  slipPower: 0,
  carcassPower: 0,
  rollingPower: 0,
  load: 0,
  speed: 0,
  airTemp: 0,
  trackTemp: 0,
  waterMm: 0,
  discTemp: 0,
  wear: 0,
};
/** Brent's safeguarded interpolation keeps a sign-changing torque bracket.
 * Smooth wheel modes usually converge in a handful of evaluations; stiff
 * contact transitions retain bisection's safety. Unlike a fixed iteration
 * count, convergence is tied to physical torque error, with a roundoff floor
 * on wheel speed. The caller supplies the brake-complementarity half-line,
 * so a nonmonotone post-peak tyre curve cannot reverse the brake's work. */
function solveWheelRoot(
  low: number,
  high: number,
  residual: (omega: number) => number,
  torqueTolerance: number,
) {
  let a = low,
    b = high,
    fa = residual(a),
    fb = residual(b),
    c = a,
    fc = fa,
    step = b - a,
    previousStep = step;
  for (let iteration = 0; iteration < 64; iteration++) {
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
      c = a;
      fc = fa;
      step = previousStep = b - a;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      // Preserve the old best point as the opposite bracket endpoint.
      a = b;
      fa = fb;
      b = c;
      fb = fc;
      c = a;
      fc = fa;
    }
    const tolerance = 4 * Number.EPSILON * Math.abs(b) + 1e-12,
      halfBracket = (c - b) * 0.5;
    if (Math.abs(fb) <= torqueTolerance || Math.abs(halfBracket) <= tolerance) return b;
    if (Math.abs(previousStep) >= tolerance && Math.abs(fa) > Math.abs(fb)) {
      const ratio = fb / fa;
      let p: number, q: number;
      if (a === c) {
        p = 2 * halfBracket * ratio;
        q = 1 - ratio;
      } else {
        const qa = fa / fc,
          qb = fb / fc;
        p = ratio * (2 * halfBracket * qa * (qa - qb) - (b - a) * (qb - 1));
        q = (qa - 1) * (qb - 1) * (ratio - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (
        2 * p <
        Math.min(3 * halfBracket * q - Math.abs(tolerance * q), Math.abs(previousStep * q))
      ) {
        previousStep = step;
        step = p / q;
      } else step = previousStep = halfBracket;
    } else step = previousStep = halfBracket;
    a = b;
    fa = fb;
    b += Math.abs(step) > tolerance ? step : Math.sign(halfBracket) * tolerance;
    fb = residual(b);
  }
  return b;
}
/** Backward Euler wheel solve with dissipative brake complementarity. A
 * safeguarded torque root resolves the stiff low-speed wheel mode without arbitrary angular-velocity
 * clamps. Forces come from the combined-slip law (tyre-force.ts) with the
 * instantaneous steady slip and two elastic contact axes solved at every
 * trial wheel speed. Their recoverable energies are separate from sliding
 * heat and numerical dissipation. Camber is road-relative inclination signed
 * toward +lateral; `airTemp` defaults to the road temperature. */
export function solveTire(
  t: Tire,
  vLong: number,
  vLat: number,
  load: number,
  drive: number,
  brake: number,
  surface: SurfaceSample,
  camber: number,
  dt: number,
  regen = 0,
  airTemp = surface.temp,
) {
  const k = t.construction,
    material = surfaceMaterial(surface.surface);
  t.load = Math.max(0, load);
  t.water = surface.water;
  t.surface = surface.surface;
  t.inclination = camber;
  if (t.wear >= 0.999) t.punctured = true;
  t.radius = t.nominalRadius * (t.punctured ? 0.77 : 1 - 0.06 * smooth(0.97, 1, t.wear));
  const r = t.radius,
    I = t.inertia,
    old = t.omega,
    // Convection and water displacement see the entire road-plane motion.
    // Signed rolling transport remains separate for slip, carcass renewal,
    // sinkage and wheel-axis resistance below.
    planarSpeed = Math.hypot(vLong, vLat),
    regularization = Math.max(2.5, Math.abs(vLong));
  t.angle = Math.atan2(vLat, Math.hypot(vLong, 3));
  // Retained telemetry diagnostic; explicit patch strain now governs force.
  t.relaxedAngle =
    t.load < 1
      ? t.angle
      : relaxSlip(
          t.relaxedAngle,
          t.angle,
          vLong,
          relaxationLength(k, t.load, t.pressure, t.wear, vLong),
          dt,
        );
  const ideal = COMPOUNDS[t.compound].ideal,
    mu = peakGrip(t, t.load, surface, planarSpeed);
  prepareSlip(
    k,
    t.load,
    mu,
    carcassStiffness(k, t.pressure, t.wear, t.carcassTemp, ideal),
    material.stiffness,
    material.falloff,
    SLIP,
    material.coupling,
  );
  // Camber: patch-size factor on the peak (scales D and the reference slips
  // together so slip stiffness is unchanged) and thrust as a slip-angle shift.
  const shift = clamp(camberShift(k, t.load, SLIP, camber, vLong), -Math.PI / 4, Math.PI / 4),
    alpha = t.angle - shift,
    camberFactor = camberGrip(k, camber, alpha / SLIP.alphaRef);
  SLIP.dx *= camberFactor;
  SLIP.dy *= camberFactor;
  SLIP.kappaRef *= camberFactor;
  SLIP.alphaRef *= camberFactor;
  SLIP.alpha = alpha;
  if (t.load < 1) SLIP.dx = SLIP.dy = 0;
  const cap = SLIP.dx;
  // Prepare geometry/ground loss before the wheel root. None of these terms
  // depends on a trial omega; sinkage advances exactly once per substep.
  t.aquaplane = aquaplaning(
    t.compound,
    t.load,
    surface.water,
    planarSpeed,
    t.wear,
    t.pressure,
    material.textureMm,
  );
  t.patchLength = clamp(2 * Math.sqrt(2 * r * (Math.max(0, t.deflection) + t.sinkage)), 0.06, 0.4);
  t.sinkage = advanceSinkage(
    t.sinkage,
    sinkageTarget(material, t.load, k.width * t.patchLength),
    vLong,
    dt,
  );
  const rollingScale =
      k.rollingResistance *
      (k.nominalPressure / Math.max(60, t.pressure)) ** k.rollingPressureExponent,
    // Surface resistance above the paved reference is an effective ground
    // loss. Retain its calibrated total, but do not deposit gravel/soil work
    // in the tyre. This is an explicit reduced split, not measured hysteresis.
    carcassRolling =
      Math.min(surface.resistance, surfaceMaterial(SURFACE.ASPHALT).rolling) * rollingScale;
  t.rolling =
    surface.resistance * rollingScale +
    rollingCoefficient(material, t.sinkage, t.patchLength) -
    material.rolling;
  t.groundRolling = Math.max(0, t.rolling - carcassRolling);
  t.groundDrag =
    t.load < 1 ? 0 : groundDrag(material, t.sinkage, k.width, vLong, surface.water, t.aquaplane);
  const rollingMoment = t.load < 1 ? 0 : (carcassRolling + (t.punctured ? 0.13 : 0)) * t.load * r;
  // Oppose solved rotation, including reverse and stationary burnouts. A
  // locked or unloaded wheel has no carcass rolling work. The smooth sign
  // retains the former near-rest resistance scale without a sticky clamp.
  const rollingTorque = (omega: number) => 0 - rollingMoment * Math.tanh(omega * r * 2);
  prepareLongitudinalContact(
    SLIP,
    t,
    regularization,
    t.load < 1 ? 0 : longitudinalRelaxationLength(k, t.load, t.pressure, t.wear, vLong),
    dt,
    LONGITUDINAL,
  );
  // Rotating the finite contact-velocity vector by the equivalent camber
  // angle preserves its bounded magnitude and the sign of the steady force.
  // At zero camber this is EXACTLY vLat, even for a sideways/reversing car;
  // the force target still uses the calibrated atan2 slip angle above.
  // Capping the equivalent angle only bounds extreme unloaded/near-zero-grip
  // inputs; normal vehicle cambers remain far inside this geometric limit.
  const lateralTransport = Math.hypot(vLong, 3),
    lateralSlipSpeed = vLat * Math.cos(shift) - lateralTransport * Math.sin(shift),
    // At alpha=0, vLat=transport*tan(shift), hence d(sy)/d(alpha)
    // = transport/cos(shift). This keeps the zero-slip rate continuous.
    zeroLateralTransport = lateralTransport / Math.cos(shift);
  prepareLateralContact(
    SLIP,
    t,
    zeroLateralTransport,
    t.load < 1 ? 0 : relaxationLength(k, t.load, t.pressure, t.wear, vLong),
    dt,
    LATERAL,
  );
  const evalForce = (omega: number, recordState = false) => {
    const slipSpeed = omega * r - vLong;
    return transientCombinedForces(
      SLIP,
      LONGITUDINAL,
      LATERAL,
      slipSpeed,
      regularization,
      lateralSlipSpeed,
      CONTACT_FORCE,
      recordState,
      vLong,
      k.contactDampingTime,
    ).fx;
  };
  const torqueAtZero = drive - evalForce(0) * r;
  let omega = 0;
  if (Math.abs((I * old) / dt + torqueAtZero) > brake) {
    const sign = Math.sign((I * old) / dt + torqueAtZero) || 1,
      delta = ((Math.abs(drive) + brake + cap * r + rollingMoment) * dt) / I;
    // Keep the sliding root on the side selected by brake complementarity.
    // A non-monotone post-peak tyre curve must never choose a root whose
    // brake torque points WITH the solved wheel rotation.
    const lo = sign > 0 ? Math.max(0, old - delta - 0.01) : old - delta - 0.01,
      hi = sign < 0 ? Math.min(0, old + delta + 0.01) : old + delta + 0.01;
    omega = solveWheelRoot(
      lo,
      hi,
      (trial) =>
        (I * (trial - old)) / dt -
        drive +
        brake * sign +
        evalForce(trial) * r -
        rollingTorque(trial),
      1e-8 + 1e-12 * (Math.abs(drive) + brake + cap * r + rollingMoment),
    );
  }
  t.omega = omega;
  t.rollingTorque = rollingTorque(omega);
  t.rollingDissipation = Math.max(0, -t.rollingTorque * omega);
  advanceWheelRotation(t, omega * dt);
  t.slip = (omega * r - vLong) / regularization;
  // Commit contact memory once, using exactly the force used by the wheel
  // residual. Trial evaluations above must not advance the carcass state.
  t.fx = evalForce(omega, true);
  t.fy = CONTACT_FORCE.fy;
  t.longitudinalDeflection = LONGITUDINAL.deflection;
  t.longitudinalEnergy = LONGITUDINAL.energy;
  t.longitudinalDissipation = LONGITUDINAL.dissipation;
  t.longitudinalRelaxationHeat = LONGITUDINAL.relaxationHeat;
  t.longitudinalNumericalDissipation = LONGITUDINAL.numericalDissipation;
  t.lateralDeflection = LATERAL.deflection;
  t.lateralEnergy = LATERAL.energy;
  t.lateralDissipation = LATERAL.dissipation;
  t.lateralRelaxationHeat = LATERAL.relaxationHeat;
  t.lateralNumericalDissipation = LATERAL.numericalDissipation;
  // Actual lateral slip work plus this signed geometric input equals work
  // at the reduced spring: −Fy*vLat + camberPower = −Fy*lateralSlipSpeed.
  // The equivalent-camber approximation has no separately solved torsional
  // patch/steering mode; report its power port instead of hiding extra work.
  t.camberPower = 0 + t.fy * (vLat - lateralSlipSpeed);
  t.energy = t.longitudinalDissipation + t.lateralDissipation;
  t.peakSlip = SLIP.kappaRef;
  t.usage = Math.hypot(t.fx / Math.max(1, SLIP.dx), t.fy / Math.max(1, SLIP.dy));
  if (t.load < 1) {
    t.fx = 0;
    t.fy = 0;
    t.usage = 0;
  }
  // Sliding work gives heat; recoverable contact deformation and the
  // implicit integrator's numerical spring losses are not tyre temperature.
  THERMAL.slipPower = t.energy;
  THERMAL.carcassPower = t.longitudinalRelaxationHeat + t.lateralRelaxationHeat;
  THERMAL.rollingPower = t.rollingDissipation;
  THERMAL.load = t.load;
  THERMAL.speed = planarSpeed;
  THERMAL.airTemp = airTemp;
  THERMAL.trackTemp = surface.temp;
  THERMAL.waterMm = surface.water;
  THERMAL.discTemp = t.discTemp;
  THERMAL.wear = t.wear;
  // Friction and electrical braking share the implicit wheel speed, but only
  // frictional work heats the disc. Keep backward-Euler numerical wheel loss
  // separate from physical heat. Rotor/core conduction is equal and opposite
  // within the finite four-node solve, using this session's ambient air.
  advanceWheelTemperatures(t, THERMAL, Math.max(0, brake - regen) * Math.abs(omega), dt);
  t.pressure = hotPressure(t.punctured ? 12 : t.coldPressure, t.coreTemp, ideal - 5);
  t.wear = clamp(
    t.wear +
      ((t.energy * dt) / COMPOUNDS[t.compound].lifeJ) *
        (1 + Math.max(0, t.surfaceTemp - 120) * 0.015),
    0,
    1,
  );
  // Damage accumulation is proportional to dissipated slip energy; cold grain
  // can clean up through rolling, while heat-blistered rubber does not regrow.
  const slipWork = (t.energy * dt) / COMPOUNDS[t.compound].lifeJ;
  t.blistering = clamp(
    t.blistering + slipWork * smooth(ideal + 20, ideal + 60, t.surfaceTemp),
    0,
    1,
  );
  t.graining = clamp(
    t.graining +
      slipWork * (1 - smooth(ideal - 30, ideal, t.carcassTemp)) -
      Math.abs(t.omega) * dt * 0.000008,
    0,
    1,
  );
  // Either direction of travel can scrub a held tread patch. Rapid reverse
  // wheelspin distributes wear around the circumference and is not a lockup.
  if (Math.abs(vLong) > 12 && Math.abs(omega * r) < 0.2 * Math.abs(vLong) && t.load > 700)
    t.flatSpot = clamp(t.flatSpot + (Math.abs(t.fx * vLong) * dt) / 2e7, 0, 1);
  updateContamination(t, surface, t.load, vLong, omega, dt);
  if (
    !Number.isFinite(
      t.omega +
        t.fx +
        t.fy +
        t.surfaceTemp +
        t.coreTemp +
        t.relaxedAngle +
        t.longitudinalDeflection +
        t.longitudinalEnergy +
        t.longitudinalDissipation +
        t.longitudinalRelaxationHeat +
        t.longitudinalNumericalDissipation +
        t.lateralDeflection +
        t.lateralEnergy +
        t.lateralDissipation +
        t.lateralRelaxationHeat +
        t.lateralNumericalDissipation +
        t.camberPower +
        t.rollingTorque +
        t.rollingDissipation +
        t.groundRolling,
    )
  )
    throw new Error('Non-finite tire state');
}
export function brakeEfficiency(temp: number) {
  return 0.78 + 0.22 * smooth(80, 350, temp) - 0.28 * smooth(1050, 1450, temp);
}
export const staticLoad = (mass: number) => (mass * G) / 4;
