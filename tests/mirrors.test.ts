import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { MirrorViews } from '../src/rendering/mirrors.ts';

function fixture() {
  const root = new T.Group();
  const surfaces = [-1, 1].map((sign) => {
    const surface = new T.Mesh(new T.PlaneGeometry(0.18, 0.065), new T.MeshStandardMaterial());
    surface.position.set(sign * 0.64, 0.3, 0.4);
    surface.rotation.y = Math.PI;
    root.add(surface);
    return surface;
  });
  const mirrors = new MirrorViews();
  mirrors.bind(surfaces);
  return { root, surfaces, mirrors };
}
function rendererMock(render: () => void = () => undefined) {
  const original = new T.WebGLRenderTarget(8, 8);
  const renderer = {
    getRenderTarget: () => original,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getViewport: (v: T.Vector4) => v.set(10, 20, 800, 600),
    getScissor: (v: T.Vector4) => v.set(1, 2, 200, 300),
    getScissorTest: () => true,
    setRenderTarget: vi.fn(),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    shadowMap: { autoUpdate: true, needsUpdate: true },
    clear: vi.fn(),
    render: vi.fn(render),
  };
  return { renderer, original };
}
describe('rear-view camera passes', () => {
  it('looks backward from both mirror surfaces after chassis translation and rotation', () => {
    const { root, surfaces, mirrors } = fixture();
    root.position.set(40, 2, -80);
    root.rotation.set(0.04, 1.1, -0.08);
    mirrors.orient(root);
    const forward = new T.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
    mirrors.cameras.forEach((c, i) => {
      expect(c.getWorldDirection(new T.Vector3()).dot(forward)).toBeLessThan(-0.98);
      expect(c.position.distanceTo(surfaces[i].getWorldPosition(new T.Vector3()))).toBeLessThan(
        1e-9,
      );
      expect(mirrors.targets[i].texture.repeat.x).toBe(-1);
      expect(mirrors.targets[i].texture.offset.x).toBe(1);
    });
    mirrors.dispose();
  });
  it('uses bounded quality budgets and does not repeat passes every animation frame', () => {
    const { root, mirrors } = fixture();
    const { renderer } = rendererMock();
    const gl = renderer as unknown as T.WebGLRenderer;
    mirrors.render(gl, new T.Scene(), root, 1 / 120);
    mirrors.render(gl, new T.Scene(), root, 1 / 120);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(mirrors.updates).toBe(1);
    mirrors.quality('low');
    expect(mirrors.targets[0].width).toBe(128);
    mirrors.quality('high');
    expect(mirrors.targets[0].width).toBe(512);
    expect(mirrors.targets[0].height).toBe(192);
    mirrors.dispose();
  });
  it('restores renderer and surface state on a failed pass without swallowing the error', () => {
    const { root, mirrors, surfaces } = fixture();
    surfaces[1].visible = false;
    const { renderer, original } = rendererMock(() => {
      expect(surfaces.every((s) => !s.visible)).toBe(true);
      throw new Error('GPU pass failed');
    });
    expect(() =>
      mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 0.1),
    ).toThrow('GPU pass failed');
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(original, 0, 0);
    expect(renderer.setViewport).toHaveBeenLastCalledWith(new T.Vector4(10, 20, 800, 600));
    expect(renderer.setScissor).toHaveBeenLastCalledWith(new T.Vector4(1, 2, 200, 300));
    expect(renderer.setScissorTest).toHaveBeenLastCalledWith(true);
    expect(renderer.shadowMap).toEqual({ autoUpdate: true, needsUpdate: true });
    expect(surfaces.map((s) => s.visible)).toEqual([true, false]);
    expect(mirrors.updates).toBe(0);
    mirrors.dispose();
  });
  it('restores the original materials and disposes its two targets', () => {
    const root = new T.Group(),
      material = new T.MeshStandardMaterial();
    const surfaces = [
      new T.Mesh(new T.PlaneGeometry(), material),
      new T.Mesh(new T.PlaneGeometry(), material),
    ];
    root.add(...surfaces);
    const mirrors = new MirrorViews();
    const dispose = mirrors.targets.map((t) => vi.spyOn(t, 'dispose'));
    mirrors.bind(surfaces);
    expect(surfaces[0].material).not.toBe(material);
    mirrors.dispose();
    expect(surfaces.every((s) => s.material === material)).toBe(true);
    dispose.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
  });
});
it('refreshes both fitted mirror feeds immediately after a presentation discontinuity', () => {
  const { root, mirrors } = fixture(),
    { renderer } = rendererMock();
  mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 0);
  mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 0);
  expect(mirrors.updates).toBe(1);
  mirrors.invalidate();
  mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 0);
  expect(mirrors.updates).toBe(2);
  mirrors.dispose();
});
