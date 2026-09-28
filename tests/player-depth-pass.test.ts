import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  canPrimePlayerDepth,
  PlayerDepthPrepass,
  PlayerScenePass,
} from '../src/rendering/player-depth-pass.ts';

function mesh() {
  return new T.Mesh(new T.BoxGeometry(), new T.MeshPhysicalMaterial({ side: T.DoubleSide }));
}
function renderer() {
  return {
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    shadowMap: { autoUpdate: true, needsUpdate: true },
    render: vi.fn(),
    clear: vi.fn(),
    setRenderTarget: vi.fn(),
  };
}
const target = new T.WebGLRenderTarget(1, 1);

describe('imported player depth ownership', () => {
  it('opts in only unconditional opaque double-sided depth writers', () => {
    const object = mesh();
    expect(canPrimePlayerDepth(object)).toBe(true);
    const changes = [
      { transparent: true },
      { opacity: 0.4 },
      { visible: false },
      { colorWrite: false },
      { depthWrite: false },
      { depthTest: false },
      { depthFunc: T.AlwaysDepth },
      { side: T.FrontSide },
      { alphaTest: 0.2 },
      { alphaHash: true },
      { alphaToCoverage: true },
      { alphaMap: new T.Texture() },
      { displacementMap: new T.Texture() },
      { polygonOffset: true },
      { stencilWrite: true },
      { clippingPlanes: [new T.Plane()] },
      { transmission: 0.1 },
    ];
    for (const change of changes) {
      const old = object.material;
      object.material = old.clone();
      Object.assign(object.material, change);
      expect(canPrimePlayerDepth(object), JSON.stringify(Object.keys(change))).toBe(false);
      object.material.dispose();
      object.material = old;
    }
    object.customDepthMaterial = new T.MeshDepthMaterial();
    expect(canPrimePlayerDepth(object)).toBe(false);
    object.customDepthMaterial = undefined;
    object.onBeforeRender = () => {};
    expect(canPrimePlayerDepth(object)).toBe(false);
  });

  it('submits actual geometry and skeleton while excluding transparencies and restoring masks', () => {
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(),
      root = new T.Group(),
      opaque = mesh(),
      transparent = mesh(),
      skinned = new T.SkinnedMesh(new T.BufferGeometry(), opaque.material);
    const bone = new T.Bone();
    skinned.add(bone);
    skinned.bind(new T.Skeleton([bone]));
    const skeleton = skinned.skeleton,
      geometry = opaque.geometry;
    transparent.material.transparent = true;
    root.add(opaque, transparent, skinned);
    scene.add(root);
    scene.background = new T.Color('red');
    const background = scene.background;
    camera.layers.enable(7);
    opaque.layers.enable(7);
    const oldCameraMask = camera.layers.mask,
      oldMeshMask = opaque.layers.mask;
    const pass = new PlayerDepthPrepass(),
      r = renderer();
    pass.register(root);
    pass.register(root);
    expect(pass.size).toBe(3);
    r.render.mockImplementation(() => {
      expect(scene.overrideMaterial).toBeInstanceOf(T.MeshDepthMaterial);
      expect(scene.overrideMaterial?.colorWrite).toBe(false);
      expect(scene.overrideMaterial?.depthWrite).toBe(true);
      expect(scene.background).toBeNull();
      expect(r.autoClear).toBe(false);
      expect(r.shadowMap).toEqual({ autoUpdate: false, needsUpdate: false });
      expect(opaque.layers.test(camera.layers)).toBe(true);
      expect(skinned.layers.test(camera.layers)).toBe(true);
      expect(transparent.layers.test(camera.layers)).toBe(false);
      expect(opaque.geometry).toBe(geometry);
      expect(skinned.skeleton).toBe(skeleton);
      expect(opaque.parent).toBe(root);
    });
    pass.render(r as unknown as T.WebGLRenderer, scene, camera);
    expect(r.render).toHaveBeenCalledTimes(1);
    expect(pass.eligibleMeshes).toBe(2);
    expect(camera.layers.mask).toBe(oldCameraMask);
    expect(opaque.layers.mask).toBe(oldMeshMask);
    expect(scene.overrideMaterial).toBeNull();
    expect(scene.background).toBe(background);
    expect(r.autoClear).toBe(true);
    expect(r.shadowMap).toEqual({ autoUpdate: true, needsUpdate: true });
    const disposeGeometry = vi.spyOn(geometry, 'dispose');
    const disposeMaterial = vi.spyOn(opaque.material, 'dispose');
    pass.dispose();
    pass.dispose();
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
    expect(pass.size).toBe(0);
  });

  it('rechecks changed source materials and restores state after failed submission', () => {
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(),
      object = mesh(),
      pass = new PlayerDepthPrepass(),
      r = renderer();
    scene.add(object);
    pass.register(object);
    object.layers.enable(4);
    const mask = object.layers.mask;
    object.material.transparent = true;
    pass.render(r as unknown as T.WebGLRenderer, scene, camera);
    expect(r.render).not.toHaveBeenCalled();
    object.material.transparent = false;
    r.render.mockImplementation(() => {
      throw new Error('GPU rejected submission');
    });
    expect(() => pass.render(r as unknown as T.WebGLRenderer, scene, camera)).toThrow(
      'GPU rejected',
    );
    expect(object.layers.mask).toBe(mask);
    expect(camera.layers.mask).toBe(1);
    expect(scene.overrideMaterial).toBeNull();
    expect(r.autoClear).toBe(true);
    expect(r.shadowMap).toEqual({ autoUpdate: true, needsUpdate: true });
    pass.dispose();
  });
});

describe('composer depth preservation', () => {
  it('clears once then preserves primed depth through the ordinary colour pass', () => {
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(),
      object = mesh(),
      pass = new PlayerScenePass(scene, camera),
      r = renderer();
    scene.background = new T.Color('blue');
    scene.add(object);
    pass.playerDepth.register(object);
    const phases: string[] = [];
    r.render.mockImplementation(() => {
      phases.push(scene.overrideMaterial ? 'depth' : 'colour');
      if (!scene.overrideMaterial) {
        expect(r.autoClearDepth).toBe(false);
        expect(r.shadowMap.autoUpdate).toBe(true);
        expect(object.layers.mask).toBe(1);
      }
    });
    pass.render(r as unknown as T.WebGLRenderer, target, target, 0, false);
    expect(phases).toEqual(['depth', 'colour']);
    expect(r.clear).toHaveBeenCalledExactlyOnceWith(true, true, true);
    expect(r.setRenderTarget).toHaveBeenCalledWith(target);
    expect(r.autoClearDepth).toBe(true);
    expect(r.autoClear).toBe(true);
    expect(pass.clear).toBe(true);
    pass.dispose();
  });

  it('keeps the old path for scene overrides and explicit depth-preserving passes', () => {
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(),
      object = mesh(),
      pass = new PlayerScenePass(scene, camera),
      r = renderer();
    scene.add(object);
    pass.playerDepth.register(object);
    scene.overrideMaterial = new T.MeshNormalMaterial();
    pass.render(r as unknown as T.WebGLRenderer, target, target, 0, false);
    expect(r.render).toHaveBeenCalledTimes(1);
    expect(scene.overrideMaterial).toBeInstanceOf(T.MeshNormalMaterial);
    scene.overrideMaterial = null;
    r.autoClearDepth = false;
    pass.render(r as unknown as T.WebGLRenderer, target, target, 0, false);
    expect(r.render).toHaveBeenCalledTimes(2);
    expect(r.autoClearDepth).toBe(false);
    pass.dispose();
  });

  it('restores clear flags after either depth or colour throws', () => {
    for (const failAt of [1, 2]) {
      const scene = new T.Scene(),
        camera = new T.PerspectiveCamera(),
        object = mesh(),
        pass = new PlayerScenePass(scene, camera),
        r = renderer();
      scene.add(object);
      pass.playerDepth.register(object);
      let calls = 0;
      r.render.mockImplementation(() => {
        if (++calls === failAt) throw new Error('submission failed');
      });
      expect(() =>
        pass.render(r as unknown as T.WebGLRenderer, target, target, 0, false),
      ).toThrow();
      expect(r.autoClear).toBe(true);
      expect(r.autoClearDepth).toBe(true);
      expect(pass.clear).toBe(true);
      expect(scene.overrideMaterial).toBeNull();
      expect(camera.layers.mask).toBe(1);
      expect(object.layers.mask).toBe(1);
      expect(r.shadowMap).toEqual({ autoUpdate: true, needsUpdate: true });
      pass.dispose();
    }
  });
});
