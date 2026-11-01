import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { BannerPreparation } from '../src/engine/babylon/banner-preparation.ts';
import {
  createBabylonStartBanner,
  type BabylonStartBannerOptions,
} from '../src/engine/babylon/start-banner.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import { RestartOwnership } from '../src/engine/babylon/restart-ownership.ts';
import { Track } from '../src/simulation/track.ts';
import { VELLAMAR } from '../src/simulation/circuits.ts';
import { FORMULA_APX01 } from '../src/simulation/vehicles.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
/** Deterministic RGBA is synthetic CPU input, NOT original Arial rasterization
 * or a GPU/image comparison. Original drawing COMMANDS are compared separately. */
function pixels(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data.set([x % 256, y % 256, (x + y) % 256, 255], offset);
    }
  return data;
}
interface CanvasRecord {
  canvas: HTMLCanvasElement;
  commands: unknown[][];
  reads: unknown[][];
}
function canvasDocument() {
  const records: CanvasRecord[] = [];
  const createElement = vi.fn((tag: string) => {
    if (tag !== 'canvas') throw new Error('Unexpected element');
    const commands: unknown[][] = [],
      reads: unknown[][] = [];
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const target = {
      fillRect: (...args: unknown[]) => commands.push(['fillRect', ...args]),
      fillText: (...args: unknown[]) => commands.push(['fillText', ...args]),
      getImageData: (...args: unknown[]) => {
        reads.push(args);
        return {
          data: pixels(canvas.width, canvas.height),
          width: canvas.width,
          height: canvas.height,
        };
      },
    };
    const drawing = new Proxy(target, {
      set(object, key, value) {
        commands.push([String(key), value]);
        Reflect.set(object, key, value);
        return true;
      },
    });
    canvas.getContext = vi.fn(() => drawing) as unknown as HTMLCanvasElement['getContext'];
    records.push({ canvas, commands, reads });
    return canvas;
  });
  vi.stubGlobal('document', {
    createElement,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  return { records, createElement };
}
function allocateTexture(data: Uint8Array, width: number, height: number, scene: Scene) {
  const texture = new RawTexture(
    data,
    width,
    height,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    0,
    true,
  );
  texture.getInternalTexture()!._useSRGBBuffer = true;
  texture.gammaSpace = false;
  return texture;
}

function harness() {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    abort = new AbortController();
  scene.useRightHandedSystem = true;
  engine.getCaps().supportSRGBBuffers = true;
  canvasDocument();
  const stage = deferred(),
    presented = deferred();
  let current = true;
  const options: BabylonStartBannerOptions = {
    scene,
    track: new Track(),
    context: { presentation: 'circuit', vehicles: [FORMULA_APX01] },
    signal: abort.signal,
    deadline: performance.now() + 120000,
    schedule: new PresentationSchedule(),
    isCurrent: () => current,
    gpu: {
      prepare: async (
        _label: string,
        deadline: number,
        work: (signal: AbortSignal) => Promise<unknown>,
      ) => {
        expect(deadline).toBe(options.deadline);
        return work(new AbortController().signal);
      },
    } as unknown as BabylonStartBannerOptions['gpu'],
  };
  let owner: Awaited<ReturnType<typeof createBabylonStartBanner>> | undefined;
  const load = vi.fn(async (opts: BabylonStartBannerOptions) => {
    expect(opts).toBe(options);
    owner = await createBabylonStartBanner(opts, {
      allocateTexture,
      prepare: async (_container, gpu, signal, deadline) => {
        expect(gpu).toBe(options.gpu);
        expect(signal).toBe(abort.signal);
        expect(deadline).toBe(options.deadline);
        await stage.promise;
      },
      present: async (_scene, signal) => {
        await presented.promise;
        signal.throwIfAborted();
      },
    });
    return owner;
  });
  cleanups.push(() => {
    abort.abort();
    owner?.dispose();
    scene.dispose();
    engine.dispose();
  });
  return {
    options,
    scene,
    abort,
    stage,
    presented,
    load,
    owner: () => owner!,
    stale: () => {
      current = false;
    },
  };
}
it('stages separately, blocks inter-variant draws and awaits install presentation without deadlock', async () => {
  const h = harness(),
    banner = new BannerPreparation(h.options, h.load);
  await flush();
  expect(banner.canDraw).toBe(false);
  expect(banner.completed).toBe(false);
  expect(h.scene.meshes).toHaveLength(0);
  expect(() => banner.receipt()).toThrow('not ready');
  h.stage.resolve();
  await flush();
  expect(banner.canDraw).toBe(true);
  expect(banner.completed).toBe(false);
  expect(h.scene.meshes).toHaveLength(1);
  h.presented.resolve();
  await banner.completion;
  expect(banner.receipt()).toEqual({
    state: 'ready',
    parts: 1,
    materials: 1,
    textures: 1,
    triangles: 2,
    width: 512,
    height: 128,
    hardwareSrgb: 1,
  });
  expect(h.scene.lights).toHaveLength(0);
  expect(h.scene.environmentTexture).toBeNull();
});
it.each(['abort', 'stale', 'dispose'] as const)(
  'drains staged resources after %s without publishing',
  async (reason) => {
    const h = harness(),
      banner = new BannerPreparation(h.options, h.load);
    const failed = expect(banner.completion).rejects.toThrow();
    await flush();
    if (reason === 'abort') h.abort.abort();
    else if (reason === 'stale') h.stale();
    else banner.dispose();
    h.stage.resolve();
    await failed;
    expect(banner.completed).toBe(false);
    expect(banner.canDraw).toBe(false);
    expect(h.scene.meshes).toHaveLength(0);
    expect(h.scene.materials).toHaveLength(0);
  },
);
it.each(['abort', 'stale'] as const)(
  'cannot publish an installing owner after %s',
  async (reason) => {
    const h = harness(),
      banner = new BannerPreparation(h.options, h.load);
    const failed = expect(banner.completion).rejects.toThrow();
    h.stage.resolve();
    await flush();
    if (reason === 'abort') h.abort.abort();
    else h.stale();
    h.presented.resolve();
    await failed;
    expect(banner.completed).toBe(false);
    expect(h.scene.meshes).toHaveLength(0);
  },
);
it('does not allocate banner in ineligible contexts', async () => {
  const h = harness();
  h.options.track = new Track('clear', false, undefined, VELLAMAR);
  const banner = new BannerPreparation(h.options, h.load);
  await banner.completion;
  expect(h.load).not.toHaveBeenCalled();
  expect(banner.completed).toBe(true);
  expect(banner.receipt()).toEqual({
    state: 'ineligible',
    parts: 0,
    materials: 0,
    textures: 0,
    triangles: 0,
    width: 0,
    height: 0,
    hardwareSrgb: 0,
  });
});
it('preserves immediate repeated restart authority while scene replacement waits for GPU drain', async () => {
  const h = harness(),
    banner = new BannerPreparation(h.options, h.load);
  const failed = expect(banner.completion).rejects.toThrow();
  const reset = vi.fn(() => ({})),
    restart = new RestartOwnership(() => h.abort.abort(), reset);
  await flush();
  restart.request();
  restart.request();
  const rebuild = vi.fn(() => banner.dispose());
  expect(restart.drain(false, rebuild)).toBe(false);
  expect(h.abort.signal.aborted).toBe(true);
  h.stage.resolve();
  await failed;
  expect(restart.drain(true, rebuild)).toBe(true);
  expect(rebuild).toHaveBeenCalledWith(reset.mock.results[1].value);
  expect(reset).toHaveBeenCalledTimes(2);
  expect(banner.completed).toBe(false);
});
it('explicitly drains independent banner ownership after skipped scene callbacks and falsy cleanup failure', async () => {
  const h = harness(),
    banner = new BannerPreparation(h.options, h.load);
  h.stage.resolve();
  h.presented.resolve();
  await banner.completion;
  const { mesh } = h.owner().diagnostics();
  h.scene.onDisposeObservable.add((_scene, event) => {
    event.skipNextObservers = true;
  });
  h.scene.onDisposeObservable.add(() => {
    throw new Error('must be skipped');
  });
  h.scene.dispose();
  expect(banner.completed).toBe(false);
  banner.dispose();
  expect(mesh.isDisposed()).toBe(true);
  expect(() => banner.receipt()).toThrow();
});
it('retains fail-closed readiness if explicit owner cleanup throws, and does not skip independent resources', async () => {
  const h = harness(),
    banner = new BannerPreparation(h.options, h.load);
  h.stage.resolve();
  h.presented.resolve();
  await banner.completion;
  const { mesh, material } = h.owner().diagnostics();
  vi.spyOn(material, 'dispose').mockImplementation(() => {
    throw undefined;
  });
  let threw = false;
  try {
    banner.dispose();
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
  expect(banner.completed).toBe(false);
  expect(h.scene.meshes).toHaveLength(0);
  expect(mesh.isDisposed()).toBe(true);
});
it.each(['material', 'texture', 'srgb', 'dimensions', 'triangles'] as const)(
  'rejects changed actual %s bindings or allocation',
  async (field) => {
    const h = harness(),
      banner = new BannerPreparation(h.options, h.load);
    h.stage.resolve();
    h.presented.resolve();
    await banner.completion;
    const { mesh, material, texture } = h.owner().diagnostics();
    if (field === 'material') h.scene.removeMaterial(material);
    if (field === 'texture') material.albedoTexture = null;
    if (field === 'srgb') texture.getInternalTexture()!._useSRGBBuffer = false;
    if (field === 'dimensions')
      vi.spyOn(texture, 'getSize').mockReturnValue({ width: 128, height: 512 });
    if (field === 'triangles') vi.spyOn(mesh, 'getTotalIndices').mockReturnValue(3);
    expect(() => banner.receipt()).toThrow('activation incomplete');
  },
);
it('wires banner after structural readiness under the existing deadline and keeps GPU receipts independent', () => {
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  const startup = source.slice(
    source.indexOf('function rebuildScene'),
    source.indexOf("window.addEventListener('pagehide'"),
  );
  expect(startup.match(/performance.now\(\) \+ 120000/g)).toHaveLength(1);
  expect(startup.indexOf('new BannerPreparation')).toBeGreaterThan(
    startup.indexOf('await lamps.completion'),
  );
  expect(startup.indexOf('loadAsset.disabled = false')).toBeGreaterThan(
    startup.indexOf('await banner.completion'),
  );
  expect(startup.slice(startup.indexOf('await banner.completion'))).toContain(
    'requestPresentation()',
  );
  expect(source).toContain("mode: 'practice'");
  expect(source).toContain('!bannerPreparation?.completed');
  expect(source).toContain('(!bannerPreparation || bannerPreparation.canDraw)');
  expect(source).toContain('return readyBefore && readyAfter;');
  expect(source.match(/\(\) => bannerPreparation\?\.dispose\(\)/g)).toHaveLength(2);
  for (const field of [
    'bannerState',
    'bannerParts',
    'bannerMaterials',
    'bannerTextures',
    'bannerTriangles',
    'bannerWidth',
    'bannerHeight',
    'bannerHardwareSrgb',
  ])
    expect(
      source.slice(
        source.indexOf('function clearSurfaceDiagnostics'),
        source.indexOf('function publishLampDiagnostics'),
      ),
    ).toContain(`'${field}'`);
});
it('never renews an expired startup deadline or allocates after expiry', async () => {
  const h = harness();
  h.options.deadline = performance.now() - 1;
  const banner = new BannerPreparation(h.options, h.load);
  await expect(banner.completion).rejects.toThrow('deadline exceeded');
  expect(h.load).not.toHaveBeenCalled();
  expect(banner.canDraw).toBe(false);
});
it('rejects expired install receipts under the same original budget', async () => {
  const h = harness(),
    banner = new BannerPreparation(h.options, h.load);
  const failed = expect(banner.completion).rejects.toThrow('deadline exceeded');
  h.stage.resolve();
  await flush();
  h.options.deadline = performance.now() - 1;
  h.presented.resolve();
  await failed;
  expect(banner.completed).toBe(false);
  expect(h.scene.meshes).toHaveLength(0);
});
it('preserves a falsy primary failure even when independent cleanup also fails', async () => {
  const h = harness();
  const cleanup = vi.fn(() => {
    throw new Error('secondary cleanup');
  });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const owner = {
    install: async () => {
      throw undefined;
    },
    dispose: cleanup,
  } as unknown as Awaited<ReturnType<typeof createBabylonStartBanner>>;
  const banner = new BannerPreparation(h.options, async () => owner);
  await expect(banner.completion).rejects.toBeUndefined();
  expect(cleanup).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalled();
  expect(banner.completed).toBe(false);
  expect(banner.canDraw).toBe(false);
});
