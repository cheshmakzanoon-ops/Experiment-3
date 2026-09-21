import { describe, it, expect } from 'vitest';
import {
  ReferenceEvidenceStore,
  referenceCapture,
  type RenderedReferenceEvidence,
} from '../src/ui/reference-evidence.ts';
import { REFERENCES } from '../src/ui/reference-catalogue.ts';
const source = 'a'.repeat(64),
  later = 'b'.repeat(64);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6BNkAAAAASUVORK5CYII=',
  'base64',
);
const id = REFERENCES.find(
  (r) => !r.duplicateOf && r.status !== 'excluded' && r.status !== 'supplementary',
)!.id;
const meta = {
  source,
  imageFile: 'apex-reference-001.png',
  capturedAt: '2026-09-21T10:00:00.000Z',
  simulationTime: 5,
  width: 1,
  height: 1,
  view: '{"camera":"cockpit"}',
};
function evidence(): RenderedReferenceEvidence {
  return {
    ...meta,
    referenceHash: REFERENCES.find((r) => r.id === id)!.sha256,
    imageHash: 'c'.repeat(64),
  };
}
describe('reference evidence is reviewable, not automatic acceptance', () => {
  it('exports exactly 100 authoritative catalogue links and no automatic approvals', () => {
    const report = new ReferenceEvidenceStore().export(source);
    expect(report.decisions).toHaveLength(100);
    expect(report.catalogue).toHaveLength(100);
    expect(report.decisions.some((d) => d.status === 'accepted')).toBe(false);
    expect(new Set(report.decisions.map((d) => d.id)).size).toBe(100);
    expect(
      report.catalogue.every(
        (r) =>
          r.referenceHash.length === 64 &&
          (r.implementationStatus === 'excluded' || r.code.length > 0),
      ),
    ).toBe(true);
  });
  it('a new actual capture still needs a named reviewer and comparison', () => {
    const store = new ReferenceEvidenceStore();
    expect(() => store.decide(id, 'accepted', 'reviewer', 'comparison', source)).toThrow(/capture/);
    store.capture(id, evidence());
    expect(store.get(id, source).status).toBe('needs-work');
    expect(() => store.decide(id, 'accepted', '', 'comparison', source)).toThrow();
    expect(() => store.decide(id, 'accepted', 'reviewer', '', source)).toThrow();
    store.decide(id, 'accepted', 'reviewer', 'Compared original silhouette and lighting', source);
    expect(store.get(id, source).status).toBe('accepted');
  });
  it('different source builds and new screenshots never inherit old approval', () => {
    const store = new ReferenceEvidenceStore();
    store.capture(id, evidence());
    store.decide(id, 'accepted', 'reviewer', 'comparison', source);
    expect(store.get(id, later).status).toBe('needs-work');
    expect(store.get(id, later).stale).toBe(true);
    expect(() => store.decide(id, 'accepted', 'reviewer', 'comparison', later)).toThrow(/older/);
    store.capture(id, { ...evidence(), imageHash: 'd'.repeat(64) });
    expect(store.get(id, source).status).toBe('needs-work');
  });
  it('keeps duplicate and hardware/unrelated exclusions tied to the source catalogue', () => {
    const store = new ReferenceEvidenceStore();
    for (const r of REFERENCES) {
      if (r.status === 'excluded' || r.status === 'supplementary' || r.duplicateOf)
        expect(() => store.decide(r.id, 'accepted', 'reviewer', 'comparison', source)).toThrow();
    }
    expect(() => store.decide(id, 'not-applicable', 'reviewer', 'too difficult', source)).toThrow(
      /excluded/,
    );
    expect(() => store.decide(id, 'duplicate', 'reviewer', '', source)).toThrow();
  });
  it('validates hashes, file paths, dimensions and finite frame identity', () => {
    const store = new ReferenceEvidenceStore();
    for (const bad of [
      { ...evidence(), referenceHash: 'd'.repeat(64) },
      { ...evidence(), imageFile: '../../other.png' },
      { ...evidence(), simulationTime: NaN },
      { ...evidence(), width: 0 },
      { ...evidence(), capturedAt: 'not-a-date' },
    ])
      expect(() => store.capture(id, bad)).toThrow();
  });
  it('imports atomically and rejects oversized/duplicate/malformed audits', () => {
    const store = new ReferenceEvidenceStore();
    store.capture(id, evidence());
    const saved = store.get(id, source);
    expect(() => store.replace('x'.repeat(3_000_001))).toThrow(/3 MB/);
    expect(() => store.replace(JSON.stringify({ version: 1, decisions: [saved, saved] }))).toThrow(
      /Duplicate/,
    );
    expect(() =>
      store.replace(JSON.stringify({ version: 1, decisions: [{ ...saved, id: 999 }] })),
    ).toThrow();
    expect(store.get(id, source)).toEqual(saved);
    const clone = new ReferenceEvidenceStore();
    clone.replace(JSON.stringify(store.export(source)));
    expect(clone.get(id, source)).toEqual(saved);
  });
  it('storage errors retain session evidence and report persistence failure', () => {
    const store = new ReferenceEvidenceStore({
      getItem: () => null,
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    });
    store.capture(id, evidence());
    expect(store.get(id, source).capture).not.toBeNull();
    expect(store.persistenceError).toMatch(/session-only/);
  });
  it('returns copies so UI or imported objects cannot mutate stored approval', () => {
    const store = new ReferenceEvidenceStore(),
      capture = evidence();
    store.capture(id, capture);
    capture.imageHash = 'd'.repeat(64);
    const read = store.get(id, source);
    read.capture!.imageHash = 'e'.repeat(64);
    expect(store.get(id, source).capture!.imageHash).toBe('c'.repeat(64));
  });
  it('hashes actual PNG bytes and rejects declared dimensions that disagree with IHDR', async () => {
    const blob = new Blob([png], { type: 'image/png' });
    const actual = await referenceCapture(blob, id, meta);
    expect(actual.imageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(actual.referenceHash).toBe(evidence().referenceHash);
    expect((await referenceCapture(blob, id, meta)).imageHash).toBe(actual.imageHash);
    await expect(referenceCapture(blob, id, { ...meta, width: 2 })).rejects.toThrow(/dimensions/);
    await expect(
      referenceCapture(new Blob([new Uint8Array(100)], { type: 'image/png' }), id, meta),
    ).rejects.toThrow(/PNG/);
    await expect(
      referenceCapture(new Blob([png], { type: 'image/jpeg' }), id, meta),
    ).rejects.toThrow(/PNG/);
  });
});
