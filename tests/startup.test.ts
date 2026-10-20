import * as T from 'three';
import { PreparationTrace } from '../src/rendering/preparation.ts';
import { expect, it, vi } from 'vitest';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { CAR_STRIDE, HEADER, H, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';

function fixture(vehicle = 'apx01') {
  const calls: string[] = [];
  let bound: T.WebGLRenderTarget | null = null;
  const sample = new Float32Array(HEADER + CAR_STRIDE * 3);
  sample[H.CARS] = 3;
  sample[H.TIME] = 0;
  const follow = 1;
  sample[carBase(follow) + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
  const target = {
    cars: [] as { update: ReturnType<typeof vi.fn> }[],
    follow,
    quality: 'high',
    bikeShells: {
      update: vi.fn(() => {
        calls.push('bike-materials');
      }),
    },
    circuit: {
      setMotorcyclePresentation: vi.fn((enabled: boolean) => {
        calls.push(`motorcycle-surface:${enabled}`);
      }),
    },
    scene: {},
    camera: {},
    mode: 'pod',
    preparation: new PreparationTrace(),
    composer: { readBuffer: new T.WebGLRenderTarget(8, 8, { type: T.HalfFloatType }) },
    warmupFrames: 0,
    waitForPreparedFrame: vi.fn(async () => {
      calls.push('gpu-ready');
    }),
    warmPitPresentation: vi.fn(async () => {
      calls.push('pit-materials');
    }),
    warmShadowCasters: vi.fn(() => {
      calls.push('shadow-casters');
    }),
    setCars(n: number) {
      while (this.cars.length < n) this.cars.push({ update: vi.fn() });
      calls.push(`cars:${n}`);
    },
    renderer: {
      getRenderTarget: () => bound,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      getViewport: (v: T.Vector4) => v.set(0, 0, 100, 100),
      getScissor: (v: T.Vector4) => v.set(0, 0, 100, 100),
      getScissorTest: () => false,
      setRenderTarget: (value: T.WebGLRenderTarget | null) => {
        bound = value;
      },
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
      compileAsync: vi.fn(async () => {
        expect(bound).toBe(target.composer.readBuffer);
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
it.each([
  { vehicle: 'apx01', motorcycle: false, grandPrix: false },
  { vehicle: 'gpr1', motorcycle: true, grandPrix: true },
  { vehicle: 'gpr2', motorcycle: true, grandPrix: true },
  { vehicle: 'sbk1000', motorcycle: true, grandPrix: false },
  { vehicle: 'ss600', motorcycle: true, grandPrix: false },
  { vehicle: 'mx450', motorcycle: true, grandPrix: false },
])(
  'yields construction, compiles and warms $vehicle camera passes without modifying simulation time',
  async ({ vehicle, motorcycle, grandPrix }) => {
    const { target, typed, sample, calls } = fixture(vehicle);
    const yieldFrame = vi.fn(async () => {
      calls.push('yield');
    });
    expect(
      await RacingRenderer.prototype.prepare.call(typed, sample, vi.fn(), () => false, yieldFrame),
    ).toBe(true);
    expect(target.cars).toHaveLength(3);
    expect(target.renderer.compileAsync).toHaveBeenCalledTimes(3);
    expect(target.draw).toHaveBeenCalledTimes(2);
    expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
    expect(target.warmPitPresentation).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('pit-materials')).toBeGreaterThan(calls.indexOf('draw'));
    expect(target.mode).toBe('pod');
    expect(target.warmupFrames).toBe(2);
    expect(target.preparation.snapshot()?.status).toBe('complete');
    expect(target.renderer.getRenderTarget()).toBeNull();
    expect(sample[H.TICK]).toBe(0);
    expect(target.bikeShells.update).toHaveBeenCalledExactlyOnceWith(
      sample,
      sample,
      1,
      target.cars,
      target.camera,
      target.quality,
      target.follow,
    );
    expect(target.circuit.setMotorcyclePresentation).toHaveBeenCalledExactlyOnceWith(
      motorcycle,
      grandPrix,
    );
    expect(calls.indexOf('bike-materials')).toBeLessThan(calls.indexOf('compile'));
    expect(calls.indexOf(`motorcycle-surface:${motorcycle}`)).toBeLessThan(
      calls.indexOf('compile'),
    );
    expect(calls.indexOf('compile')).toBeGreaterThan(calls.indexOf('cars:3'));
    expect(calls.indexOf('draw')).toBeGreaterThan(calls.indexOf('compile'));
    // Every caster's depth program compiles once, between material compiles
    // and the first warmup draw.
    expect(target.warmShadowCasters).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('shadow-casters')).toBeGreaterThan(calls.indexOf('compile'));
    expect(calls.indexOf('shadow-casters')).toBeLessThan(calls.indexOf('draw'));
  },
);
it.each([
  { vehicles: ['gpr1', 'gpr2', 'gpr1'], bikeBuilds: 0 },
  { vehicles: ['apx01', 'gpr1', 'gpr2'], bikeBuilds: 1 },
  { vehicles: ['mx450', 'mx450', 'mx450'], bikeBuilds: 1 },
])(
  'allows cancellation before motorcycle construction only for a complete GP field: $vehicles',
  async ({ vehicles, bikeBuilds }) => {
    const { target, typed, sample } = fixture(vehicles[1]);
    vehicles.forEach((vehicle, id) => {
      sample[carBase(id) + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
    });
    // Existing hosts isolate the new yield from the original per-car yields.
    target.setCars(vehicles.length);
    const before = sample.slice();
    const progress = vi.fn();
    let cancelled = false;
    expect(
      await RacingRenderer.prototype.prepare.call(
        typed,
        sample,
        progress,
        () => cancelled,
        async () => {
          // The stage must already be reported when the browser can repaint.
          expect(progress).toHaveBeenCalled();
          cancelled = true;
        },
      ),
    ).toBe(false);
    expect(target.bikeShells.update).toHaveBeenCalledTimes(bikeBuilds);
    expect(target.renderer.compileAsync).not.toHaveBeenCalled();
    expect(target.draw).not.toHaveBeenCalled();
    expect(target.preparation.snapshot()?.status).toBe('cancelled');
    expect(sample).toEqual(before);
  },
);
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
  expect(target.preparation.snapshot()?.status).toBe('cancelled');
  expect(target.draw).not.toHaveBeenCalled();
  expect(target.renderer.compileAsync).not.toHaveBeenCalled();
});
it('requires the complete selected circuit before a showroom can prepare driving', async () => {
  const { target, typed, sample } = fixture('mx450');
  Object.assign(target, { showroomOnly: true });
  const before = sample.slice();
  await expect(
    RacingRenderer.prototype.prepare.call(
      typed,
      sample,
      vi.fn(),
      () => false,
      async () => {},
    ),
  ).rejects.toThrow('Build the selected circuit before preparing a race');
  expect(target.cars).toHaveLength(0);
  expect(target.draw).not.toHaveBeenCalled();
  expect(target.renderer.compileAsync).not.toHaveBeenCalled();
  expect(sample).toEqual(before);
  expect(target.preparation.snapshot()?.status).toBe('failed');
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
  expect(target.preparation.snapshot()?.error).toBe('Shader failure');
  expect(target.renderer.getRenderTarget()).toBeNull();
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

it('never treats an unfinished GPU preparation deadline as successful completion', async () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const target = { gpuFrames: { ready: vi.fn(() => false) } } as unknown as RacingRenderer;
  try {
    await expect(
      RacingRenderer.prototype.waitForPreparedFrame.call(
        target,
        () => false,
        async () => {
          now += 45001;
        },
      ),
    ).rejects.toThrow('GPU preparation did not complete');
  } finally {
    clock.mockRestore();
  }
});

it('does not apply graphics or compile when preparation fails', async () => {
  const target = {
    disposed: false,
    waitForPreparedFrame: vi.fn(async () => {
      throw new Error('GPU preparation did not complete');
    }),
    setQuality: vi.fn(),
  };
  await expect(
    RacingRenderer.prototype.prepareQuality.call(
      target as unknown as RacingRenderer,
      'low',
      {} as never,
      () => false,
      async () => {},
    ),
  ).rejects.toThrow('GPU preparation did not complete');
  expect(target.setQuality).not.toHaveBeenCalled();
});
