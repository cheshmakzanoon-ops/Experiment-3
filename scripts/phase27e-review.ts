import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readPresentationReport, reviewBudget } from '../src/rendering/presentation-review.ts';
import {
  ReferenceEvidenceStore,
  referenceCapture,
  REFERENCE_AUDIT_LIMIT,
} from '../src/ui/reference-evidence.ts';

/** Verify exported observations and PNG byte identity. These checks deliberately
 * cannot approve art, authenticate a reviewer/machine, or infer VRAM from counts.
 * --strict returns 1 for incomplete/unmeasured evidence, 2 for invalid input. */
try {
  const args = process.argv.slice(2),
    strict = args.includes('--strict');
  const positional = args.filter((value) => value !== '--strict');
  if (args.filter((value) => value === '--strict').length > 1)
    throw new Error('Duplicate --strict flag');
  const [kind, file, source, images] = positional;
  if (
    !['presentation', 'references'].includes(kind) ||
    !file ||
    !/^[a-f0-9]{64}$/.test(source ?? '') ||
    positional.length !== (kind === 'references' ? 4 : 3)
  )
    throw new Error(
      'Usage: node --experimental-transform-types scripts/phase27e-review.ts presentation report.json SOURCE_SHA256 [--strict]\n       node --experimental-transform-types scripts/phase27e-review.ts references audit.json SOURCE_SHA256 PNG_DIRECTORY [--strict]',
    );
  const limit = kind === 'presentation' ? 20_000_000 : REFERENCE_AUDIT_LIMIT;
  if (!statSync(file).isFile() || statSync(file).size > limit)
    throw new Error(`Evidence input exceeds ${limit} bytes or is not a file`);
  const raw = readFileSync(file, 'utf8');
  if (kind === 'presentation') {
    const report = readPresentationReport(JSON.parse(raw));
    if (report.context.source !== source)
      throw new Error('Rendered report belongs to another source');
    const budget = reviewBudget(report);
    console.log(
      JSON.stringify(
        {
          inputSHA256: createHash('sha256').update(raw).digest('hex'),
          source,
          state: report.state,
          reason: report.reason,
          context: report.context,
          frames: report.rows.length,
          progressM: report.progressM,
          summary: report.summary,
          budget,
          visualAcceptance: 'not-determined',
        },
        null,
        2,
      ),
    );
    process.exitCode = strict && (report.state !== 'complete' || budget.state !== 'pass') ? 1 : 0;
  } else {
    const input = JSON.parse(raw) as { source?: unknown; decisions?: unknown[] };
    if (
      input.source !== source ||
      !Array.isArray(input.decisions) ||
      input.decisions.length !== 100
    )
      throw new Error('Export must name the expected source and contain all 100 decisions');
    const store = new ReferenceEvidenceStore();
    store.replace(raw, false);
    const audit = store.export(source),
      checked = [];
    for (const row of audit.decisions) {
      let bytesVerified = false;
      if (row.capture) {
        const path = resolve(images, row.capture.imageFile);
        if (!statSync(path).isFile() || statSync(path).size > 32 * 1024 * 1024)
          throw new Error(`Invalid PNG for reference ${row.id}`);
        const image = readFileSync(path);
        const actual = await referenceCapture(
          new Blob([new Uint8Array(image)], { type: 'image/png' }),
          row.id,
          row.capture,
        );
        if (actual.imageHash !== row.capture.imageHash)
          throw new Error(`PNG hash mismatch for reference ${row.id}`);
        bytesVerified = true;
      }
      checked.push({ id: row.id, status: row.status, stale: row.stale, bytesVerified });
    }
    const needsWork = checked.filter((r) => r.status === 'needs-work' || r.stale).length;
    console.log(
      JSON.stringify(
        {
          source,
          checked,
          needsWork,
          applicableAccepted: checked.filter(
            (r) => r.status === 'accepted' && r.bytesVerified && !r.stale,
          ).length,
          reviewerDeclarationsNotCertification: true,
          originalReferencePixelsRequiredForHumanComparison: true,
        },
        null,
        2,
      ),
    );
    process.exitCode = strict && needsWork ? 1 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
