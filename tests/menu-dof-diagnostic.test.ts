import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from 'vite';
import { expect, it } from 'vitest';

// Exercise the same compile-time replacement/minification boundary rather
// than assuming an unset runtime variable makes experiment code disappear.
it.each([
  [undefined, false, false],
  ['0', true, false],
  ['1', true, true],
] as const)(
  'build flag %s retains only its intended diagnostic branch',
  async (flag, marker, compile) => {
    const source = readFileSync(new URL('../src/rendering/renderer.ts', import.meta.url), 'utf8');
    const { code } = await transformWithEsbuild(source, 'renderer.ts', {
      loader: 'ts',
      format: 'esm',
      minify: true,
      define: {
        'import.meta.env.VITE_APEX_DIAGNOSTIC_MENU_DOF_PRIME':
          flag === undefined ? 'undefined' : JSON.stringify(flag),
      },
    });
    expect(code.includes('menu-dof-diagnostic:')).toBe(marker);
    expect(code.includes('Unexpected diagnostic menu lens')).toBe(compile);
    expect(code.includes('Diagnostic: compiling exact menu depth of field')).toBe(compile);
  },
);
