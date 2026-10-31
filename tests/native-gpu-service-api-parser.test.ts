import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarizeNativeGpuTrace } from '../scripts/native-gpu-trace-summary.mjs';
import { PRIVATE_TRACE_SENTINEL } from './fixtures/native-gpu-trace';
import {
  nativeGpuServiceApiTraceFixture,
  TRACE_SERVICE_API_EVENTS,
  TRACE_SERVICE_API_SUMMARY_EVENTS,
  type NativeGpuServiceApiFixture,
  type ServiceApiEventId,
} from './fixtures/native-gpu-service-api-trace';

// Required by the separate diagnostic invocation; optional in ordinary suites.
// No native app, browser, network access or runtime parser download is used.
const parserPath = process.env.MOTOBOUND_TRACE_PROCESSOR;
const required = process.env.MOTOBOUND_TRACE_PARSER_REQUIRED === '1';
const execute = promisify(execFile);
const parserSha256 = '58042408e6cc861fb1a731c26bb082dc222285561eaa4e12a48a8b2b90dca7b9';
const serviceApiMode = 'service-api-boundary-v1' as const;
const positive = 'same-track-open-service-api-under-unfinished-decoder-and-flush-observed';

describe.skipIf(!parserPath && !required)(
  'official pinned offline service-API boundary parser',
  () => {
    let directory: string;
    let sequence = 0;

    beforeAll(async () => {
      expect(parserPath, 'Diagnostic fixture step requires the pinned parser').toBeTruthy();
      expect((await stat(parserPath!)).size).toBe(14_897_560);
      expect(
        createHash('sha256')
          .update(await readFile(parserPath!))
          .digest('hex'),
      ).toBe(parserSha256);
      directory = await mkdtemp(join(tmpdir(), 'motobound-service-api-fixtures-'));
    });

    afterAll(async () => {
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    async function fixture(
      kind: NativeGpuServiceApiFixture,
      apiId?: ServiceApiEventId,
      category?: string,
    ) {
      const path = join(directory, `${kind}-${++sequence}.pftrace`);
      await writeFile(path, nativeGpuServiceApiTraceFixture(kind, apiId, category), {
        mode: 0o600,
      });
      return path;
    }

    async function summarize(
      kind: NativeGpuServiceApiFixture,
      apiId?: ServiceApiEventId,
      category?: string,
    ) {
      const summary = await summarizeNativeGpuTrace({
        path: await fixture(kind, apiId, category),
        parserPath,
        serviceApiMode,
      });
      // A discriminator is an observation, never certification of the child tail.
      expect(summary.childTailCertified).toBe(false);
      expect(summary.version).toBe(3);
      return summary;
    }

    async function query(kind: NativeGpuServiceApiFixture, sql: string) {
      // Only fixed numeric SQL projections escape the parser here. Private
      // strings/stderr are not copied into assertions, diagnostics or artifacts.
      const { stdout } = await execute(parserPath!, ['-Q', sql, await fixture(kind)], {
        timeout: 5000,
        maxBuffer: 16 * 1024,
        encoding: 'utf8',
      });
      return stdout.trim().split('\n');
    }

    it('decodes a real three-layer same-track chain before interpreting the summary', async () => {
      expect(
        await query(
          'isolated-open',
          `SELECT COUNT(*) AS service_count,
         (SELECT COUNT(*) FROM ancestor_slice(s.id) d
          WHERE d.name='CommandBufferService:PutChanged' AND d.category='gpu'
           AND d.dur=-1 AND d.track_id=s.track_id
           AND EXISTS (SELECT 1 FROM ancestor_slice(d.id) f
            WHERE f.name='CommandBufferStub::OnAsyncFlush' AND f.category='gpu'
             AND f.dur=-1 AND f.track_id=d.track_id)) AS decoder_flush_chains,
         COUNT(DISTINCT p.upid) AS process_count
         FROM slice s JOIN thread_track tt ON tt.id=s.track_id
         JOIN thread t ON t.utid=tt.utid JOIN process p ON p.upid=t.upid
         WHERE s.name='TraceGLAPI::glDrawArrays' AND s.category='gpu' AND s.dur=-1
          AND EXTRACT_ARG(p.arg_set_id,'chrome.process_type')='Gpu';`,
        ),
      ).toEqual(['"service_count","decoder_flush_chains","process_count"', '1,1,1']);
    });

    it('preserves the exact original nine rows then all ten service rows with numeric duration receipts', async () => {
      const summary = await summarize('all-rows-completed');
      expect(summary).toMatchObject({
        version: 3,
        privacy: 'constant-label-numeric-summary-only',
        parserVersion: '58.2',
        serviceApiMode,
        serviceApiCoverage: 'typed-gpu-service-api-observed',
        serviceApiBoundaryDiscriminator: 'inconclusive',
        compileLinkDiscriminator: 'inconclusive',
        captureBytes: nativeGpuServiceApiTraceFixture('all-rows-completed').length,
        parseCompleted: true,
        parserExitStatus: 0,
        parserErrors: 0,
        parserErrorStatRows: 165,
        reportedDataLoss: 0,
        dataLossStatRows: 22,
        otherGpuEvents: 0,
        coverage: 'typed-gpu-work-observed',
        aggregate: {
          id: 0,
          processCount: 1,
          count: 19,
          completed: 19,
          unfinished: 0,
          firstNs: 0,
          lastNs: 37_000_000,
          totalDurationNs: 19_000_000,
          maxDurationNs: 1_000_000,
          unfinishedFlushAncestorCount: 0,
          unfinishedUnderUnfinishedFlushCount: 0,
          unfinishedDecoderFlushAncestorCount: 0,
          unfinishedUnderUnfinishedDecoderFlushCount: 0,
        },
      });
      expect(summary.events).toHaveLength(19);
      expect(summary.events.map(({ id, name, category }) => ({ id, name, category }))).toEqual(
        TRACE_SERVICE_API_SUMMARY_EVENTS,
      );
      for (const event of summary.events) {
        expect(event).toEqual({
          ...TRACE_SERVICE_API_SUMMARY_EVENTS[event.id - 1],
          processCount: 1,
          count: 1,
          completed: 1,
          unfinished: 0,
          firstNs: (event.id - 1) * 2_000_000,
          lastNs: (event.id - 1) * 2_000_000 + 1_000_000,
          totalDurationNs: 1_000_000,
          maxDurationNs: 1_000_000,
          unfinishedFlushAncestorCount: 0,
          unfinishedUnderUnfinishedFlushCount: 0,
          unfinishedDecoderFlushAncestorCount: 0,
          unfinishedUnderUnfinishedDecoderFlushCount: 0,
        });
      }
    });

    it.each(TRACE_SERVICE_API_EVENTS)(
      'recognizes isolated OPEN $name under an open decoder inside an open flush',
      async ({ id }) => {
        const summary = await summarize('isolated-open', id);
        expect(summary.serviceApiCoverage).toBe('typed-gpu-service-api-observed');
        expect(summary.serviceApiBoundaryDiscriminator).toBe(positive);
        // Service wrappers must not contaminate the original five-row discriminator.
        expect(summary.compileLinkDiscriminator).toBe('inconclusive');
        expect(summary.aggregate).toMatchObject({
          count: 3,
          completed: 0,
          unfinished: 3,
          totalDurationNs: 0,
          maxDurationNs: 0,
          unfinishedFlushAncestorCount: 2,
          unfinishedUnderUnfinishedFlushCount: 2,
          unfinishedDecoderFlushAncestorCount: 1,
          unfinishedUnderUnfinishedDecoderFlushCount: 1,
        });
        for (const event of summary.events.slice(9)) {
          const count = event.id === id ? 1 : 0;
          expect(event).toMatchObject({
            count,
            completed: 0,
            unfinished: count,
            totalDurationNs: 0,
            maxDurationNs: 0,
            unfinishedFlushAncestorCount: count,
            unfinishedUnderUnfinishedFlushCount: count,
            unfinishedDecoderFlushAncestorCount: count,
            unfinishedUnderUnfinishedDecoderFlushCount: count,
          });
        }
      },
    );

    it.each(TRACE_SERVICE_API_EVENTS)(
      'does not call completed $name under open parents an OPEN boundary',
      async ({ id }) => {
        const summary = await summarize('completed-child', id);
        expect(summary.serviceApiBoundaryDiscriminator).toBe('inconclusive');
        expect(summary.events[id - 1]).toMatchObject({
          count: 1,
          completed: 1,
          unfinished: 0,
          totalDurationNs: 1_000_000,
          maxDurationNs: 1_000_000,
          unfinishedFlushAncestorCount: 1,
          unfinishedUnderUnfinishedFlushCount: 0,
          unfinishedDecoderFlushAncestorCount: 1,
          unfinishedUnderUnfinishedDecoderFlushCount: 0,
        });
        expect(summary.aggregate).toMatchObject({
          count: 3,
          unfinished: 2,
          unfinishedDecoderFlushAncestorCount: 1,
          unfinishedUnderUnfinishedDecoderFlushCount: 0,
        });
      },
    );

    it.each(TRACE_SERVICE_API_EVENTS)(
      'does not join completed nested $name to an unrelated same-name OPEN slice',
      async ({ id }) => {
        const summary = await summarize('mixed-child-tracks', id);
        expect(summary.events[id - 1]).toMatchObject({
          processCount: 1,
          count: 2,
          completed: 1,
          unfinished: 1,
          unfinishedFlushAncestorCount: 1,
          unfinishedUnderUnfinishedFlushCount: 0,
          unfinishedDecoderFlushAncestorCount: 1,
          unfinishedUnderUnfinishedDecoderFlushCount: 0,
        });
        expect(summary.aggregate).toMatchObject({
          count: 4,
          completed: 1,
          unfinished: 3,
          unfinishedFlushAncestorCount: 2,
          unfinishedUnderUnfinishedFlushCount: 1,
          unfinishedDecoderFlushAncestorCount: 1,
          unfinishedUnderUnfinishedDecoderFlushCount: 0,
        });
        expect(summary.serviceApiBoundaryDiscriminator).toBe('inconclusive');
      },
    );

    it('keeps every nested OPEN service wrapper duration unknown and counts each once', async () => {
      const summary = await summarize('all-open');
      expect(summary.serviceApiBoundaryDiscriminator).toBe(positive);
      expect(summary.compileLinkDiscriminator).toBe('inconclusive');
      expect(summary.aggregate).toMatchObject({
        count: 12,
        completed: 0,
        unfinished: 12,
        totalDurationNs: 0,
        maxDurationNs: 0,
        unfinishedFlushAncestorCount: 11,
        unfinishedUnderUnfinishedFlushCount: 11,
        unfinishedDecoderFlushAncestorCount: 10,
        unfinishedUnderUnfinishedDecoderFlushCount: 10,
      });
      for (const event of summary.events.slice(9)) {
        expect(event).toMatchObject({
          count: 1,
          unfinished: 1,
          totalDurationNs: 0,
          maxDurationNs: 0,
          unfinishedDecoderFlushAncestorCount: 1,
          unfinishedUnderUnfinishedDecoderFlushCount: 1,
        });
      }
    });

    it.each(['all-completed', 'all-service-completed'] as const)(
      'does not turn %s scopes into unfinished ancestry',
      async (kind) => {
        const summary = await summarize(kind);
        expect(summary.serviceApiCoverage).toBe('typed-gpu-service-api-observed');
        expect(summary.serviceApiBoundaryDiscriminator).toBe('inconclusive');
        expect(summary.aggregate.unfinished).toBe(0);
        expect(
          summary.events.every((event) => event.unfinishedDecoderFlushAncestorCount === 0),
        ).toBe(true);
        expect(
          summary.events.every((event) => event.unfinishedUnderUnfinishedDecoderFlushCount === 0),
        ).toBe(true);
      },
    );

    it.each([
      'no-parents',
      'no-flush',
      'no-decoder',
      'reversed-ancestors',
      'cross-track-child',
      'cross-track-decoder',
      'crossed-ancestors',
    ] as const)('rejects the incomplete, reversed or crossed triple chain in %s', async (kind) => {
      const summary = await summarize(kind);
      expect(summary.events[9]).toMatchObject({
        count: 1,
        unfinished: 1,
        unfinishedDecoderFlushAncestorCount: 0,
        unfinishedUnderUnfinishedDecoderFlushCount: 0,
      });
      expect(summary.aggregate.unfinishedDecoderFlushAncestorCount).toBe(0);
      expect(summary.serviceApiCoverage).toBe('typed-gpu-service-api-observed');
      expect(summary.serviceApiBoundaryDiscriminator).toBe('inconclusive');
    });

    it('proves cross-track counterexamples share the same typed GPU process, not different identities', async () => {
      expect(
        await query(
          'crossed-ancestors',
          `SELECT COUNT(DISTINCT s.track_id) AS track_count, COUNT(DISTINCT p.upid) AS process_count
         FROM slice s JOIN thread_track tt ON tt.id=s.track_id
         JOIN thread t ON t.utid=tt.utid JOIN process p ON p.upid=t.upid
         WHERE EXTRACT_ARG(p.arg_set_id,'chrome.process_type')='Gpu';`,
        ),
      ).toEqual(['"track_count","process_count"', '3,1']);
    });

    it.each(['completed-decoder', 'completed-flush'] as const)(
      'does not use %s ancestry or an unrelated same-track OPEN instance',
      async (kind) => {
        const summary = await summarize(kind);
        expect(summary.events[9]).toMatchObject({
          count: 2,
          completed: 1,
          unfinished: 1,
          unfinishedFlushAncestorCount: kind === 'completed-decoder' ? 2 : 0,
          unfinishedUnderUnfinishedFlushCount: kind === 'completed-decoder' ? 1 : 0,
          unfinishedDecoderFlushAncestorCount: 0,
          unfinishedUnderUnfinishedDecoderFlushCount: 0,
        });
        expect(summary.events[3].unfinished).toBe(0);
        expect(summary.serviceApiBoundaryDiscriminator).toBe('inconclusive');
      },
    );

    it('counts each slice once despite multiple qualifying decoder/flush ancestor pairs', async () => {
      const summary = await summarize('duplicate-ancestors');
      expect(summary.events[0]).toMatchObject({ count: 2, unfinishedDecoderFlushAncestorCount: 0 });
      expect(summary.events[3]).toMatchObject({
        count: 2,
        unfinishedDecoderFlushAncestorCount: 1,
        unfinishedUnderUnfinishedDecoderFlushCount: 1,
      });
      expect(summary.events[9]).toMatchObject({
        count: 1,
        unfinishedDecoderFlushAncestorCount: 1,
        unfinishedUnderUnfinishedDecoderFlushCount: 1,
      });
      expect(summary.aggregate).toMatchObject({
        count: 5,
        unfinishedFlushAncestorCount: 4,
        unfinishedUnderUnfinishedFlushCount: 4,
        unfinishedDecoderFlushAncestorCount: 2,
        unfinishedUnderUnfinishedDecoderFlushCount: 2,
      });
      expect(summary.serviceApiBoundaryDiscriminator).toBe(positive);
    });

    it.each(['self-only-flush', 'self-only-decoder', 'self-flush-and-decoder'] as const)(
      'does not treat %s as its own parent or as a service wrapper',
      async (kind) => {
        const summary = await summarize(kind);
        expect(summary.aggregate.count).toBe(kind === 'self-flush-and-decoder' ? 2 : 1);
        expect(summary.aggregate.unfinishedDecoderFlushAncestorCount).toBe(0);
        expect(summary.aggregate.unfinishedUnderUnfinishedDecoderFlushCount).toBe(0);
        expect(summary.serviceApiCoverage).toBe('no-typed-gpu-service-api-observed');
        expect(summary.serviceApiBoundaryDiscriminator).toBe('inconclusive');
        expect(summary.compileLinkDiscriminator).toBe('inconclusive');
      },
    );

    it.each(['gpu.angle', 'gpu.service', 'notgpu', 'gpu-extra'])(
      'requires the exact gpu category token at every chain layer, not %s',
      async (category) => {
        for (const kind of [
          'wrong-flush-category',
          'wrong-decoder-category',
          'wrong-service-category',
        ] as const) {
          const summary = await summarize(kind, 10, category);
          const rejectedIndex =
            kind === 'wrong-flush-category' ? 0 : kind === 'wrong-decoder-category' ? 3 : 9;
          expect(summary.events[rejectedIndex].count, kind).toBe(0);
          expect(summary.aggregate.unfinishedDecoderFlushAncestorCount, kind).toBe(0);
          expect(summary.serviceApiBoundaryDiscriminator, kind).toBe('inconclusive');
          expect(summary.serviceApiCoverage, kind).toBe(
            kind === 'wrong-service-category'
              ? 'no-typed-gpu-service-api-observed'
              : 'typed-gpu-service-api-observed',
          );
        }
      },
    );

    it('accepts an actual gpu token among other categories without publishing the dynamic list', async () => {
      const summary = await summarize('category-token-list');
      expect(summary.serviceApiBoundaryDiscriminator).toBe(positive);
      expect(summary.events[9].category).toBe('gpu');
      expect(JSON.stringify(summary)).not.toContain('gpu.angle,gpu,gpu.service');
    });

    it.each(['renderer-spoof', 'untyped-spoof'] as const)(
      'does not accept %s despite Gpu/CrGpuMain names and nested allowlisted scopes',
      async (kind) => {
        const summary = await summarize(kind);
        expect(summary.coverage).toBe('no-typed-gpu-work-observed');
        expect(summary.serviceApiCoverage).toBe('no-typed-gpu-service-api-observed');
        expect(summary.aggregate).toMatchObject({
          count: 0,
          unfinishedDecoderFlushAncestorCount: 0,
          unfinishedUnderUnfinishedDecoderFlushCount: 0,
        });
        expect(summary.otherGpuEvents).toBe(0);
        expect(summary.serviceApiBoundaryDiscriminator).toBe('inconclusive');
      },
    );

    it('keeps the compile/link discriminator limited to its original five rows', async () => {
      const withoutService = await summarize('compile-only-open');
      expect(withoutService.compileLinkDiscriminator).toBe(
        'same-track-open-compile-or-link-under-unfinished-flush-observed',
      );
      expect(withoutService.aggregate.unfinishedUnderUnfinishedDecoderFlushCount).toBe(1);
      expect(withoutService.serviceApiCoverage).toBe('no-typed-gpu-service-api-observed');
      expect(withoutService.serviceApiBoundaryDiscriminator).toBe('inconclusive');
      const both = await summarize('compile-and-service-open');
      expect(both.compileLinkDiscriminator).toBe(withoutService.compileLinkDiscriminator);
      expect(both.serviceApiBoundaryDiscriminator).toBe(positive);
    });

    it('actually decodes the private fixture annotations while exporting only constant labels and numbers', async () => {
      expect(
        await query(
          'privacy-negative',
          `SELECT
         (SELECT COUNT(*) FROM slice WHERE instr(name,'${PRIVATE_TRACE_SENTINEL}')>0) AS private_names,
         (SELECT COUNT(DISTINCT s.id) FROM slice s JOIN args a ON a.arg_set_id=s.arg_set_id
          WHERE instr(a.string_value,'${PRIVATE_TRACE_SENTINEL}')>0) AS private_annotations;`,
        ),
      ).toEqual(['"private_names","private_annotations"', '1,13']);
      const summary = await summarize('privacy-negative');
      expect(summary.aggregate).toMatchObject({
        count: 12,
        completed: 10,
        unfinished: 2,
        unfinishedDecoderFlushAncestorCount: 10,
        unfinishedUnderUnfinishedDecoderFlushCount: 0,
      });
      expect(summary.otherGpuEvents).toBe(1);
      expect(summary.serviceApiBoundaryDiscriminator).toBe('inconclusive');
      expect(summary.events.map(({ id, name, category }) => ({ id, name, category }))).toEqual(
        TRACE_SERVICE_API_SUMMARY_EVENTS,
      );
      const receipt = JSON.stringify(summary);
      expect(receipt).not.toContain(PRIVATE_TRACE_SENTINEL);
      expect(receipt).not.toContain('/private/');
      expect(receipt).not.toContain(directory);
      expect(Buffer.byteLength(receipt)).toBeLessThanOrEqual(16 * 1024);
    });

    it.each([
      ['metadata-only', 0],
      ['unknown-only', 3],
      ['annotation-spoof', 19],
    ] as const)(
      'does not promote absent emission, unknown names or argument-only name spoofing in %s',
      async (kind, otherGpuEvents) => {
        const summary = await summarize(kind);
        expect(summary.aggregate.count).toBe(0);
        expect(summary.serviceApiCoverage).toBe('no-typed-gpu-service-api-observed');
        expect(summary.serviceApiBoundaryDiscriminator).toBe('inconclusive');
        expect(summary.otherGpuEvents).toBe(otherGpuEvents);
        expect(summary.events.every((event) => event.count === 0)).toBe(true);
        expect(JSON.stringify(summary)).not.toContain(PRIVATE_TRACE_SENTINEL);
      },
    );

    it('does not call an arbitrary unknown open child a service API even inside the correct parent chain', async () => {
      const summary = await summarize('unknown-nested');
      expect(summary.coverage).toBe('typed-gpu-work-observed');
      expect(summary.aggregate.count).toBe(2);
      expect(summary.otherGpuEvents).toBe(1);
      expect(summary.serviceApiCoverage).toBe('no-typed-gpu-service-api-observed');
      expect(summary.serviceApiBoundaryDiscriminator).toBe('inconclusive');
      expect(JSON.stringify(summary)).not.toContain(PRIVATE_TRACE_SENTINEL);
    });

    it.each(['truncated-packet', 'truncated-after-open'] as const)(
      'never certifies %s even if the real parser exits successfully',
      async (kind) => {
        const summary = await summarize(kind);
        expect(summary.parseCompleted).toBe(true);
        expect(summary.parserExitStatus).toBe(0);
        expect(summary.childTailCertified).toBe(false);
        expect(summary.aggregate.count).toBe(kind === 'truncated-packet' ? 0 : 3);
        expect(summary.serviceApiCoverage).toBe(
          kind === 'truncated-packet'
            ? 'no-typed-gpu-service-api-observed'
            : 'typed-gpu-service-api-observed',
        );
        expect(summary.serviceApiBoundaryDiscriminator).toBe(
          kind === 'truncated-packet' ? 'inconclusive' : positive,
        );
      },
    );

    it('defaults to the unchanged version 2 parser instead of opting in from trace contents', async () => {
      const path = await fixture('isolated-open');
      const omitted = await summarizeNativeGpuTrace({ path, parserPath });
      const off = await summarizeNativeGpuTrace({ path, parserPath, serviceApiMode: 'off' });
      expect(omitted).toEqual(off);
      expect(omitted.version).toBe(2);
      expect(omitted.events).toHaveLength(9);
      expect(omitted.aggregate.count).toBe(2);
      expect(omitted.otherGpuEvents).toBe(1);
      expect(omitted).not.toHaveProperty('serviceApiMode');
      expect(omitted).not.toHaveProperty('serviceApiCoverage');
      expect(omitted.aggregate).not.toHaveProperty('unfinishedDecoderFlushAncestorCount');
    });

    it('preserves the 64 MiB regular-file input boundary in the new mode', async () => {
      const large = join(directory, 'oversized-service.pftrace');
      await writeFile(large, Buffer.alloc(0));
      await truncate(large, 64 * 1024 * 1024 + 1);
      const link = join(directory, 'linked-service.pftrace');
      await symlink(await fixture('isolated-open'), link);
      for (const path of [large, link]) {
        await expect(
          summarizeNativeGpuTrace({ path, parserPath, serviceApiMode }),
        ).rejects.toMatchObject({
          name: 'NativeGpuTraceSummaryError',
          reason: 'trace-size',
        });
      }
    });

    it('keeps parser size/SHA verification mandatory for the new mode without executing a wrong binary', async () => {
      const path = await fixture('isolated-open');
      const incorrect = join(directory, `${PRIVATE_TRACE_SENTINEL}-service-not-a-parser`);
      await writeFile(incorrect, Buffer.alloc(0), { mode: 0o600 });
      for (const size of [1, 14_897_560]) {
        await truncate(incorrect, size);
        await expect(
          summarizeNativeGpuTrace({ path, parserPath: incorrect, serviceApiMode }),
        ).rejects.toMatchObject({
          name: 'NativeGpuTraceSummaryError',
          reason: 'parser-integrity',
          message: 'Native GPU trace summary: parser-integrity',
        });
      }
      expect(
        (await readdir(directory)).filter((name) => name.startsWith('.gpu-trace-private-')),
      ).toEqual([]);
    });
  },
);
