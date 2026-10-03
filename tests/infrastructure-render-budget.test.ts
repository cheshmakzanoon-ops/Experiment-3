import { describe, expect, it } from 'vitest';
import { requireInfrastructureRenderBudget } from '../scripts/infrastructure-render-budget.ts';
import baseline from '../docs/TRACK_INFRASTRUCTURE_RENDER_BASELINE.json' with { type: 'json' };

describe('infrastructure submitted-work accounting', () => {
  for (const lighting of ['day', 'sunset', 'night'] as const) {
    const ref = baseline.lighting[lighting];
    const sample = () => ({ name: 'normal-cockpit', calls: ref.calls, triangles: ref.triangles });
    const phases = () => structuredClone(ref.drawBreakdown);
    it(`${lighting}: accepts the measured baseline with all passes counted`, () => {
      expect(() => requireInfrastructureRenderBudget(lighting, sample(), phases())).not.toThrow();
    });
    it(`${lighting}: rejects extra calls just beyond the complete-frame envelope`, () => {
      const row = sample(),
        parts = phases();
      const extra = Math.floor(ref.calls * 1.02) + 1 - row.calls;
      row.calls += extra;
      parts.shadow.calls += extra;
      expect(() => requireInfrastructureRenderBudget(lighting, row, parts)).toThrow('more than 2%');
    });
    it(`${lighting}: rejects extra triangles just beyond the complete-frame envelope`, () => {
      const row = sample(),
        parts = phases();
      const extra = Math.floor(ref.triangles * 1.02) + 1 - row.triangles;
      row.triangles += extra;
      parts.shadow.triangles += extra;
      expect(() => requireInfrastructureRenderBudget(lighting, row, parts)).toThrow('more than 2%');
    });
    it(`${lighting}: rejects missing or inconsistent pass accounting`, () => {
      expect(() => requireInfrastructureRenderBudget(lighting, sample())).toThrow('accounting');
      const parts = phases();
      parts.mirrors.calls--;
      expect(() => requireInfrastructureRenderBudget(lighting, sample(), parts)).toThrow('totals');
    });
    it(`${lighting}: keeps the 1,800-call compositor ceiling even within the total`, () => {
      const parts = phases();
      parts.mirrors.calls -= 1800 - parts.composer.calls;
      parts.composer.calls = 1800;
      expect(() => requireInfrastructureRenderBudget(lighting, sample(), parts)).toThrow(
        'composer draw budget',
      );
    });
  }
  it('retains the strict direct-scene ceiling', () => {
    expect(() =>
      requireInfrastructureRenderBudget('day', {
        name: 'A01-concrete',
        calls: 1799,
        triangles: 4000,
      }),
    ).not.toThrow();
    expect(() =>
      requireInfrastructureRenderBudget('day', {
        name: 'A01-concrete',
        calls: 1800,
        triangles: 4000,
      }),
    ).toThrow('direct-scene');
  });
  it('rejects non-finite, negative and empty counts', () => {
    for (const calls of [NaN, Infinity, -1, 0, 1.5])
      expect(() =>
        requireInfrastructureRenderBudget('day', { name: 'A01-concrete', calls, triangles: 100 }),
      ).toThrow();
  });
});
