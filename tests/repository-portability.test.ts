import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps tracked paths checkout-safe on Windows and case-insensitive macOS', () => {
  // Include unstaged additions and omit removed paths so this also checks local edits.
  const paths = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter((path) => path && existsSync(path));
  const canonical = new Map<string, string>();
  for (const path of new Set(paths)) {
    for (const part of path.split('/')) {
      expect(part, path).not.toMatch(/[<>:"\\|?*]|[. ]$/);
      expect(
        Array.from(part).every((character) => character.charCodeAt(0) >= 32),
        path,
      ).toBe(true);
      expect(part, path).not.toMatch(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i);
    }
    const key = path.normalize('NFC').toLowerCase();
    expect(canonical.get(key) ?? path, `case-insensitive collision: ${path}`).toBe(path);
    canonical.set(key, path);
  }
});
