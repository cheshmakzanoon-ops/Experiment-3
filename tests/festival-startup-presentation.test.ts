import { expect, it, vi } from 'vitest';
import { completeHeldPresentation } from '../src/session/festival-startup-presentation.ts';
function fixture() {
  let time = 0,
    ready = false,
    revision = 0;
  const events: string[] = [];
  const options = {
    active: vi.fn(),
    ready: () => ready,
    revision: () => revision,
    resize: vi.fn(() => {
      events.push('resize');
    }),
    draw: vi.fn(() => {
      events.push('draw');
      ready = false;
    }),
    receipt: () => ({ sampleTick: 0, presentedTick: 0 }),
    deadline: 300000,
    now: () => time,
    yieldTask: vi.fn(async () => {
      time += 16;
      ready = true;
    }),
  };
  return {
    options,
    events,
    setReady: (v: boolean) => {
      ready = v;
    },
    resize: () => {
      revision++;
    },
  };
}
it('drains old work, resizes, submits one real frame and waits for completion', async () => {
  const f = fixture();
  const receipt = await completeHeldPresentation(f.options);
  expect(f.events).toEqual(['resize', 'draw']);
  expect(f.options.yieldTask).toHaveBeenCalledTimes(2);
  expect(receipt).toEqual({
    sampleTick: 0,
    presentedTick: 0,
    submittedAt: 16,
    completedAt: 32,
    viewportRevision: 0,
    completed: true,
  });
});
it('does not reveal/resume while the candidate fence remains pending', async () => {
  const f = fixture();
  f.setReady(true);
  let release!: () => void;
  f.options.yieldTask.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const loaded = vi.fn();
  const pending = completeHeldPresentation(f.options).then(loaded);
  await vi.waitFor(() => expect(f.options.draw).toHaveBeenCalledTimes(1));
  expect(loaded).not.toHaveBeenCalled();
  f.setReady(true);
  release();
  await pending;
  expect(loaded).toHaveBeenCalledTimes(1);
});
it('a resize during a pending draw drains before resize and redraw, then fences again', async () => {
  const f = fixture();
  f.setReady(true);
  let release!: () => void;
  f.options.yieldTask.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const loaded = vi.fn();
  const pending = completeHeldPresentation(f.options).then(loaded);
  await vi.waitFor(() => expect(f.options.draw).toHaveBeenCalledTimes(1));
  f.resize();
  f.resize();
  expect(f.options.resize).toHaveBeenCalledTimes(1);
  f.setReady(true);
  release();
  await vi.waitFor(() => expect(f.options.draw).toHaveBeenCalledTimes(2));
  expect(f.options.resize).toHaveBeenCalledTimes(2);
  expect(loaded).not.toHaveBeenCalled();
  f.setReady(true);
  release();
  await pending;
  expect(loaded.mock.calls[0][0].viewportRevision).toBe(2);
});
it.each(['abort', 'context loss', 'owner replaced'])(
  'fails %s without publishing or further drawing',
  async (reason) => {
    const f = fixture();
    f.setReady(true);
    f.options.yieldTask.mockImplementation(async () => {
      f.options.active.mockImplementation(() => {
        throw new Error(reason);
      });
    });
    const loaded = vi.fn();
    await expect(completeHeldPresentation(f.options).then(loaded)).rejects.toThrow(reason);
    expect(loaded).not.toHaveBeenCalled();
    expect(f.options.draw).toHaveBeenCalledTimes(1);
  },
);
it('cancellation before old work drains never resizes or draws', async () => {
  const f = fixture();
  f.options.active.mockImplementation(() => {
    throw new Error('cancel');
  });
  await expect(completeHeldPresentation(f.options)).rejects.toThrow('cancel');
  expect(f.options.resize).not.toHaveBeenCalled();
  expect(f.options.draw).not.toHaveBeenCalled();
});
it('retains the original absolute budget', async () => {
  const f = fixture();
  f.options.deadline = 16;
  await expect(completeHeldPresentation(f.options)).rejects.toThrow('deadline');
  expect(f.options.draw).not.toHaveBeenCalled();
});
it('rejects stale presentation instead of accepting a synthetic receipt', async () => {
  const f = fixture();
  f.options.receipt = () => ({ sampleTick: 14, presentedTick: 0 });
  await expect(completeHeldPresentation(f.options)).rejects.toThrow('authoritative snapshot');
});
it('repeated entries require independent submissions and completions', async () => {
  const a = fixture(),
    b = fixture();
  await completeHeldPresentation(a.options);
  await completeHeldPresentation(b.options);
  expect(a.options.draw).toHaveBeenCalledTimes(1);
  expect(b.options.draw).toHaveBeenCalledTimes(1);
});

it('initial candidate construction/configuration cannot mutate a pending previous frame', async () => {
  const { withDrainedFestivalPresentation } = await import(
    '../src/session/festival-startup-presentation.ts'
  );
  const f = fixture();
  let release!: () => void;
  f.options.yieldTask.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const constructAndConfigure = vi.fn(() => ({ candidate: true }));
  const pending = withDrainedFestivalPresentation(f.options, constructAndConfigure);
  await vi.waitFor(() => expect(f.options.yieldTask).toHaveBeenCalledTimes(1));
  expect(constructAndConfigure).not.toHaveBeenCalled();
  f.setReady(true);
  release();
  expect(await pending).toEqual({ candidate: true });
  expect(constructAndConfigure).toHaveBeenCalledTimes(1);
});
it('cancelled initial ownership never constructs or configures the candidate', async () => {
  const { withDrainedFestivalPresentation } = await import(
    '../src/session/festival-startup-presentation.ts'
  );
  const f = fixture();
  f.options.yieldTask.mockImplementation(async () => {
    f.options.active.mockImplementation(() => {
      throw new Error('owner replaced');
    });
  });
  const construct = vi.fn();
  await expect(withDrainedFestivalPresentation(f.options, construct)).rejects.toThrow(
    'owner replaced',
  );
  expect(construct).not.toHaveBeenCalled();
});
