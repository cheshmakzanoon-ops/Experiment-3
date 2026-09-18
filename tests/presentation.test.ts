import { afterEach, expect, it, vi } from 'vitest';
import * as T from 'three';
import { graphicsPreset, validateGraphics, bufferSize } from '../src/rendering/options.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { InputPump } from '../src/input/pump.ts';
import { TextureBudget } from '../src/rendering/texture-budget.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each([1, 2, 3])('migrates version %i without losing controls or setup', (version) => {
  const old = structuredClone(DEFAULT_SETTINGS);
  const saved = {
    ...old,
    version,
    quality: 'high',
    bindings: { ...old.bindings, throttle: 'KeyI' },
  };
  const migrated = validateSettings(saved);
  expect(migrated.version).toBe(4);
  expect(migrated.graphics).toEqual(graphicsPreset('high'));
  expect(migrated.bindings.throttle).toBe('KeyI');
  expect(migrated.setup).toEqual(old.setup);
});
it('preserves independent quality controls through version-four serialization', () => {
  const saved = structuredClone(DEFAULT_SETTINGS);
  Object.assign(saved.graphics, {
    resolutionScale: 0.55,
    textureSize: 128,
    shadowSize: 512,
    reflections: 'local',
    particleDensity: 0.2,
    crowd: false,
    bloom: true,
    antialias: false,
    anisotropy: 4,
  });
  saved.colorblind = true;
  saved.highContrast = true;
  expect(validateSettings(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
});
it('bounds every numeric budget and rejects unsupported quality values', () => {
  const g = validateGraphics(
    {
      resolutionScale: Infinity,
      textureSize: 12345,
      shadowSize: 999,
      particleDensity: -8,
      vegetationDensity: 10,
      anisotropy: 999,
      reflections: 'magic',
      antialias: 'false',
    },
    'medium',
  );
  expect(g.resolutionScale).toBe(1);
  expect(g.textureSize).toBe(512);
  expect(g.shadowSize).toBe(1024);
  expect(g.particleDensity).toBe(0);
  expect(g.vegetationDensity).toBe(1);
  expect(g.anisotropy).toBe(8);
  expect(g.reflections).toBe('environment');
  expect(g.antialias).toBe(true);
});
it('calculates bounded physical pixels without changing aspect ratio', () => {
  expect(bufferSize(1920, 1080, 0.5, 8192)).toEqual({ width: 960, height: 540 });
  expect(bufferSize(8000, 4000, 2, 4096)).toEqual({ width: 4096, height: 2048 });
  expect(() => bufferSize(NaN, 100, 1, 4096)).toThrow();
});
it('samples input without any animation callbacks and stops cleanly', () => {
  vi.useFakeTimers();
  const sample = vi.fn();
  let now = 1000;
  const pump = new InputPump(sample, () => now);
  pump.start();
  pump.start();
  now += 20;
  vi.advanceTimersByTime(20);
  expect(sample).toHaveBeenCalledTimes(1);
  expect(sample).toHaveBeenLastCalledWith(0.02);
  now += 5000;
  pump.poll();
  expect(sample).toHaveBeenLastCalledWith(0.25);
  pump.dispose();
  const count = sample.mock.calls.length;
  vi.advanceTimersByTime(2000);
  expect(sample).toHaveBeenCalledTimes(count);
});
it('resizes immutable texture assets but never live displays and can restore resolution', () => {
  class Canvas {
    width = 1024;
    height = 512;
    getContext() {
      return { drawImage: vi.fn() };
    }
  }
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  const original = new Canvas() as unknown as HTMLCanvasElement;
  const map = new T.CanvasTexture(original);
  const display = new T.CanvasTexture(new Canvas() as unknown as HTMLCanvasElement);
  display.userData.dynamic = true;
  const group = new T.Group();
  group.add(new T.Mesh(new T.PlaneGeometry(), new T.MeshBasicMaterial({ map })));
  group.add(new T.Mesh(new T.PlaneGeometry(), new T.MeshBasicMaterial({ map: display })));
  const budget = new TextureBudget();
  budget.register(group);
  budget.configure(128, 2);
  expect(map.image.width).toBe(128);
  expect(map.image.height).toBe(64);
  expect(display.image.width).toBe(1024);
  expect(map.anisotropy).toBe(2);
  budget.configure(1024, 16);
  expect(map.image).toBe(original);
  expect(map.anisotropy).toBe(16);
  budget.dispose();
});
