import { describe, expect, it } from 'vitest';
import { DrawLedger, DRAW_PHASES } from '../src/rendering/draw-ledger.ts';

function totals(ledger: DrawLedger) {
  return DRAW_PHASES.reduce(
    (sum, phase) => ({
      calls: sum.calls + ledger.completed[phase].calls,
      triangles: sum.triangles + ledger.completed[phase].triangles,
    }),
    { calls: 0, triangles: 0 },
  );
}

describe('draw-ledger frame ownership audit', () => {
  it('retains the last completed frame while a replacement frame is incomplete', () => {
    const info = { calls: 0, triangles: 0 };
    const ledger = new DrawLedger(info);
    const completed = ledger.completed;
    const bucket = completed.composer;
    ledger.begin();
    ledger.mark('composer');
    info.calls = 2;
    info.triangles = 20;
    ledger.end();
    const first = ledger.snapshot();
    info.calls = info.triangles = 0;
    ledger.begin();
    ledger.mark('mirrors');
    info.calls = 4;
    info.triangles = 40;
    expect(ledger.snapshot()).toEqual(first);
    ledger.end();
    expect(ledger.completed).toBe(completed);
    expect(ledger.completed.composer).toBe(bucket);
    expect(ledger.completed.composer.calls).toBe(0);
    expect(ledger.completed.mirrors.calls).toBe(4);
    expect(first.composer.calls).toBe(2);
    expect(first.mirrors.calls).toBe(0);
  });

  it('clears an interrupted frame and off-frame shadow work on the next begin', () => {
    const info = { calls: 0, triangles: 0 };
    const ledger = new DrawLedger(info);
    const shadows = {
      render() {
        info.calls += 5;
        info.triangles += 15;
      },
    };
    ledger.instrumentShadows(shadows);
    shadows.render();
    ledger.begin();
    ledger.mark('environment');
    info.calls += 9;
    info.triangles += 27;
    // The frame is abandoned before end, as on a failed higher-level render.
    info.calls = info.triangles = 0;
    ledger.begin();
    ledger.mark('composer');
    info.calls += 3;
    info.triangles += 9;
    shadows.render();
    ledger.end();
    expect(ledger.completed.environment).toEqual({ calls: 0, triangles: 0 });
    expect(ledger.completed.composer).toEqual({ calls: 3, triangles: 9 });
    expect(ledger.completed.shadow).toEqual({ calls: 5, triangles: 15 });
    expect(totals(ledger)).toEqual(info);
  });

  it('preserves the shadow receiver and arguments across recursive throws', () => {
    const info = { calls: 0, triangles: 0 };
    const ledger = new DrawLedger(info);
    const failure = new Error('render failed');
    const visited: number[] = [];
    const shadows = {
      render(depth: number) {
        expect(this).toBe(shadows);
        visited.push(depth);
        info.calls++;
        info.triangles += 7;
        if (depth) this.render(depth - 1);
        else throw failure;
      },
    };
    ledger.instrumentShadows(shadows);
    ledger.begin();
    ledger.mark('probe');
    info.calls += 2;
    info.triangles += 14;
    expect(() => shadows.render(3)).toThrow(failure);
    info.calls += 6;
    info.triangles += 42;
    ledger.end();
    expect(visited).toEqual([3, 2, 1, 0]);
    expect(ledger.completed.shadow).toEqual({ calls: 4, triangles: 28 });
    expect(ledger.completed.probe).toEqual({ calls: 8, triangles: 56 });
    expect(totals(ledger)).toEqual(info);
  });

  it('keeps exact phase totals through repeated counter resets and nested passes', () => {
    const info = { calls: 0, triangles: 0 };
    const ledger = new DrawLedger(info);
    const shadows = {
      render() {
        info.calls += 3;
        info.triangles += 12;
      },
    };
    ledger.instrumentShadows(shadows);
    for (let frame = 0; frame < 256; frame++) {
      info.calls = info.triangles = 0;
      ledger.begin();
      for (const phase of DRAW_PHASES) {
        ledger.mark(phase);
        info.calls += frame % 7;
        info.triangles += (frame % 7) * 11;
        if (phase === 'composer' || phase === 'mirrors') shadows.render();
      }
      ledger.end();
      expect(totals(ledger)).toEqual(info);
      expect(ledger.completed.shadow).toEqual({
        calls: (frame % 7) + 6,
        triangles: (frame % 7) * 11 + 24,
      });
    }
  });
});
