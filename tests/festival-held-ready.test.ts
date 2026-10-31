import { expect, it, vi } from 'vitest';
import { FestivalSession } from '../src/session/free-roam.ts';
import { LiveFrameClock } from '../src/rendering/live-frame-clock.ts';
import type { FromOpenWorld } from '../src/workers/open-world-protocol.ts';
import { CAR_STRIDE, HEADER, H, F, carBase } from '../src/simulation/protocol.ts';
type TestSession = {
  receive(message: FromOpenWorld): void;
  frame(time: number): void;
  drawHeldOrLive(time: number): void;
  status: unknown;
  controls: { syncInput: ReturnType<typeof vi.fn> };
};
function fixture() {
  const resolve = vi.fn(),
    reject = vi.fn();
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  const session = Object.assign(Object.create(FestivalSession.prototype), {
    disposed: false,
    current: null,
    previous: null,
    status: null,
    renderer: null,
    readyResolve: resolve,
    readyReject: reject,
    liveFrames: new LiveFrameClock(),
    preparing: true,
    host: { toast: vi.fn() },
    controls: { syncInput: vi.fn() },
  }) as TestSession;
  return { session, resolve, reject, frame };
}
it('snapshot and status cannot release startup before the typed held acknowledgment', () => {
  const f = fixture();
  f.session.receive({ type: 'frame', buffer: f.frame.buffer });
  expect(f.resolve).not.toHaveBeenCalled();
  f.session.status = { vehicleId: 'eh3' };
  expect(f.resolve).not.toHaveBeenCalled();
  f.session.receive({ type: 'held-ready', tick: 0 });
  expect(f.resolve).toHaveBeenCalledTimes(1);
});
it('rejects missing status and mismatched initial tick', () => {
  const f = fixture();
  f.session.receive({ type: 'frame', buffer: f.frame.buffer });
  f.session.receive({ type: 'held-ready', tick: 0 });
  expect(f.reject).toHaveBeenCalledTimes(1);
  const g = fixture();
  g.session.status = {};
  g.session.receive({ type: 'frame', buffer: g.frame.buffer });
  g.session.receive({ type: 'held-ready', tick: 1 });
  expect(g.reject).toHaveBeenCalledTimes(1);
});
it('normal RAF cannot enable driving during preparation', () => {
  const f = fixture();
  f.session.frame(16);
  expect(f.session.controls.syncInput).not.toHaveBeenCalled();
});
it('real paused LiveFrameClock draws same-tick travel destination, never interpolated spawn', () => {
  const f = fixture();
  const base = carBase(0);
  f.frame[H.TICK] = 42;
  f.frame[H.TIME] = 0.35;
  f.frame[base + F.X] = 10;
  f.frame[base + F.Z] = 20;
  f.frame[base + F.QW] = 1;
  f.session.receive({ type: 'frame', buffer: f.frame.buffer });
  const destination = f.frame.slice();
  destination[base + F.X] = 901;
  destination[base + F.Z] = -502;
  f.session.receive({ type: 'frame', buffer: destination.buffer });
  const shown = destination.slice();
  const draw = vi.fn((a: Float32Array, b: Float32Array, alpha: number) => {
    expect(a[base + F.X]).toBe(901);
    expect(b[base + F.X]).toBe(901);
    expect(a[base + F.Z]).toBe(-502);
    expect(b[base + F.Z]).toBe(-502);
    expect(a[H.TICK]).toBe(42);
    expect(b[H.TICK]).toBe(42);
    expect(alpha).toBe(1);
  });
  const submitted = vi.fn();
  Object.assign(f.session, {
    renderer: { draw, camera: {}, night: false, mode: 'chase', presented: { value: shown } },
    host: { presentation: { submitted } },
    riders: null,
    traffic: null,
    lastTime: 0,
    presentationFrames: 0,
  });
  f.session.drawHeldOrLive(100);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(submitted).toHaveBeenCalledTimes(1);
  expect(f.session.controls.syncInput).not.toHaveBeenCalled();
});

it('direct resize invalidates presentation even with a host revision callback', () => {
  const resize = vi.fn();
  const session = Object.assign(Object.create(FestivalSession.prototype), {
    host: { presentation: { revision: () => 7 } },
    localViewportRevision: 0,
    viewportRevision: 7,
    renderer: { resize },
  }) as { resize(): void; applyViewport(): void; revision(): number };
  session.resize();
  expect(session.revision()).toBe(8);
  expect(resize).not.toHaveBeenCalled();
  session.applyViewport();
  expect(resize).toHaveBeenCalledTimes(1);
  session.applyViewport();
  expect(resize).toHaveBeenCalledTimes(1);
});
