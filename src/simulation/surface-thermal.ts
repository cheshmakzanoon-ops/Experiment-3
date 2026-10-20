import { clamp } from '../core/math.ts';
import { advanceWater } from './weather.ts';

/** A reduced pavement column with a thin surface and a deeper heat reservoir.
 * Capacities are J/(m² K), conductances W/(m² K), heat flux W/m² and water mm.
 * These are authored engineering parameters, not iRacing's equations/data or
 * a measured venue calibration. The two-node energy balance is integrated
 * exactly for a held weather/evaporation/traffic input, including its zero
 * eigenvalue when an insulated column has no external heat sink. */
export interface SurfaceThermalParameters {
  surfaceCapacity: number;
  substrateCapacity: number;
  conduction: number;
  deepConductance: number;
  airBase: number;
  airWind: number;
  solarFlux: number;
}

export const SURFACE_THERMAL: Readonly<SurfaceThermalParameters> = Object.freeze({
  surfaceCapacity: 21000,
  substrateCapacity: 168000,
  conduction: 45,
  deepConductance: 3,
  airBase: 12,
  airWind: 4,
  solarFlux: 260,
});
/** One millimetre of liquid water on one square metre has a mass of 1 kg. */
export const WATER_LATENT_HEAT = 2.45e6;
export const WATER_HEAT_CAPACITY = 4180;

export interface SurfaceWeather {
  ambient: number;
  cloud: number;
  rain: number;
  windX: number;
  windZ: number;
}

/** Saturation vapour pressure (kPa), bounded to the model's weather envelope. */
export function saturationVapourPressure(temperature: number) {
  const c = clamp(temperature, -40, 80);
  return 0.61078 * Math.exp((17.27 * c) / (c + 237.3));
}

/** Integrate the amount that actually evaporates, not a demand on a dry cell.
 * Drainage and evaporation compete for the same water. Once a film dries,
 * at most the incoming rainfall can evaporate during the rest of the step. */
export function evaporatedWater(
  water: number,
  rainfall: number,
  evaporation: number,
  drainage: number,
  dt: number,
) {
  if (
    !Number.isFinite(water) ||
    !Number.isFinite(rainfall) ||
    !Number.isFinite(evaporation) ||
    !Number.isFinite(drainage) ||
    !Number.isFinite(dt) ||
    Math.min(water, rainfall, evaporation, drainage, dt) < 0
  )
    throw new Error('Invalid surface evaporation step');
  if (evaporation <= rainfall) return evaporation * dt;
  const deficit = evaporation - rainfall;
  const wetTime = Math.min(
    dt,
    drainage > 1e-12 ? Math.log1p((water * drainage) / deficit) / drainage : water / deficit,
  );
  return evaporation * wetTime + rainfall * (dt - wetTime);
}

function exponentialIntegral(eigenvalue: number, dt: number) {
  return Math.abs(eigenvalue * dt) < 1e-8
    ? dt * (1 + eigenvalue * dt * (0.5 + (eigenvalue * dt) / 6))
    : Math.expm1(eigenvalue * dt) / eigenvalue;
}

/** Reusable, allocation-free solution for cells sharing weather/exposure.
 * prepare() caches the environment; advanceWet() uses each cell's incoming
 * water mass for sensible cooling and only rebuilds the thermal matrix when
 * that rainfall changes. advance() retains the rainfall selected by prepare().
 * The dry-column equation is linear; evaporation is held over each 0.5 s
 * production surface update and returns its heat to this same energy balance. */
export class SurfaceThermalStep {
  surface = 0;
  substrate = 0;
  water = 0;
  evaporated = 0;
  private dt = 0;
  private ambient = 0;
  private air = 0;
  private solar = 0;
  private vapour = 0;
  private transfer = 0;
  private preparedRainfall = 0;
  private matrixRainfall = Number.NaN;
  private e11 = 1;
  private e12 = 0;
  private e21 = 0;
  private e22 = 1;
  private q1 = 0;
  private q2 = 0;

  constructor(readonly parameters: Readonly<SurfaceThermalParameters> = SURFACE_THERMAL) {
    if (
      !Object.values(parameters).every(Number.isFinite) ||
      parameters.surfaceCapacity <= 0 ||
      parameters.substrateCapacity <= 0 ||
      Math.min(
        parameters.conduction,
        parameters.deepConductance,
        parameters.airBase,
        parameters.airWind,
        parameters.solarFlux,
      ) < 0
    )
      throw new Error('Invalid pavement thermal parameters');
  }

  prepare(
    dt: number,
    weather: SurfaceWeather,
    sheltered = false,
    rainfall = sheltered ? 0 : weather.rain / 3600,
  ) {
    if (
      !Number.isFinite(dt) ||
      !Number.isFinite(weather.ambient) ||
      !Number.isFinite(weather.cloud) ||
      !Number.isFinite(weather.rain) ||
      !Number.isFinite(weather.windX) ||
      !Number.isFinite(weather.windZ) ||
      !Number.isFinite(rainfall) ||
      rainfall < 0 ||
      dt <= 0 ||
      weather.rain < 0 ||
      weather.cloud < 0 ||
      weather.cloud > 1
    )
      throw new Error('Invalid pavement thermal weather');
    this.dt = dt;
    this.ambient = weather.ambient;
    const p = this.parameters;
    const wind = sheltered ? 0 : Math.hypot(weather.windX, weather.windZ);
    this.preparedRainfall = sheltered ? 0 : rainfall;
    this.air = p.airBase + p.airWind * Math.sqrt(wind);
    this.solar = sheltered ? 0 : p.solarFlux * (1 - weather.cloud);
    // The weather protocol has no humidity channel. This bounded authored
    // cloud/humidity proxy is explicit rather than an invented measurement.
    const humidity = 0.5 + 0.42 * weather.cloud;
    this.vapour = humidity * saturationVapourPressure(weather.ambient);
    this.transfer = 0.000025 * (1 + 0.35 * Math.sqrt(wind));
    // Even unchanged rain needs a new matrix when the timestep or air changes.
    this.matrixRainfall = Number.NaN;
    this.prepareMatrix(this.preparedRainfall);
    return this;
  }

  private prepareMatrix(rainfall: number) {
    if (rainfall === this.matrixRainfall) return;
    this.matrixRainfall = rainfall;
    const p = this.parameters;
    const dt = this.dt;
    const a = -(this.air + rainfall * WATER_HEAT_CAPACITY + p.conduction) / p.surfaceCapacity;
    const b = p.conduction / p.surfaceCapacity;
    const c = p.conduction / p.substrateCapacity;
    const d = -(p.conduction + p.deepConductance) / p.substrateCapacity;
    const delta = Math.hypot(a - d, 2 * Math.sqrt(b * c));
    if (delta < 1e-14) {
      // Equal uncoupled modes (including a completely insulated column).
      this.e11 = this.e22 = Math.exp(a * dt);
      this.e12 = this.e21 = 0;
      this.q1 = exponentialIntegral(a, dt) / p.surfaceCapacity;
      this.q2 = 0;
    } else {
      const fast = (a + d - delta) * 0.5;
      // det(A)/lambda_fast avoids cancellation in the nearly insulated mode.
      const slow = fast === 0 ? 0 : (a * d - b * c) / fast;
      const es = Math.exp(slow * dt);
      const ef = Math.exp(fast * dt);
      const gap = slow - fast;
      const spread = (es - ef) / gap;
      this.e11 = ((a - fast) * es + (slow - a) * ef) / gap;
      this.e22 = ((d - fast) * es + (slow - d) * ef) / gap;
      this.e12 = b * spread;
      this.e21 = c * spread;
      const fs = exponentialIntegral(slow, dt);
      const ff = exponentialIntegral(fast, dt);
      this.q1 = ((a - fast) * fs + (slow - a) * ff) / (gap * p.surfaceCapacity);
      this.q2 = (c * (fs - ff)) / (gap * p.surfaceCapacity);
    }
  }

  /** Exact thermal step for held total additional heat flux (W/m²).
   * Negative flux includes latent heat from water actually evaporated.
   * Uses prepare()'s rainfall, independent of intervening advanceWet() calls. */
  advance(surface: number, substrate: number, heatFlux = 0) {
    this.prepareMatrix(this.preparedRainfall);
    return this.advanceColumn(surface, substrate, heatFlux);
  }

  private advanceColumn(surface: number, substrate: number, heatFlux: number) {
    if (
      !this.dt ||
      !Number.isFinite(surface) ||
      !Number.isFinite(substrate) ||
      !Number.isFinite(heatFlux)
    )
      throw new Error('Invalid pavement thermal state');
    const s = surface - this.ambient;
    const b = substrate - this.ambient;
    const flux = this.solar + heatFlux;
    this.surface = this.ambient + this.e11 * s + this.e12 * b + this.q1 * flux;
    this.substrate = this.ambient + this.e21 * s + this.e22 * b + this.q2 * flux;
    return this;
  }

  /** Coupled film/temperature step; qTraffic is the road's share of tire work
   * per cell area. Actual incoming rainfall (mm/s) sets both the water supply
   * and sensible heat exchange, overriding prepare()'s rainfall for this call.
   * Water removed by drainage does not evaporate a second time. */
  advanceWet(
    surface: number,
    substrate: number,
    water: number,
    rainfall: number,
    drainage: number,
    qTraffic = 0,
  ) {
    const potential = this.transfer * Math.max(0, saturationVapourPressure(surface) - this.vapour);
    this.evaporated = evaporatedWater(water, rainfall, potential, drainage, this.dt);
    this.water = advanceWater(water, rainfall - potential, drainage, this.dt);
    this.prepareMatrix(rainfall);
    return this.advanceColumn(
      surface,
      substrate,
      qTraffic - (this.evaporated * WATER_LATENT_HEAT) / this.dt,
    );
  }
}
