import { clamp } from '../core/math.ts';

export interface SteeringCalibration {
  axis: number;
  left: number;
  center: number;
  right: number;
}
export interface PedalCalibration {
  axis: number;
  released: number;
  pressed: number;
}
export interface CalibrationSet {
  steering: SteeringCalibration | null;
  throttle: PedalCalibration | null;
  brake: PedalCalibration | null;
  clutch: PedalCalibration | null;
}
export interface DeviceSelection {
  index: number;
  id: string;
}
export const emptyCalibration = (): CalibrationSet => ({
  steering: null,
  throttle: null,
  brake: null,
  clutch: null,
});
const axisIndex = (value: unknown): number => {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 31)
    throw new Error('Calibration axis must be an integer from 0 to 31.');
  return value as number;
};
const endpoint = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1)
    throw new Error('Calibration endpoints must be finite Gamepad axis values from -1 to 1.');
  return value;
};
export function validateSteering(value: unknown): SteeringCalibration {
  if (!value || typeof value !== 'object') throw new Error('Invalid steering calibration.');
  const v = value as SteeringCalibration;
  const result = {
    axis: axisIndex(v.axis),
    left: endpoint(v.left),
    center: endpoint(v.center),
    right: endpoint(v.right),
  };
  if (
    (result.left - result.center) * (result.right - result.center) >= 0 ||
    Math.min(Math.abs(result.left - result.center), Math.abs(result.right - result.center)) < 0.05
  )
    throw new Error(
      'Capture steering left, centered, and right with at least 0.05 travel on each side.',
    );
  return result;
}
export function validatePedal(value: unknown): PedalCalibration {
  if (!value || typeof value !== 'object') throw new Error('Invalid pedal calibration.');
  const v = value as PedalCalibration;
  const result = {
    axis: axisIndex(v.axis),
    released: endpoint(v.released),
    pressed: endpoint(v.pressed),
  };
  if (Math.abs(result.pressed - result.released) < 0.1)
    throw new Error('Pedal released and pressed positions must differ by at least 0.1.');
  return result;
}
export function validateCalibration(value: unknown): CalibrationSet {
  if (value === undefined || value === null) return emptyCalibration();
  if (typeof value !== 'object') throw new Error('Invalid device calibration.');
  const v = value as CalibrationSet;
  return {
    steering: v.steering == null ? null : validateSteering(v.steering),
    throttle: v.throttle == null ? null : validatePedal(v.throttle),
    brake: v.brake == null ? null : validatePedal(v.brake),
    clutch: v.clutch == null ? null : validatePedal(v.clutch),
  };
}
export function validateDevice(value: unknown): DeviceSelection | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') throw new Error('Invalid selected device.');
  const v = value as DeviceSelection;
  if (
    !Number.isInteger(v.index) ||
    v.index < 0 ||
    v.index > 31 ||
    typeof v.id !== 'string' ||
    !v.id ||
    v.id.length > 1024
  )
    throw new Error('Invalid device identity. Select a connected device.');
  return { index: v.index, id: v.id };
}
/** Gamepad slots are sparse and may be reused for different hardware. A custom
 * profile is never applied to a different device merely because it got its slot. */
export function selectDevice(pads: readonly (Gamepad | null)[], selection: DeviceSelection | null) {
  if (selection)
    return (
      pads.find((p) => p?.connected && p.index === selection.index && p.id === selection.id) ?? null
    );
  return pads.find((p) => p?.connected && p.mapping === 'standard') ?? null;
}
export function readAxis(pad: Gamepad, index: number): number | undefined {
  const value = pad.axes[index];
  return Number.isFinite(value) && Math.abs(value) <= 1 ? value : undefined;
}
export function calibratedSteer(raw: number, c: SteeringCalibration): number {
  const side = (raw - c.center) * Math.sign(c.right - c.center);
  const extent = side >= 0 ? Math.abs(c.right - c.center) : Math.abs(c.left - c.center);
  return Number.isFinite(raw) && side !== 0 ? clamp(side / extent, -1, 1) : 0;
}
export function calibratedPedal(raw: number, c: PedalCalibration): number {
  return Number.isFinite(raw) ? clamp((raw - c.released) / (c.pressed - c.released), 0, 1) : 0;
}
export function steeringResponse(
  raw: number,
  deadzone: number,
  saturation: number,
  exponent: number,
) {
  if (!Number.isFinite(raw)) return 0;
  const x = clamp((Math.abs(raw) - deadzone) / Math.max(0.01, saturation - deadzone), 0, 1);
  return Math.sign(raw) * x ** exponent;
}
