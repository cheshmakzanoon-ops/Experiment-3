import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../e2e/preparation-profile.ts', () => ({
  preparationProfileTest: { extend: (fixtures: unknown) => fixtures },
}));
import { menuTimingTest } from '../e2e/menu-timing-evidence.ts';

type Fixture = {
  menuTimingMode: [string, { option: boolean }];
  menuTimingEvidence: [
    (input: unknown, use: () => Promise<void>, info: unknown) => Promise<void>,
    unknown,
  ];
};
const fixtures = menuTimingTest as unknown as Fixture;

afterEach(() => vi.unstubAllGlobals());

describe('menu timing fixture preparation-only mode', () => {
  it('keeps full evidence the opt-in fixture default for existing transition tests', () => {
    expect(fixtures.menuTimingMode).toEqual(['full', { option: true }]);
  });
  it('streams bounded preparation details without accessing RAF, GL, or timer hooks', async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const window = {
      addEventListener: vi.fn((name: string, callback: (event: unknown) => void) =>
        listeners.set(name, callback),
      ),
      get requestAnimationFrame(): never {
        throw new Error('preparation-only must not access RAF');
      },
    };
    vi.stubGlobal('window', window);
    vi.stubGlobal('HTMLCanvasElement', undefined);
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('PerformanceObserver', undefined);
    vi.stubGlobal('setInterval', () => {
      throw new Error('preparation-only must not install timers');
    });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const attach = vi.fn();
    const page = {
      on: vi.fn(),
      off: vi.fn(),
      addInitScript: vi.fn(async (callback: (args: unknown) => void, args: unknown) =>
        callback(args),
      ),
    };
    try {
      await fixtures.menuTimingEvidence[0](
        { page, menuTimingMode: 'preparation-only' },
        async () => {
          expect([...listeners.keys()]).toEqual(['apex-preparation-checkpoint']);
          const emit = listeners.get('apex-preparation-checkpoint')!;
          emit({
            detail: {
              label: 'menu:scene-submit',
              phase: 'start',
              at: 12,
              run: 1,
              sequence: 1,
              span: 2,
              detailJSON: '{"newIds":[1]}',
            },
          });
          expect(debug).toHaveBeenCalledTimes(1);
          const packet = JSON.parse(
            String(debug.mock.calls[0][0]).replace('__APEX_MENU_TIMING__', ''),
          );
          expect(packet.events[0]).toMatchObject({
            kind: 'preparation',
            label: 'menu:scene-submit',
            detailJSON: '{"newIds":[1]}',
          });
          emit({
            detail: { label: 'menu:programs', phase: 'end', at: 13, detailJSON: 'x'.repeat(32769) },
          });
          const bounded = JSON.parse(
            String(debug.mock.calls[1][0]).replace('__APEX_MENU_TIMING__', ''),
          );
          expect(JSON.parse(bounded.events[0].detailJSON)).toEqual({
            truncated: true,
            reason: 'invalid-checkpoint-detail',
          });
        },
        { title: 'Academy', status: 'passed', attach },
      );
      expect(JSON.parse(attach.mock.calls[0][1].body).mode).toBe('preparation-only');
      expect(page.off).toHaveBeenCalledWith('console', expect.any(Function));
    } finally {
      debug.mockRestore();
    }
  });
});
