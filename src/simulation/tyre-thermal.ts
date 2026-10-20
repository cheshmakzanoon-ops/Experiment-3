import { BRAKE_THERMAL, type BrakeThermalParameters } from './brake-thermal.ts';

/** Tyre and rotor thermal model (docs/production/PHYSICS_MODEL.md §1.6).
 *
 * Nodes: tread SURFACE (thin layer that sees sliding friction), CARCASS
 * (tread bulk, belts and sidewalls: hysteresis), CORE (inflation gas and inner
 * liner: sets the hot pressure). Heat paths, all in W:
 *   surface ← share·Pslip + (1-k)·Proll,  carcass ← k·Proll,
 *   surface ↔ carcass ↔ core conduction,  surface → air (forced convection),
 *   surface → track (contact conduction),  surface → water film (rain),
 *   carcass → air (sidewall),  core → rim/air,  brake disc ↔ core (rim).
 * The tyre-only entry point has three nodes and an imposed rotor temperature;
 * production cars include the finite rotor as a fourth node. Both are advanced
 * with backward Euler (a tridiagonal M-matrix solve), so passive exchange with
 * positive capacities/nonnegative conductances is stable and cannot
 * overshoot the bounding temperatures at any timestep. Original engineering
 * calibration, not measured thermal data. Units: J/K, W/K, °C, m/s, mm. */
export interface TyreThermalParameters {
  readonly surfaceCapacity: number;
  readonly carcassCapacity: number;
  readonly coreCapacity: number;
  readonly surfaceCarcass: number;
  readonly carcassCore: number;
  /** Surface forced convection: base + per m/s. */
  readonly airBase: number;
  readonly airSpeed: number;
  /** Surface → track conduction while loaded. */
  readonly trackContact: number;
  /** Water film cooling per mm of water: base + per m/s. */
  readonly waterBase: number;
  readonly waterSpeed: number;
  /** Sidewall convection (carcass → air): base + per m/s. */
  readonly sidewallBase: number;
  readonly sidewallSpeed: number;
  /** Core → rim/air: base + per m/s; brake disc → core through the rim. */
  readonly rimBase: number;
  readonly rimSpeed: number;
  readonly discToCore: number;
  /** Share of contact slip power entering the tread (the rest heats the road). */
  readonly slipShare: number;
  /** Compatibility rolling heat per (N·m/s) for callers without explicit
   * mechanical work; production cars supply their solved rollingPower. */
  readonly hysteresis: number;
  readonly hysteresisCarcassShare: number;
  /** Tread surface heat capacity lost at full wear (thinner tread). */
  readonly wearCapacityLoss: number;
}
export const TYRE_THERMAL: TyreThermalParameters = Object.freeze({
  surfaceCapacity: 9000,
  carcassCapacity: 52000,
  coreCapacity: 7000,
  surfaceCarcass: 85,
  carcassCore: 30,
  airBase: 12,
  airSpeed: 1.25,
  trackContact: 8,
  waterBase: 130,
  waterSpeed: 0.6,
  sidewallBase: 4,
  sidewallSpeed: 0.08,
  rimBase: 2,
  rimSpeed: 0.05,
  discToCore: 0.6,
  slipShare: 0.62,
  hysteresis: 0.0012,
  hysteresisCarcassShare: 0.6,
  wearCapacityLoss: 0.4,
});
export interface TyreTemperatures {
  surfaceTemp: number;
  carcassTemp: number;
  coreTemp: number;
}
export interface WheelTemperatures extends TyreTemperatures {
  discTemp: number;
}
export interface ThermalInputs {
  /** Physically dissipated contact sliding/projection power (W). Elastic
   * energy storage and numerical integrator loss are excluded. */
  slipPower: number;
  /** Internal carcass relaxation heat (W), fully retained by the tyre. This
   * can occur without tread/road contact and therefore causes no tread wear. */
  carcassPower?: number;
  /** Dissipated carcass rolling work (W), excluding ground compaction and
   * contact slip. Explicit zero disables compatibility speed-based heat. */
  rollingPower?: number;
  load: number;
  /** Road-plane translation speed for convection/water cooling. Production
   * supplies hypot(longitudinal, lateral); signed scalar legacy inputs remain
   * accepted. This must not be wheel rim speed during a stationary burnout. */
  speed: number;
  airTemp: number;
  trackTemp: number;
  waterMm: number;
  discTemp: number;
  wear: number;
}
/** Advance the three temperatures by dt with backward Euler. */
export function advanceTyreTemperatures(
  t: TyreTemperatures,
  input: ThermalInputs,
  dt: number,
  p: TyreThermalParameters = TYRE_THERMAL,
) {
  return advanceThermalNodes(t, input, dt, p);
}

/** Coupled rotor and tyre update. The rotor is a fourth finite heat reservoir,
 * not an imposed temperature: every joule conducted into the core is removed
 * from the rotor in the same solve. Only friction brake work heats the rotor;
 * electrical regeneration is supplied separately by the wheel solver.
 *
 * Backward Euler on the four-node tridiagonal M-matrix conserves internal
 * heat and keeps passive cooling inside the initial/environment temperature
 * bounds, even for large timesteps. Existing three-node callers retain their
 * explicitly imposed disc-temperature boundary condition. */
export function advanceWheelTemperatures(
  t: WheelTemperatures,
  input: ThermalInputs,
  brakePower: number,
  dt: number,
  p: TyreThermalParameters = TYRE_THERMAL,
  brake: BrakeThermalParameters = BRAKE_THERMAL,
) {
  if (!(brake.capacity > 0 && Number.isFinite(brake.capacity)))
    throw new Error('Invalid brake heat capacity');
  advanceThermalNodes(t, input, dt, p, brake, brakePower);
  return t;
}

function advanceThermalNodes<T extends TyreTemperatures & { discTemp?: number }>(
  t: T,
  input: ThermalInputs,
  dt: number,
  p: TyreThermalParameters,
  brake?: BrakeThermalParameters,
  brakePower = 0,
) {
  if (!(dt > 0 && Number.isFinite(dt))) throw new Error('Invalid tyre thermal timestep');
  const v = Math.abs(input.speed),
    loaded = input.load > 1 ? 1 : 0,
    rolling = Math.max(0, input.rollingPower ?? p.hysteresis * Math.max(0, input.load) * v),
    qs = p.slipShare * Math.max(0, input.slipPower) + (1 - p.hysteresisCarcassShare) * rolling,
    qc = p.hysteresisCarcassShare * rolling + Math.max(0, input.carcassPower ?? 0),
    cs = (p.surfaceCapacity * (1 - p.wearCapacityLoss * Math.min(1, Math.max(0, input.wear)))) / dt,
    cc = p.carcassCapacity / dt,
    cg = p.coreCapacity / dt,
    gsc = p.surfaceCarcass,
    gcg = p.carcassCore,
    gsa = p.airBase + p.airSpeed * v,
    gst = p.trackContact * loaded,
    gw = Math.max(0, input.waterMm) * (p.waterBase + p.waterSpeed * v) * loaded,
    gca = p.sidewallBase + p.sidewallSpeed * v,
    gga = p.rimBase + p.rimSpeed * v,
    gd = p.discToCore;
  // Tridiagonal system [a1 -gsc 0; -gsc a2 -gcg; 0 -gcg a3]·T' = b.
  const a1 = cs + gsc + gsa + gst + gw,
    a2 = cc + gsc + gcg + gca,
    a3 = cg + gcg + gga + gd,
    b1 = cs * t.surfaceTemp + qs + gsa * input.airTemp + gst * input.trackTemp + gw * input.airTemp,
    b2 = cc * t.carcassTemp + qc + gca * input.airTemp,
    b3 = cg * t.coreTemp + gga * input.airTemp + (brake ? 0 : gd * input.discTemp);
  const c1 = -gsc / a1,
    d1 = b1 / a1,
    m2 = a2 + gsc * c1,
    c2 = -gcg / m2,
    d2 = (b2 + gsc * d1) / m2,
    m3 = a3 + gcg * c2,
    d3 = (b3 + gcg * d2) / m3;
  let core = d3;
  if (brake) {
    const cd = brake.capacity / dt,
      gda = brake.airBase + brake.airSpeed * v,
      a4 = cd + gd + gda,
      b4 = cd * t.discTemp! + Math.max(0, brakePower) + gda * input.airTemp,
      c3 = -gd / m3,
      disc = (b4 + gd * d3) / (a4 + gd * c3);
    t.discTemp = disc;
    core = d3 - c3 * disc;
  }
  const carcass = d2 - c2 * core,
    surface = d1 - c1 * carcass;
  t.coreTemp = core;
  t.carcassTemp = carcass;
  t.surfaceTemp = surface;
  return t;
}
/** Hot gauge pressure (kPa) from the core temperature: ideal gas at constant
 * volume on absolute pressure, set cold at `setTemp`. */
export const ATMOSPHERE_KPA = 101.325;
export function hotPressure(coldGauge: number, coreTemp: number, setTemp: number) {
  return ((coldGauge + ATMOSPHERE_KPA) * (coreTemp + 273.15)) / (setTemp + 273.15) - ATMOSPHERE_KPA;
}
