import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { staticSag } from '../src/rendering/bike.ts';
import {
  motocrossAirbox,
  motocrossMudFlap,
  motocrossSeat,
  motocrossTankShell,
  motocrossTankTop,
} from '../src/rendering/offroad/motocross-bodywork.ts';
import { motocrossNeckBrace } from '../src/rendering/offroad/motocross-gear.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const triangles = (g: T.BufferGeometry) =>
  (g.index?.count ?? g.getAttribute('position').count) / 3;
const finite = (g: T.BufferGeometry) =>
  Object.values(g.attributes).every((a) => Array.from(a.array).every(Number.isFinite));
/** Highest surface point within `reach` of the centreline at station `z`. */
function crown(g: T.BufferGeometry, z: number, reach = 0.03) {
  const p = g.getAttribute('position');
  let top = -Infinity;
  for (let i = 0; i < p.count; i++)
    if (Math.abs(p.getZ(i) - z) < 0.03 && Math.abs(p.getX(i)) < reach)
      top = Math.max(top, p.getY(i));
  return top;
}

describe('motocross bodywork volumes', () => {
  it.each(['high', 'mid', 'far'] as const)('%s tank, seat, airbox and flap are finite and light', (detail) => {
    const parts = [motocrossTankShell(detail), motocrossSeat(detail), motocrossAirbox(detail)];
    try {
      for (const g of parts) {
        expect(finite(g)).toBe(true);
        g.computeBoundingBox();
        // Symmetric about the centreline, inside the shrouds and side panels.
        expect(g.boundingBox!.max.x).toBeCloseTo(-g.boundingBox!.min.x, 5);
        expect(g.boundingBox!.max.x).toBeLessThan(0.17);
      }
      const total = parts.reduce((n, g) => n + triangles(g), 0);
      expect(total).toBeLessThan(detail === 'high' ? 7000 : detail === 'mid' ? 2200 : 420);
    } finally {
      for (const g of parts) g.dispose();
    }
    const flap = motocrossMudFlap();
    expect(finite(flap)).toBe(true);
    expect(triangles(flap)).toBeLessThan(200);
    flap.dispose();
  });

  it('keeps the original seat crown where the rider sits and climbs the tank ahead of the hips', () => {
    const seat = motocrossSeat('high');
    try {
      // The earlier seat: centre + top radius at these stations.
      expect(crown(seat, -0.45)).toBeCloseTo(0.085 + 0.045, 2);
      expect(crown(seat, -0.15)).toBeCloseTo(0.09 + 0.045, 2);
      // The forward-most seated hip is at z = -0.155; nothing rises before z = -0.05.
      expect(crown(seat, -0.06)).toBeLessThan(0.145);
      expect(crown(seat, 0.13)).toBeGreaterThan(0.2);
    } finally {
      seat.dispose();
    }
  });

  it('raises the tank from the seat nose to just under the lower fork clamp', () => {
    let previous = motocrossTankTop(-0.06);
    for (let z = -0.04; z <= 0.2; z += 0.02) {
      const top = motocrossTankTop(z);
      expect(top).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = top;
    }
    const b = VEHICLES.mx450.bike!,
      // Lower clamp (steering mount) height in the sprung frame.
      clamp = b.frontWheelRadius - b.cgHeight + Math.cos(0.47) * 0.92 - Math.sin(0.47) * 0.022;
    expect(motocrossTankTop(0.2)).toBeGreaterThan(0.24);
    for (let z = -0.06; z <= 0.3; z += 0.01) expect(motocrossTankTop(z)).toBeLessThan(clamp);
    const tank = motocrossTankShell('high');
    tank.computeBoundingBox();
    // The moulding stops behind the steering stem and its sweeping clamps.
    expect(tank.boundingBox!.max.z).toBeLessThan(0.3);
    expect(tank.boundingBox!.max.y).toBeLessThan(clamp);
    tank.dispose();
  });

  it.each(['mx450', 'mx250', 'sm450'])('%s airbox clears the rear tyre through full travel', (id) => {
    const def = VEHICLES[id],
      b = def.bike!,
      sag = staticSag(def),
      pivot = new T.Vector2(-0.15, -0.36),
      axle = new T.Vector2(-b.cgToRear, b.rearWheelRadius - b.cgHeight),
      arm = axle.distanceTo(pivot),
      airbox = motocrossAirbox('high'),
      p = airbox.getAttribute('position');
    try {
      for (const shock of [0, sag.shock, b.shockTravel]) {
        const dy = axle.y + shock - sag.shock - pivot.y,
          z = pivot.x - Math.sqrt(arm * arm - dy * dy),
          y = pivot.y + dy;
        let nearest = Infinity;
        // The tyre is 12 cm wide; side panels may straddle it, as they do.
        for (let i = 0; i < p.count; i++)
          if (Math.abs(p.getX(i)) < 0.085)
            nearest = Math.min(nearest, Math.hypot(p.getZ(i) - z, p.getY(i) - y));
        expect(nearest).toBeGreaterThan(b.rearWheelRadius + 0.015);
      }
    } finally {
      airbox.dispose();
    }
  });
});

describe('motocross neck brace', () => {
  it.each(['high', 'mid', 'far'] as const)('%s ring rests on the shoulders clear of the neck', (detail) => {
    const brace = motocrossNeckBrace(detail),
      p = brace.getAttribute('position');
    try {
      expect(finite(brace)).toBe(true);
      expect(triangles(brace)).toBeLessThan(detail === 'high' ? 1500 : detail === 'mid' ? 700 : 300);
      let inner = Infinity;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        // Between the upper chest and the helmet rim.
        expect(y).toBeGreaterThan(0.4);
        expect(y).toBeLessThan(0.585);
        expect(Math.abs(p.getX(i))).toBeLessThan(0.15);
        // The ring itself (not the two struts) leaves the neck liner free.
        if (y > 0.53 && Math.abs(p.getX(i)) > 0.03)
          inner = Math.min(inner, Math.hypot(p.getX(i), p.getZ(i) - 0.029));
      }
      expect(inner).toBeGreaterThan(0.056);
    } finally {
      brace.dispose();
    }
  });
});
