import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FestivalRenderer } from '../src/rendering/open-world/festival-renderer.ts';
import { SolvaneDetails } from '../src/rendering/open-world/solvane-details.ts';
import { StreetDetails } from '../src/rendering/open-world/street-details.ts';
import { VegetationLibrary } from '../src/rendering/vegetation/library.ts';

const renderers: {
  renderer: FestivalRenderer;
  owned: { dispose: ReturnType<typeof vi.fn> }[];
}[] = [];

afterEach(() => {
  for (const { renderer, owned } of renderers.splice(0)) {
    renderer.dispose();
    for (const resource of owned) expect(resource.dispose).toHaveBeenCalledOnce();
  }
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function asset(trees = true) {
  const root = new T.Group();
  return {
    root,
    aero: new T.Group(),
    trees: trees ? [{}] : [],
    stats: { boats: 3 },
    flagTemplate: vi.fn(() => new T.Group()),
    dispose: vi.fn(() => root.removeFromParent()),
  };
}

/** Exercise the real loader entry points and terminal dispose method without
 * constructing a WebGL context, scene assets, workers or network requests. */
function fixture() {
  const disposable = () => ({ dispose: vi.fn() });
  const state = {
    disposed: false,
    renderer: {},
    world: { field: { height: vi.fn(() => 12) } },
    structures: [],
    preset: 'high',
    scene: new T.Scene(),
    sky: { geometry: disposable(), material: disposable() },
    sun: { shadow: disposable() },
    photoVegetation: null,
    photoLoading: null,
    details: null,
    detailLoading: null,
    streetDetails: null,
    streetLoading: null,
    atmosphere: { ...disposable(), install: vi.fn() },
    dressing: {
      ...disposable(),
      stats: { boats: 3 },
      usePhotoVegetation: vi.fn(),
      useAuthoredBoats: vi.fn(),
    },
    vegetation: { ...disposable(), setPhotoLibrary: vi.fn() },
    shadows: { ...disposable(), invalidate: vi.fn() },
    streetLights: { ...disposable(), invalidate: vi.fn() },
    reflection: { ...disposable(), sceneryChanged: vi.fn(), probeExclusions: [] },
    guidance: { ...disposable(), useFlagTemplate: vi.fn() },
    terrain: disposable(),
    roads: disposable(),
    practicalLights: disposable(),
    buildings: disposable(),
    crops: disposable(),
    contacts: disposable(),
    water: disposable(),
    markers: disposable(),
    cars: disposable(),
    trails: disposable(),
    orbit: disposable(),
    environment: disposable(),
    wet: disposable(),
    bloom: disposable(),
    outputPass: disposable(),
    grade: disposable(),
    fxaa: disposable(),
    imagePipeline: disposable(),
    ultra: disposable(),
    photoSky: disposable(),
    composer: disposable(),
    vehiclePaint: [],
    vehicleRoots: [],
    effectPlayback: { reset: vi.fn() },
    effects: { group: new T.Group() },
  };
  const renderer = Object.assign(
    Object.create(FestivalRenderer.prototype),
    state,
  ) as FestivalRenderer;
  renderers.push({
    renderer,
    owned: [state.sky.geometry, state.sky.material, state.sun.shadow, state.outputPass],
  });
  return { renderer, state };
}

const kinds = ['photographic', 'authored', 'street'] as const;
type Kind = (typeof kinds)[number];

function loader(kind: Kind, renderer: FestivalRenderer) {
  const pending = deferred<ReturnType<typeof asset>>();
  const load = vi.fn(() => pending.promise);
  if (kind === 'photographic') {
    vi.spyOn(VegetationLibrary, 'load').mockImplementation(
      () => load() as unknown as Promise<VegetationLibrary>,
    );
  } else if (kind === 'authored') {
    vi.spyOn(SolvaneDetails, 'load').mockImplementation(
      () => load() as unknown as Promise<SolvaneDetails>,
    );
  } else {
    vi.spyOn(StreetDetails, 'load').mockImplementation(
      () => load() as unknown as Promise<StreetDetails>,
    );
  }
  const start = () => {
    if (kind === 'photographic') return renderer.loadPhotoVegetation();
    if (kind === 'authored') return renderer.loadAuthoredDetails();
    return renderer.loadStreetDetails();
  };
  const installed = () => {
    if (kind === 'photographic') return renderer.photoVegetation;
    if (kind === 'authored') return renderer.details;
    return renderer.streetDetails;
  };
  return { pending, load, start, installed };
}

function expectNoInstallation(state: ReturnType<typeof fixture>['state']) {
  expect(state.scene.children).toHaveLength(0);
  expect(state.atmosphere.install).not.toHaveBeenCalled();
  expect(state.dressing.usePhotoVegetation).not.toHaveBeenCalled();
  expect(state.dressing.useAuthoredBoats).not.toHaveBeenCalled();
  expect(state.vegetation.setPhotoLibrary).not.toHaveBeenCalled();
  expect(state.guidance.useFlagTemplate).not.toHaveBeenCalled();
  expect(state.reflection.probeExclusions).toHaveLength(0);
  expect(state.shadows.invalidate).not.toHaveBeenCalled();
  expect(state.streetLights.invalidate).not.toHaveBeenCalled();
  expect(state.reflection.sceneryChanged).not.toHaveBeenCalled();
}

describe.each(kinds)('Festival %s loader lifetime', (kind) => {
  it('does not start work after renderer disposal', async () => {
    const { renderer, state } = fixture();
    const h = loader(kind, renderer);
    h.load.mockResolvedValue(asset());
    renderer.dispose();

    expect(await h.start()).toBe(false);
    expect(h.load).not.toHaveBeenCalled();
    expect(h.installed()).toBeNull();
    expectNoInstallation(state);
  });

  it('releases a result resolved just before disposal without installing it', async () => {
    const { renderer, state } = fixture();
    const h = loader(kind, renderer);
    const resource = asset();
    const result = h.start();
    // The loader has finished, but its installation continuation has not run.
    h.pending.resolve(resource);
    renderer.dispose();

    expect(await result).toBe(false);
    expect(resource.dispose).toHaveBeenCalledTimes(1);
    expect(h.installed()).toBeNull();
    expectNoInstallation(state);
    renderer.dispose();
    expect(resource.dispose).toHaveBeenCalledTimes(1);
  });

  it('settles a pending rejection quietly after disposal and stays closed', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { renderer, state } = fixture();
    const h = loader(kind, renderer);
    const result = h.start();
    renderer.dispose();
    h.pending.reject(new Error('download interrupted'));

    expect(await result).toBe(false);
    expect(warning).not.toHaveBeenCalled();
    h.load.mockResolvedValue(asset());
    expect(await h.start()).toBe(false);
    expect(h.load).toHaveBeenCalledTimes(1);
    expectNoInstallation(state);
  });

  it('shares concurrent work, preserves installation, and disposes its owner once', async () => {
    const { renderer, state } = fixture();
    const h = loader(kind, renderer);
    const resource = asset();
    const first = h.start();
    const second = h.start();
    expect(h.load).toHaveBeenCalledTimes(1);
    h.pending.resolve(resource);

    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(h.installed()).toBe(resource);
    expect(resource.dispose).not.toHaveBeenCalled();
    expect(state.shadows.invalidate).toHaveBeenCalledTimes(1);
    expect(state.streetLights.invalidate).toHaveBeenCalledTimes(1);
    expect(state.reflection.sceneryChanged).toHaveBeenCalledTimes(1);
    if (kind === 'photographic') {
      expect(state.dressing.usePhotoVegetation).toHaveBeenCalledExactlyOnceWith(resource);
      expect(state.vegetation.setPhotoLibrary).toHaveBeenCalledExactlyOnceWith(
        resource,
        expect.any(Function),
      );
    } else {
      expect(state.atmosphere.install).toHaveBeenCalledExactlyOnceWith(resource.root);
      expect(resource.root.parent).toBe(state.scene);
      if (kind === 'authored') {
        expect(resource.flagTemplate).toHaveBeenCalledExactlyOnceWith(false);
        expect(state.guidance.useFlagTemplate).toHaveBeenCalledExactlyOnceWith(
          resource.flagTemplate.mock.results[0].value,
        );
        expect(state.reflection.probeExclusions).toEqual([resource.aero]);
        expect(state.dressing.useAuthoredBoats).toHaveBeenCalledTimes(1);
      }
    }
    // Keep the existing return contract for an already-installed resource.
    expect(await h.start()).toBe(kind !== 'photographic');
    expect(h.load).toHaveBeenCalledTimes(1);
    renderer.dispose();
    renderer.dispose();
    expect(resource.dispose).toHaveBeenCalledTimes(1);
    expect(h.installed()).toBeNull();
  });

  it('allows a live renderer to retry a failed load', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { renderer } = fixture();
    const h = loader(kind, renderer);
    const result = h.start();
    h.pending.reject(new Error('temporary download failure'));

    expect(await result).toBe(false);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(h.installed()).toBeNull();
    const resource = asset();
    h.load.mockResolvedValue(resource);
    expect(await h.start()).toBe(true);
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(h.installed()).toBe(resource);
  });
});

it('releases an empty photographic library and allows another attempt', async () => {
  const { renderer, state } = fixture();
  const h = loader('photographic', renderer);
  const empty = asset(false);
  h.load.mockResolvedValueOnce(empty);

  expect(await h.start()).toBe(false);
  expect(empty.dispose).toHaveBeenCalledTimes(1);
  expect(h.installed()).toBeNull();
  expectNoInstallation(state);
  const resource = asset();
  h.load.mockResolvedValue(resource);
  expect(await h.start()).toBe(true);
  expect(h.installed()).toBe(resource);
  expect(h.load).toHaveBeenCalledTimes(2);
  renderer.dispose();
  expect(empty.dispose).toHaveBeenCalledTimes(1);
  expect(resource.dispose).toHaveBeenCalledTimes(1);
});

it.each(['low', 'medium'] as const)('keeps photographic loading disabled on %s', async (preset) => {
  const { renderer, state } = fixture();
  const h = loader('photographic', renderer);
  renderer.preset = preset;

  expect(await h.start()).toBe(false);
  expect(h.load).not.toHaveBeenCalled();
  expectNoInstallation(state);
});
