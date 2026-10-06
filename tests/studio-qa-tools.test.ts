import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Contracts of the studio QA tools (scripts/studio): the capture matrix keeps stable shot
// indices, refuses to write into the repository, and look-targets.json only names shots the
// matrix produces, with valid crops and known measures. No browser or Python is started.
const root = new URL('..', import.meta.url).pathname;
const tool = join(root, 'scripts/studio/capture-matrix.mjs');
const run = (...args: string[]) =>
  spawnSync(process.execPath, [tool, ...args], { cwd: root, encoding: 'utf8' });

interface Check {
  id: string;
  shot?: string;
  measure: string;
  value?: string;
  crop?: number[];
  poly?: number[][];
  line?: number[][];
  a?: { crop: number[] };
  b?: { crop: number[] };
  target?: Record<string, unknown>;
  path?: string;
}
const targets = JSON.parse(
  readFileSync(join(root, 'scripts/studio/look-targets.json'), 'utf8'),
) as {
  kpis: { id: string; checks: Check[] }[];
  extras?: { id: string; checks: Check[] }[];
  views: Record<string, string>;
  compositions: Record<string, Record<string, unknown>>;
};

function plan(...args: string[]) {
  const result = run(join(tmpdir(), 'capture-matrix-plan'), '--plan', ...args);
  expect(result.status, result.stderr).toBe(0);
  return new Map(
    result.stdout
      .split('\n')
      .map((line) => /^(\d\d) (\S+)$/.exec(line))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2]] as const),
  );
}

describe('capture-matrix', () => {
  it('documents every production-plan flag', () => {
    const result = run('--help');
    expect(result.status).toBe(0);
    for (const flag of [
      '--lighting',
      '--weather',
      '--views',
      '--pit',
      '--grid',
      '--drive',
      '--quality',
    ])
      expect(result.stdout).toContain(flag);
  });

  it('keeps the original capture.mjs indices for the default day run', () => {
    expect([...plan().entries()]).toEqual([
      ['00', 'menu'],
      ['10', 'day-chase'],
      ['11', 'day-cockpit'],
      ['12', 'day-pod'],
      ['13', 'day-trackside'],
      ['20', 'day-drive-chase'],
      ['21', 'day-drive-cockpit'],
    ]);
  });

  it('gives every matrix shot a unique, scenario-stable index', () => {
    const shots = plan('--matrix');
    expect(shots.get('30')).toBe('sunset-chase');
    expect(shots.get('41')).toBe('night-cockpit');
    expect(shots.get('50')).toBe('rain-chase');
    expect(shots.get('52')).toBe('rain-pod');
    expect(shots.get('60')).toBe('grid-t10-chase');
    expect(shots.get('70')).toBe('pit-tv');
    expect(shots.get('71')).toBe('pit-cockpit');
    // A view keeps its slot when others are left out.
    expect([...plan('--views', 'pod', '--drive', '0').keys()]).toEqual(['00', '12']);
    // --drive 0 also drops the extra weather's drive shots.
    expect([...plan('--weather', 'clear,rain', '--drive', '0').keys()]).toEqual([
      '00',
      '10',
      '11',
      '12',
      '13',
      '50',
      '52',
    ]);
  });

  it('holds the default drive shots at one simulated instant (turn-1 approach)', () => {
    const result = run(join(tmpdir(), 'capture-matrix-plan'), '--plan');
    expect(result.stdout).toContain('(hold drive 16 s, lighting day)');
    expect(run(join(tmpdir(), 'x'), '--plan', '--drive-mode', 'live').status).toBe(1);
  });

  it('rejects bad options and output inside the repository before launching a browser', () => {
    expect(run(join(tmpdir(), 'x'), '--plan', '--lighting', 'dusk').status).toBe(1);
    expect(run(join(tmpdir(), 'x'), '--url', 'http://127.0.0.1:4173').status).toBe(1);
    const inside = run(join(root, 'scripts/studio/out'), '--url', 'http://127.0.0.1:4999');
    expect(inside.status).toBe(1);
    expect(inside.stderr).toContain('inside the repository');
  });
});

describe('look-targets.json', () => {
  const python = readFileSync(join(root, 'scripts/studio/look-metrics.py'), 'utf8');
  const measures = new Set(
    [...python.slice(python.indexOf('MEASURES = {')).matchAll(/^ {4}'(\w+)': m_\w+,$/gm)].map(
      (m) => m[1],
    ),
  );
  const checks = [...targets.kpis, ...(targets.extras ?? [])].flatMap((kpi) =>
    kpi.checks.map((check) => ({ kpi: kpi.id, check })),
  );
  const inFrame = (box: number[]) =>
    box.length === 4 && box.every((v) => v >= 0 && v <= 1) && box[0] < box[2] && box[1] < box[3];

  it('covers KPIs 1-13 with unique check ids', () => {
    expect(targets.kpis.map((kpi) => kpi.id)).toEqual(
      Array.from({ length: 13 }, (_, i) => String(i + 1)),
    );
    const ids = checks.map(({ check }) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { kpi, check } of checks) expect(check.id.startsWith(`${kpi}.`)).toBe(true);
  });

  it('only measures shots the matrix produces, inside the frame, with known measures', () => {
    const produced = new Set(plan('--matrix').keys());
    expect(measures.size).toBeGreaterThan(8);
    for (const { check } of checks) {
      expect(measures.has(check.measure) || check.measure === 'diag', check.id).toBe(true);
      expect(Object.keys(check.target ?? {}).length, check.id).toBeGreaterThan(0);
      if (check.measure === 'diag') {
        expect(check.path, check.id).toMatch(/^renderer\./);
        continue;
      }
      expect(produced.has(check.shot!), check.id).toBe(true);
      // Every measured shot names the camera view its crops are calibrated on.
      expect(['chase', 'cockpit', 'pod', 'trackside'], check.id).toContain(
        targets.views[check.shot!],
      );
      for (const box of [check.crop, check.a?.crop, check.b?.crop])
        if (box) expect(inFrame(box), check.id).toBe(true);
      for (const points of [check.poly, check.line])
        if (points)
          for (const [x, y] of points) {
            expect(x >= 0 && x <= 1 && y >= 0 && y <= 1, check.id).toBe(true);
          }
    }
    for (const shot of Object.keys(targets.compositions).filter((k) => !k.startsWith('_')))
      expect(produced.has(shot), `composition ${shot}`).toBe(true);
  });
});
