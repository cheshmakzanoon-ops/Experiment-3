/** Acceptance is clause-specific and source-bound. A passing neighbour, an
 * inspection button, an automated drive or an image thumbnail cannot approve it. */
export type AcceptanceStatus = 'PASS' | 'PARTIAL' | 'FAIL';
export type EvidenceKind = 'test' | 'render' | 'human' | 'hardware';
export interface AcceptanceRequirement {
  id: string;
  digest: string;
  clauses: readonly string[];
  required: readonly EvidenceKind[];
  implemented: boolean;
  applicable: boolean;
  originalImage?: string;
  continuousHumanRace?: boolean;
}
export interface AcceptanceReceipt {
  requirement: string;
  requirementDigest: string;
  sourceFingerprint: string;
  kind: EvidenceKind;
  result: 'PASS' | 'FAIL';
  clauses: string[];
  artifact: { path: string; sha256: string };
  recordedAt: string;
  operator: string;
  operatorKind: 'human' | 'automation';
  notes: string;
  render?: { scope: 'application' | 'component'; originalImage?: string; fullImage: boolean };
  hardware?: {
    os: 'Windows';
    virtualMachine: boolean;
    physicalDevices: string[];
    cpu: string;
    gpu: string;
    vramBytes: number;
  };
  race?: {
    humanDriven: boolean;
    uninterrupted: boolean;
    startsAtApplicationLaunch: boolean;
    endsAfterTelemetry: boolean;
  };
}
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const kinds: readonly EvidenceKind[] = ['test', 'render', 'human', 'hardware'];
export function receiptProblem(
  row: AcceptanceRequirement,
  sourceFingerprint: string,
  value: unknown,
): string | null {
  if (!value || typeof value !== 'object') return 'Not an evidence receipt';
  const r = value as Partial<AcceptanceReceipt>;
  if (r.requirement !== row.id) return 'Different requirement';
  if (r.requirementDigest !== row.digest) return 'Requirement changed';
  if (!hash(r.sourceFingerprint) || r.sourceFingerprint !== sourceFingerprint)
    return 'Stale source';
  if (!r.kind || !kinds.includes(r.kind) || !['PASS', 'FAIL'].includes(r.result ?? ''))
    return 'Invalid result';
  if (
    !Array.isArray(r.clauses) ||
    !r.clauses.length ||
    new Set(r.clauses).size !== r.clauses.length ||
    r.clauses.some((clause) => !row.clauses.includes(clause))
  )
    return 'Unknown or duplicate clauses';
  if (
    !r.artifact ||
    !hash(r.artifact.sha256) ||
    !text(r.artifact.path) ||
    /(^\/|\\|(^|\/)\.\.($|\/)|^[a-z]+:)/i.test(r.artifact.path)
  )
    return 'Invalid evidence artifact';
  if (
    !text(r.operator) ||
    !text(r.notes) ||
    !['human', 'automation'].includes(r.operatorKind ?? '') ||
    !text(r.recordedAt) ||
    !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(r.recordedAt) ||
    !Number.isFinite(Date.parse(r.recordedAt))
  )
    return 'Missing evidence provenance';
  if (r.kind === 'render' && (r.render?.scope !== 'application' || r.render.fullImage !== true))
    return 'Component/cropped output is not whole-application evidence';
  if (
    row.originalImage &&
    (r.kind === 'render' || r.kind === 'human') &&
    (r.render?.originalImage !== row.originalImage || r.render.fullImage !== true)
  )
    return 'Original reference image was not independently compared';
  if (r.kind === 'human' && r.operatorKind !== 'human') return 'Automation is not human approval';
  if (r.kind === 'hardware') {
    const h = r.hardware;
    if (
      r.operatorKind !== 'human' ||
      h?.os !== 'Windows' ||
      h.virtualMachine !== false ||
      !Array.isArray(h.physicalDevices) ||
      !h.physicalDevices.length ||
      !h.physicalDevices.every(text) ||
      !text(h.cpu) ||
      !text(h.gpu) ||
      !Number.isSafeInteger(h.vramBytes) ||
      h.vramBytes <= 0
    )
      return 'Missing physical Windows/device/VRAM evidence';
  }
  if (
    row.continuousHumanRace &&
    r.kind === 'human' &&
    (r.race?.humanDriven !== true ||
      r.race.uninterrupted !== true ||
      r.race.startsAtApplicationLaunch !== true ||
      r.race.endsAfterTelemetry !== true)
  )
    return 'Section 146 requires an uninterrupted human run from startup through telemetry';
  return null;
}

export function acceptanceState(
  row: AcceptanceRequirement,
  sourceFingerprint: string,
  receipts: readonly unknown[],
): {
  status: AcceptanceStatus;
  missing: string[];
  acceptedReceipts: number;
  rejectedReceipts: number;
} {
  if (
    !hash(sourceFingerprint) ||
    !hash(row.digest) ||
    !row.clauses.length ||
    new Set(row.clauses).size !== row.clauses.length ||
    !row.required.length ||
    new Set(row.required).size !== row.required.length ||
    row.required.some((kind) => !kinds.includes(kind))
  )
    throw new Error('Invalid acceptance requirement');
  // Exclusions remain explicitly not implemented, but are excluded from required
  // totals. They cannot turn sixteen unrelated pictures into sixteen passes.
  if (!row.applicable)
    return {
      status: 'FAIL',
      missing: ['Excluded from gameplay scope; not an implementation pass'],
      acceptedReceipts: 0,
      rejectedReceipts: 0,
    };
  const relevant = receipts.filter(
    (r) => !!r && typeof r === 'object' && (r as AcceptanceReceipt).requirement === row.id,
  );
  const accepted = relevant.filter(
    (r) => receiptProblem(row, sourceFingerprint, r) === null,
  ) as AcceptanceReceipt[];
  const missing = row.required.flatMap((kind) =>
    row.clauses
      .filter(
        (clause) =>
          !accepted.some(
            (r) => r.kind === kind && r.result === 'PASS' && r.clauses.includes(clause),
          ),
      )
      .map((clause) => `${kind}:${clause}`),
  );
  const failed = accepted.some((r) => r.result === 'FAIL');
  return {
    status: !row.implemented || failed ? 'FAIL' : missing.length ? 'PARTIAL' : 'PASS',
    missing: !row.implemented ? ['No complete native implementation', ...missing] : missing,
    acceptedReceipts: accepted.length,
    rejectedReceipts: relevant.length - accepted.length,
  };
}
