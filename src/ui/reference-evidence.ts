import { REFERENCES, type ReferenceEntry } from './reference-catalogue.ts';

export type AcceptanceStatus = 'needs-work' | 'accepted' | 'duplicate' | 'not-applicable';
export interface RenderedReferenceEvidence {
  source: string;
  referenceHash: string;
  imageHash: string;
  imageFile: string;
  capturedAt: string;
  simulationTime: number;
  width: number;
  height: number;
  /** Exact camera/photo/weather configuration, encoded at the rendered frame. */
  view: string;
}
export interface ReferenceDecision {
  id: number;
  status: AcceptanceStatus;
  reviewer: string;
  notes: string;
  capture: RenderedReferenceEvidence | null;
}
// Fits all 100 maximum-length notes/configurations plus the source catalogue.
export const REFERENCE_AUDIT_LIMIT = 3_000_000;
const KEY = 'apex-reference-acceptance-v1';
const hash = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const text = (s: unknown, max: number): s is string =>
  typeof s === 'string' &&
  s.length <= max &&
  !Array.from(s).some((c) => c.charCodeAt(0) < 32 && c !== '\n' && c !== '\t');
function entry(id: number) {
  const e = REFERENCES.find((r) => r.id === id);
  if (!e) throw new Error('Unknown reference image');
  return e;
}
function initialStatus(e: ReferenceEntry): AcceptanceStatus {
  if (e.status === 'excluded' || e.status === 'supplementary') return 'not-applicable';
  return e.duplicateOf ? 'duplicate' : 'needs-work';
}
function validateCapture(id: number, value: RenderedReferenceEvidence) {
  if (
    !value ||
    !hash(value.source) ||
    !hash(value.referenceHash) ||
    !hash(value.imageHash) ||
    value.referenceHash !== entry(id).sha256 ||
    !text(value.imageFile, 180) ||
    !/^apex-[a-zA-Z0-9_.-]+\.png$/.test(value.imageFile) ||
    !text(value.view, 6000) ||
    !text(value.capturedAt, 40) ||
    !Number.isFinite(Date.parse(value.capturedAt)) ||
    !Number.isFinite(value.simulationTime) ||
    value.simulationTime < 0 ||
    ![value.width, value.height].every((n) => Number.isInteger(n) && n > 0 && n <= 16384)
  )
    throw new Error('Invalid rendered reference evidence');
  return { ...value };
}
function validateDecision(value: ReferenceDecision) {
  const e = entry(value?.id);
  if (
    !['needs-work', 'accepted', 'duplicate', 'not-applicable'].includes(value.status) ||
    !text(value.reviewer, 80) ||
    !text(value.notes, 2000)
  )
    throw new Error('Invalid reference decision');
  const fixed = initialStatus(e);
  if ((fixed === 'duplicate' || fixed === 'not-applicable') && value.status !== fixed)
    throw new Error('Duplicate/exclusion classification belongs to the source catalogue');
  if ((value.status === 'duplicate' || value.status === 'not-applicable') && value.status !== fixed)
    throw new Error('An applicable unique reference cannot be silently excluded');
  const capture = value.capture ? validateCapture(value.id, value.capture) : null;
  if (value.status === 'accepted' && (!capture || !value.reviewer.trim() || !value.notes.trim()))
    throw new Error('Acceptance requires a rendered capture, reviewer and written comparison');
  return {
    id: value.id,
    status: value.status,
    reviewer: value.reviewer,
    notes: value.notes,
    capture,
  };
}

/** Local reviewer declarations, not automatic quality scores. Images themselves
 * remain exported PNGs; only their hashes/configuration are stored here. */
export class ReferenceEvidenceStore {
  private rows = new Map<number, ReferenceDecision>();
  persistenceError: string | null = null;
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try {
      const raw = storage?.getItem(KEY);
      if (raw) this.replace(raw, false);
    } catch (error) {
      this.persistenceError = `Audit storage unavailable: ${String(error)}`;
    }
  }
  static browser() {
    try {
      return new ReferenceEvidenceStore(window.localStorage);
    } catch {
      const store = new ReferenceEvidenceStore();
      store.persistenceError = 'Audit is session-only: local storage unavailable';
      return store;
    }
  }
  get(id: number, source: string): ReferenceDecision & { stale: boolean } {
    if (!hash(source)) throw new Error('Invalid source fingerprint');
    const e = entry(id),
      row = this.rows.get(id) ?? {
        id,
        status: initialStatus(e),
        reviewer: '',
        notes: '',
        capture: null,
      };
    const stale = !!row.capture && row.capture.source !== source;
    return {
      ...row,
      capture: row.capture ? { ...row.capture } : null,
      stale,
      status: stale && row.status === 'accepted' ? 'needs-work' : row.status,
    };
  }
  capture(id: number, capture: RenderedReferenceEvidence) {
    const e = entry(id),
      previous = this.rows.get(id);
    this.rows.set(id, {
      id,
      status: initialStatus(e),
      reviewer: previous?.reviewer ?? '',
      notes: previous?.notes ?? '',
      capture: validateCapture(id, capture),
    });
    this.persist(); // A new capture never silently inherits an old approval.
  }
  decide(id: number, status: AcceptanceStatus, reviewer: string, notes: string, source: string) {
    const current = this.get(id, source);
    if (status === 'accepted' && current.stale)
      throw new Error('Capture belongs to an older source build');
    const next = validateDecision({
      id,
      status,
      reviewer: reviewer.trim(),
      notes: notes.trim(),
      capture: current.capture,
    });
    this.rows.set(id, next);
    this.persist();
  }
  replace(raw: string, persist = true) {
    if (raw.length > REFERENCE_AUDIT_LIMIT) throw new Error('Reference audit exceeds 3 MB');
    const value = JSON.parse(raw) as { version: number; decisions: ReferenceDecision[] };
    if (value.version !== 1 || !Array.isArray(value.decisions) || value.decisions.length > 100)
      throw new Error('Invalid reference audit schema');
    const next = new Map<number, ReferenceDecision>();
    for (const decision of value.decisions) {
      const row = validateDecision(decision);
      if (next.has(row.id)) throw new Error('Duplicate reference decision');
      next.set(row.id, row);
    }
    this.rows = next;
    if (persist) this.persist();
  }
  export(source: string) {
    return {
      version: 1,
      source,
      reviewerDeclarationsNotCertification: true,
      decisions: REFERENCES.map((e) => this.get(e.id, source)),
      catalogue: REFERENCES.map((e) => ({
        id: e.id,
        referenceHash: e.sha256,
        title: e.title,
        duplicateOf: e.duplicateOf,
        implementationStatus: e.status,
        principle: e.observation,
        implementation: e.implementation,
        reproduction: e.view,
        code: [...e.code],
        remainingGap: e.gap,
      })),
    };
  }
  private persist() {
    if (!this.storage) return;
    try {
      this.storage.setItem(KEY, JSON.stringify({ version: 1, decisions: [...this.rows.values()] }));
      this.persistenceError = null;
    } catch (error) {
      this.persistenceError = `Audit remains session-only: ${String(error)}`;
    }
  }
}

/** Hash the actual PNG bytes, not a screenshot name or a catalogue placeholder. */
export async function referenceCapture(
  blob: Blob,
  id: number,
  metadata: Omit<RenderedReferenceEvidence, 'imageHash' | 'referenceHash'>,
): Promise<RenderedReferenceEvidence> {
  if (blob.type !== 'image/png' || blob.size < 64 || blob.size > 32 * 1024 * 1024)
    throw new Error('Reference capture must be a PNG below 32 MiB');
  const bytes = await blob.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, 8),
    header = new DataView(bytes);
  if (
    signature.some((byte, i) => byte !== [137, 80, 78, 71, 13, 10, 26, 10][i]) ||
    header.getUint32(12) !== 0x49484452 ||
    header.getUint32(16) !== metadata.width ||
    header.getUint32(20) !== metadata.height
  )
    throw new Error('PNG pixels do not match the declared capture dimensions');
  const imageHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return validateCapture(id, { ...metadata, imageHash, referenceHash: entry(id).sha256 });
}
