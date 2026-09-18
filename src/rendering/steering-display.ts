import { F } from '../simulation/protocol.ts';
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
export function drawSteeringDisplay(
  c: CanvasRenderingContext2D,
  frame: Float32Array,
  base: number,
) {
  const value = steeringReadout(frame, base);
  c.fillStyle = '#09100f';
  c.fillRect(0, 0, 512, 256);
  c.textAlign = 'center';
  c.fillStyle = '#d9ffde';
  c.font = 'bold 92px monospace';
  c.fillText(value.gear, 256, 119);
  c.font = 'bold 36px monospace';
  c.fillText(`${value.speed} KM/H`, 256, 161);
  c.font = '24px monospace';
  c.fillStyle = '#a5b7b2';
  c.fillText('BB', 69, 70);
  c.fillText('DIFF', 446, 70);
  c.fillStyle = '#e2e7d6';
  c.font = 'bold 31px monospace';
  c.fillText(value.brakeBias, 69, 110);
  c.fillText(String(value.differential), 446, 110);
  c.font = '22px monospace';
  c.fillStyle = '#a5b7b2';
  c.fillText(value.ers, 256, 197);
  c.fillStyle = value.ahead ? '#77dfad' : '#f0cd8d';
  c.font = 'bold 27px monospace';
  c.fillText(`DELTA ${value.delta}`, 256, 231);
  c.fillStyle = '#f3a849';
  c.fillRect(12, 10, 488 * clamp(value.rpm / 13700, 0, 1), 9);
  c.fillStyle = '#54d4b6';
  c.fillRect(12, 244, 488 * value.battery, 5);
}
