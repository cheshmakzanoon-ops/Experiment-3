import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  acceptanceState,
  receiptProblem,
  type AcceptanceRequirement,
  type AcceptanceReceipt,
  type EvidenceKind,
} from '../src/ui/acceptance-gates.ts';
import {
  buildMatrix,
  directiveSections,
  sourceFingerprint,
  verifyReceiptArtifacts,
  matrixMarkdown,
} from '../scripts/phase27h-matrix.ts';
import { SECTION_OWNERS } from '../scripts/phase27h-scope.ts';
const fingerprint = 'a'.repeat(64),
  digest = 'b'.repeat(64);
const row: AcceptanceRequirement = {
  id: 'D123',
  digest,
  clauses: ['wing', 'nose'],
  required: ['test', 'render', 'human'],
  implemented: true,
  applicable: true,
};
// Deliberately synthetic parser fixtures. These are never emitted as real receipts.
function receipt(kind: EvidenceKind, extra: Partial<AcceptanceReceipt> = {}): AcceptanceReceipt {
  return {
    requirement: row.id,
    requirementDigest: digest,
    sourceFingerprint: fingerprint,
    kind,
    result: 'PASS',
    clauses: [...row.clauses],
    artifact: { path: 'test-results/synthetic.txt', sha256: 'c'.repeat(64) },
    recordedAt: '2026-09-22T12:00:00Z',
    operator: 'SYNTHETIC TEST FIXTURE',
    operatorKind: kind === 'human' ? 'human' : 'automation',
    notes: 'Synthetic validation fixture; not real acceptance evidence',
    render: { scope: 'application', fullImage: true },
    ...extra,
  };
}
describe('exact acceptance evidence', () => {
  it('does not infer acceptance from file ownership or a neighbouring feature', () => {
    expect(acceptanceState(row, fingerprint, []).status).toBe('PARTIAL');
    expect(
      acceptanceState(row, fingerprint, [receipt('test', { requirement: 'D124' })])
        .acceptedReceipts,
    ).toBe(0);
    const partial = [receipt('test'), receipt('render'), receipt('human', { clauses: ['wing'] })];
    expect(acceptanceState(row, fingerprint, partial).missing).toEqual(['human:nose']);
    expect(
      acceptanceState(row, fingerprint, [...partial, receipt('human', { clauses: ['nose'] })])
        .status,
    ).toBe('PASS');
  });
  it('rejects stale source, changed requirements, unknown clauses, cropped output and automated human approval', () => {
    for (const patch of [
      { sourceFingerprint: 'd'.repeat(64) },
      { requirementDigest: 'e'.repeat(64) },
      { clauses: ['neighbour'] },
      { clauses: ['wing', 'wing'] },
      { operatorKind: 'automation' as const },
      { render: { scope: 'component' as const, fullImage: true }, kind: 'render' as const },
      { render: { scope: 'application' as const, fullImage: false }, kind: 'render' as const },
    ]) {
      expect(receiptProblem(row, fingerprint, receipt('human', patch))).not.toBeNull();
    }
    expect(
      receiptProblem(
        row,
        fingerprint,
        receipt('test', { artifact: { path: '../other.txt', sha256: 'c'.repeat(64) } }),
      ),
    ).not.toBeNull();
  });
  it('requires the exact original even for repeated compositions', () => {
    const image = { ...row, originalImage: 'f'.repeat(64) };
    expect(receiptProblem(image, fingerprint, receipt('human'))).toContain('Original reference');
    expect(
      receiptProblem(
        image,
        fingerprint,
        receipt('human', {
          render: { scope: 'application', fullImage: true, originalImage: image.originalImage },
        }),
      ),
    ).toBeNull();
  });
  it('will not convert hosted Linux or an automated journey into physical Windows and continuous human acceptance', () => {
    const h = receipt('hardware', {
      operatorKind: 'human',
      hardware: {
        os: 'Windows',
        virtualMachine: false,
        physicalDevices: ['SYNTHETIC WHEEL'],
        cpu: 'SYNTHETIC CPU',
        gpu: 'SYNTHETIC GPU',
        vramBytes: 1024,
      },
    });
    expect(receiptProblem(row, fingerprint, h)).toBeNull();
    expect(
      receiptProblem(row, fingerprint, { ...h, hardware: { ...h.hardware, virtualMachine: true } }),
    ).not.toBeNull();
    expect(receiptProblem(row, fingerprint, { ...h, operatorKind: 'automation' })).not.toBeNull();
    const journey = { ...row, id: 'D146', continuousHumanRace: true };
    const r = receipt('human', {
      requirement: 'D146',
      race: {
        humanDriven: true,
        uninterrupted: true,
        startsAtApplicationLaunch: true,
        endsAfterTelemetry: true,
      },
    });
    expect(receiptProblem(journey, fingerprint, r)).toBeNull();
    for (const key of [
      'humanDriven',
      'uninterrupted',
      'startsAtApplicationLaunch',
      'endsAfterTelemetry',
    ])
      expect(
        receiptProblem(journey, fingerprint, { ...r, race: { ...r.race, [key]: false } }),
      ).not.toBeNull();
  });
  it('keeps an explicit failure or exclusion out of PASS totals', () => {
    expect(
      acceptanceState(row, fingerprint, [
        ...row.required.map((k) => receipt(k)),
        receipt('test', { result: 'FAIL' }),
      ]).status,
    ).toBe('FAIL');
    expect(acceptanceState({ ...row, implemented: false }, fingerprint, []).status).toBe('FAIL');
    expect(
      acceptanceState(
        { ...row, applicable: false },
        fingerprint,
        row.required.map((k) => receipt(k)),
      ).status,
    ).toBe('FAIL');
  });
  it('binds artifacts to actual file bytes inside the selected workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'apex-evidence-'));
    try {
      writeFileSync(join(root, 'actual.txt'), 'ACTUAL FILE');
      const artifact = {
        path: 'actual.txt',
        sha256: createHash('sha256').update('ACTUAL FILE').digest('hex'),
      };
      expect(() => verifyReceiptArtifacts(root, [receipt('test', { artifact })])).not.toThrow();
      writeFileSync(join(root, 'actual.txt'), 'changed');
      expect(() => verifyReceiptArtifacts(root, [receipt('test', { artifact })])).toThrow(
        'changed',
      );
      symlinkSync(join(process.cwd(), 'package.json'), join(root, 'outside.txt'));
      expect(() =>
        verifyReceiptArtifacts(root, [
          receipt('test', { artifact: { ...artifact, path: 'outside.txt' } }),
        ]),
      ).toThrow('inside');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('enumerates the verbatim 148 sections and every original clause, without changing the directive', () => {
    const text = readFileSync('docs/MASTER_DIRECTIVE.md', 'utf8'),
      sections = directiveSections(text);
    expect(sections.map((s) => s.id)).toEqual(Array.from({ length: 148 }, (_, i) => i + 1));
    expect(SECTION_OWNERS.size).toBe(148);
    expect(sections.every((s) => s.clauses.length > 0)).toBe(true);
    for (const s of sections) for (const clause of s.clauses) expect(s.text).toContain(clause.text);
    expect(() => directiveSections(text + ' ')).toThrow('authoritative directive changed');
  });
  it('binds all 248 rows to actual paths and keeps 82 game, two hardware and 16 unrelated images distinct', () => {
    const report = buildMatrix(process.cwd());
    expect(report.rows).toHaveLength(248);
    expect(new Set(report.rows.map((r) => r.id)).size).toBe(248);
    expect(report.rows.filter((r) => !r.applicable)).toHaveLength(16);
    expect(report.rows.filter((r) => r.classification === 'game reference')).toHaveLength(82);
    expect(report.rows.filter((r) => r.classification === 'hardware supplement')).toHaveLength(2);
    expect(report.counts.required.PASS).toBe(0);
    expect(report.rows.filter((r) => r.applicable && r.status === 'FAIL').map((r) => r.id)).toEqual(
      ['R069', 'R084'],
    );
    const a = matrixMarkdown(report);
    expect(a).toContain('D148');
    expect(a).toContain('R100');
    expect(report.sourceFingerprint).toBe(sourceFingerprint(process.cwd()));
  });
});
