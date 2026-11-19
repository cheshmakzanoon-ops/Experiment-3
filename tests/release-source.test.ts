import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

it('permits only report/prose descendants, rejects changed inputs and non-ancestor source, and keeps the validated SHA', () => {
  const root = mkdtempSync(join(tmpdir(), 'motobound-source-'));
  const script = new URL('../scripts/release-source.mjs', import.meta.url).href;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Release test',
        '-c',
        'user.email=release@example.test',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = () => {
    git('add', '-A');
    git('commit', '--quiet', '-m', 'test input');
    return git('rev-parse', 'HEAD');
  };
  const inspect = (validated: string, current: string) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        'const {releaseSourceEligibility}=await import(process.argv[1]); console.log(JSON.stringify(releaseSourceEligibility(process.argv[2],process.argv[3],process.argv[4])));',
        script,
        validated,
        current,
        root,
      ],
      { encoding: 'utf8' },
    );
  const eligible = (validated: string, current: string) => {
    const result = inspect(validated, current);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as { eligible: boolean; changed: string[]; blocked: string[] };
  };
  try {
    git('init', '--quiet', '--initial-branch=main');
    write('src/main.ts', 'export const game = 1;');
    const validated = commit();
    expect(eligible(validated, validated).eligible).toBe(true);
    write('ci-reports/build.md', 'new run receipt');
    write('ci-reports/logs/build.log', 'new diagnostics');
    write('docs/CURRENT_STATUS.md', 'current evidence');
    write('README.md', 'status link');
    let previous = commit();
    expect(eligible(validated, previous)).toMatchObject({ eligible: true, blocked: [] });
    // Exercise the actual CLI and its remote-main lookup without a network.
    git('remote', 'add', 'origin', root);
    const current = spawnSync(process.execPath, [new URL(script).pathname, validated], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(current.status, current.stderr).toBe(0);
    expect(current.stdout.trim()).toBe('true');
    expect(git('rev-parse', 'HEAD')).toBe(previous);
    for (const path of [
      'src/main.ts',
      'public/models/car.glb',
      'public/README.md',
      'src/input.md',
      'tests/fixture.md',
      'scripts/check.mjs',
      '.github/workflows/ci.yml',
      'package-lock.json',
      'docs/reference.json',
      'docs/MASTER_DIRECTIVE.md',
      'docs/IMPLEMENTATION_MATRIX.md',
      'docs/production/CONTENT_PIPELINE.md',
      'docs/arbitrary.md',
    ]) {
      write(path, `changed input: ${path}`);
      const head = commit();
      expect(eligible(previous, head)).toMatchObject({ eligible: false, blocked: [path] });
      previous = head;
    }
    // Rename detection cannot hide removal of a runtime file as a prose-only edit.
    renameSync(join(root, 'src/main.ts'), join(root, 'docs/copied.md'));
    const renamed = commit();
    expect(eligible(previous, renamed).blocked).toContain('src/main.ts');
    const unrelated = git('commit-tree', git('rev-parse', 'HEAD^{tree}'), '-m', 'disconnected');
    expect(eligible(renamed, unrelated)).toMatchObject({
      eligible: false,
      blocked: ['non-descendant'],
    });
    expect(inspect(renamed, 'f'.repeat(40)).status).not.toBe(0);
    expect(inspect(renamed, '--help').status).not.toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
