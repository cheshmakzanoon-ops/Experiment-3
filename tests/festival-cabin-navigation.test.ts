import * as T from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { CabinNavigation, paintCabinNavigation } from '../src/rendering/open-world/cabin-navigation.ts';

const source = { width: 440, height: 440 } as HTMLCanvasElement;
const road = { name: 'Harbour Boulevard', roadClass: 'town', limitKmh: 50, onRoad: true, surface: 'asphalt' };
function context() {
  return { fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn() } as unknown as CanvasRenderingContext2D;
}
afterEach(() => vi.unstubAllGlobals());

it('shows the actual heading-up route, current road and posted limit on the physical screen', () => {
  const ctx = context();
  paintCabinNavigation(ctx, source, road);
  expect(ctx.fillText).toHaveBeenCalledWith(road.name, 13, 21, 310);
  expect(ctx.fillText).toHaveBeenCalledWith('50', 356, 21, 25);
  const [map, sx, sy, sw, sh, , , dw, dh] = vi.mocked(ctx.drawImage).mock.calls[0] as unknown as
    [HTMLCanvasElement, number, number, number, number, number, number, number, number];
  expect(map).toBe(source);
  expect(sw / sh).toBeCloseTo(dw / dh, 9);
  expect((source.width / 2 - sx) / sw).toBeCloseTo(0.5);
  expect((source.height / 2 - sy) / sh).toBeCloseTo(0.67);
  const offRoad = context();
  paintCabinNavigation(offRoad, source, { ...road, onRoad: false, name: 'Varda' });
  expect(offRoad.fillText).toHaveBeenCalledTimes(1);
});

it('holds a paused map, shows route and garage changes immediately, and releases the texture', () => {
  const ctx = context();
  const createElement = vi.fn(() => ({ width: 0, height: 0, getContext: () => ctx }));
  vi.stubGlobal('document', { createElement });
  const nav = new CabinNavigation(), backing = new T.MeshStandardMaterial();
  const pane = new T.Mesh(new T.PlaneGeometry(0.226, 0.1271), backing);
  const second = pane.clone();
  const update = (target: T.Mesh, t: number, x: number, route = '', night = 0) =>
    nav.update(target, source, road, t, x, 10, 0.1, route, 3, night);
  update(pane, 0, 2);
  const live = pane.material as unknown as T.MeshBasicMaterial;
  expect(nav.uploads).toBe(1);
  update(pane, 0.06, 3);
  expect(nav.uploads).toBe(1);
  update(pane, 0.13, 3);
  expect(nav.uploads).toBe(2);
  update(pane, 1, 3);
  expect(nav.uploads).toBe(2);
  update(pane, 1, 3, 'harbour-welcome');
  expect(nav.uploads).toBe(3);
  const day = live.color.r;
  update(pane, 1, 3, 'harbour-welcome', 1);
  expect(live.color.r).toBeLessThan(day * 0.6);
  expect(nav.uploads).toBe(3);
  update(second, 1, 3, 'harbour-welcome');
  expect(pane.material).toBe(backing);
  expect(pane.visible).toBe(false);
  expect(second.visible).toBe(true);
  expect(second.material).toBe(live);
  expect(createElement).toHaveBeenCalledTimes(1);
  update(second, 0.1, -550);
  expect(nav.uploads).toBe(5);
  const freed = vi.fn();
  live.map!.addEventListener('dispose', freed);
  nav.dispose(); nav.dispose();
  expect(freed).toHaveBeenCalledTimes(1);
  expect(second.material).toBe(backing);
  pane.geometry.dispose(); backing.dispose();
});
