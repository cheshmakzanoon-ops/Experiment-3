import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { staticSag } from '../src/rendering/bike.ts';
import {
  motocrossAirbox,
  motocrossMudFlap,
  mxMudFlapLoad,
  motocrossSeat,
  motocrossTankShell,
  motocrossTankTop,
} from '../src/rendering/offroad/motocross-bodywork.ts';
import { motocrossGarmentGeometry, motocrossNeckBrace } from '../src/rendering/offroad/motocross-gear.ts';
import { motocrossRoostDeflector } from '../src/rendering/offroad/mx-roost-deflector.ts';
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

  it('pins the mud flap under the airbox and bends its ribbed free edge without stretching it', () => {
    const flap = motocrossMudFlap();
    try {
      const p = flap.getAttribute('position'),
        n = flap.getAttribute('normal');
      const move = flap.morphAttributes.position![0],
        tilt = flap.morphAttributes.normal![0];
      let travel = 0;
      for (let i = 0; i < p.count; i++) {
        const dy = move.getY(i),
          dz = move.getZ(i);
        travel = Math.max(travel, dz);
        if (p.getY(i) >= 0.07) expect([move.getX(i), dy, dz]).toEqual([0, 0, 0]);
        const reach = Math.max(0, 0.07 - p.getY(i));
        const chord = Math.hypot(reach - dy, dz);
        expect(chord).toBeLessThanOrEqual(reach + 1e-7);
        expect(chord).toBeGreaterThanOrEqual(0.985 * reach);
        const transformed = new T.Vector3()
          .fromBufferAttribute(n, i)
          .add(new T.Vector3().fromBufferAttribute(tilt, i));
        expect(transformed.length()).toBeCloseTo(1, 5);
      }
      expect(travel).toBeGreaterThan(0.036);
      expect(travel).toBeLessThan(0.043);
      expect(mxMudFlapLoad(0, 0, 1, 0)).toBe(0);
      expect(mxMudFlapLoad(22, 40, 0, 0)).toBeLessThan(0);
      expect(mxMudFlapLoad(6, 25, 1, 0)).toBeGreaterThan(0.3);
      expect(mxMudFlapLoad(6, 25, 3, 1)).toBeGreaterThan(0.9);
    } finally {
      flap.dispose();
    }
  });

  it.each(['mx450', 'mx250'])(
    '%s mud flap clears the moving rear tyre at droop, sag and bottom-out',
    (id) => {
      const def = VEHICLES[id],
        b = def.bike!,
        sag = staticSag(def);
      const pivot = new T.Vector2(-0.15, -0.36);
      const axle = new T.Vector2(-b.cgToRear, b.rearWheelRadius - b.cgHeight);
      const arm = axle.distanceTo(pivot),
        flap = motocrossMudFlap();
      const p = flap.getAttribute('position'),
        m = flap.morphAttributes.position![0];
      const position = new T.Vector3(),
        offset = new T.Vector3(),
        xAxis = new T.Vector3(1, 0, 0);
      try {
        for (const shock of [0, sag.shock, b.shockTravel]) {
          const dy = axle.y + shock - sag.shock - pivot.y;
          const z = pivot.x - Math.sqrt(arm * arm - dy * dy),
            y = pivot.y + dy;
          const stroke = Math.max(0, (shock - sag.shock) / (b.shockTravel - sag.shock));
          const weight = mxMudFlapLoad(22, 22, stroke ? 3 : 0, stroke);
          let gap = Infinity;
          for (let i = 0; i < p.count; i++) {
            position
              .fromBufferAttribute(p, i)
              .addScaledVector(offset.fromBufferAttribute(m, i), weight)
              .applyAxisAngle(xAxis, 0.3);
            if (Math.abs(position.x) <= 0.066)
              gap = Math.min(
                gap,
                Math.hypot(position.z - 0.345 - z, position.y - 0.14 - y) - b.rearWheelRadius,
              );
          }
          expect(gap).toBeGreaterThan(0.005);
        }
      } finally {
        flap.dispose();
      }
    },
  );

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
  it.each(['high', 'mid', 'far'] as const)('%s kidney belt wraps the jersey continuously at the waist', (detail) => {
    const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
    const jersey = new T.Mesh(motocrossGarmentGeometry('jersey', detail), material);
    const guard = new T.Mesh(motocrossRoostDeflector(detail, 0xdec842, false), material);
    const ray = new T.Raycaster();
    try {
      for (let degree = 0; degree < 360; degree += 2) {
        const angle = degree * Math.PI / 180;
        ray.ray.origin.set(0.41 * Math.cos(angle), 0.17, -0.005 + 0.41 * Math.sin(angle));
        ray.ray.direction.set(-Math.cos(angle), 0, -Math.sin(angle));
        const cloth = ray.intersectObject(jersey)[0];
        const band = ray.intersectObject(guard)[0];
        expect(band, `belt at ${degree} degrees`).toBeDefined();
        expect(cloth).toBeDefined();
        const clearance = cloth.distance - band.distance;
        expect(clearance).toBeGreaterThan(0);
        expect(clearance).toBeLessThan(0.027);
      }
    } finally {
      jersey.geometry.dispose();
      guard.geometry.dispose();
      material.dispose();
    }
  });
  it('shows the release below the stamped tongue and seats its two moulded end faces', () => {
    const g = motocrossNeckBrace('high');
    const mesh = new T.Mesh(g, new T.MeshBasicMaterial());
    const tangent = new T.Vector3(-0.5, 0, Math.sqrt(3) / 2);
    const pivot = new T.Vector3(0.113 * Math.cos(Math.PI / 6), 0.5055, 0.024 + 0.084 / 2);
    try {
      for (const sign of [-1, 1]) {
        const ray = new T.Raycaster(pivot, tangent.clone().multiplyScalar(sign), 0, 0.004);
        const hit = ray.intersectObject(mesh)[0];
        expect(hit?.distance).toBeGreaterThan(0.0008);
        expect(hit.distance).toBeLessThan(0.0023);
        expect(hit.face!.normal.dot(ray.ray.direction)).toBeLessThan(-0.95);
      }
      const above = new T.Raycaster(new T.Vector3(0.108, 0.53, 0.072), new T.Vector3(0, -1, 0));
      expect(above.intersectObject(mesh)[0]?.point.y).toBeCloseTo(0.5185, 5);
    } finally {
      mesh.material.dispose();
      g.dispose();
    }
  });

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
      // The moulded rim was wound inward: the outside disappeared when
      // back-face culling was active. Check its two shoulder extremities.
      const normal = brace.getAttribute('normal');
      for (const side of [-1, 1]) {
        let tip = 0;
        for (let i = 1; i < p.count; i++)
          if (p.getX(i) * side > p.getX(tip) * side) tip = i;
        expect(normal.getX(tip) * side).toBeGreaterThan(0.7);
        expect(p.getY(tip)).toBeLessThan(0.52);
      }
      expect(brace.getAttribute('color').count).toBe(p.count);
      expect(inner).toBeGreaterThan(0.056);
    } finally {
      brace.dispose();
    }
  });
});
