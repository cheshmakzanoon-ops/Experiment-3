import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('qualifies migration desktop artifacts only on babylon-js through unchanged supported native gates', () => {
  const source = readFileSync('.github/workflows/babylon-desktop.yml', 'utf8');
  expect(source).toContain('branches: [babylon-js]');
  expect(source).toContain("if: github.ref == 'refs/heads/babylon-js'");
  expect(source).toContain('permissions:\n  contents: read');
  expect(source).toContain('uses: ./.github/workflows/desktop-platform.yml');
  expect([...source.matchAll(/^ {2}([a-z][\w-]*):$/gm)].map((match) => match[1])).toEqual([
    'workflow_dispatch',
    'push',
    'build',
  ]);
  expect(
    [...source.matchAll(/- os: ([^\n]+)\n\s+target: ([^\n]+)\n\s+arch: ([^\n]+)/g)].map((match) =>
      match.slice(1),
    ),
  ).toEqual([
    ['ubuntu-22.04', 'linux', 'x64'],
    ['windows-2022', 'win', 'x64'],
    ['macos-15', 'mac', 'arm64'],
  ]);
  expect(source).not.toMatch(
    /contents: write|secrets:|\brun:|\bsteps:|gpu_trace:|gpu_service_api_trace:|smoke_journey:|linux_graphics:/,
  );
});
