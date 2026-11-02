import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { a09SubmittedClipShader } from '../e2e/fixtures/babylon-braking-triplet-shader.ts';

// Minimal verbatim processed-shape lines from GPU run41373827088, artifact13110831092.
// ZIP SHA256 a47c64a657a3bd7dd34a5938b733799cb290f7bf43395d56fe31b62ae8656643.
// Full submitted UBO vertex SHA256 5f59760992a7a5194406dbd4b11881d26897d007f08c931feb63c13549d9bb7d;
// standalone 38a37d434a16388b8f9f829e2e363a2e8a46441c677656f4a5b32fecd4760031.
// This CPU regression checks stage attribution; it does not claim new GPU success.
const assignment = 'gl_Position=a09OriginalProjection*(a09OriginalView*worldPos);';
const processed = `#version 300 es
#define ORIGINAL_A09_CLIP_ORDER
precision highp float;
uniform mat4 a09OriginalView;
uniform mat4 a09OriginalProjection;
void main(void) {
mat4 finalWorld=world;
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
#define CUSTOM_VERTEX_UPDATE_WORLDPOS
${assignment}
vec2 uv2Updated=vec2(0.,0.);
vMainUV1=uvUpdated;
#define CUSTOM_VERTEX_MAIN_END
}`;
const accepted = (source: string) => {
  const result = a09SubmittedClipShader(source);
  return result.marker && result.declarations && result.ordinarySite;
};

describe('A09 submitted-stage clip contract', () => {
  it('accepts the captured processed ordinary shape without raw branch delimiters', () => {
    expect(processed).not.toContain('#else');
    expect(processed).not.toContain('#endif');
    expect(accepted(processed)).toBe(true);
    expect(a09SubmittedClipShader(processed)).toMatchObject({
      groupedAssignments: 1,
      positionWrites: 1,
      legacyCombinedAssignments: 0,
    });
  });
  it('accepts token-preserving whitespace, not different arithmetic', () => {
    expect(
      accepted(
        processed.replace(
          assignment,
          'gl_Position = a09OriginalProjection * ( a09OriginalView * worldPos ) ;',
        ),
      ),
    ).toBe(true);
  });
  it.each([
    ['missing', processed.replace(assignment, '')],
    ['legacy', processed.replace(assignment, 'gl_Position=viewProjection*worldPos;')],
    ['duplicate grouped', processed.replace(assignment, assignment + assignment)],
    [
      'later legacy override',
      processed.replace(assignment, assignment + '\ngl_Position=viewProjection*worldPos;'),
    ],
    [
      'different grouping',
      processed.replace(
        assignment,
        'gl_Position=(a09OriginalProjection*a09OriginalView)*worldPos;',
      ),
    ],
    [
      'wrong order',
      processed.replace(
        assignment,
        'gl_Position=a09OriginalView*(a09OriginalProjection*worldPos);',
      ),
    ],
    ['missing semicolon', processed.replace(assignment, assignment.slice(0, -1))],
    ['component override', processed.replace(assignment, assignment + '\ngl_Position.z=0.;')],
    ['comment-only assignment', processed.replace(assignment, `/* ${assignment} */`)],
    ['missing marker', processed.replace('#define ORIGINAL_A09_CLIP_ORDER', '')],
    ['disabled marker', processed + '\n#undef ORIGINAL_A09_CLIP_ORDER'],
    ['multiview', processed + '\n#define MULTIVIEW'],
    ['missing ordinary uniform', processed.replace('uniform mat4 a09OriginalProjection;', '')],
    ['duplicate ordinary uniform', processed + '\nuniform mat4 a09OriginalView;'],
    ['wrong uniform type', processed.replace('mat4 a09OriginalView', 'mat3 a09OriginalView')],
  ])('rejects %s', (_name, source) => {
    expect(accepted(source)).toBe(false);
  });
});

it('selects this fixture-only contract and helper in GPU CI without changing native triggers', () => {
  const workflow = readFileSync('.github/workflows/babylon-integration.yml', 'utf8');
  const testPath = 'tests/a09-submitted-shader-contract.test.ts';
  for (const path of [testPath, 'e2e/fixtures/babylon-braking-triplet-shader.ts'])
    expect(workflow).toContain(`- '${path}'`);
  const selection = workflow
    .split('      - name: Engine component and existing asset geometry contracts\n')[1]
    .split('\n')[0]
    .trim()
    .replace('run: npx vitest run ', '')
    .split(' ');
  expect(selection).toEqual([
    'tests/babylon-*.test.ts',
    'tests/discipline-presets.test.ts',
    'tests/input.test.ts',
    'tests/formula-surfaces.test.ts',
    'tests/circuit-line-profile.test.ts',
    'tests/indexed-ribbon-normals.test.ts',
    'tests/circuit-ribbon-data.test.ts',
    'tests/road-detail.test.ts',
    'tests/tyre-marks.test.ts',
    'tests/start-gantry.test.ts',
    'tests/gp-grid-paint.test.ts',
    'tests/track-boards.test.ts',
    testPath,
  ]);
  expect(testPath).not.toMatch(/^tests\/babylon-/);
  const fixture = readFileSync('e2e/fixtures/babylon-braking-triplet.ts', 'utf8');
  expect(fixture).toContain('a09SubmittedClipShader(vertex)');
  const native = readFileSync('.github/workflows/babylon-desktop.yml', 'utf8');
  expect(native).not.toContain(testPath);
  expect(native).not.toContain('e2e/fixtures/babylon-braking-triplet-shader.ts');
});
