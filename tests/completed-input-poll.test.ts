import { afterEach, expect, it, vi } from 'vitest';
import { CompletedInputPoll } from '../e2e/fixtures/completed-input-poll.ts';
import { InputController } from '../src/input/controller.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fixture() {
  const receipts = new CompletedInputPoll();
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = {
    id: 'Results controller',
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons,
  } as unknown as Gamepad;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { getGamepads: () => receipts.observe([pad]) });
  const emit = vi.fn();
  const input = new InputController(structuredClone(DEFAULT_SETTINGS), emit);
  const poll = () => receipts.sample(() => input.pollActions(['pause']));
  const press = (down: boolean) =>
    Object.assign(buttons[9], { pressed: down, value: Number(down) });
  return { receipts, buttons, pad, emit, input, poll, press };
}

it('elapsed time and HUD reads cannot acknowledge a neutral controller baseline', () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    navigator.getGamepads(); // HUD/test read, not an actual input poll.
    vi.advanceTimersByTime(100);
    expect(f.receipts.receipt).toEqual({ sequence: 0, pads: [] });
    f.press(true);
    f.poll(); // First observed sample is held: must not manufacture Start.
    f.poll();
    expect(f.emit).not.toHaveBeenCalled();
    expect(f.receipts.receipt.pads).toEqual([{ id: 'Results controller', index: 0, pressed: [9] }]);
    f.press(false);
    f.poll();
    expect(f.receipts.receipt.pads).toEqual([{ id: 'Results controller', index: 0, pressed: [] }]);
    f.press(true);
    f.poll();
    f.poll();
    expect(f.emit.mock.calls).toEqual([['pause']]);
  } finally {
    f.input.dispose();
  }
});

it('one completed neutral input sample permits exactly one subsequent Start edge', () => {
  const f = fixture();
  try {
    f.poll();
    const acknowledged = f.receipts.receipt;
    expect(acknowledged).toEqual({
      sequence: 1,
      pads: [{ id: 'Results controller', index: 0, pressed: [] }],
    });
    f.press(true);
    expect(acknowledged.pads[0].pressed).toEqual([]); // Snapshot, not mutable pad state.
    f.poll();
    f.poll();
    expect(f.emit.mock.calls).toEqual([['pause']]);
  } finally {
    f.input.dispose();
  }
});

it('publishes only completed polls and bounds and isolates retained evidence', () => {
  const f = fixture();
  try {
    f.poll();
    const previous = f.receipts.receipt;
    expect(() =>
      f.receipts.sample(() => {
        navigator.getGamepads();
        throw new Error('poll failed');
      }),
    ).toThrow('poll failed');
    expect(f.receipts.receipt).toEqual(previous);
    navigator.getGamepads();
    expect(f.receipts.receipt).toEqual(previous);
    const wide = {
      id: 'x'.repeat(200),
      index: 2,
      buttons: Array.from({ length: 200 }, () => ({ pressed: true, touched: true, value: 1 })),
    };
    f.receipts.sample(() => f.receipts.observe(Array.from({ length: 8 }, () => wide)));
    const receipt = f.receipts.receipt;
    expect(receipt.pads).toHaveLength(4);
    expect(receipt.pads[0].id).toHaveLength(160);
    expect(receipt.pads[0].pressed).toHaveLength(128);
    receipt.pads.length = 0;
    expect(f.receipts.receipt.pads).toHaveLength(4);
    f.receipts.sample(() => {});
    expect(f.receipts.receipt.pads).toEqual([]); // Never reuse a prior pad observation.
  } finally {
    f.input.dispose();
  }
});
