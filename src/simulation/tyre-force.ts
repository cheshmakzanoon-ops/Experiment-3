import { clamp, smooth } from '../core/math.ts';

/** Tyre force law (docs/production/PHYSICS_MODEL.md §1). Original engineering
 * calibration, not a fitted manufacturer data set. Pure-slip curves are
 * Magic-Formula shaped, F = D·sin(C·atan(Bx − E(Bx − atan Bx))), with
 *  - peak friction D = μ(Fz,T,p,γ,wear,surface,water)·Fz (tire.ts peakGrip),
 *  - slip stiffness BCD a carcass property: load-saturating, pressure,
 *    wear, temperature and ground dependent, only partly coupled to road μ,
 *    so low-friction ground has a smaller peak slip (the brush-model result);
 *  - combined slip by Magic-Formula weighting functions on normalized slips
 *    sx = κ/κ*, sy = α/α* (MF 5.2 form with C = 1):
 *        Fy = Gyκ·Fy0(α),  Gyκ = cos(atan(By·sx)),  By = by1·cos(atan(by2·sy)),
 *        Fx = Gxα·Fx0(κ),  Gxα = cos(atan(Bx·sy)),  Bx = bx1·cos(atan(bx2·sx)),
 *    then bounded by the friction ellipse (μx Fz, μy Fz), so a spinning or
 *    locked tyre loses its cornering force while moderate slip in one
 *    direction costs the other a calibrated, moderate share;
 *  - camber thrust as an equivalent slip-angle shift Cγ·γ/Cα (saturates with
 *    the lateral force, never adds outside the ellipse);
 *  - longitudinal AND lateral elastic contact deformation, solved implicitly
 *    at every trial wheel speed. Positive sliding rates recover the same
 *    steady force curves; a shared friction-ellipse projection removes excess
 *    strain without creating energy. Stored energy, physical dissipation and
 *    numerical loss remain separate. Both modes fade out at walking speed. */
export interface SlipCurve {
  /** Shape factor C (peak sharpness / post-peak fall-off). */
  readonly C: number;
  /** Curvature factor E. */
  readonly E: number;
  /** Slip stiffness per unit load at Fz0 and reference friction (1/rad or per unit κ). */
  readonly stiffness: number;
}
export interface CombinedSlip {
  readonly by1: number;
  readonly by2: number;
  readonly bx1: number;
  readonly bx2: number;
}
export interface TyreConstruction {
  /** Nominal load Fz0 (N) of the load-sensitivity laws. */
  readonly nominalLoad: number;
  /** Peak friction μ ∝ (Fz/Fz0)^-loadSensitivity. */
  readonly loadSensitivity: number;
  /** Cornering stiffness ∝ Fz·(Fz/Fz0)^-q: the peak slip angle grows with
   * load. Longitudinal slip stiffness has its own (MF: close to ∝ Fz). */
  readonly stiffnessLoadExponent: number;
  readonly longitudinalLoadExponent: number;
  /** Rolling-resistance scale of this carcass on the ground's rigid
   * coefficient, and its pressure exponent: c_rr ∝ (p_nominal/p)^n. */
  readonly rollingResistance: number;
  readonly rollingPressureExponent: number;
  /** Slip stiffness ∝ (μ/μref)^p; 1 reproduces a curve that scales with μ. */
  readonly frictionStiffnessCoupling: number;
  /** Friction at which `stiffness` values are quoted (dry medium slick). */
  readonly referenceFriction: number;
  readonly lateral: SlipCurve;
  readonly longitudinal: SlipCurve;
  /** Peak longitudinal friction relative to lateral. */
  readonly longitudinalFriction: number;
  /** Combined-slip weighting: by1/by2 (lateral force lost to longitudinal
   * slip and its fade with slip angle), bx1/bx2 (the converse). */
  readonly combined: CombinedSlip;
  /** Camber thrust stiffness per unit load (N/N/rad). */
  readonly camberStiffness: number;
  /** Inclination into the lateral force with the largest contact patch (rad). */
  readonly camberOptimum: number;
  /** Fractional peak-friction loss per rad² away from that inclination. */
  readonly camberSensitivity: number;
  /** Lateral relaxation length (m) at Fz0 and nominal pressure. */
  readonly relaxationLength: number;
  /** Longitudinal small-slip relaxation length (m) at Fz0 and nominal pressure.
   * The corresponding contact spring stiffness is Kκ / σx (N/m). */
  readonly longitudinalRelaxationLength: number;
  /** Speeds (m/s) between which contact compliance fades in. Below the first
   * the original algebraic force law retains the calibrated low-speed creep. */
  readonly relaxationFade: readonly [number, number];
  /** Hot gauge pressure (kPa) at which pressure-stiffness factors are 1. */
  readonly nominalPressure: number;
  /** Hot pressure (kPa) of the largest contact patch, and the fractional
   * grip loss `pressureGripLoss` at ±`pressureSpan` kPa from it. */
  readonly pressureOptimum: number;
  readonly pressureGripLoss: number;
  readonly pressureSpan: number;
  /** d(ln slip stiffness)/d(ln pressure). */
  readonly pressureStiffness: number;
  /** Radial (vertical) stiffness N/m at nominal pressure, its pressure gain
   * d(ln k)/d(ln p), and its damping N s/m. */
  readonly verticalStiffness: number;
  readonly verticalPressureGain: number;
  readonly verticalDamping: number;
  /** Tread width (m): contact patch, water displacement, sinkage. */
  readonly width: number;
  /** Peak friction lost at full wear, and slip stiffness gained (shorter tread blocks). */
  readonly wearGripLoss: number;
  readonly wearStiffnessGain: number;
  /** Slip stiffness gained per K below the compound's ideal temperature. */
  readonly temperatureStiffness: number;
}
/** APX-01 slick: original calibration with the former pure-slip shapes at
 * nominal load (B 7.2/10.5, C 1.28/1.3, E 0.15) and physically separated
 * carcass stiffness, load saturation and relaxation. */
export const FORMULA_SLICK: TyreConstruction = Object.freeze({
  nominalLoad: 2200,
  loadSensitivity: 0.105,
  stiffnessLoadExponent: 0.12,
  longitudinalLoadExponent: 0,
  rollingResistance: 0.9,
  rollingPressureExponent: 0.3,
  frictionStiffnessCoupling: 0.6,
  referenceFriction: 1.84,
  lateral: Object.freeze({ C: 1.28, E: 0.15, stiffness: 7.2 * 1.28 * 1.84 }),
  longitudinal: Object.freeze({ C: 1.3, E: 0.15, stiffness: 10.5 * 1.3 * 1.84 }),
  longitudinalFriction: 1,
  combined: Object.freeze({ by1: 0.7, by2: 0.6, bx1: 0.7, bx2: 0.6 }),
  camberStiffness: 0.35,
  camberOptimum: 0.03,
  camberSensitivity: 9,
  relaxationLength: 0.32,
  longitudinalRelaxationLength: 0.22,
  relaxationFade: Object.freeze([3, 12] as const),
  nominalPressure: 160,
  pressureOptimum: 165,
  pressureGripLoss: 0.12,
  pressureSpan: 65,
  pressureStiffness: 0.25,
  verticalStiffness: 330000,
  verticalPressureGain: 0.7,
  verticalDamping: 350,
  width: 0.36,
  wearGripLoss: 0.5,
  wearStiffnessGain: 0.15,
  temperatureStiffness: 0.0015,
});
/** TC-1 touring slick: narrower, softer carcass, higher pressure, more camber. */
export const TOURING_SLICK: TyreConstruction = Object.freeze({
  ...FORMULA_SLICK,
  nominalLoad: 3300,
  stiffnessLoadExponent: 0.15,
  rollingResistance: 1,
  camberStiffness: 0.45,
  camberOptimum: 0.045,
  camberSensitivity: 7,
  relaxationLength: 0.42,
  longitudinalRelaxationLength: 0.29,
  verticalStiffness: 260000,
  verticalDamping: 300,
  width: 0.27,
});
/** Catalogue tyre families other than the Formula slick (tire-families.ts):
 * the closed-wheel carcass with the Formula slick's load reference and slip
 * stiffness exponent, because a family's `tireGrip` is defined relative to the
 * Formula slick at that reference load. */
export const FAMILY_CARCASS: TyreConstruction = Object.freeze({
  ...TOURING_SLICK,
  nominalLoad: FORMULA_SLICK.nominalLoad,
  stiffnessLoadExponent: FORMULA_SLICK.stiffnessLoadExponent,
});

const HALF_PI = Math.PI / 2;
/** Normalized pure-slip curve: σ is slip divided by the reference slip X0/B
 * where X0 = tan(π/2C), so σ = 1 is the E = 0 peak. Equal to the Magic
 * Formula with Bx = X0·σ. */
export function slipCurve(sigma: number, C: number, E: number, X0: number) {
  const x = X0 * sigma;
  return Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}
/** Per-substep curve state for one tyre: everything the implicit wheel solve
 * needs to evaluate combined forces cheaply at trial wheel speeds. */
export interface SlipState {
  /** Peak forces μx·Fz and μy·Fz (N). */
  dx: number;
  dy: number;
  cx: number;
  ex: number;
  cy: number;
  ey: number;
  x0x: number;
  x0y: number;
  /** Reference slips κ* and α* (σ = 1). */
  kappaRef: number;
  alphaRef: number;
  /** Steady contact slip after camber shift (rad), as σy·α*. */
  alpha: number;
  /** Combined-slip weighting coefficients of this tyre. */
  by1: number;
  by2: number;
  bx1: number;
  bx2: number;
  /** Lateral terms of the combined law, cached for the wheel solve: they
   * depend only on the lateral slip, which is fixed during it. */
  cache: {
    stamp: number;
    alpha: number;
    dy: number;
    alphaRef: number;
    sy: number;
    fy0: number;
    by: number;
  };
  stamp: number;
  /** Cornering stiffness (N/rad) and longitudinal slip stiffness (N/unit). */
  corneringStiffness: number;
  slipStiffness: number;
}
export const slipState = (): SlipState => ({
  dx: 0,
  dy: 0,
  cx: 1.3,
  ex: 0,
  cy: 1.3,
  ey: 0,
  x0x: 1,
  x0y: 1,
  kappaRef: 1,
  alphaRef: 1,
  alpha: 0,
  corneringStiffness: 0,
  slipStiffness: 0,
  by1: 0,
  by2: 0,
  bx1: 0,
  bx2: 0,
  cache: { stamp: -1, alpha: NaN, dy: NaN, alphaRef: NaN, sy: 0, fy0: 0, by: 0 },
  stamp: 0,
});
/** Stiffness multiplier from pressure, wear and carcass temperature. */
export function carcassStiffness(
  c: TyreConstruction,
  pressure: number,
  wear: number,
  carcassTemp: number,
  idealTemp: number,
) {
  const dp = (pressure - c.nominalPressure) / c.nominalPressure;
  return (
    clamp(1 + c.pressureStiffness * dp, 0.6, 1.4) *
    (1 + c.wearStiffnessGain * clamp(wear, 0, 1)) *
    clamp(1 + c.temperatureStiffness * (idealTemp - carcassTemp), 0.85, 1.25)
  );
}
/** Fill `out` for load Fz with peak friction `mu` (already including every
 * grip factor), carcass stiffness factor and ground stiffness/fall-off. */
export function prepareSlip(
  c: TyreConstruction,
  load: number,
  mu: number,
  stiffnessFactor: number,
  groundStiffness: number,
  groundFalloff: number,
  out: SlipState,
  groundCoupling = 1,
) {
  const fz = Math.max(load, 1),
    ratio = clamp(fz / c.nominalLoad, 0.05, 6),
    friction = Math.max(mu, 1e-3),
    common =
      fz *
      (friction / c.referenceFriction) ** c.frictionStiffnessCoupling *
      stiffnessFactor *
      groundStiffness;
  out.stamp++;
  out.dy = friction * fz;
  out.dx = out.dy * c.longitudinalFriction;
  out.by1 = c.combined.by1 * groundCoupling;
  out.by2 = c.combined.by2;
  out.bx1 = c.combined.bx1 * groundCoupling;
  out.bx2 = c.combined.bx2;
  // Loose ground keeps ploughing force at large slip (C → 1, no fall-off).
  out.cy = clamp(1 + (c.lateral.C - 1) * groundFalloff, 1.03, 1.9);
  out.cx = clamp(1 + (c.longitudinal.C - 1) * groundFalloff, 1.03, 1.9);
  out.ey = c.lateral.E;
  out.ex = c.longitudinal.E;
  out.x0y = Math.tan(HALF_PI / out.cy);
  out.x0x = Math.tan(HALF_PI / out.cx);
  out.corneringStiffness = c.lateral.stiffness * common * ratio ** -c.stiffnessLoadExponent;
  out.slipStiffness = c.longitudinal.stiffness * common * ratio ** -c.longitudinalLoadExponent;
  // BCD = stiffness ⇒ B = stiffness/(C·D); reference slip X0/B.
  out.alphaRef = (out.x0y * out.cy * out.dy) / Math.max(1e-6, out.corneringStiffness);
  out.kappaRef = (out.x0x * out.cx * out.dx) / Math.max(1e-6, out.slipStiffness);
  return out;
}
/** Camber thrust as an equivalent slip-angle shift: Fy ≈ −Cα·α + Cγ·γ.
 * `inclination` is signed toward +lateral (driver's left). Like slip-angle
 * force it is a rolling deflection of the tread: a stationary cambered tyre
 * on a slope produces none, so it builds over the first metres per second. */
export function camberShift(
  c: TyreConstruction,
  load: number,
  state: SlipState,
  inclination: number,
  speed: number,
) {
  return (
    (c.camberStiffness * Math.max(load, 0) * inclination * smooth(0.3, 3, Math.abs(speed))) /
    Math.max(1, state.corneringStiffness)
  );
}
/** Contact-patch friction factor of inclination: the optimum leans into the
 * lateral force (direction −sign(α)); straight running prefers none. */
export function camberGrip(c: TyreConstruction, inclination: number, alphaNormalized: number) {
  const into = -Math.tanh(2 * alphaNormalized),
    error = inclination - c.camberOptimum * into;
  return clamp(1 - c.camberSensitivity * error * error, 0.7, 1);
}
/** Inflation-pressure friction factor (contact-patch size), as before. */
export function pressureGrip(c: TyreConstruction, pressure: number) {
  return clamp(
    1 - c.pressureGripLoss * ((pressure - c.pressureOptimum) / c.pressureSpan) ** 2,
    0.75,
    1,
  );
}
/** Pure-slip force of a normalized slip (signed, magnitude ≤ peak). */
function pure(peak: number, sigma: number, C: number, E: number, X0: number) {
  return sigma >= 0 ? peak * slipCurve(sigma, C, E, X0) : -peak * slipCurve(-sigma, C, E, X0);
}
/** Combined forces for normalized slips (sx, α/α*): MF weighting, then the
 * friction-ellipse bound. Writes fx (along +rolling) and fy (along +α, i.e.
 * before the sign that opposes the lateral slip). */
function combine(state: SlipState, sx: number, out: { fx: number; fy: number }) {
  const lateral = state.cache;
  if (
    lateral.stamp !== state.stamp ||
    lateral.alpha !== state.alpha ||
    lateral.dy !== state.dy ||
    lateral.alphaRef !== state.alphaRef
  ) {
    const sigma = state.alpha / state.alphaRef;
    lateral.stamp = state.stamp;
    lateral.alpha = state.alpha;
    lateral.dy = state.dy;
    lateral.alphaRef = state.alphaRef;
    lateral.sy = sigma;
    lateral.fy0 = pure(state.dy, sigma, state.cy, state.ey, state.x0y);
    // cos(atan(x)) = 1/√(1+x²): the C = 1 weighting functions are algebraic.
    lateral.by = state.by1 / Math.sqrt(1 + (state.by2 * sigma) ** 2);
  }
  const sy = lateral.sy,
    by = lateral.by,
    fy0 = lateral.fy0,
    fx0 = pure(state.dx, sx, state.cx, state.ex, state.x0x),
    bx = state.bx1 / Math.sqrt(1 + (state.bx2 * sx) ** 2),
    fy = fy0 / Math.sqrt(1 + (by * sx) ** 2),
    fx = fx0 / Math.sqrt(1 + (bx * sy) ** 2),
    use = Math.hypot(fx / Math.max(1e-9, state.dx), fy / Math.max(1e-9, state.dy)),
    scale = use > 1 ? 1 / use : 1;
  out.fx = fx * scale;
  out.fy = fy * scale;
  return out;
}
const SCRATCH = { fx: 0, fy: 0 };
/** Longitudinal force (N) of the combined law at slip ratio κ with the
 * prepared lateral slip; used by the implicit wheel solve. */
export function longitudinalForce(state: SlipState, kappa: number) {
  return combine(state, kappa / state.kappaRef, SCRATCH).fx;
}
/** Combined forces: Fx along +rolling, Fy opposing lateral slip. */
export function combinedForces(state: SlipState, kappa: number, out: { fx: number; fy: number }) {
  combine(state, kappa / state.kappaRef, out);
  // 0 - x, not -x: an unloaded or straight-running tyre reports +0.
  out.fy = 0 - out.fy;
  return out;
}
/** Persistent longitudinal contact state. `energy` is kept separately from
 * deflection so changing load, ground or carcass stiffness can remap the
 * spring without creating energy. */
export interface LongitudinalContactMemory {
  longitudinalDeflection: number;
  longitudinalEnergy: number;
}
/** Lateral patch displacement relative to the rim is −lateralDeflection:
 * positive lateral slip builds y > 0 and a restoring force Fy = −Ky y. */
export interface LateralContactMemory {
  lateralDeflection: number;
  lateralEnergy: number;
}
/** One prepared contact and its trial solution. Reused across the bracketed
 * wheel solve; preparation reads tyre memory once, trials never modify it. */
export interface LongitudinalContact {
  stiffness: number;
  zeroSlipRate: number;
  oldDeflection: number;
  oldEnergy: number;
  dt: number;
  deflection: number;
  force: number;
  energy: number;
  /** Physical contact sliding/projection loss, W. */
  dissipation: number;
  /** Internal contact-reservoir release, W; heats the carcass without wear
   * or a road-work share, including on an unloaded tyre. */
  relaxationHeat: number;
  /** Backward-Euler spring loss, W; deliberately not passed off as heat. */
  numericalDissipation: number;
}
export const longitudinalContact = (): LongitudinalContact => ({
  stiffness: 0,
  zeroSlipRate: 0,
  oldDeflection: 0,
  oldEnergy: 0,
  dt: 1,
  deflection: 0,
  force: 0,
  energy: 0,
  dissipation: 0,
  relaxationHeat: 0,
  numericalDissipation: 0,
});
/** The two orthogonal springs share the same passive integration and work
 * accounting. The historical longitudinal names remain an API-compatible
 * spelling for this common scalar contact state. */
export type LateralContact = LongitudinalContact;
export const lateralContact = longitudinalContact;
/** Prepare an energy-preserving change of contact stiffness. At vanishing
 * relaxation length the model becomes the existing algebraic tyre law and
 * the remaining deformation relaxes into heat. This also gives an unloaded
 * patch a force-free way to discharge its stored energy. */
export function prepareLongitudinalContact(
  state: SlipState,
  memory: LongitudinalContactMemory,
  regularizedSpeed: number,
  length: number,
  dt: number,
  out: LongitudinalContact,
) {
  out.dt = dt;
  out.oldEnergy = Math.max(0, memory.longitudinalEnergy);
  out.stiffness = length < 1e-4 ? 0 : state.slipStiffness / length;
  out.oldDeflection =
    out.stiffness > 0
      ? Math.sign(memory.longitudinalDeflection) * Math.sqrt((2 * out.oldEnergy) / out.stiffness)
      : 0;
  // dFx/dκ at κ=0, including the existing combined-slip weighting. At zero
  // slip there is no longitudinal force to trigger the friction-ellipse cap.
  const slope =
    state.slipStiffness / Math.sqrt(1 + ((state.bx1 * state.alpha) / state.alphaRef) ** 2);
  out.zeroSlipRate = (out.stiffness * regularizedSpeed) / Math.max(1e-9, slope);
  return out;
}
/** Prepare the lateral spring from cornering stiffness and relaxation
 * length. Its zero-slip rate is multiplied by the trial longitudinal-slip
 * weighting in transientCombinedForces, because locking/spinning changes
 * lateral force capacity during the SAME wheel-speed solve. */
export function prepareLateralContact(
  state: SlipState,
  memory: LateralContactMemory,
  transportSpeed: number,
  length: number,
  dt: number,
  out: LateralContact,
) {
  out.dt = dt;
  out.oldEnergy = Math.max(0, memory.lateralEnergy);
  out.stiffness = length < 1e-4 ? 0 : state.corneringStiffness / length;
  out.oldDeflection =
    out.stiffness > 0
      ? Math.sign(memory.lateralDeflection) * Math.sqrt((2 * out.oldEnergy) / out.stiffness)
      : 0;
  out.zeroSlipRate = (out.stiffness * transportSpeed) / Math.max(1e-9, state.corneringStiffness);
  return out;
}
/** Passive elastic/sliding contact reduction:
 *
 *   Fx = Kx x,  dx/dt = s − λx,  λ = Kx s/Fsteady(s/V) ≥ 0.
 *
 * It retains the complete calibrated steady combined-slip force (including
 * its post-peak fall-off), but stores U=½Kx x² during contact deformation.
 * At small slip λ→V/σx; strong sliding renews the patch more quickly. The
 * backward-Euler trial is algebraic and uses the SAME trial slip speed as
 * the implicit wheel residual. Its force is projected onto the remaining
 * longitudinal share of the ellipse, including after an abrupt load change.
 *
 * For fixed prepared parameters its exact discrete work identity is
 * Fx·s·dt = ΔU + (sliding + projection)·dt + ½Kx·(x−x_old)².
 * The final term is numerical dissipation, kept separate from tyre heat.
 * Negative instantaneous slip work can therefore only return stored U.
 * `recordState=false` evaluates the same force without writing trial state or
 * unused work budgets; only the converged wheel root needs those outputs. */
export function transientLongitudinalForce(
  contact: LongitudinalContact,
  slipSpeed: number,
  steadyForce: number,
  forceLimit: number,
  recordState = true,
  zeroSlipRate = contact.zeroSlipRate,
) {
  const k = contact.stiffness,
    dt = contact.dt;
  if (k === 0) {
    const force = clamp(steadyForce, -forceLimit, forceLimit);
    if (!recordState) return force;
    contact.force = force;
    contact.deflection = 0;
    contact.energy = 0;
    contact.dissipation = Math.max(0, force * slipSpeed);
    contact.relaxationHeat = contact.oldEnergy / dt;
    contact.numericalDissipation = 0;
    return contact.force;
  }
  const rate =
      Math.abs(slipSpeed) > 1e-9 && Math.abs(steadyForce) > 1e-12
        ? (k * slipSpeed) / steadyForce
        : zeroSlipRate,
    divisor = 1 + dt * rate,
    trial = (contact.oldDeflection + dt * slipSpeed) / divisor,
    force = clamp(k * trial, -forceLimit, forceLimit);
  if (!recordState) return force;
  const x = force / k,
    projection = divisor * (trial - x);
  contact.force = force;
  contact.deflection = x;
  contact.energy = 0.5 * k * x * x;
  contact.relaxationHeat = 0;
  // The projection removes deformation in the force direction; both terms
  // are nonnegative. The max only removes roundoff at an inactive constraint.
  contact.dissipation = k * rate * x * x + Math.max(0, (force * projection) / dt);
  contact.numericalDissipation = (0.5 * k * (x - contact.oldDeflection) ** 2) / dt;
  return force;
}
const STEADY_CONTACT = { fx: 0, fy: 0 };
/** Coupled transient forces inside the wheel root. Each axis first solves
 * x = (x_old + dt*s)/(1 + dt*lambda), lambda = K*s/Fsteady >= 0.
 * If the pair exceeds the current friction ellipse, both forces are reduced
 * by the same nonnegative factor. No axis gets an arbitrary priority.
 *
 * For either axis, projected force F and strain x still satisfy
 * F*s*dt = delta(0.5*K*x*x) + physical loss*dt + numerical loss*dt.
 * Projection only shortens each strain in its own force direction, so its
 * work is dissipative even during reversals and sudden load/grip changes.
 * Pure longitudinal callers keep the existing scalar helper above.
 *
 * `lateralSlipSpeed` is the signed velocity resisted by the lateral spring.
 * Fy has the opposite sign. Camber's kinematic bias and its work port are
 * resolved by the caller; no small-angle approximation is imposed here.
 * Force-only probes do not change either prepared or recorded spring state. */
export function transientCombinedForces(
  state: SlipState,
  longitudinal: LongitudinalContact,
  lateral: LateralContact,
  longitudinalSlipSpeed: number,
  regularizedSpeed: number,
  lateralSlipSpeed: number,
  out: { fx: number; fy: number },
  recordState = true,
) {
  const kappa = longitudinalSlipSpeed / regularizedSpeed;
  combinedForces(state, kappa, STEADY_CONTACT);
  // d(-Fy)/d(alpha) at alpha=0, including trial longitudinal-slip weighting.
  const lateralRate =
      lateral.stiffness > 0 &&
      (Math.abs(lateralSlipSpeed) <= 1e-9 || Math.abs(STEADY_CONTACT.fy) <= 1e-12)
        ? lateral.zeroSlipRate * Math.sqrt(1 + ((state.by1 * kappa) / state.kappaRef) ** 2)
        : lateral.zeroSlipRate,
    trialX = transientLongitudinalForce(
      longitudinal,
      longitudinalSlipSpeed,
      STEADY_CONTACT.fx,
      state.dx,
      false,
    ),
    trialY = transientLongitudinalForce(
      lateral,
      lateralSlipSpeed,
      0 - STEADY_CONTACT.fy,
      state.dy,
      false,
      lateralRate,
    ),
    normalizedX = trialX / Math.max(1e-9, state.dx),
    normalizedY = trialY / Math.max(1e-9, state.dy),
    // Individual axis bounds keep each normalized component in [−1,1], so
    // squaring cannot overflow. Most probes need no square root at all.
    usageSquared = normalizedX * normalizedX + normalizedY * normalizedY,
    scale = usageSquared > 1 ? 1 / Math.sqrt(usageSquared) : 1,
    fx = trialX * scale,
    resistY = trialY * scale;
  if (recordState) {
    transientLongitudinalForce(
      longitudinal,
      longitudinalSlipSpeed,
      STEADY_CONTACT.fx,
      Math.abs(fx),
    );
    transientLongitudinalForce(
      lateral,
      lateralSlipSpeed,
      0 - STEADY_CONTACT.fy,
      Math.abs(resistY),
      true,
      lateralRate,
    );
  }
  out.fx = fx;
  out.fy = 0 - resistY;
  return out;
}
/** Effective relaxation length (m): grows ~√load, shortens with pressure and
 * wear (stiffer carcass/shorter tread), and fades to zero at low speed. */
export function relaxationLength(
  c: TyreConstruction,
  load: number,
  pressure: number,
  wear: number,
  speed: number,
) {
  return c.relaxationLength * relaxationScale(c, load, pressure, wear, speed);
}
/** Small-slip longitudinal relaxation follows the construction's separate
 * length, with the same load/pressure/tread and walking-speed limits. */
export function longitudinalRelaxationLength(
  c: TyreConstruction,
  load: number,
  pressure: number,
  wear: number,
  speed: number,
) {
  return c.longitudinalRelaxationLength * relaxationScale(c, load, pressure, wear, speed);
}
function relaxationScale(
  c: TyreConstruction,
  load: number,
  pressure: number,
  wear: number,
  speed: number,
) {
  const dp = (pressure - c.nominalPressure) / c.nominalPressure;
  return (
    clamp(Math.sqrt(Math.max(load, 0) / c.nominalLoad), 0.4, 2) *
    clamp(1 - 0.35 * dp, 0.7, 1.3) *
    (1 - 0.3 * clamp(wear, 0, 1)) *
    smooth(c.relaxationFade[0], c.relaxationFade[1], Math.abs(speed))
  );
}
/** Exact first-order slip lag dα/dt = (V/σ)(α_ss − α) over a step with the
 * speed held: unconditionally stable and never overshoots the target. */
export function relaxSlip(
  current: number,
  target: number,
  speed: number,
  length: number,
  dt: number,
) {
  if (length < 1e-4) return target;
  return target + (current - target) * Math.exp((-Math.abs(speed) * dt) / length);
}
