import { K, SKID_BASE } from '../simulation/protocol.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, WHEEL_NAMES, carBase } from '../simulation/protocol.ts';

// Keep the first three fields and speed/pedal positions stable for graph consumers.
const priority: number[] = [
  F.SPEED,
  F.THROTTLE,
  F.BRAKE,
  F.STEER,
  F.GEAR,
  F.RPM,
  F.G_LONG,
  F.G_LAT,
  F.FUEL,
  F.BATTERY,
  F.AERO_FRONT,
  F.AERO_REAR,
  F.DRAG,
  F.FRONT_HEALTH,
  F.REAR_HEALTH,
  F.FLOOR_HEALTH,
  F.WAKE,
];
const MARBLE_FIELDS: number[] = [
  F.MARBLE_PICKUP_FR,
  F.MARBLE_PICKUP_FL,
  F.MARBLE_PICKUP_RR,
  F.MARBLE_PICKUP_RL,
];
// Completed-lap evidence belongs to the full snapshot/replay protocol. Exclude
// newly reserved fields from the historical 228-column telemetry CSV contract.
const LAP_EVIDENCE_FIELDS: number[] = [F.LAST_LAP_VALID, F.LAST_LAP_ASSISTED];
export const TELEMETRY_FIELDS: number[] = [
  ...priority,
  ...Object.values(F).filter(
    (field) =>
      field !== F.S &&
      field !== F.LAPS &&
      !priority.includes(field) &&
      !MARBLE_FIELDS.includes(field) &&
      !LAP_EVIDENCE_FIELDS.includes(field),
  ),
];
const units: Record<string, string> = {
  X: 'm',
  Y: 'm',
  Z: 'm',
  VX: 'mps',
  VY: 'mps',
  VZ: 'mps',
  WX: 'radps',
  WY: 'radps',
  WZ: 'radps',
  SPEED: 'mps',
  STEER: 'rad',
  RPM: 'rpm',
  FUEL: 'kg',
  BATTERY: 'J',
  AERO_FRONT: 'N',
  AERO_REAR: 'N',
  DRAG: 'N',
  S: 'm',
  LATERAL: 'm',
  LAP_TIME: 's',
  BEST_LAP: 's',
  LAST_LAP: 's',
  PENALTY: 's',
  AI_TARGET: 'mps',
  G_LONG: 'g',
  G_LAT: 'g',
  G_VERT: 'g',
  FINISH: 's',
  SLIP_ENERGY: 'W',
  BOTTOM_ENERGY: 'W',
  MOTOR_POWER: 'W',
  REGEN_POWER: 'W',
  FRONT_RIDE: 'm',
  REAR_RIDE: 'm',
  JACK_HEIGHT: 'm',
  LOST_MASS: 'kg',
  MASS: 'kg',
  CLUTCH_TORQUE: 'Nm',
  CLUTCH_SLIP_POWER: 'W',
  ENGINE_TORQUE: 'Nm',
  CAUTION_DISTANCE: 'm',
  CAUTION_SPEED: 'mps',
  PIT_CLOCK: 's',
  LAP_DELTA: 's',
  AI_DEFENDING: 'm',
  MARBLE_PICKUP_FR: 'tread_covers',
  MARBLE_PICKUP_FL: 'tread_covers',
  MARBLE_PICKUP_RR: 'tread_covers',
  MARBLE_PICKUP_RL: 'tread_covers',
  SECTOR_1: 's',
  SECTOR_2: 's',
  SECTOR_3: 's',
};
const wheelUnits: Record<string, string> = {
  OMEGA: 'radps',
  LOAD: 'N',
  FX: 'N',
  FY: 'N',
  ANGLE: 'rad',
  SURFACE_TEMP: 'C',
  CARCASS_TEMP: 'C',
  COMPRESSION: 'm',
  DISC_TEMP: 'C',
  WATER: 'mm',
  ROTATION: 'rad',
  PRESSURE: 'kPa',
  RADIUS: 'm',
  SLIP_POWER: 'W',
  LENGTH: 'm',
  STEER: 'rad',
  CAMBER: 'rad',
};
const nameOf = (key: string, unit: string | undefined) =>
  key.toLowerCase() + (unit ? `_${unit}` : '');
// New channels append after the established CSV contract, never shift old columns.
const ALIGNMENT_FIELDS: number[] = [W.STEER, W.CAMBER];
export const WHEEL_FIELDS = Object.values(W).filter((field) => !ALIGNMENT_FIELDS.includes(field));
export const HEADER_FIELDS = [
  H.TIME,
  H.TICK,
  H.PHASE,
  H.LIGHTS,
  H.RAIN,
  H.CLOUD,
  H.AMBIENT,
  H.FLAG,
  H.STEP_MS,
  H.DROPPED,
  H.WIND_X,
  H.WIND_Z,
];
const skidUnits: Record<string, string> = {
  LOAD: 'N',
  SLIDE_POWER: 'W',
  DAMPING_POWER: 'W',
  SPARK_POWER: 'W',
  SPARK_X: 'm',
  SPARK_Y: 'm',
  SPARK_Z: 'm',
  VELOCITY_X: 'mps',
  VELOCITY_Y: 'mps',
  VELOCITY_Z: 'mps',
  SLIDE_WORK: 'J',
  SPARK_WORK: 'J',
  TOTAL_WORK: 'J',
};
export const SKID_FIELDS = Object.values(K);
export const CHANNELS = [
  'time_s',
  'distance_m',
  'lap',
  ...TELEMETRY_FIELDS.map((field) => {
    const key = Object.entries(F).find(([, value]) => field === value)![0];
    return nameOf(key, units[key]);
  }),
  ...WHEEL_NAMES.flatMap((wheel) =>
    Object.entries(W)
      .filter(([, field]) => !ALIGNMENT_FIELDS.includes(field))
      .map(([key]) => `${wheel}_${nameOf(key, wheelUnits[key])}`),
  ),
  'session_time_s',
  'tick',
  'session_phase',
  'start_lights',
  'rain_rate_mmph',
  'cloud_cover',
  'ambient_C',
  'flag',
  'physics_step_ms',
  'dropped_wall_time_s',
  'wind_x_mps',
  'wind_z_mps',
  ...MARBLE_FIELDS.map((field) => {
    const key = Object.entries(F).find(([, value]) => field === value)![0];
    return nameOf(key, units[key]);
  }),
  ...WHEEL_NAMES.flatMap((wheel) => ['steer_rad', 'camber_rad'].map((key) => `${wheel}_${key}`)),
  ...Object.keys(K).map((key) => `skid_${nameOf(key, skidUnits[key])}`),
];
export const TELEMETRY_STRIDE = CHANNELS.length;
export const TELEMETRY_BATCH_ROWS = 60;

export function packTelemetry(frame: Float32Array, out: Float32Array, offset: number) {
  const base = carBase(0);
  out[offset++] = frame[H.RACE_TIME];
  out[offset++] = frame[base + F.S];
  out[offset++] = frame[base + F.LAP_TIME] > 0 ? frame[base + F.LAPS] : -1;
  for (const field of TELEMETRY_FIELDS) out[offset++] = frame[base + field];
  for (let wheel = 0; wheel < 4; wheel++)
    for (const field of WHEEL_FIELDS)
      out[offset++] = frame[base + WHEEL_BASE + wheel * WHEEL_STRIDE + field];
  for (const field of HEADER_FIELDS) out[offset++] = frame[field];
  for (const field of MARBLE_FIELDS) out[offset++] = frame[base + field];
  for (let wheel = 0; wheel < 4; wheel++)
    for (const field of ALIGNMENT_FIELDS)
      out[offset++] = frame[base + WHEEL_BASE + wheel * WHEEL_STRIDE + field];
  for (const field of SKID_FIELDS) out[offset++] = frame[base + SKID_BASE + field];
}

export function telemetryCsv(values: Float32Array, count: number): Blob {
  if (!Number.isSafeInteger(count) || count < 0 || count * TELEMETRY_STRIDE !== values.length)
    throw new Error('Invalid telemetry export shape');
  const chunks: string[] = [CHANNELS.join(',') + '\n'];
  for (let start = 0; start < count; start += 500) {
    const rows: string[] = [];
    for (let row = start; row < Math.min(count, start + 500); row++) {
      const columns: string[] = [];
      for (let field = 0; field < TELEMETRY_STRIDE; field++) {
        const value = values[row * TELEMETRY_STRIDE + field];
        if (!Number.isFinite(value))
          throw new Error(`Non-finite telemetry at row ${row}, channel ${CHANNELS[field]}`);
        columns.push(String(value));
      }
      rows.push(columns.join(','));
    }
    chunks.push(rows.join('\n') + '\n');
  }
  return new Blob(chunks, { type: 'text/csv;charset=utf-8' });
}
