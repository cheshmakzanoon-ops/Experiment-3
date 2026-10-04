import { DRAW_PHASES, type DrawBreakdown } from '../src/rendering/draw-ledger.ts';
import {
  requireInfrastructureRenderBudget,
  type InfrastructureRenderSample,
} from './infrastructure-render-budget.ts';

/** Fixed inspections submit colour plus shadow maps inside WebGLRenderer.render.
 * Bound each actual pass by the retained 1,800-call ceiling, require exact full
 * accounting, and compare whole submitted workloads in the matched browser job.
 * Neither rendering nor the existing cockpit/infrastructure gate is changed. */
export function requireOperationsInspectionBudget(
  sample: InfrastructureRenderSample,
  passes: DrawBreakdown,
) {
  if (!passes) throw new Error('Inspection pass accounting is required');
  let calls = 0,
    triangles = 0;
  for (const phase of DRAW_PHASES) {
    const row = passes[phase];
    if (
      !row ||
      !Number.isSafeInteger(row.calls) ||
      row.calls < 0 ||
      !Number.isSafeInteger(row.triangles) ||
      row.triangles < 0
    )
      throw new Error(`Invalid inspection phase: ${phase}`);
    calls += row.calls;
    triangles += row.triangles;
    if (phase !== 'other' && phase !== 'shadow' && (row.calls || row.triangles))
      throw new Error(`Unexpected inspection phase: ${phase}`);
  }
  if (sample.calls !== calls || sample.triangles !== triangles)
    throw new Error('Inspection totals do not equal submitted passes');
  for (const phase of ['other', 'shadow'] as const) {
    const row = passes[phase];
    requireInfrastructureRenderBudget('day', { name: `${sample.name}/${phase}`, ...row });
  }
}
