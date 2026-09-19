import type { Controls, SessionOptions } from './config.ts';
export const HEADER = 16,
  CAR_STRIDE = 224,
  WHEEL_BASE = 96,
  WHEEL_STRIDE = 24,
  DEBRIS_BASE = 192,
  DEBRIS_STRIDE = 8;
export const PROTOCOL_VERSION = 7;
// +Z is the nose, +Y up and +X the driver's left; negative-X hubs are right-side wheels.
export const WHEEL_NAMES = ['FR', 'FL', 'RR', 'RL'] as const;
export const D = { KIND: 0, X: 1, Y: 2, Z: 3, ROTATION: 4, AGE: 5, MASS: 6, ACTIVE: 7 } as const;
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
  WIND_X: 14,
  WIND_Z: 15,
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
  MOTOR_POWER: 48,
  REGEN_POWER: 49,
  FRONT_RIDE: 50,
  REAR_RIDE: 51,
  BRAKE_BIAS: 52,
  DIFF_POWER: 53,
  DIFF_COAST: 54,
  ERS_MODE: 55,
  JACK_HEIGHT: 56,
  SIDEPOD_HEALTH: 57,
  LOST_MASS: 58,
  SUSPENSION_DAMAGE: 59,
  SECTOR: 60,
  SECTOR_1: 61,
  SECTOR_2: 62,
  SECTOR_3: 63,
  LAP_VALID: 64,
  WARNINGS: 65,
  PIT_YIELDING: 66,
  RETIRED: 67,
  MASS: 68,
  CLUTCH_PEDAL: 69,
  CLUTCH_ENGAGEMENT: 70,
  CLUTCH_TORQUE: 71,
  CLUTCH_SLIP_POWER: 72,
  ENGINE_TORQUE: 73,
  LOCAL_FLAG: 74,
  CAUTION_DISTANCE: 75,
  CAUTION_SPEED: 76,
  BLUE_CAR: 77,
  CONTROL_SEQUENCE: 78,
  CONTROL_PENALTIES: 79,
  PIT_CLOCK: 80,
  LAP_DELTA: 81,
  DELTA_VALID: 82,
  AI_STRESS: 83,
  AI_TIRE_CARE: 84,
  AI_ERROR_COUNT: 85,
  AI_STEER_ERROR: 86,
  AI_PEDAL_ERROR: 87,
  AI_DEFENDING: 88,
  AI_PACE: 89,
  MARBLE_PICKUP_FR: 90,
  MARBLE_PICKUP_FL: 91,
  MARBLE_PICKUP_RR: 92,
  MARBLE_PICKUP_RL: 93,
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
  PRESSURE: 16,
  RADIUS: 17,
  BLISTERING: 18,
  GRAINING: 19,
  PUNCTURED: 20,
  SUSPENSION_DAMAGE: 21,
  SLIP_POWER: 22,
  LENGTH: 23,
} as const;
export type ToWorker =
  | { type: 'init'; options: SessionOptions }
  | { type: 'input'; input: Controls }
  | { type: 'pause'; value: boolean }
  | { type: 'recycle'; buffer: ArrayBuffer }
  | { type: 'recycleTelemetry'; buffer: ArrayBuffer }
  | { type: 'recycleReplay'; buffer: ArrayBuffer }
  | { type: 'pit' }
  | { type: 'autopilot'; value: boolean };
export type FromWorker =
  | { type: 'frame'; buffer: ArrayBuffer }
  | { type: 'telemetry'; buffer: ArrayBuffer; rows: number }
  | { type: 'replayFrames'; buffer: ArrayBuffer; rows: number }
  | { type: 'recordingWarning'; message: string }
  | {
      type: 'surface';
      water: Float32Array;
      rubber: Float32Array;
      marbles: Float32Array;
      time: number;
    }
  | { type: 'error'; message: string };
export const carBase = (id: number) => HEADER + id * CAR_STRIDE;
