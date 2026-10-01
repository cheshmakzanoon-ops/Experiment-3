import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { feedDetailDistance, detailDistance } from '../src/rendering/view-detail.ts';
import { carLod, type ReducedCar } from '../src/rendering/lod.ts';
import { MirrorViews } from '../src/rendering/mirrors.ts';
import { mergeCensus } from '../src/rendering/render-census.ts';
import { FormulaCar } from '../src/rendering/car.ts';
import { HeroShells } from '../src/rendering/hero-shells.ts';
import { DriverAsset } from '../src/rendering/driver-asset.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, W, WHEEL_BASE, carBase } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';

it('measures a mirror reflection by its size in the feed, relative to the main view', () => {
  // A 512 x 192 mirror under a 1080-row main view: a rival 10 m behind is as
  // large as one 39 m away in the main view, 30 m behind as one 117 m away.
  const mirror = (d: number) => feedDetailDistance(d, 42, 8 / 3, 192, 1080);
  expect(mirror(10)).toBeCloseTo(detailDistance(10, 42, 8 / 3) * 5.625, 9);
  expect(mirror(10)).toBeGreaterThan(38);
  expect(mirror(10)).toBeLessThan(40);
  // At High: full detail 8 m behind, the middle level at 30 m, coarsest at 60 m.
  expect(carLod(mirror(8), 0, 'high', false)).toBe(0);
  expect(carLod(mirror(30), 0, 'high', false)).toBe(1);
  expect(carLod(mirror(60), 0, 'high', false)).toBe(2);
  // A feed never chooses less detail than its pixels allow (no upscaling).
  expect(feedDetailDistance(10, 58, 16 / 9, 2160, 1080)).toBe(10);
  expect(() => feedDetailDistance(10, 42, 2, 0, 1080)).toThrow('Invalid detail feed');
});

it('chooses detail per mirror pass and restores it, even when a pass throws', () => {
  const views = new MirrorViews();
  const surfaces = [0, 1].map(() => new T.Mesh(new T.PlaneGeometry(), new T.MeshBasicMaterial()));
  const root = new T.Group();
  surfaces.forEach((s) => root.add(s));
  views.bind(surfaces);
  views.quality('high');
  const calls: string[] = [];
  views.detail = {
    before: (camera, height) => calls.push(`before ${views.cameras.indexOf(camera)} ${height}`),
    after: () => calls.push('after'),
  };
  let fail = false;
  const renderer = {
    shadowMap: { autoUpdate: true, needsUpdate: false },
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getViewport: (v: T.Vector4) => v,
    getScissor: (v: T.Vector4) => v,
    getScissorTest: () => false,
    setRenderTarget() {},
    setViewport() {},
    setScissor() {},
    setScissorTest() {},
    clear() {},
    render: vi.fn(() => {
      calls.push('render');
      if (fail) throw new Error('lost');
    }),
  } as unknown as T.WebGLRenderer;
  // After a discontinuity both feeds render in one update.
  views.render(renderer, new T.Scene(), root, 1 / 60);
  expect(calls).toEqual(['before 0 192', 'render', 'after', 'before 1 192', 'render', 'after']);
  calls.length = 0;
  fail = true;
  views.invalidate();
  expect(() => views.render(renderer, new T.Scene(), root, 1 / 60)).toThrow('lost');
  expect(calls).toEqual(['before 0 192', 'render', 'after']);
  views.dispose();
});

it('sums census tables per owner', () => {
  expect(
    mergeCensus([
      [
        { owner: 'a', draws: 3, instances: 3 },
        { owner: 'b', draws: 1, instances: 1 },
      ],
      [{ owner: 'b', draws: 5, instances: 2 }],
    ]),
  ).toEqual([
    { owner: 'b', draws: 6, instances: 3 },
    { owner: 'a', draws: 3, instances: 3 },
  ]);
});

it('keeps coarser representations posed and damaged while a rival is at full detail', async () => {
  const context = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 8 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient')
        return () => ({ addColorStop() {} });
      return () => undefined;
    },
  });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  const hero = await HeroShells.decode(
    new Uint8Array(readFileSync('src/rendering/apx01-shell.glb.gz')),
  );
  const driver = await DriverAsset.decode(
    new Uint8Array(readFileSync('src/rendering/apx01-driver.glb.gz')),
  );
  const car = new FormulaCar(1, hero, driver);
  const reduced = (car as unknown as { reduced: ReducedCar[] }).reduced;
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 3 });
  const frame = sim.makeFrame(),
    o = carBase(1);
  frame[o + WHEEL_BASE + W.STEER] = 0.3;
  frame[o + F.FRONT_HEALTH] = 0.05;
  car.setLod(10, 'high', false);
  expect(car.lodLevel).toBe(0);
  car.update(frame, frame, o, 1, 1 / 60, 0, false);
  for (const representation of reduced) {
    expect(representation.wheels[0].rotation.y).toBeCloseTo(0.3, 6);
    // A lost front wing is gone from every representation a mirror can show.
    expect(representation.front.visible).toBe(false);
  }
  // Showing a coarser level leaves the chosen LOD alone; restoring is exact.
  car.showDetail(2);
  expect(car.lodLevel).toBe(0);
  expect(reduced.map((r) => r.root.visible)).toEqual([false, true]);
  car.showDetail(car.lodLevel);
  expect(reduced.map((r) => r.root.visible)).toEqual([false, false]);
  expect(() => car.showDetail(3)).toThrow('Invalid car detail level');
  // At the middle level the coarsest representation is still kept current.
  car.setLod(100, 'high', false);
  frame[o + WHEEL_BASE + W.STEER] = -0.2;
  car.update(frame, frame, o, 1, 1 / 60, 0, false);
  expect(reduced[1].wheels[0].rotation.y).toBeCloseTo(-0.2, 6);
  hero.dispose();
  driver.dispose();
  vi.unstubAllGlobals();
});
