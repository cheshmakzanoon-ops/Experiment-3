import { describe, expect, it } from 'vitest';
import { judge, percentile, summariseRun } from '../scripts/bench/gpu-bench.mjs';

const targets = { minAvg: 58, minP5: 45, maxStallMs: 250, maxBootS: 30 };
const rows = (fps: number[]) => ({ rows: fps.map((rafFps) => ({ rafFps })) });
const result = (fps: number[], extra: Record<string, unknown> = {}) => ({
  summary: {
    outcome: 'ok',
    boot: { timeToMenuS: 12, gpu: { renderer: 'NVIDIA GeForce GTX 1660', vendor: 'NVIDIA', software: false } },
    drives: [rows(fps)],
    memory: { jsHeapGrowthSession2MB: 4 },
  },
  pageCounters: { maxGap: 120, longTasks: 2 },
  findings: [],
  console: [],
  ...extra,
});

describe('gpu benchmark reduction', () => {
  it('uses nearest-rank percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.05)).toBe(1);
    expect(percentile([], 0.5)).toBeNull();
  });

  it('drops the first three seconds of warm-up and summarises the rest', () => {
    const fps = [5, 5, 5, ...Array.from({ length: 40 }, () => 60)];
    const run = summariseRun(result(fps));
    expect(run.seconds).toBe(40);
    expect(run.avgFps).toBe(60);
    expect(run.minFps).toBe(60);
    expect(run.bootToMenuS).toBe(12);
    expect(run.gpu?.renderer).toContain('1660');
  });

  it('passes a steady 60 fps run at the target preset', () => {
    const run = summariseRun(result(Array.from({ length: 43 }, () => 60)));
    expect(judge(run, targets, true)).toEqual({ pass: true, problems: [] });
  });

  it('fails a run whose slow seconds break the 5th percentile', () => {
    const fps = [...Array.from({ length: 3 }, () => 60), ...Array.from({ length: 30 }, () => 62), ...Array.from({ length: 10 }, () => 30)];
    const verdict = judge(summariseRun(result(fps)), targets, true);
    expect(verdict.pass).toBe(false);
    expect(verdict.problems.join(' ')).toContain('p5');
  });

  it('judges only boot, stalls and fps at the target preset, but always rejects software and errors', () => {
    const slow = summariseRun(result(Array.from({ length: 43 }, () => 20), { pageCounters: { maxGap: 900, longTasks: 9 } }));
    expect(judge(slow, targets, false).pass).toBe(true);
    expect(judge(slow, targets, true).pass).toBe(false);
    const soft = summariseRun(result(Array.from({ length: 43 }, () => 60), {
      summary: { outcome: 'ok', boot: { gpu: { renderer: 'ANGLE (Google, Vulkan, SwiftShader)', vendor: 'Google', software: true } }, drives: [rows(Array.from({ length: 43 }, () => 60))] },
      console: [{ type: 'pageerror', text: 'boom' }],
    }));
    const verdict = judge(soft, targets, false);
    expect(verdict.problems).toEqual(expect.arrayContaining(['software renderer', '1 console error(s)']));
  });

  it('treats a journey that produced no data as a failure, not a pass', () => {
    const run = summariseRun({ summary: { outcome: 'no result (exit 1)' } });
    expect(run.seconds).toBe(0);
    expect(judge(run, targets, true).pass).toBe(false);
  });
});
