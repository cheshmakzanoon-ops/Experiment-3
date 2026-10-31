import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) =>
  readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
const platform = source('desktop-platform.yml');
const diagnostic = source('desktop-linux-driver-review.yml');
const job = (workflow: string, name: string) => {
  const header = `  ${name}:\n`;
  const start = workflow.indexOf(header);
  if (start < 0) throw new Error(`Missing workflow job: ${name}`);
  return workflow.slice(start + header.length).split(/\n {2}[a-z][a-z-]*:\n/)[0];
};

describe('opt-in nonpublishing native GPU trace workflow', () => {
  it('defaults every reusable call to tracing off, without changing launch commands', () => {
    expect(platform).toMatch(/gpu_trace:\n\s+required: false\n\s+type: boolean\n\s+default: false/);
    expect(platform).toContain("MOTOBOUND_GPU_TRACE: ${{ inputs.gpu_trace && '1' || '0' }}");
    expect(platform).toContain('timeout-minutes: 50');
    expect(platform).toContain('run: xvfb-run -a node scripts/desktop-smoke.mjs');
    expect(platform).toContain('run: node scripts/desktop-smoke.mjs');
    expect(platform).toContain("LIBGL_ALWAYS_SOFTWARE: '1'");
    expect(platform).toContain('MOTOBOUND_CI_GL: ${{ inputs.linux_graphics }}');
    expect(platform).not.toMatch(/--no-sandbox|disable-gpu|disable-web-security|disable.*watchdog/);
  });

  it('pauses the old trace job until private parsing prevents raw trace uploads', () => {
    expect(diagnostic).not.toContain('  gpu-trace-mesa:');
    expect(diagnostic).not.toContain('gpu_trace: true');
    expect(diagnostic).toContain('GPU trace diagnostic paused');
    expect(job(diagnostic, 'compare')).not.toContain('gpu_trace');
    expect(job(diagnostic, 'compatibility-mesa')).not.toContain('gpu_trace');
    expect(job(diagnostic, 'compare')).toContain('linux_graphics: swiftshader');
    expect(job(diagnostic, 'compatibility-mesa')).toContain('smoke_journey: compatibility-diagnostic');
    expect(diagnostic).not.toMatch(/contents: write|publish-development|continue-on-error/);
  });

  it('keeps required and other existing native callers untraced with original publication needs', () => {
    const required = source('desktop-build.yml');
    for (const name of [
      'desktop-build.yml',
      'desktop-intel-experimental.yml',
      'desktop-linux-current-mesa.yml',
    ])
      expect(source(name)).not.toContain('gpu_trace');
    expect(required).toContain('needs: build');
    expect(required).not.toContain('gpu-trace-mesa');
    expect(required).toContain('if test "$current" != "$GITHUB_SHA"; then');
    expect(required).toContain('fail-fast: false');
  });

  it('preserves default evidence names while distinguishing traced and compatibility artifacts', () => {
    expect(platform).toContain(
      "name: desktop-evidence-${{ inputs.target }}-${{ inputs.arch }}${{ inputs.smoke_journey != 'full' && '-compatibility-diagnostic' || '' }}${{ inputs.gpu_trace && '-gpu-trace' || '' }}",
    );
    expect(platform).toMatch(/Preserve native launch evidence\n\s+if: always\(\)/);
    expect(platform).toContain('path: desktop-evidence/');
  });

  it('validates retained trace evidence after launch only for the diagnostic, including launch failure', () => {
    const name = 'Validate retained GPU trace evidence (diagnostic only)';
    const validation = platform.split(`name: ${name}`)[1]?.split('      - name:')[0];
    expect(validation).toContain('if: always() && inputs.gpu_trace');
    expect(validation).toContain(
      'run: node scripts/native-gpu-trace.mjs --validate desktop-evidence/report.json',
    );
    expect(validation).not.toMatch(/continue-on-error|\|\| true/);
    const preceding = platform.slice(0, platform.indexOf(`name: ${name}`));
    expect(preceding).toMatch(/run: node scripts\/desktop-smoke\.mjs\n\s+- $/);
    expect(platform.indexOf(`name: ${name}`)).toBeLessThan(
      platform.indexOf('name: Preserve native launch evidence'),
    );
    expect(platform).not.toContain('continue-on-error');
  });

  it('never labels a trace diagnostic as checksummed development installers', () => {
    for (const step of [
      'Record package checksums and exact source',
      'Upload development installers',
    ])
      expect(platform).toContain(
        `name: ${step}\n        if: inputs.smoke_journey == 'full' && !inputs.gpu_trace`,
      );
    expect(platform).toContain('run: node scripts/desktop-checksums.mjs');
    expect(platform).toContain('name: motobound-package-${{ inputs.target }}-${{ inputs.arch }}');
    expect(platform).toContain('--publish never');
  });

  it('runs new trace contracts through the existing generated-asset lifecycle and triggers their diagnostic', () => {
    const contract = platform
      .split('name: Validate desktop isolation and engine contracts')[1]
      ?.split('      - name:')[0];
    expect(contract).toContain('run: npm test -- ');
    for (const test of [
      'native-gpu-trace',
      'native-gpu-trace-workflow',
      'native-smoke-control',
      'native-preparation-evidence',
    ])
      expect(contract).toContain(`tests/${test}.test.ts`);
    const selectors = contract.match(/tests\/\S+\.test\.ts/g)!;
    expect(new Set(selectors).size).toBe(selectors.length);
    expect(contract).toContain('tests/babylon-*.test.ts');
    expect(contract).not.toMatch(/--exclude|--passWithNoTests|--ignore-scripts/);
    expect(diagnostic).toContain("- 'scripts/native-gpu-trace.*'");
    expect(diagnostic).toContain("- 'tests/native-gpu-trace*.test.ts'");
  });
});
