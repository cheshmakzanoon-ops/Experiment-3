import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The tracked paths of this checkout, or null where git is not available (a source archive). */
function trackedPaths(): string[] | null {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    return null;
  }
}
const paths = trackedPaths();

/** Why a Windows `git checkout` cannot create this path, or null when it can. The desktop package
 * matrix (desktop-packages.yml) checks out on windows-latest: run 41915488028 failed there with
 * `error: invalid path 'docs/session-artifacts/2026-10-15-scratchpad/offroad-suite-test:bikes.log'`
 * before a single build step ran. */
function windowsPathProblem(path: string): string | null {
  if (path.length > 259) return 'longer than 259 characters';
  for (const part of path.split('/')) {
    if (/[<>:"|?*\\]/.test(part) || [...part].some((ch) => ch.charCodeAt(0) < 32))
      return `"${part}" has a character Windows forbids`;
    if (/[. ]$/.test(part)) return `"${part}" ends with a dot or a space`;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(part))
      return `"${part}" is a reserved device name`;
  }
  return null;
}

describe('every tracked path can be checked out on a Windows runner', () => {
  it('flags the paths that broke the Windows package legs', () => {
    expect(windowsPathProblem('docs/offroad-suite-test:bikes.log')).toMatch(/forbids/);
    expect(windowsPathProblem('docs/notes.')).toMatch(/dot or a space/);
    expect(windowsPathProblem('src/aux.ts')).toMatch(/reserved/);
    expect(windowsPathProblem('docs/offroad-suite-test-bikes.log')).toBeNull();
  });

  it.skipIf(paths === null)('has no tracked path Windows rejects, or two that differ by case only', () => {
    const problems: string[] = [];
    const seen = new Map<string, string>();
    for (const path of paths!) {
      const problem = windowsPathProblem(path);
      if (problem) problems.push(`${path}: ${problem}`);
      const other = seen.get(path.toLowerCase());
      if (other !== undefined && other !== path) problems.push(`${path}: differs from ${other} by case only`);
      seen.set(path.toLowerCase(), path);
    }
    expect(problems).toEqual([]);
  });
});
