import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const PUBLICATION_PROSE = new Set([
  'README.md',
  'docs/CURRENT_STATUS.md',
  'docs/studio/ROADMAP.md',
  'docs/studio/EXECUTION_PLAN.md',
  'docs/studio/HYPERREALISM_HANDOVER.md',
  'docs/studio/hyperrealism-wip/README.md',
]);

/** These paths cannot change the artifact or any validation/deployment program.
 * Do not broaden this to all Markdown: src/public fixtures and machine-consumed
 * docs (MASTER_DIRECTIVE, IMPLEMENTATION_MATRIX, CONTENT_PIPELINE) are inputs. */
export function publicationOnlyPath(path) {
  return path.startsWith('ci-reports/') || PUBLICATION_PROSE.has(path);
}

/** A validated ancestor remains eligible when only reports/prose advanced main.
 * A different branch, missing commit, or changed runtime/asset/gate fails closed. */
export function releaseSourceEligibility(validated, current, cwd = process.cwd()) {
  if (!SHA.test(validated) || !SHA.test(current)) throw new Error('Invalid release source SHA');
  if (validated === current) return { eligible: true, changed: [], blocked: [] };
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', validated, current], {
    cwd,
    encoding: 'utf8',
  });
  if (ancestor.error) throw ancestor.error;
  if (ancestor.status === 1) return { eligible: false, changed: [], blocked: ['non-descendant'] };
  if (ancestor.status !== 0) throw new Error(`Cannot verify main ancestry: ${ancestor.stderr}`);
  const changed = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', validated, current, '--'],
    { cwd, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  const blocked = changed.filter((path) => !publicationOnlyPath(path));
  return { eligible: blocked.length === 0, changed, blocked };
}

export function currentReleaseEligibility(validated, cwd = process.cwd()) {
  if (!SHA.test(validated)) throw new Error('Invalid validated release source SHA');
  const remote = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const match = /^([0-9a-f]{40})\trefs\/heads\/main$/.exec(remote);
  if (!match) throw new Error('Cannot identify the current main branch');
  const current = match[1];
  if (current !== validated) {
    const known = spawnSync('git', ['cat-file', '-e', `${current}^{commit}`], { cwd });
    if (known.error) throw known.error;
    if (known.status !== 0) {
      // Fetch only the observed main commit; never check out, reset or push a ref.
      execFileSync('git', ['fetch', '--no-tags', 'origin', current], { cwd, stdio: 'pipe' });
    }
  }
  return { validated, current, ...releaseSourceEligibility(validated, current, cwd) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.argv.length !== 3)
      throw new Error('Usage: node scripts/release-source.mjs <validated-sha>');
    const result = currentReleaseEligibility(process.argv[2]);
    if (!result.eligible) console.error(`Release source superseded: ${result.blocked.join(', ')}`);
    else if (result.current !== result.validated)
      console.error(
        `Validated source retained across ${result.changed.length} report/prose changes.`,
      );
    console.log(String(result.eligible));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
