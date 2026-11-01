import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  summarizeOfflineGpuStructure,
  OfflineGpuStructureError,
} from '../scripts/offline-gpu-structure-runner.mjs';
import { writeStructuralWorkload } from './fixtures/offline-gpu-structure-workload';

// Explicit stress opt-in; not added to any workflow or default native selector.
const enabled = process.env.MOTOBOUND_STRUCTURE_STRESS === '1';
const parserPath = process.env.MOTOBOUND_TRACE_PROCESSOR;
const evidenceDirectory = process.env.MOTOBOUND_STRUCTURE_BENCHMARK_DIRECTORY;
const cases = [
  {
    id: 'sparse-8.5mb',
    targetBytes: 8_500_000,
    scopeCount: 400,
    depth: 1,
    qualifyingParents: true,
    openUnselected: true,
    requiredCompletion: true,
  },
  {
    id: 'dense-8.5mb',
    targetBytes: 8_500_000,
    scopeCount: 80_000,
    depth: 1,
    qualifyingParents: true,
    openUnselected: true,
    requiredCompletion: true,
  },
  {
    id: 'denser-9.1mb',
    targetBytes: 9_100_000,
    scopeCount: 120_000,
    depth: 1,
    qualifyingParents: true,
    openUnselected: true,
    requiredCompletion: true,
  },
  {
    id: 'depth64-9.1mb',
    targetBytes: 9_100_000,
    scopeCount: 60_000,
    depth: 64,
    qualifyingParents: true,
    openUnselected: true,
    requiredCompletion: true,
  },
  {
    id: 'nonqualifying-depth64-8.5mb',
    targetBytes: 8_500_000,
    scopeCount: 60_000,
    depth: 64,
    qualifyingParents: false,
    openUnselected: true,
    requiredCompletion: true,
  },
  {
    id: 'nonqualifying-depth256-9.1mb',
    targetBytes: 9_100_000,
    scopeCount: 60_000,
    depth: 256,
    qualifyingParents: false,
    openUnselected: true,
    requiredCompletion: false,
  },
  {
    id: 'sparse-exact64mib',
    targetBytes: 64 * 1024 * 1024,
    scopeCount: 10,
    depth: 1,
    qualifyingParents: true,
    openUnselected: true,
    requiredCompletion: true,
  },
] as const;

describe.skipIf(!enabled)(
  'explicitly synthetic structural size/density/depth qualification',
  () => {
    let directory: string;
    const measurements: Record<string, unknown>[] = [];
    beforeAll(async () => {
      expect(parserPath).toBeTruthy();
      directory = await mkdtemp(join(tmpdir(), 'structural-workload-synthetic-'));
    });
    afterAll(async () => {
      // Measurements are numeric/fixed case labels only, never trace/parser data.
      try {
        if (evidenceDirectory) {
          const output = {
            schema: 'synthetic-structural-route-cost-v1',
            syntheticOnly: true,
            workAcceptanceBudgetMs: 5000,
            realTracePerformanceCertified: false,
            rssCapped: false,
            measurements,
          };
          const serialized = JSON.stringify(output, null, 2) + '\n';
          expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(16 * 1024);
          await writeFile(join(evidenceDirectory, 'workload-timings.json'), serialized, {
            flag: 'wx',
            mode: 0o600,
          });
        }
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    });
    it.each(cases)(
      '$id stays bounded and retains only validated numeric evidence',
      async (spec) => {
        const path = join(directory, `${spec.id}.pftrace`);
        const generateStart = performance.now();
        const fixture = await writeStructuralWorkload(path, spec);
        const generationMs = performance.now() - generateStart;
        expect((await stat(path)).size).toBe(spec.targetBytes);
        const started = performance.now();
        let summary;
        let failure;
        try {
          summary = await summarizeOfflineGpuStructure({ path, parserPath: parserPath! });
        } catch (error) {
          failure = error;
        }
        const wallMs = performance.now() - started;
        measurements.push({
          id: spec.id,
          requiredCompletion: spec.requiredCompletion,
          scopeCount: spec.scopeCount,
          depth: spec.depth,
          qualifyingParents: spec.qualifyingParents,
          ...fixture,
          generationMs,
          wallMs,
          outcome: summary
            ? 'completed'
            : failure instanceof OfflineGpuStructureError
              ? failure.reason
              : 'unexpected-failure',
          serializedSummaryBytes: summary ? Buffer.byteLength(JSON.stringify(summary)) : 0,
          observedBucketCounts: summary?.buckets.map((row) => row.count) ?? null,
          observedCoverageMask: summary?.coverageMask ?? null,
          childTailCertified: summary?.childTailCertified ?? false,
        });
        expect(
          (await readdir(directory)).filter((x) => x.startsWith('.gpu-structure-private-')),
        ).toEqual([]);
        if (failure) {
          expect(failure).toBeInstanceOf(OfflineGpuStructureError);
          expect((failure as OfflineGpuStructureError).reason).toBe('processing-timeout');
          expect(
            spec.requiredCompletion,
            'Representative synthetic case exceeded the unchanged work budget',
          ).toBe(false);
        } else {
          expect(summary!.buckets.map((row) => row.count)).toEqual(fixture.bucketCounts);
          expect(summary!.coverageMask).toBe(fixture.expectedCoverageMask);
          expect(summary!.parserErrors).toBe(0);
          expect(summary!.reportedDataLoss).toBe(0);
          expect(summary!.childTailCertified).toBe(false);
          expect(wallMs).toBeLessThan(5000);
          expect(JSON.stringify(summary)).not.toMatch(
            /PRIVATE_|TraceGLAPI|track_id|arg_set_id|\/private\//,
          );
        }
        await rm(path);
      },
    );
  },
);
