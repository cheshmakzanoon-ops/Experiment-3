import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { DrawLedger, type DrawBreakdown } from '../src/rendering/draw-ledger.ts';
import { requireOperationsInspectionBudget } from '../scripts/operations-render-budget.ts';

const fixture = () => {
  const passes = DrawLedger.empty();
  passes.other = { calls: 1000, triangles: 3000 };
  passes.shadow = { calls: 1100, triangles: 3300 };
  return { sample: { name: 'inspection', calls: 2100, triangles: 6300 }, passes };
};
describe('operations inspection accounting', () => {
  it('accounts for an actual shadow pass plus a colour pass, not a single 2,100-call colour pass', () => {
    const { sample, passes } = fixture();
    expect(() => requireOperationsInspectionBudget(sample, passes)).not.toThrow();
  });
  for (const phase of ['other', 'shadow'] as const) {
    it(`retains the strict 1,800-call ceiling for ${phase}`, () => {
      const { sample, passes } = fixture();
      sample.calls += 1800 - passes[phase].calls;
      passes[phase].calls = 1800;
      expect(() => requireOperationsInspectionBudget(sample, passes)).toThrow('draw budget');
    });
    it(`rejects missing ${phase} rendering`, () => {
      const { sample, passes } = fixture();
      sample.calls -= passes[phase].calls;
      sample.triangles -= passes[phase].triangles;
      passes[phase] = { calls: 0, triangles: 0 };
      expect(() => requireOperationsInspectionBudget(sample, passes)).toThrow('empty rendering');
    });
  }
  for (const key of ['calls', 'triangles'] as const) {
    it(`rejects unaccounted ${key}`, () => {
      const { sample, passes } = fixture();
      sample[key]++;
      expect(() => requireOperationsInspectionBudget(sample, passes)).toThrow('totals');
    });
    it(`rejects invalid ${key}`, () => {
      const { sample, passes } = fixture();
      passes.other[key] = NaN;
      expect(() => requireOperationsInspectionBudget(sample, passes)).toThrow('Invalid');
    });
  }
  it('rejects absent accounting', () => {
    expect(() =>
      requireOperationsInspectionBudget(fixture().sample, null as unknown as DrawBreakdown),
    ).toThrow('required');
  });
  it('rejects an unexpected hidden pass', () => {
    const { sample, passes } = fixture();
    passes.wet.calls = 1;
    sample.calls++;
    expect(() => requireOperationsInspectionBudget(sample, passes)).toThrow('Unexpected');
  });
  it('projects using the current unparented camera before the first GPU render', () => {
    const camera = new T.PerspectiveCamera(40, 16 / 9, 0.1, 1000);
    camera.position.set(0, 2, -10);
    camera.lookAt(10, 2, -10);
    camera.updateMatrixWorld(true);
    const target = new T.Vector3(100, 3, 80);
    camera.position.set(100, 3, 77);
    camera.lookAt(target);
    const stale = target.clone().project(camera);
    camera.updateMatrixWorld(true);
    const current = target.clone().project(camera);
    expect(Math.abs(stale.x)).toBeGreaterThan(1);
    expect(current.x).toBeCloseTo(0, 10);
    expect(current.y).toBeCloseTo(0, 10);
    expect(current.z).toBeLessThan(1);
  });
});
