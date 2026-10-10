import { F, W, WHEEL_BASE, WHEEL_STRIDE } from '../simulation/protocol.ts';
import { clamp } from '../core/math.ts';

/** Values shared by the physical steering-wheel display and its tests. A delta
 * is available only after a valid, fully observed best-lap distance trace. */
export function steeringReadout(frame: Float32Array, base: number) {
  const gear = Math.round(frame[base + F.GEAR]);
  const delta = frame[base + F.LAP_DELTA];
  return {
    gear: gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear),
    speed: Math.round(frame[base + F.SPEED] * 3.6),
    rpm: frame[base + F.RPM],
    battery: clamp(frame[base + F.BATTERY] / 4e6, 0, 1),
    brakeBias: (frame[base + F.BRAKE_BIAS] * 100).toFixed(1),
    differential: Math.round(frame[base + F.DIFF_POWER] * 100),
    ers: ['HARVEST', 'BALANCED', 'ATTACK'][Math.round(frame[base + F.ERS_MODE])] ?? 'BALANCED',
    delta: frame[base + F.DELTA_VALID] ? `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}` : '—',
    ahead: frame[base + F.DELTA_VALID] > 0 && delta < 0,
  };
}
export function shiftLight(rpm: number, index: number) {
  return rpm >= 8000 + index * 500;
}
/** Surface temperature colour scale (AB-B §1.7): cold blue, ideal green,
 * hot amber, overheated red. */
export function tyreTempColour(celsius: number) {
  if (!Number.isFinite(celsius)) return '#9aa4ad';
  return celsius < 70
    ? '#4aa3ff'
    : celsius < 85
      ? '#7fd3ff'
      : celsius <= 105
        ? '#3ddc5a'
        : celsius <= 115
          ? '#ffd21f'
          : '#ff4a3d';
}
/** Lap time m:ss.mmm (or --:--.--- without one). */
export function lapClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-:--.---';
  const m = Math.floor(seconds / 60),
    rest = seconds - m * 60;
  return `${m}:${rest.toFixed(3).padStart(6, '0')}`;
}
const LCD_FONT = '"Saira", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
/** F1 25 style full-colour wheel dashboard (AB-B §2.2), 512×256 canvas px. */
export function drawSteeringDisplay(
  c: CanvasRenderingContext2D,
  frame: Float32Array,
  base: number,
) {
  const value = steeringReadout(frame, base);
  c.fillStyle = '#020305';
  c.fillRect(0, 0, 512, 256);
  c.strokeStyle = '#14171c';
  c.lineWidth = 4;
  c.strokeRect(2, 2, 508, 252);
  c.textBaseline = 'middle';
  // Top row: lap, position, delta pill.
  c.textAlign = 'left';
  c.fillStyle = '#c8ccd4';
  c.font = `600 30px ${LCD_FONT}`;
  c.fillText(`L ${Math.max(1, Math.round(frame[base + F.LAPS]) + 1)}`, 18, 36);
  c.textAlign = 'center';
  c.fillStyle = '#ffffff';
  c.font = `bold 34px ${LCD_FONT}`;
  c.fillText(`P${Math.max(1, Math.round(frame[base + F.RANK]) + 1)}`, 256, 36);
  const ahead = value.ahead,
    valid = value.delta !== '—';
  c.fillStyle = valid ? (ahead ? '#0f5e1a' : '#5e0f12') : '#1b1f25';
  c.fillRect(372, 16, 124, 40);
  c.fillStyle = valid ? (ahead ? '#3ddc5a' : '#ff5a5a') : '#9aa4ad';
  c.font = `bold 28px ${LCD_FONT}`;
  c.fillText(valid ? value.delta.replace(/(\.\d\d)\d$/, '$1') : 'DELTA', 434, 37);
  // Gear.
  c.fillStyle = '#ffffff';
  c.font = `bold 120px ${LCD_FONT}`;
  c.fillText(value.gear, 256, 134);
  // Left column: lap time over speed.
  c.textAlign = 'left';
  c.font = `600 28px ${LCD_FONT}`;
  c.fillText(lapClock(frame[base + F.LAP_TIME]), 16, 92);
  c.fillStyle = '#c8ccd4';
  c.font = `600 24px ${LCD_FONT}`;
  c.fillText(`${value.speed} KM/H`, 16, 128);
  c.fillText(`DIFF ${value.differential}`, 16, 162);
  // Right column: four tyre surface temperatures, then brake bias.
  c.textAlign = 'center';
  c.font = `bold 22px ${LCD_FONT}`;
  for (let i = 0; i < 4; i++) {
    const t = frame[base + WHEEL_BASE + i * WHEEL_STRIDE + W.SURFACE_TEMP];
    c.fillStyle = tyreTempColour(t);
    c.fillRect(366 + (i % 2) * 66, 74 + Math.floor(i / 2) * 42, 60, 36);
    c.fillStyle = '#020305';
    c.fillText(
      Number.isFinite(t) ? String(Math.round(t)) : '--',
      396 + (i % 2) * 66,
      93 + Math.floor(i / 2) * 42,
    );
  }
  c.fillStyle = '#c8ccd4';
  c.font = `600 22px ${LCD_FONT}`;
  c.fillText(`BB ${value.brakeBias}`, 430, 178);
  // Bottom bar: ERS with a 10 % tick grid and the mode inside.
  const overtake = value.ers === 'ATTACK';
  c.fillStyle = '#0d1a10';
  c.fillRect(16, 212, 480, 32);
  c.fillStyle = overtake ? '#ffd21f' : '#39d353';
  c.fillRect(16, 212, 480 * value.battery, 32);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  for (let k = 1; k < 10; k++) c.fillRect(16 + 48 * k - 1, 212, 2, 32);
  c.fillStyle = '#000000';
  c.font = `bold 20px ${LCD_FONT}`;
  c.fillText(overtake ? 'OVERTAKE' : value.ers, 200, 229);
  c.textAlign = 'right';
  c.fillStyle = '#ffffff';
  c.fillText(`${Math.round(value.battery * 100)}%`, 490, 229);
  // RPM strip along the top bezel.
  c.fillStyle = '#f3a849';
  c.fillRect(12, 6, 488 * clamp(value.rpm / 13700, 0, 1), 4);
}

/** Throttle texture uploads by observed simulation time, never the camera's
 * clamped integration delta. A hitch must not leave an old gear/speed visible
 * for several more frames. Gear changes and replay rewinds refresh immediately.
 * Repeated paused snapshots do not synthesize a new measurement or upload. */
export class SteeringDisplayClock {
  private previousTime = NaN;
  private previousGear = NaN;
  due(simulationTime: number, gear: number) {
    if (!Number.isFinite(simulationTime) || !Number.isFinite(gear))
      throw new Error('Non-finite steering display state');
    const refresh = !Number.isFinite(this.previousTime) ||
      simulationTime < this.previousTime || gear !== this.previousGear ||
      simulationTime - this.previousTime >= 0.08 - 1e-6;
    if (refresh) { this.previousTime = simulationTime; this.previousGear = gear; }
    return refresh;
  }
}
