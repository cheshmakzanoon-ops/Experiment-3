import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  SkyEnvironment,
  configureSky,
  lightingDirection,
  type LightingMode,
} from '../src/rendering/daylight.ts';
import { MENU_CLOUD_COVER, menuPreview } from '../src/rendering/menu-preview.ts';
import { SkyClouds } from '../src/rendering/studio/sky-clouds.ts';
import { H } from '../src/simulation/protocol.ts';
import { Track } from '../src/simulation/track.ts';
import { skyRendererDouble } from './sky-renderer-double.ts';

afterEach(() => vi.restoreAllMocks());
const track = new Track();

function skyCase(
  run: (value: {
    environment: SkyEnvironment;
    renderer: T.WebGLRenderer;
    scene: T.Scene;
    draws: string[];
  }) => void,
) {
  const sky = new Sky();
  configureSky(sky);
  const { renderer } = skyRendererDouble(),
    scene = new T.Scene(),
    clouds = SkyClouds.forSky(sky.material, lightingDirection),
    environment = new SkyEnvironment(sky, clouds),
    draws: string[] = [];
  // Rasterization is replaced; real cache selection, cloud construction,
  // target ownership and per-bin PMREM preparation still run.
  vi.spyOn(renderer, 'render').mockImplementation((object) => {
    draws.push(((object as T.Mesh).material as T.Material).name);
  });
  vi.spyOn(T.PMREMGenerator.prototype, 'fromScene').mockImplementation(() => {
    const target = new T.WebGLRenderTarget(8, 8);
    target.texture.mapping = T.CubeUVReflectionMapping;
    return target;
  });
  try {
    run({ environment, renderer, scene, draws });
  } finally {
    environment.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
  }
}

describe('initial showroom sky cache', () => {
  it.each([
    { highDetail: false, mode: 'day' },
    { highDetail: false, mode: 'night' },
    { highDetail: true, mode: 'day' },
    { highDetail: true, mode: 'sunset' },
  ] as const)(
    'reuses the prepared cloud field, panorama and radiance atlas at $mode / high=$highDetail',
    ({ highDetail, mode }: { highDetail: boolean; mode: LightingMode }) =>
      skyCase(({ environment, renderer, scene, draws }) => {
        environment.highDetail = highDetail;
        environment.update(renderer, scene, MENU_CLOUD_COVER, mode);
        const prepared = environment.diagnostics(),
          texture = scene.environment,
          submitted = draws.length;
        expect(prepared).toMatchObject({
          captures: 2,
          blends: 1,
          cachedBins: [0, 1],
          size: highDetail ? 256 : 128,
          clouds: { fieldBakes: 1, bakes: 1 },
        });
        for (const machine of ['apx01', 'gpr1', 'gpr2']) {
          const frame = menuPreview(track, track.length - 32, machine);
          expect(frame[H.CLOUD]).toBe(new Float32Array([0.12])[0]);
          expect(environment.update(renderer, scene, frame[H.CLOUD], mode)).toBe(false);
          expect(scene.environment).toBe(texture);
          expect(environment.diagnostics()).toEqual(prepared);
          expect(draws).toHaveLength(submitted);
        }
      }),
  );

  it('detects both the former missing-bin capture and an unquantized first-frame blend', () =>
    skyCase(({ environment, renderer, scene, draws }) => {
      const cover = menuPreview(track)[H.CLOUD];
      environment.update(renderer, scene, 0, 'day');
      expect(environment.diagnostics()).toMatchObject({
        captures: 1,
        blends: 0,
        clouds: { fieldBakes: 0, bakes: 0 },
      });
      expect(environment.update(renderer, scene, cover, 'day')).toBe(true);
      expect(environment.diagnostics()).toMatchObject({
        captures: 2,
        blends: 1,
        clouds: { fieldBakes: 1, bakes: 1 },
      });
      expect(draws).toEqual([
        'Sky cloud field bake',
        'Sky cloud panorama bake',
        'Snapshot-linear sky radiance',
      ]);
      // Using the decimal literal for preparation is still a cache miss,
      // because presentation reads the Float32 snapshot instead.
      environment.update(renderer, scene, 0.12, 'day');
      const before = environment.blends;
      expect(environment.update(renderer, scene, cover, 'day')).toBe(true);
      expect(environment.blends).toBe(before + 1);
      expect(environment.captures).toBe(2);
    }));
});
