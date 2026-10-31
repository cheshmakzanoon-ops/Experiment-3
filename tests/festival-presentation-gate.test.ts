import { expect, it, vi } from 'vitest';
import { FestivalSession } from '../src/session/free-roam.ts';
import { CAR_STRIDE, HEADER, H, F, carBase } from '../src/simulation/protocol.ts';

function fixture() {
  const calls: string[] = [];
  const sample = new Float32Array(HEADER + CAR_STRIDE);
  sample[H.CARS] = 1;
  sample[carBase(0) + F.QW] = 1;
  const target = Object.assign(Object.create(FestivalSession.prototype), {
    disposed: false,
    travelling: false,
    current: sample,
    lastTime: 0,
    presentationFrames: 0,
    viewportRevision: 0,
    localViewportRevision: 0,
    status: null,
    riders: null,
    traffic: null,
    controls: {
      paused: false,
      syncInput: vi.fn(() => {
        calls.push('input');
      }),
    },
    host: {
      presentation: {
        ready: vi.fn(() => {
          calls.push('ready');
          return true;
        }),
        submitted: vi.fn(() => {
          calls.push('submitted');
        }),
      },
    },
    liveFrames: {
      sample: vi.fn(() => {
        calls.push('sample');
        return { a: sample, b: sample, alpha: 1 };
      }),
    },
    renderer: {
      camera: {},
      night: false,
      mode: 'chase',
      presented: { value: sample },
      draw: vi.fn(() => {
        calls.push('draw');
      }),
    },
  }) as {
    disposed: boolean;
    travelling: boolean;
    current: Float32Array;
    presentationFrames: number;
    controls: { paused: boolean; syncInput: ReturnType<typeof vi.fn> };
    host: {
      presentation: { ready: ReturnType<typeof vi.fn>; submitted: ReturnType<typeof vi.fn> };
    };
    liveFrames: { sample: ReturnType<typeof vi.fn> };
    renderer: { draw: ReturnType<typeof vi.fn> };
  };
  const draw = () => FestivalSession.prototype.frame.call(target as unknown as FestivalSession, 16);
  return { target, calls, sample, draw };
}
it('polls input but does not queue presentation work behind an unfinished shared GPU frame', () => {
  const { target, calls, sample, draw } = fixture();
  const before = sample.slice();
  target.host.presentation.ready.mockImplementation(() => {
    calls.push('ready');
    return false;
  });
  draw();
  draw();
  expect(calls).toEqual(['input', 'ready', 'input', 'ready']);
  expect(target.liveFrames.sample).not.toHaveBeenCalled();
  expect(target.renderer.draw).not.toHaveBeenCalled();
  expect(target.host.presentation.submitted).not.toHaveBeenCalled();
  expect(target.presentationFrames).toBe(0);
  expect(sample).toEqual(before);
});
it('samples and submits exactly one completed draw after shared ownership becomes available', () => {
  const { target, calls, sample, draw } = fixture();
  const before = sample.slice();
  draw();
  expect(calls).toEqual(['input', 'ready', 'sample', 'draw', 'submitted']);
  expect(target.presentationFrames).toBe(1);
  expect(sample).toEqual(before);
});
it.each(['disposed', 'travelling'] as const)(
  'does not draw when an input action makes the session %s',
  (state) => {
    const { target, draw } = fixture();
    target.controls.syncInput.mockImplementation(() => {
      target[state] = true;
    });
    draw();
    expect(target.host.presentation.ready).not.toHaveBeenCalled();
    expect(target.renderer.draw).not.toHaveBeenCalled();
  },
);
it('does not publish a frame receipt when drawing fails', () => {
  const { target, draw } = fixture();
  target.renderer.draw.mockImplementation(() => {
    throw new Error('GPU draw failed');
  });
  expect(draw).toThrow('GPU draw failed');
  expect(target.host.presentation.submitted).not.toHaveBeenCalled();
  expect(target.presentationFrames).toBe(0);
});
