import { describe, it, expect } from 'vitest';
import { DrawLedger, DRAW_PHASES } from '../src/rendering/draw-ledger.ts';

describe('draw ledger', () => {
  it('attributes renderer counters to phases, including nested shadow passes', () => {
    const info = { calls: 0, triangles: 0 };
    const ledger = new DrawLedger(info);
    const shadowMap = {
      render() {
        info.calls += 40;
        info.triangles += 4000;
      },
    };
    ledger.instrumentShadows(shadowMap);
    ledger.begin();
    ledger.mark('mirrors');
    info.calls += 100;
    info.triangles += 1000;
    ledger.mark('composer');
    info.calls += 5; // scene pass setup before the shadow map
    shadowMap.render();
    info.calls += 300;
    info.triangles += 9000;
    ledger.mark('other');
    ledger.end();
    const out = ledger.snapshot();
    expect(out.mirrors).toEqual({ calls: 100, triangles: 1000 });
    expect(out.shadow).toEqual({ calls: 40, triangles: 4000 });
    expect(out.composer).toEqual({ calls: 305, triangles: 9000 });
    const total = DRAW_PHASES.reduce((n, p) => n + out[p].calls, 0);
    expect(total).toBe(info.calls);
  });
  it('restores the enclosing phase if the shadow pass throws', () => {
    const info = { calls: 0, triangles: 0 };
    const ledger = new DrawLedger(info);
    const shadowMap = {
      render() {
        info.calls += 2;
        throw new Error('lost context');
      },
    };
    ledger.instrumentShadows(shadowMap);
    ledger.begin();
    ledger.mark('composer');
    expect(() => shadowMap.render()).toThrow('lost context');
    info.calls += 7;
    ledger.end();
    expect(ledger.completed.shadow.calls).toBe(2);
    expect(ledger.completed.composer.calls).toBe(7);
  });
});
