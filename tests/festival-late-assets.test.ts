import { afterEach, expect, it, vi } from 'vitest';
import { FestivalRenderer } from '../src/rendering/open-world/festival-renderer.ts';
import { VegetationLibrary } from '../src/rendering/vegetation/library.ts';
import { SolvaneDetails } from '../src/rendering/open-world/solvane-details.ts';
afterEach(() => vi.restoreAllMocks());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it('disposes photographic vegetation resolving after its renderer closed', async () => {
  const pending = deferred<VegetationLibrary>();
  const load = vi.spyOn(VegetationLibrary, 'load').mockReturnValue(pending.promise);
  const library = { trees: [{}], dispose: vi.fn() };
  const target = {
    disposed: false,
    preset: 'high',
    photoVegetation: null,
    renderer: {},
    dressing: { usePhotoVegetation: vi.fn() },
    vegetation: { setPhotoLibrary: vi.fn() },
  };
  const result = FestivalRenderer.prototype.loadPhotoVegetation.call(
    target as unknown as FestivalRenderer,
  );
  expect(load).toHaveBeenCalledTimes(1);
  target.disposed = true;
  pending.resolve(library as unknown as VegetationLibrary);
  expect(await result).toBe(false);
  expect(library.dispose).toHaveBeenCalledTimes(1);
  expect(target.photoVegetation).toBeNull();
  expect(target.dressing.usePhotoVegetation).not.toHaveBeenCalled();
  expect(target.vegetation.setPhotoLibrary).not.toHaveBeenCalled();
});
it('disposes authored details when teardown wins the loader-to-installer handoff', async () => {
  const pending = deferred<SolvaneDetails>();
  vi.spyOn(SolvaneDetails, 'load').mockReturnValue(pending.promise);
  const kit = { dispose: vi.fn() };
  const target = {
    disposed: false,
    details: null,
    detailLoading: null,
    world: {},
    structures: [],
    atmosphere: { install: vi.fn() },
    scene: { add: vi.fn() },
  };
  const result = FestivalRenderer.prototype.loadAuthoredDetails.call(
    target as unknown as FestivalRenderer,
  );
  target.disposed = true;
  pending.resolve(kit as unknown as SolvaneDetails);
  expect(await result).toBe(false);
  expect(kit.dispose).toHaveBeenCalledTimes(1);
  expect(target.details).toBeNull();
  expect(target.detailLoading).toBeNull();
  expect(target.atmosphere.install).not.toHaveBeenCalled();
  expect(target.scene.add).not.toHaveBeenCalled();
});
it('does not begin either loader after disposal', async () => {
  const photo = vi.spyOn(VegetationLibrary, 'load'),
    details = vi.spyOn(SolvaneDetails, 'load');
  const target = { disposed: true } as unknown as FestivalRenderer;
  expect(await FestivalRenderer.prototype.loadPhotoVegetation.call(target)).toBe(false);
  expect(await FestivalRenderer.prototype.loadAuthoredDetails.call(target)).toBe(false);
  expect(photo).not.toHaveBeenCalled();
  expect(details).not.toHaveBeenCalled();
});
