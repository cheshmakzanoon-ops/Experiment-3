import { expect, it, vi } from 'vitest';
import { persistSecondaryStandCapture } from '../e2e/fixtures/secondary-stand-capture.ts';

it('A12 owns the current PNG before yielding and waits for durable delivery', async () => {
  let frame = 'data:image/png;base64,first-frame';
  const canvas = { toDataURL: vi.fn(() => frame) };
  let finish!: () => void;
  const saved = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const sink = vi.fn(() => saved);
  let completed = false;
  const pending = persistSecondaryStandCapture(canvas, '450-front', sink).then(() => {
    completed = true;
  });
  frame = 'data:image/png;base64,next-frame';
  await Promise.resolve();
  expect(canvas.toDataURL).toHaveBeenCalledExactlyOnceWith('image/png');
  expect(sink).toHaveBeenCalledExactlyOnceWith({
    name: '450-front',
    image: 'data:image/png;base64,first-frame',
  });
  expect(completed).toBe(false);
  finish();
  await pending;
  expect(completed).toBe(true);
});

it('A12 propagates evidence storage failure instead of accepting an unsaved image', async () => {
  const failed = new Error('Evidence storage unavailable');
  await expect(
    persistSecondaryStandCapture(
      { toDataURL: () => 'data:image/png;base64,current-frame' },
      'normal-cockpit',
      async () => {
        throw failed;
      },
    ),
  ).rejects.toBe(failed);
});

it('A12 rejects missing PNG ownership before contacting the sink', async () => {
  for (const image of ['data:,', 'data:image/png;base64,', 'data:image/jpeg;base64,wrong']) {
    const sink = vi.fn(async () => {});
    await expect(
      persistSecondaryStandCapture({ toDataURL: () => image }, '450-front', sink),
    ).rejects.toThrow('PNG');
    expect(sink).not.toHaveBeenCalled();
  }
});
