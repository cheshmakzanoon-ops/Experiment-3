import { expect, it, vi } from 'vitest';
import { FestivalSession } from '../src/session/free-roam.ts';
function fixture(preparing: boolean) {
  const events: string[] = [];
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const loaded = vi.fn(() => events.push('loaded'));
  const paused = vi.fn((value: boolean) => events.push(`pause:${value}`));
  const prepare = vi.fn(async () => {
    events.push('draw-destination');
    await completed;
    events.push('completed');
  });
  const session = Object.assign(Object.create(FestivalSession.prototype), {
    preparing,
    disposed: false,
    travelling: false,
    renderer: { ready: () => true },
    events: [{ spec: { id: 'destination', name: 'Destination' }, marker: { x: 10, z: 20 } }],
    host: { loading: vi.fn(), loaded, toast: vi.fn() },
    hud: { showMenu: vi.fn(), showMap: vi.fn(), hideResults: vi.fn() },
    setPaused: paused,
    commandAndWait: vi.fn(async () => {
      events.push('destination-snapshot-status-ack');
    }),
    preparePresentation: prepare,
  }) as { travel(id: string): Promise<void>; travelling: boolean };
  return { session, events, finish, loaded, paused, prepare };
}
it.each([true, false])('travel awaits destination completion (startup=%s)', async (startup) => {
  const f = fixture(startup);
  const pending = f.session.travel('destination');
  await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledTimes(1));
  expect(f.events).toEqual(['pause:true', 'destination-snapshot-status-ack', 'draw-destination']);
  expect(f.loaded).not.toHaveBeenCalled();
  expect(f.session.travelling).toBe(true);
  await f.session.travel('destination').catch(() => {});
  expect(f.prepare).toHaveBeenCalledTimes(1);
  f.finish();
  await pending;
  expect(f.session.travelling).toBe(false);
  if (startup) {
    expect(f.loaded).not.toHaveBeenCalled();
    expect(f.paused).not.toHaveBeenCalledWith(false);
  } else expect(f.events.slice(-3)).toEqual(['completed', 'loaded', 'pause:false']);
});
it('startup travel failure never reveals the spawn or resumes', async () => {
  const f = fixture(true);
  f.prepare.mockRejectedValueOnce(new Error('Context lost'));
  await expect(f.session.travel('destination')).rejects.toThrow('Context lost');
  expect(f.loaded).not.toHaveBeenCalled();
  expect(f.paused).not.toHaveBeenCalledWith(false);
});
