/** Effective brake rotor thermal parameters. These retain the existing car
 * calibration; they are not measured rotor masses or manufacturer data.
 * The rotor exchanges heat with the tyre core through the shared thermal
 * solve, so that heat is removed from one body and added to the other. */
export interface BrakeThermalParameters {
  /** Effective rotor heat capacity (J/K). */
  readonly capacity: number;
  /** Rotor-to-air conductance: airBase + airSpeed * |speed| (W/K). */
  readonly airBase: number;
  readonly airSpeed: number;
}

export const BRAKE_THERMAL: BrakeThermalParameters = Object.freeze({
  capacity: 16000,
  airBase: 25,
  airSpeed: 4,
});
