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
describe('rear-view detail exclusions', () => {
  it('hides excluded roots for both passes and restores them after a failure', () => {
    const { root, mirrors } = fixture();
    const crowd = new T.Group(),
      crew = new T.Group();
    crew.visible = false;
    mirrors.exclusions = [crowd, crew];
    let observed = 0;
    const { renderer } = rendererMock(() => {
      expect([crowd.visible, crew.visible]).toEqual([false, false]);
      if (++observed === 2) throw new Error('second pass lost');
    });
    expect(() =>
      mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 0.1),
    ).toThrow('second pass lost');
    expect(observed).toBe(2);
    expect([crowd.visible, crew.visible]).toEqual([true, false]);
    mirrors.dispose();
  });
});
it('alternates the two feeds in steady state, each at the quality rate, and refreshes both after a discontinuity', () => {
  const { root, mirrors } = fixture();
  const { renderer } = rendererMock();
  const cameras = () =>
    (renderer.render.mock.calls as unknown as [T.Scene, T.PerspectiveCamera][]).map(([, c]) =>
      mirrors.cameras.indexOf(c),
    );
  const gl = renderer as unknown as T.WebGLRenderer;
  mirrors.quality('high'); // 30 Hz per feed
  mirrors.render(gl, new T.Scene(), root, 0);
  expect(cameras()).toEqual([0, 1]);
  // 60 Hz presentation: one pass per frame, alternating feeds.
  for (let frame = 0; frame < 6; frame++) mirrors.render(gl, new T.Scene(), root, 1 / 60);
  expect(cameras()).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
  expect(mirrors.passes).toBe(1);
  // Each feed is refreshed every 1/30 s.
  expect(mirrors.updates).toBe(7);
  mirrors.invalidate();
  mirrors.render(gl, new T.Scene(), root, 0);
  expect(cameras().slice(-2)).toEqual([0, 1]);
  expect(mirrors.passes).toBe(2);
  mirrors.dispose();
});

it('plans the exact upcoming feeds without consuming cadence, visibility or detail', () => {
  const a = fixture(),
    b = fixture();
  const baseline = rendererMock(),
    prepared = rendererMock();
  const detail = { before: vi.fn(), after: vi.fn() };
  b.mirrors.detail = detail;
  a.mirrors.quality('high');
  b.mirrors.quality('high');
  const hidden = new T.Group();
  b.mirrors.exclusions = [hidden];
  const steps = [0, 0, 1 / 120, 1 / 120, 1 / 60, 1 / 60, 1 / 120, 1 / 120];
  for (const dt of steps) {
    const updates = b.mirrors.updates,
      passes = b.mirrors.passes;
    const before = detail.before.mock.calls.length;
    const plan = b.mirrors.prepare(b.root, dt)!;
    expect(b.mirrors.updates).toBe(updates);
    expect(b.mirrors.passes).toBe(passes);
    expect(detail.before).toHaveBeenCalledTimes(before);
    expect(hidden.visible).toBe(true);
    expect(b.surfaces.every((s) => s.visible)).toBe(true);
    expect(plan.hiddenRoots).toEqual([...b.surfaces, hidden]);
    a.mirrors.render(baseline.renderer as unknown as T.WebGLRenderer, new T.Scene(), a.root, dt);
    const offset = prepared.renderer.render.mock.calls.length;
    b.mirrors.render(
      prepared.renderer as unknown as T.WebGLRenderer,
      new T.Scene(),
      b.root,
      dt,
      plan,
    );
    const actual = (prepared.renderer.render.mock.calls as unknown as [T.Scene, T.Camera][])
      .slice(offset)
      .map(([, camera]) => camera);
    expect(actual).toEqual(plan.cameras);
    expect(b.mirrors.updates).toBe(a.mirrors.updates);
    expect(b.mirrors.passes).toBe(a.mirrors.passes);
    b.mirrors.cameras.forEach((camera, i) =>
      expect(camera.matrixWorld.elements).toEqual(a.mirrors.cameras[i].matrixWorld.elements),
    );
    expect(() =>
      b.mirrors.render(
        prepared.renderer as unknown as T.WebGLRenderer,
        new T.Scene(),
        b.root,
        dt,
        plan,
      ),
    ).toThrow('Stale mirror preparation plan');
  }
  a.mirrors.dispose();
  b.mirrors.dispose();
});

it('does not plan invisible/unbound mirrors and invalidates a plan on quality or bind changes', () => {
  const { root, mirrors, surfaces } = fixture();
  const { renderer } = rendererMock();
  root.visible = false;
  expect(mirrors.prepare(root, 0)).toBeNull();
  root.visible = true;
  const plan = mirrors.prepare(root, 0)!;
  mirrors.quality('low');
  expect(() =>
    mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 0, plan),
  ).toThrow('Stale');
  const next = mirrors.prepare(root, 0)!;
  mirrors.bind(surfaces);
  expect(() =>
    mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 0, next),
  ).toThrow('Stale');
  mirrors.dispose();
  expect(mirrors.prepare(root, 0)).toBeNull();
});

it('checks exclusion contents without rejecting an equivalent repopulated array', () => {
  const { root, mirrors } = fixture();
  const { renderer } = rendererMock();
  const excluded = new T.Group();
  mirrors.exclusions = [excluded];
  const plan = mirrors.prepare(root, 0)!;
  mirrors.exclusions = [excluded];
  mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 0, plan);
  const changed = mirrors.prepare(root, 1 / 30)!;
  mirrors.exclusions[0] = new T.Group();
  const count = renderer.render.mock.calls.length;
  expect(() =>
    mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 1 / 30, changed),
  ).toThrow('Stale');
  expect(renderer.render).toHaveBeenCalledTimes(count);
  mirrors.dispose();
});

it('rejects a root pose changed after preparation before consuming cadence or submitting work', () => {
  const { root, mirrors } = fixture();
  const { renderer } = rendererMock();
  const plan = mirrors.prepare(root, 0)!;
  root.position.x += 3; // Deliberately do not call updateMatrixWorld.
  expect(() =>
    mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 0, plan),
  ).toThrow('Stale mirror preparation pose');
  expect(renderer.clear).not.toHaveBeenCalled();
  expect(renderer.render).not.toHaveBeenCalled();
  expect(mirrors.updates).toBe(0);
  expect(mirrors.passes).toBe(0);
  const fresh = mirrors.prepare(root, 0)!;
  expect(fresh.cameras).toHaveLength(2);
  mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 0, fresh);
  expect(mirrors.updates).toBe(1);
  expect(renderer.render).toHaveBeenCalledTimes(2);
  mirrors.dispose();
});

it.each(['owner', 'before', 'after'] as const)(
  'rejects changed detail %s identity before submission',
  (changed) => {
    const { root, mirrors } = fixture();
    const { renderer } = rendererMock();
    mirrors.detail = { before: vi.fn(), after: vi.fn() };
    const plan = mirrors.prepare(root, 0)!;
    if (changed === 'owner') mirrors.detail = { ...mirrors.detail };
    else mirrors.detail[changed] = vi.fn();
    expect(() =>
      mirrors.render(renderer as unknown as T.WebGLRenderer, new T.Scene(), root, 0, plan),
    ).toThrow('Stale mirror preparation plan');
    expect(renderer.clear).not.toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(mirrors.updates).toBe(0);
    mirrors.dispose();
  },
);
