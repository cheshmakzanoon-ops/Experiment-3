import { clamp, smooth, Vec3 } from '../core/math.ts';
import { VEHICLE, type Setup } from './config.ts';
export interface AeroForces {
  front: number;
  rear: number;
  floor: number;
  drag: number;
  wake: number;
}
export function groundEffect(frontHeight: number, rearHeight: number) {
  const h = (frontHeight + rearHeight) * 0.5;
  return (0.3 + 0.7 * smooth(0.012, 0.044, h)) * Math.exp(-Math.max(0, h - 0.075) * 7);
}
export function aero(
  speed: number,
  setup: Setup,
  frontHeight: number,
  rearHeight: number,
  frontHealth: number,
  rearHealth: number,
  floorHealth: number,
  wake: number,
  yawSlip: number,
  out: AeroForces,
) {
  const q = 0.5 * VEHICLE.airDensity * speed * speed * 1.3,
    yawLoss = Math.exp(-Math.abs(yawSlip) * 0.85),
    floor = groundEffect(frontHeight, rearHeight);
  out.front = q * (0.85 + setup.frontWing * 0.8) * frontHealth * (1 - 0.43 * wake) * yawLoss;
  out.rear = q * (1.05 + setup.rearWing * 0.9) * rearHealth * (1 - 0.2 * wake) * yawLoss;
  out.floor = q * 2.25 * floor * floorHealth * yawLoss * (1 - 0.24 * wake);
  out.drag =
    q *
    (0.76 + setup.frontWing * 0.14 + setup.rearWing * 0.23 + (1 - frontHealth) * 0.12) *
    (1 - 0.16 * wake);
  out.wake = wake;
}
export function wakeOverlap(
  follower: Vec3,
  leader: Vec3,
  leaderForward: Vec3,
  leaderSpeed: number,
) {
  const dx = follower.x - leader.x,
    dz = follower.z - leader.z,
    behind = -(dx * leaderForward.x + dz * leaderForward.z);
  if (behind <= 2 || behind > 100 || leaderSpeed < 20) return 0;
  const lateral = Math.abs(dx * leaderForward.z - dz * leaderForward.x),
    radius = 1.3 + behind * 0.055;
  return (
    Math.exp(-behind / 46) *
    (1 - smooth(radius * 0.3, radius, lateral)) *
    clamp(leaderSpeed / 55, 0, 1)
  );
}
