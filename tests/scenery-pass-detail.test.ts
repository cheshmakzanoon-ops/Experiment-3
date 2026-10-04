import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { sceneryPassDistance, SceneryPassDetail } from '../src/rendering/scenery-pass-detail.ts';
import { detailDistance } from '../src/rendering/view-detail.ts';

describe('scenery pass pixel footprint', () => {
  it('retains the main lens and maps smaller feeds to equivalent viewing distance', () => {
    const camera = new T.PerspectiveCamera(58, 16 / 9);
    expect(sceneryPassDistance(100, camera, 1280, 720, 720)).toBe(100);
    expect(sceneryPassDistance(100, camera, 512, 192, 720)).toBe(375);
    // A larger target must not increase detail beyond the existing main-view rule.
    expect(sceneryPassDistance(100, camera, 2560, 1440, 720)).toBe(100);
    camera.fov = 18;
    expect(sceneryPassDistance(100, camera, 512, 192, 720)).toBeCloseTo(
      detailDistance(100, 18, 16 / 9) * 3.75,
      10,
    );
  });
  it('uses independent orthographic span/zoom and conservatively chooses the finer axis', () => {
    const camera = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 5000);
    const near = sceneryPassDistance(1000, camera, 2048, 2048, 720);
    expect(near).toBeGreaterThan(6);
    expect(near).toBeLessThan(7);
    expect(sceneryPassDistance(0, camera, 2048, 2048, 720)).toBe(near);
    camera.zoom = 2;
    expect(sceneryPassDistance(1000, camera, 2048, 2048, 720)).toBe(near / 2);
    camera.zoom = 1;
    camera.left = -2000;
    camera.right = 2000;
    camera.top = 2000;
    camera.bottom = -2000;
    expect(sceneryPassDistance(0, camera, 2048, 2048, 720)).toBeCloseTo(near * 200, 8);
    camera.top = 10;
    camera.bottom = -10;
    expect(sceneryPassDistance(0, camera, 2048, 2048, 720)).toBe(near);
  });
  it('reads a point-shadow atlas face viewport rather than assuming the whole target size', () => {
    const sampler = new SceneryPassDetail();
    const camera = new T.PerspectiveCamera(90, 1);
    const renderer = {
      getCurrentViewport: (out: T.Vector4) => out.set(256, 128, 128, 128),
      getDrawingBufferSize: (out: T.Vector2) => out.set(1280, 720),
    } as T.WebGLRenderer;
    expect(sampler.distance(50, camera, renderer)).toBe(
      sceneryPassDistance(50, camera, 128, 128, 720),
    );
    const target = new T.WebGLCubeRenderTarget(128);
    const cube = new T.CubeCamera(0.1, 1600, target);
    try {
      expect(sampler.distance(50, cube.children[0] as T.Camera, renderer)).toBe(
        sampler.distance(50, camera, renderer),
      );
    } finally {
      target.dispose();
    }
  });
  it('rejects invalid dimensions and lenses without silently removing geometry', () => {
    const camera = new T.PerspectiveCamera(58, 16 / 9);
    for (const bad of [-1, NaN, Infinity])
      expect(() => sceneryPassDistance(bad, camera, 128, 128, 720)).toThrow();
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => sceneryPassDistance(10, camera, bad, 128, 720)).toThrow();
      expect(() => sceneryPassDistance(10, camera, 128, bad, 720)).toThrow();
      expect(() => sceneryPassDistance(10, camera, 128, 128, bad)).toThrow();
    }
    expect(() => sceneryPassDistance(10, new T.PerspectiveCamera(-90, 1), 128, 128, 720)).toThrow(
      'Invalid detail lens',
    );
    const shadow = new T.OrthographicCamera(1, -1, 1, -1);
    expect(() => sceneryPassDistance(10, shadow, 128, 128, 720)).toThrow('orthographic');
    shadow.left = -1;
    shadow.right = 1;
    shadow.zoom = 0;
    expect(() => sceneryPassDistance(10, shadow, 128, 128, 720)).toThrow('orthographic');
    expect(() => sceneryPassDistance(10, new T.Camera(), 128, 128, 720)).toThrow('Unsupported');
  });
});
