import { expect, it, vi } from 'vitest';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { CAR_STRIDE, HEADER, H } from '../src/simulation/protocol.ts';

function fixture() {
  const calls: string[] = [];
  const sample = new Float32Array(HEADER + CAR_STRIDE * 3);
  sample[H.CARS] = 3;
  sample[H.TIME] = 0;
  const target = {
    cars: [] as { update: ReturnType<typeof vi.fn> }[],
    scene: {},
    camera: {},
    mode: 'pod',
    warmupFrames: 0,
    setCars(n: number) {
      while (this.cars.length < n) this.cars.push({ update: vi.fn() });
      calls.push(`cars:${n}`);
    },
    renderer: {
      compileAsync: vi.fn(async () => {
        calls.push('compile');
      }),
    },
    changeCamera(mode: string) {
      this.mode = mode;
      calls.push(mode);
    },
    reset: vi.fn(),
    draw: vi.fn(
      (
        a: Float32Array,
        b: Float32Array,
        _alpha: number,
        _dt: number,
        menu: boolean,
        replay: boolean,
      ) => {
        expect(a).toBe(sample);
        expect(b[H.TIME]).toBe(0);
        expect(menu).toBe(false);
        expect(replay).toBe(true);
        calls.push('draw');
      },
    ),
  };
  return { target, calls, sample, typed: target as unknown as RacingRenderer };
}
it('yields construction, compiles and warms camera passes without modifying simulation time', async () => {
  const { target, typed, sample, calls } = fixture();
  const yieldFrame = vi.fn(async () => {
    calls.push('yield');
  });
  expect(
    await RacingRenderer.prototype.prepare.call(typed, sample, vi.fn(), () => false, yieldFrame),
  ).toBe(true);
  expect(target.cars).toHaveLength(3);
  expect(target.renderer.compileAsync).toHaveBeenCalledTimes(3);
  expect(target.draw).toHaveBeenCalledTimes(2);
  expect(target.mode).toBe('pod');
  expect(target.warmupFrames).toBe(2);
  expect(sample[H.TICK]).toBe(0);
  expect(calls.indexOf('compile')).toBeGreaterThan(calls.indexOf('cars:3'));
  expect(calls.indexOf('draw')).toBeGreaterThan(calls.indexOf('compile'));
});
it('stops cancelled construction before touching any further GPU resources', async () => {
  const { target, typed, sample } = fixture();
  let cancelled = false;
  const result = await RacingRenderer.prototype.prepare.call(
    typed,
    sample,
    vi.fn(),
    () => cancelled,
    async () => {
      cancelled = true;
    },
  );
  expect(result).toBe(false);
  expect(target.cars).toHaveLength(1);
  expect(target.draw).not.toHaveBeenCalled();
  expect(target.renderer.compileAsync).not.toHaveBeenCalled();
});
it('a shader failure rejects initialization instead of starting unprepared gameplay', async () => {
  const { target, typed, sample } = fixture();
  target.renderer.compileAsync.mockRejectedValueOnce(new Error('Shader failure'));
  await expect(
    RacingRenderer.prototype.prepare.call(
      typed,
      sample,
      vi.fn(),
      () => false,
      async () => undefined,
    ),
  ).rejects.toThrow('Shader failure');
  expect(target.draw).not.toHaveBeenCalled();
});
it('restores the selected camera when a GPU warmup pass throws', async () => {
  const { target, typed, sample } = fixture();
  target.draw.mockImplementationOnce(() => {
    throw new Error('GPU pass failed');
  });
  await expect(
    RacingRenderer.prototype.prepare.call(
      typed,
      sample,
      vi.fn(),
      () => false,
      async () => undefined,
    ),
  ).rejects.toThrow('GPU pass failed');
  expect(target.mode).toBe('pod');
  expect(target.reset).toHaveBeenCalled();
});
