import type { Controls, SessionOptions } from './config.ts';
export const HEADER = 16,
  CAR_STRIDE = 112,
  WHEEL_BASE = 48,
  WHEEL_STRIDE = 16;
export const H = {
  TIME: 0,
  PHASE: 1,
  RACE_TIME: 2,
  LIGHTS: 3,
  RAIN: 4,
  CLOUD: 5,
  AMBIENT: 6,
  FLAG: 7,
  STEP_MS: 8,
  DROPPED: 9,
  WATER: 10,
  TICK: 11,
  CARS: 12,
  LENGTH: 13,
} as const;
export const F = {
  X: 0,
  Y: 1,
  Z: 2,
  QX: 3,
  QY: 4,
  QZ: 5,
  QW: 6,
  VX: 7,
  VY: 8,
  VZ: 9,
  WX: 10,
  WY: 11,
  WZ: 12,
  SPEED: 13,
  STEER: 14,
  RPM: 15,
  GEAR: 16,
  THROTTLE: 17,
  BRAKE: 18,
  FUEL: 19,
  BATTERY: 20,
  AERO_FRONT: 21,
  AERO_REAR: 22,
  DRAG: 23,
  FRONT_HEALTH: 24,
  FLOOR_HEALTH: 25,
  REAR_HEALTH: 26,
  S: 27,
  LATERAL: 28,
  LAPS: 29,
  LAP_TIME: 30,
  BEST_LAP: 31,
  LAST_LAP: 32,
  PENALTY: 33,
  PIT_PHASE: 34,
  IN_PIT: 35,
  AI_TARGET: 36,
  G_LONG: 37,
  G_LAT: 38,
  G_VERT: 39,
  RANK: 40,
  FINISH: 41,
  WAKE: 42,
  SLIP_ENERGY: 43,
  BOTTOM_ENERGY: 44,
  IMPACT: 45,
  COMPOUND: 46,
  PIT_STOPS: 47,
} as const;
export const W = {
  OMEGA: 0,
  LOAD: 1,
  FX: 2,
  FY: 3,
  SLIP: 4,
  ANGLE: 5,
  SURFACE_TEMP: 6,
  CARCASS_TEMP: 7,
  WEAR: 8,
  DIRT: 9,
  COMPRESSION: 10,
  DISC_TEMP: 11,
  WATER: 12,
  SURFACE: 13,
  ROTATION: 14,
  FLAT: 15,
} as const;
export type ToWorker =
  | { type: 'init'; options: SessionOptions }
  | { type: 'input'; input: Controls }
  | { type: 'pause'; value: boolean }
  | { type: 'recycle'; buffer: ArrayBuffer }
  | { type: 'pit' }
  | { type: 'autopilot'; value: boolean };
export type FromWorker =
  | { type: 'frame'; buffer: ArrayBuffer }
  | { type: 'surface'; water: Float32Array; rubber: Float32Array }
  | { type: 'error'; message: string };
export const carBase = (id: number) => HEADER + id * CAR_STRIDE;
