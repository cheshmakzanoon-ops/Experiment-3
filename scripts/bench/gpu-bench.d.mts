export interface BenchRun {
  outcome: string;
  gpu: { renderer: string; vendor: string; software: boolean } | null;
  bootToMenuS: number | null;
  seconds: number;
  avgFps: number | null;
  minFps: number | null;
  p1Fps: number | null;
  p5Fps: number | null;
  medianFps: number | null;
  maxStallMs: number | null;
  longTasks: number | null;
  jsHeapGrowthSession2MB: number | null;
  findings: number;
  consoleErrors: number;
}
export interface BenchTargets {
  minAvg: number;
  minP5: number;
  maxStallMs: number;
  maxBootS: number;
}
export function percentile(sorted: number[], fraction: number): number | null;
export function summariseRun(result: Record<string, unknown>): BenchRun;
export function judge(run: BenchRun, targets: BenchTargets, isTargetQuality: boolean): { pass: boolean; problems: string[] };
