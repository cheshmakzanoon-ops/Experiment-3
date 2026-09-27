import { describe, expect, it, vi } from 'vitest';
import { completedDrawMilliseconds } from '../e2e/fixtures/completed-draw.ts';

function context() {
  let elapsed = 0;
  const order: string[] = [];
  const pixel = new Uint8Array(4);
  const gl = {
    RGBA: 0x1908 as const,
    UNSIGNED_BYTE: 0x1401 as const,
    isContextLost: vi.fn(() => false),
    readPixels: vi.fn((_x, _y, _w, _h, _format, _type, destination: Uint8Array) => {
      order.push('readback');
      elapsed += 31;
      destination.set([5, 11, 23, 255]);
    }),
  };
  const draw = vi.fn(() => {
    order.push('draw');
    elapsed += 2;
  });
  const now = () => {
    order.push('clock');
    return elapsed;
  };
  return { gl, draw, pixel, now, order };
}

describe('test-only completed draw measurements', () => {
  it('times one draw AND its CPU readback, not just queued submission', () => {
    const f = context();
    expect(completedDrawMilliseconds(f.gl, f.draw, f.pixel, f.now)).toBe(33);
    expect(f.order).toEqual(['clock', 'draw', 'readback', 'clock']);
    expect(f.draw).toHaveBeenCalledTimes(1);
    expect(f.gl.readPixels).toHaveBeenCalledExactlyOnceWith(
      0,
      0,
      1,
      1,
      f.gl.RGBA,
      f.gl.UNSIGNED_BYTE,
      f.pixel,
    );
    expect([...f.pixel]).toEqual([5, 11, 23, 255]);
  });
  it('reuses exactly four completion bytes across eight samples without extra warmup draws', () => {
    const f = context();
    const samples = Array.from({ length: 8 }, () =>
      completedDrawMilliseconds(f.gl, f.draw, f.pixel, f.now),
    );
    expect(samples).toEqual(Array(8).fill(33));
    expect(f.draw).toHaveBeenCalledTimes(8);
    expect(f.gl.readPixels).toHaveBeenCalledTimes(8);
    for (const args of f.gl.readPixels.mock.calls) expect(args[6]).toBe(f.pixel);
  });
  it('rejects an invalid completion buffer before submitting work', () => {
    for (const bytes of [0, 3, 5]) {
      const f = context();
      expect(() => completedDrawMilliseconds(f.gl, f.draw, new Uint8Array(bytes), f.now)).toThrow();
      expect(f.draw).not.toHaveBeenCalled();
    }
  });
  it('rejects context loss before or during a sample instead of returning a fast zero', () => {
    const before = context();
    before.gl.isContextLost.mockReturnValue(true);
    expect(() =>
      completedDrawMilliseconds(before.gl, before.draw, before.pixel, before.now),
    ).toThrow();
    expect(before.draw).not.toHaveBeenCalled();
    const during = context();
    during.gl.isContextLost.mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(() =>
      completedDrawMilliseconds(during.gl, during.draw, during.pixel, during.now),
    ).toThrow();
    expect(during.gl.readPixels).toHaveBeenCalledTimes(1);
  });
  it('propagates draw and readback failures without publishing a duration', () => {
    for (const phase of ['draw', 'readback']) {
      const f = context();
      const fail = () => {
        throw new Error(phase);
      };
      if (phase === 'draw') f.draw.mockImplementation(fail);
      else f.gl.readPixels.mockImplementation(fail);
      expect(() => completedDrawMilliseconds(f.gl, f.draw, f.pixel, f.now)).toThrow(phase);
      if (phase === 'draw') expect(f.gl.readPixels).not.toHaveBeenCalled();
    }
  });
  it('rejects reversed and nonfinite clocks', () => {
    for (const end of [-1, NaN, Infinity]) {
      const f = context();
      const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(end);
      expect(() => completedDrawMilliseconds(f.gl, f.draw, f.pixel, now)).toThrow();
    }
  });
});
