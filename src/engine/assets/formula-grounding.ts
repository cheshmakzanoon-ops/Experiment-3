/* Scalar pose rotation adapted from Three.js r180 Vector3.applyQuaternion.
The MIT License

Copyright © 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

import { W, WHEEL_BASE, WHEEL_STRIDE } from '../../simulation/protocol.ts';
import { FORMULA_APX01 } from '../../simulation/vehicles.ts';

/** Original Formula grounding data, not a renderer/material or simulation.
 * The legacy path deliberately retains its permissive nonfinite/default rules.
 * Stricter adapter validation, if needed, belongs outside this boundary. */
export const FORMULA_GROUNDING_MAX_CARS = 12;
export const FORMULA_GROUNDING_MOUNTS = FORMULA_APX01.wheelPositions;
export const FORMULA_GROUNDING_DEFAULT_LENGTH = 0.25;
export const FORMULA_GROUNDING_DEFAULT_RADIUS = 0.335;

/** Preserve the original shallow freezes and nested-array mutability. */
export const CAR_GROUNDING = Object.freeze({
  indirect: 0.6,
  direct: 0.32,
  falloff: 0.2,
  tyreFalloff: 0.09,
  height: 0.45,
  /** Cars further than this (metres, footprint centre) are skipped per pixel. */
  reach: 4,
});

/** Footprint parts in car-local (across, along) metres: centre, half size,
 * strength. Wheel contacts are at (±0.83, 1.82) and (±0.83, -1.62). */
export const CAR_FOOTPRINT = Object.freeze([
  { name: 'floor', centre: [0, -0.3], half: [0.78, 1.5], strength: 1 },
  { name: 'nose', centre: [0, 1.9], half: [0.28, 0.7], strength: 0.45 },
  { name: 'front wing', centre: [0, 2.5], half: [0.95, 0.28], strength: 0.5 },
  { name: 'rear wing', centre: [0, -2.3], half: [0.5, 0.35], strength: 0.5 },
] as const);
export const CAR_TYRES = Object.freeze({
  across: 0.83,
  front: 1.82,
  rear: -1.62,
  half: [0.19, 0.34],
});

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function groundBox(
  qx: number,
  qz: number,
  cx: number,
  cz: number,
  hx: number,
  hz: number,
  falloff: number,
) {
  const dx = Math.abs(qx - cx) - hx,
    dz = Math.abs(qz - cz) - hz;
  const sdf = Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
  return 1 - smooth(-falloff, falloff, sdf);
}
/** CPU reference of the shader's `apexCarGrounding` for one car: occlusion
 * 0..1 at car-local (across, height above ground, along). */
export function carGroundingAt(across: number, height: number, along: number) {
  const gate = 1 - smooth(CAR_GROUNDING.height * 0.4, CAR_GROUNDING.height, Math.abs(height));
  if (gate <= 0) return 0;
  let occ = 0;
  for (const part of CAR_FOOTPRINT)
    occ = Math.max(
      occ,
      part.strength *
        groundBox(
          across,
          along,
          part.centre[0],
          part.centre[1],
          part.half[0],
          part.half[1],
          CAR_GROUNDING.falloff,
        ),
    );
  for (const z of [CAR_TYRES.front, CAR_TYRES.rear])
    occ = Math.max(
      occ,
      groundBox(
        Math.abs(across),
        along,
        CAR_TYRES.across,
        z,
        CAR_TYRES.half[0],
        CAR_TYRES.half[1],
        CAR_GROUNDING.tyreFalloff,
      ),
    );
  return occ * gate;
}

/** Preserve StudioFrame's floor/clamp and `value || 0` semantics, including
 * NaN -> 0 and Infinity -> 12. This is not a frame-validity predicate. */
export function formulaGroundingCarCount(value: number) {
  return Math.min(FORMULA_GROUNDING_MAX_CARS, Math.max(0, Math.floor(value || 0)));
}

export interface GroundingPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export interface GroundingQuaternion extends GroundingPosition {
  readonly w: number;
}
export interface FormulaGroundingPose {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Write (world x, world z, heading, mean contact height) into caller-owned data.
 * The quaternion MUST be the already-normalized presented chassis quaternion:
 * StudioFrame retains its original Three normalization/matrix/history path.
 * Do not normalize a second time, fit a banked plane, use the newer rigid-wheel
 * helper, substitute per-vehicle mounts, or sanitize legacy malformed values.
 * The scalar order below is Three r180 Vector3.applyQuaternion's original order.
 * There are no allocations, renderer imports, clocks or additional state here. */
export function writeFormulaGroundingPose(
  presented: Float32Array,
  offset: number,
  position: GroundingPosition,
  quaternion: GroundingQuaternion,
  out: FormulaGroundingPose,
) {
  const qx = quaternion.x,
    qy = quaternion.y,
    qz = quaternion.z,
    qw = quaternion.w;
  const vx = 0,
    vy = 0,
    vz = 1;
  const tx = 2 * (qy * vz - qz * vy),
    ty = 2 * (qz * vx - qx * vz),
    tz = 2 * (qx * vy - qy * vx);
  const forwardX = vx + qw * tx + qy * tz - qz * ty,
    forwardZ = vz + qw * tz + qx * ty - qy * tx;
  const heading = Math.atan2(forwardX, forwardZ);
  let sum = 0;
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = offset + WHEEL_BASE + wheel * WHEEL_STRIDE,
      mount = FORMULA_GROUNDING_MOUNTS[wheel];
    const length = presented[p + W.LENGTH] || FORMULA_GROUNDING_DEFAULT_LENGTH,
      radius = presented[p + W.RADIUS] || FORMULA_GROUNDING_DEFAULT_RADIUS;
    const vx = mount[0],
      vy = mount[1] - length - radius,
      vz = mount[2];
    const tx = 2 * (qy * vz - qz * vy),
      ty = 2 * (qz * vx - qx * vz),
      tz = 2 * (qx * vy - qy * vx);
    const y = vy + qw * ty + qz * tx - qx * tz;
    sum += position.y + y;
  }
  out.x = position.x;
  out.y = position.z;
  out.z = heading;
  out.w = sum / 4;
  return out;
}
