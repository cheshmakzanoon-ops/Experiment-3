import { describe, expect, it } from 'vitest';
import {
  GP_TYRE_SIDEWALL,
  gpTyreContactAcross,
  gpTyreScrubEdge,
} from '../src/rendering/gp-tyre-finish.ts';
import { GP_SHIFT_LIGHTS, gpShiftLightsLit } from '../src/rendering/bike-cockpit.ts';
import { GP_LIP_BEVEL, gpWheelMachinedLip } from '../src/rendering/gp-forged-wheel.ts';
import { gpInnerFairingNet } from '../src/rendering/gp-race-bodywork.ts';

describe('GP slick scrub band follows the presented lean', () => {
  it('places the contact patch at crown * sin(lean) across the tread', () => {
    const { crown, halfWidth } = GP_TYRE_SIDEWALL.front;
    expect(gpTyreContactAcross(0, crown, halfWidth)).toBe(0);
    expect(gpTyreContactAcross(0.5, crown, halfWidth)).toBeCloseTo(
      (crown * Math.sin(0.5)) / halfWidth,
      9,
    );
    // Symmetric in lean direction and bounded at the tread edge.
    expect(gpTyreContactAcross(-0.5, crown, halfWidth)).toBe(
      gpTyreContactAcross(0.5, crown, halfWidth),
    );
    expect(gpTyreContactAcross(1.4, crown, halfWidth)).toBe(1);
    for (const bad of [NaN, Infinity, -Infinity])
      expect(gpTyreContactAcross(bad, crown, halfWidth)).toBe(0);
  });
  it('keeps a run-in band upright and widens it monotonically to the edge with lean', () => {
    const { crown, halfWidth } = GP_TYRE_SIDEWALL.rear;
    let previous = 0;
    for (let lean = 0; lean <= 1.1; lean += 0.05) {
      const edge = gpTyreScrubEdge(gpTyreContactAcross(lean, crown, halfWidth));
      expect(edge).toBeGreaterThanOrEqual(previous);
      expect(edge).toBeGreaterThanOrEqual(0.62);
      expect(edge).toBeLessThanOrEqual(0.97);
      previous = edge;
    }
    expect(gpTyreScrubEdge(gpTyreContactAcross(0, crown, halfWidth))).toBe(0.62);
    // About 57 degrees of lean scrubs the rear to its edge.
    expect(gpTyreScrubEdge(gpTyreContactAcross(1, crown, halfWidth))).toBe(0.97);
  });
});

describe('GP race TFT shift lights', () => {
  it('stay dark low in the rev range and fill to the shift point', () => {
    expect(gpShiftLightsLit(0)).toBe(0);
    expect(gpShiftLightsLit(GP_SHIFT_LIGHTS.from)).toBe(0);
    expect(gpShiftLightsLit(GP_SHIFT_LIGHTS.to)).toBe(GP_SHIFT_LIGHTS.count);
    expect(gpShiftLightsLit(1)).toBe(GP_SHIFT_LIGHTS.count);
    expect(gpShiftLightsLit(NaN)).toBe(0);
    let previous = 0;
    for (let fill = 0; fill <= 1; fill += 0.01) {
      const lit = gpShiftLightsLit(fill);
      expect(lit).toBeGreaterThanOrEqual(previous);
      previous = lit;
    }
  });
});

describe('GP forged wheel machined lips', () => {
  it('are two finite outward-facing flange rings just proud of the rim face', () => {
    for (const [rim, halfWidth] of [
      [0.2159, 0.06],
      [0.2159, 0.1],
    ]) {
      const g = gpWheelMachinedLip(rim, halfWidth, 'high');
      try {
        const p = g.getAttribute('position'),
          n = g.getAttribute('normal');
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i),
            r = Math.hypot(p.getY(i), p.getZ(i));
          // The outer edge is 0.4 mm proud of the flange face; the chamfer rises to
          // 6.5 mm * tan(32 deg) = 4 mm above that at its inner edge.
          const proud = Math.abs(x) - (halfWidth * 0.76 + 0.0004);
          expect(proud).toBeGreaterThan(-1e-6);
          expect(proud).toBeLessThan(0.0042);
          expect(r).toBeGreaterThan(rim - 0.009);
          expect(r).toBeLessThan(rim - 0.0019);
          // Each ring faces away from the wheel's centre plane, tilted outward
          // along the radius by the chamfer angle.
          expect(Math.sign(n.getX(i))).toBe(Math.sign(x));
          expect(Math.abs(n.getX(i))).toBeCloseTo(Math.cos(GP_LIP_BEVEL), 5);
        }
      } finally {
        g.dispose();
      }
    }
    expect(() => gpWheelMachinedLip(0.5, 0.06, 'high')).toThrow();
  });
  it('maps U round the circumference and V across the band, so lathe marks and anisotropy follow the lip', () => {
    const rim = 0.2159,
      g = gpWheelMachinedLip(rim, 0.06, 'high');
    try {
      const p = g.getAttribute('position'),
        uv = g.getAttribute('uv');
      let maxV = 0;
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getY(i), p.getZ(i));
        // V is the radial position: inner edge 0, outer edge 1.
        const expectedV = (r - (rim - 0.0085)) / (0.0085 - 0.002);
        expect(uv.getY(i)).toBeCloseTo(expectedV, 3);
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getX(i)).toBeLessThanOrEqual(1);
        maxV = Math.max(maxV, uv.getY(i));
      }
      expect(maxV).toBe(1);
      // U advances with the angle about the axle (X): a quarter turn is a quarter of U.
      const angle = (i: number) => Math.atan2(p.getZ(i), p.getY(i));
      const outer = Array.from({ length: p.count }, (_, i) => i).filter(
        (i) => uv.getY(i) === 1 && p.getX(i) > 0,
      );
      const first = outer[0],
        quarter = outer[16];
      const turn = ((angle(quarter) - angle(first) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      expect(Math.abs(Math.abs(turn) - Math.PI / 2)).toBeLessThan(1e-3);
      expect(uv.getX(quarter) - uv.getX(first)).toBeCloseTo(0.25, 6);
    } finally {
      g.dispose();
    }
  });
});

describe('GP inner upper fairing', () => {
  it('stays inside the screen base, ahead of the steering sweep, dipping under the TFT', () => {
    const net = gpInnerFairingNet();
    for (const row of net) {
      for (const [x, y, z] of row) {
        expect(z).toBeGreaterThanOrEqual(0.545);
        expect(Math.abs(x)).toBeLessThan(0.142);
        expect(y).toBeGreaterThan(0.26);
        expect(y).toBeLessThan(0.3);
      }
      // Centre line first (mirrored seam), lowest under the display.
      expect(row[0][0]).toBe(0);
      expect(row[0][1]).toBeLessThan(row[row.length - 1][1]);
    }
  });
});
