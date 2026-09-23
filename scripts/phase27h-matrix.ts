import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFERENCES } from '../src/ui/reference-catalogue.ts';
import {
  acceptanceState,
  type AcceptanceRequirement,
  type AcceptanceReceipt,
  type EvidenceKind,
} from '../src/ui/acceptance-gates.ts';
import { SECTION_OWNERS, REFERENCE_CHECKS } from './phase27h-scope.ts';

export const DIRECTIVE_SHA256 = 'f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c';
export const REFERENCE_ARCHIVE_SHA256 =
  '4a3934002ee98335764b37a01c6ceb2a781857c117757080b453010894a510be';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const p = join(directory, entry.name);
    return entry.isDirectory() ? files(p) : [p];
  });
}
/** Intentionally identical to Vite's current source identity, regression-tested
 * against the built define. Generated reports are not an input to themselves. */
export function sourceFingerprint(root: string) {
  const h = createHash('sha256');
  for (const path of [
    ...files(join(root, 'src')),
    join(root, 'package-lock.json'),
    join(root, 'index.html'),
    join(root, 'vite.config.ts'),
  ].sort()) {
    h.update(relative(root, path).replaceAll('\\', '/') + '\0');
    h.update(readFileSync(path));
    h.update('\0');
  }
  return h.digest('hex');
}
export function directiveSections(text: string) {
  if (sha(text) !== DIRECTIVE_SHA256)
    throw new Error('The authoritative directive changed; do not silently rewrite the contract');
  const lines = text.split('\n'),
    starts: { id: number; title: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^# (\d+)\. (.+)$/);
    if (match) starts.push({ id: Number(match[1]), title: match[2], line: i + 1 });
  }
  if (starts.length !== 148 || starts.some((section, index) => section.id !== index + 1))
    throw new Error('Expected all 148 directive sections');
  return starts.map((section, index) => {
    const end = starts[index + 1] ? starts[index + 1].line - 1 : lines.length;
    const text = lines.slice(section.line - 1, end).join('\n');
    // Nonblank source lines remain individually addressable, including required
    // subheadings and code examples. No reduced paraphrase replaces a clause.
    const clauses = lines
      .slice(section.line, end)
      .flatMap((line, i) =>
        line.trim() && line.trim() !== '---'
          ? [
              {
                id: `D${section.id.toString().padStart(3, '0')}:L${section.line + i + 1}`,
                text: line,
                digest: sha(line),
              },
            ]
          : [],
      );
    return { ...section, end, text, digest: sha(text), clauses };
  });
}
interface MatrixRow extends AcceptanceRequirement {
  title: string;
  category: 'directive' | 'reference';
  source: { path: string; sha256: string }[];
  tests: string[];
  renderChecks: string[];
  requirementLocation: string;
  inspection: string;
  limitation: string;
  duplicateOf?: number | null;
  classification?: string;
}
function pathEvidence(root: string, paths: readonly string[]) {
  return [...new Set(paths)].map((path) => {
    if (!existsSync(join(root, path))) throw new Error(`Broken source evidence: ${path}`);
    return { path, sha256: sha(readFileSync(join(root, path))) };
  });
}
function testPaths(root: string, paths: string[]) {
  for (const p of paths)
    if (!existsSync(join(root, p))) throw new Error(`Missing executable test: ${p}`);
  return [...new Set(paths)];
}
export function buildMatrix(root: string, receipts: readonly unknown[] = []) {
  const fingerprint = sourceFingerprint(root);
  const directive = readFileSync(join(root, 'docs/MASTER_DIRECTIVE.md'), 'utf8');
  const sections = directiveSections(directive);
  if (SECTION_OWNERS.size !== 148) throw new Error('Missing explicit section ownership');
  const rows: MatrixRow[] = sections.map((section) => {
    const own = SECTION_OWNERS.get(section.id)!;
    const required: EvidenceKind[] = ['test', 'human'];
    if (own.render.length) required.push('render');
    if ([76, 77, 79, 93, 118, 146, 147, 148].includes(section.id)) required.push('hardware');
    return {
      id: `D${section.id.toString().padStart(3, '0')}`,
      title: section.title,
      category: 'directive',
      digest: section.digest,
      clauses: section.clauses.map((c) => c.id),
      required,
      implemented: true,
      applicable: true,
      source: pathEvidence(root, own.source),
      tests: testPaths(root, own.tests),
      renderChecks: testPaths(root, own.render),
      requirementLocation: `docs/MASTER_DIRECTIVE.md#L${section.line}-L${section.end}`,
      inspection:
        section.id === 146
          ? 'Uninterrupted human launch → complete race → results → replay → telemetry; retain original video and per-event timestamps'
          : own.render.length
            ? 'Inspect the complete requirement in the running application, not only its component test'
            : 'Inspect every original clause and its real implementation/test assertions',
      limitation:
        'File ownership and passing individual tests do not certify all clauses. Clause-specific source-bound evidence remains required.',
      continuousHumanRace: section.id === 146,
    };
  });
  if (REFERENCES.length !== 100 || REFERENCES.some((r, i) => r.id !== i + 1))
    throw new Error('Expected all 100 reference entries');
  for (const ref of REFERENCES) {
    const excluded = ref.status === 'excluded',
      hardware = ref.status === 'supplementary';
    const checks = REFERENCE_CHECKS[ref.group];
    if (!checks && !excluded) throw new Error(`No review procedure for ${ref.group}`);
    const required: EvidenceKind[] = hardware
      ? ['test', 'human', 'hardware']
      : ['test', 'render', 'human'];
    const native = ref.code.filter((p) => existsSync(join(root, p)));
    if (native.length !== ref.code.length)
      throw new Error(`Reference ${ref.id} contains missing source paths`);
    // The directory is not a second F2 chassis; a local result is not a global
    // reverse-circuit leaderboard. Those exact whole-image targets remain FAIL.
    const missing = [69, 84].includes(ref.id);
    const id = `R${ref.id.toString().padStart(3, '0')}`;
    rows.push({
      id,
      title: ref.title,
      category: 'reference',
      digest: sha(`${ref.sha256}\0${ref.observation}`),
      clauses: [`${id}:whole-image`],
      required,
      implemented: !missing && !excluded,
      applicable: !excluded,
      originalImage: hardware || excluded ? undefined : ref.sha256,
      source: pathEvidence(root, native),
      tests: testPaths(
        root,
        hardware ? ['tests/calibration.test.ts'] : ['tests/reference-evidence.test.ts'],
      ),
      renderChecks: testPaths(root, checks ?? []),
      requirementLocation: `${ref.file} / SHA-256 ${ref.sha256}`,
      inspection: ref.view,
      limitation: excluded
        ? 'Unrelated archive content; intentionally not implemented and excluded from required totals'
        : missing
          ? ref.gap
          : 'Full-image visual/function acceptance is open. Historical catalogue gaps are leads, not proof of current absence; later source may supersede them.',
      duplicateOf: ref.duplicateOf,
      classification: excluded ? 'excluded' : hardware ? 'hardware supplement' : 'game reference',
    });
  }
  const evaluated = rows.map((row) => ({ ...row, ...acceptanceState(row, fingerprint, receipts) }));
  const totals = (applicable: boolean) =>
    Object.fromEntries(
      (['PASS', 'PARTIAL', 'FAIL'] as const).map((status) => [
        status,
        evaluated.filter((row) => row.applicable === applicable && row.status === status).length,
      ]),
    );
  return {
    schema: 1,
    sourceFingerprint: fingerprint,
    directiveSHA256: DIRECTIVE_SHA256,
    referenceArchiveSHA256: REFERENCE_ARCHIVE_SHA256,
    counts: { directive: 148, reference: 100, required: totals(true), excluded: totals(false) },
    rows: evaluated,
  };
}
export function verifyReceiptArtifacts(root: string, receipts: readonly unknown[]) {
  const base = realpathSync(root);
  for (const value of receipts) {
    const r = value as Partial<AcceptanceReceipt>;
    if (!r?.artifact?.path || !/^[0-9a-f]{64}$/.test(r.artifact.sha256))
      throw new Error('Receipt has no artifact hash');
    const file = realpathSync(resolve(base, r.artifact.path));
    if (!file.startsWith(base + sep))
      throw new Error('Evidence must be inside the selected workspace');
    if (sha(readFileSync(file)) !== r.artifact.sha256)
      throw new Error(`Evidence artifact changed: ${r.artifact.path}`);
  }
}
export function matrixMarkdown(report: ReturnType<typeof buildMatrix>) {
  const escape = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');
  const link = (p: string) => `[${p}](../${p})`;
  let out =
    `# Phase 27H — exact acceptance matrix\n\n` +
    `Source fingerprint: \`${report.sourceFingerprint}\`. Directive SHA-256: \`${report.directiveSHA256}\`.\n\n` +
    `**148 directive sections + 100 individually retained reference entries.** Status is acceptance, not implementation coverage. ` +
    `PASS requires every original clause's required evidence kinds on this exact source. PARTIAL means a native counterpart exists but acceptance is incomplete. ` +
    `FAIL means an absent exact target or an explicit failing receipt. Excluded rows are labelled FAIL/not implemented, are **not required**, and never inflate pass totals.\n\n` +
    `Required rows: ${JSON.stringify(report.counts.required)}. Excluded: ${JSON.stringify(report.counts.excluded)}. ` +
    `No human, physical Windows/wheel or all-image artistic approval is inferred from automation.\n\n` +
    `Regenerate: \`node --experimental-transform-types scripts/phase27h-matrix.ts --write\`. ` +
    `Verify committed output: replace \`--write\` with \`--check\`. Optional \`--receipts relative-file.json --json test-results/phase27h-matrix.json\` ` +
    `validates real artifact SHA-256 values before applying clause-specific receipts. A test-path link is an executable coverage target, not an executed result.\n\n` +
    `The full requirement text remains verbatim in MASTER_DIRECTIVE.md; every nonblank clause has its own Dxxx:Lnnn evidence key in the JSON report. ` +
    `A receipt for D123, R002, or a duplicate cannot approve its neighbour. The JSON report retains full source hashes, missing clause/kind keys and evidence rejection counts.\n\n`;
  for (const category of ['directive', 'reference'] as const) {
    out += `## ${category === 'directive' ? 'Original directive — all 148 sections' : 'Reference archive — all 100 entries'}\n\n`;
    out +=
      '| ID / target | Status | Exact requirement / required gates | Actual source | Executable checks | Render / human inspection |\n|---|---|---|---|---|---|\n';
    for (const row of report.rows.filter((r) => r.category === category)) {
      const target =
        row.category === 'directive'
          ? `[original lines](../${row.requirementLocation.replace(/-L\d+$/, '')})`
          : `\`${row.requirementLocation}\`${row.duplicateOf ? ` (variant of R${row.duplicateOf.toString().padStart(3, '0')}; independently open)` : ''}`;
      out +=
        `| **${row.id}** ${escape(row.title)} | **${row.status}**${row.applicable ? '' : ' / excluded, not required'} | ${target}; ${row.clauses.length} clauses; ${row.required.join(' + ')} | ` +
        `${row.source.map((s) => `${link(s.path)} \`${s.sha256.slice(0, 12)}\``).join('<br>') || 'None required'} | ` +
        `${row.tests.map(link).join('<br>')} | ${row.renderChecks.map(link).join('<br>')}${row.renderChecks.length ? '<br>' : ''}${escape(row.inspection)} |\n`;
    }
    out += '\n';
  }
  out +=
    '## Independent closure boundaries\n\n' +
    '27H.1–27H.6: rendered asset/driver/human/environment/weather/reference approval remains separate from geometry, DOM or source tests. ' +
    '27H.7: all three Section 141 audits need recorded findings and closure evidence. ' +
    '27H.8: Section 146 requires actual uninterrupted human driving from application launch through telemetry. ' +
    '27H.9: hosted Linux/software-renderer CI is not Windows hardware, wheel, VRAM or target-performance evidence. ' +
    'The extra car series and reverse/global/ghost route represented by R084/R069 are not silently replaced by a cockpit or a local timing table.\n';
  return out;
}
function main() {
  const args = process.argv.slice(2),
    root = process.cwd();
  const argument = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const receiptFile = argument('--receipts');
  const receipts: unknown[] = receiptFile
    ? JSON.parse(readFileSync(resolve(root, receiptFile), 'utf8'))
    : [];
  if (!Array.isArray(receipts)) throw new Error('Expected an array of evidence receipts');
  verifyReceiptArtifacts(root, receipts);
  const report = buildMatrix(root, receipts),
    markdown = matrixMarkdown(report),
    path = join(root, 'docs/PHASE_27H_MATRIX.md');
  if (args.includes('--write')) writeFileSync(path, markdown);
  if (args.includes('--check') && (!existsSync(path) || readFileSync(path, 'utf8') !== markdown))
    throw new Error('Acceptance matrix is stale; regenerate on the exact source');
  const json = argument('--json');
  if (json) {
    const p = resolve(root, json);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(
    JSON.stringify({ sourceFingerprint: report.sourceFingerprint, ...report.counts }, null, 2),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
