import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { compileSceneTarget, PreparationTrace } from '../src/rendering/preparation.ts';

function compilerHarness(compileAsync: T.WebGLRenderer['compileAsync']) {
  const original = new T.WebGLRenderTarget(),
    target = new T.WebGLRenderTarget(32, 20, { type: T.HalfFloatType });
  let current: T.WebGLRenderTarget | null = original,
    face = 2,
    mip = 1;
  const viewport = new T.Vector4(1, 2, 30, 20),
    scissor = new T.Vector4(2, 3, 8, 8);
  let scissorTest = true;
  const renderer = {
    getRenderTarget: () => current,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    getViewport: (v: T.Vector4) => v.copy(viewport),
    getScissor: (v: T.Vector4) => v.copy(scissor),
    getScissorTest: () => scissorTest,
    setRenderTarget: (t: T.WebGLRenderTarget | null, f = 0, m = 0) => {
      current = t;
      face = f;
      mip = m;
      viewport.set(0, 0, 32, 20);
      scissor.set(0, 0, 32, 20);
      scissorTest = false;
    },
    setViewport: (v: T.Vector4) => viewport.copy(v),
    setScissor: (v: T.Vector4) => scissor.copy(v),
    setScissorTest: (v: boolean) => {
      scissorTest = v;
    },
    compileAsync: (...args: Parameters<T.WebGLRenderer['compileAsync']>) => {
      expect(current).toBe(target);
      return compileAsync(...args);
    },
  };
  return {
    renderer: renderer as unknown as T.WebGLRenderer,
    target,
    restored() {
      expect(current).toBe(original);
      expect([face, mip]).toEqual([2, 1]);
      expect(viewport.toArray()).toEqual([1, 2, 30, 20]);
      expect(scissor.toArray()).toEqual([2, 3, 8, 8]);
      expect(scissorTest).toBe(true);
    },
    dispose() {
      original.dispose();
      target.dispose();
    },
  };
}

function gpCompilationFixture() {
  const scene = new T.Scene(),
    camera = new T.Camera(),
    geometry = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial(),
    environment = new T.Texture();
  scene.environment = environment;
  scene.fog = new T.Fog(0x8899aa, 20, 200);
  const hiddenFormula = new T.Group(),
    visibleFormula = new T.Group(),
    unlistedHidden = new T.Group(),
    bikes = new T.Group(),
    high = new T.Group(),
    middle = new T.Group(),
    far = new T.Group(),
    service = new T.Group(),
    pits = new T.Group();
  hiddenFormula.visible = unlistedHidden.visible = false;
  high.visible = far.visible = service.visible = pits.visible = false;
  const excluded = new T.Mesh(geometry, material),
    excludedChild = new T.Mesh(geometry, material),
    visibleFallback = new T.Mesh(geometry, material),
    unlisted = new T.Mesh(geometry, material),
    rider = new T.SkinnedMesh(geometry, material),
    instances = new T.InstancedMesh(geometry, material, 2),
    farBike = new T.Mesh(geometry, material),
    carriedWheel = new T.Mesh(geometry, [material]),
    circuit = new T.Mesh(geometry, material),
    nested = new T.Mesh(geometry, material),
    points = new T.Points(geometry, new T.PointsMaterial()),
    line = new T.Line(geometry, new T.LineBasicMaterial()),
    sprite = new T.Sprite(new T.SpriteMaterial()),
    bone = new T.Bone(),
    skeleton = new T.Skeleton([bone]),
    sun = new T.DirectionalLight(),
    nestedLight = new T.PointLight();
  rider.add(bone);
  rider.bind(skeleton);
  excluded.add(excludedChild);
  hiddenFormula.add(excluded);
  visibleFormula.add(visibleFallback);
  unlistedHidden.add(unlisted);
  high.add(rider);
  middle.add(instances);
  far.add(farBike);
  service.add(carriedWheel);
  bikes.add(high, middle, far, service);
  pits.add(points, line, sprite);
  circuit.add(nested, nestedLight);
  scene.add(hiddenFormula, visibleFormula, unlistedHidden, bikes, pits, circuit, sun);
  const retained = [
    visibleFallback,
    unlisted,
    rider,
    instances,
    farBike,
    carriedWheel,
    points,
    line,
    sprite,
    circuit,
    nested,
  ];
  const nodes: T.Object3D[] = [];
  scene.traverse((object) => nodes.push(object));
  const snapshot = nodes.map((object) => ({
    object,
    parent: object.parent,
    children: [...object.children],
    visible: object.visible,
    matrix: object.matrix.toArray(),
    matrixWorld: object.matrixWorld.toArray(),
    geometry: (object as T.Mesh).geometry,
    material: (object as T.Mesh).material,
  }));
  const dispose = vi.fn();
  for (const resource of [
    geometry,
    material,
    environment,
    points.material,
    line.material,
    sprite.material,
  ])
    resource.addEventListener('dispose', dispose);
  const bones = skeleton.bones,
    instanceMatrix = instances.instanceMatrix,
    fog = scene.fog;
  return {
    scene,
    camera,
    hiddenRoots: [hiddenFormula, visibleFormula],
    hiddenFormula,
    excluded,
    excludedChild,
    retained,
    far,
    geometry,
    material,
    rider,
    skeleton,
    instances,
    preserved() {
      for (const state of snapshot) {
        expect(state.object.parent).toBe(state.parent);
        expect(state.object.children).toHaveLength(state.children.length);
        state.children.forEach((child, index) => expect(state.object.children[index]).toBe(child));
        expect(state.object.visible).toBe(state.visible);
        expect(state.object.matrix.toArray()).toEqual(state.matrix);
        expect(state.object.matrixWorld.toArray()).toEqual(state.matrixWorld);
        expect((state.object as T.Mesh).geometry).toBe(state.geometry);
        expect((state.object as T.Mesh).material).toBe(state.material);
      }
      expect(rider.skeleton).toBe(skeleton);
      expect(skeleton.bones).toBe(bones);
      expect(instances.instanceMatrix).toBe(instanceMatrix);
      expect(scene.environment).toBe(environment);
      expect(scene.fog).toBe(fog);
      expect(dispose).not.toHaveBeenCalled();
    },
    dispose() {
      skeleton.dispose();
      instances.dispose();
      for (const resource of [
        geometry,
        material,
        environment,
        points.material,
        line.material,
        sprite.material,
      ])
        resource.dispose();
    },
  };
}

describe('grid preparation diagnostics and target ownership', () => {
  it('compiles for the actual scene attachment and restores state before an async wait', async () => {
    const original = new T.WebGLRenderTarget(),
      linear = new T.WebGLRenderTarget(32, 20, { type: T.HalfFloatType });
    let current: T.WebGLRenderTarget | null = original,
      face = 2,
      mip = 1;
    let viewport = new T.Vector4(1, 2, 30, 20),
      scissor = new T.Vector4(2, 3, 8, 8),
      scissorTest = true;
    let finish: () => void = () => {};
    const compiling = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const renderer = {
      getRenderTarget: () => current,
      getActiveCubeFace: () => face,
      getActiveMipmapLevel: () => mip,
      getViewport: (v: T.Vector4) => v.copy(viewport),
      getScissor: (v: T.Vector4) => v.copy(scissor),
      getScissorTest: () => scissorTest,
      setRenderTarget: (t: T.WebGLRenderTarget | null, f = 0, m = 0) => {
        current = t;
        face = f;
        mip = m;
        viewport.set(0, 0, 32, 20);
        scissorTest = false;
      },
      setViewport: (v: T.Vector4) => {
        viewport = v;
      },
      setScissor: (v: T.Vector4) => {
        scissor = v;
      },
      setScissorTest: (v: boolean) => {
        scissorTest = v;
      },
      compileAsync: () => {
        expect(current).toBe(linear);
        return compiling;
      },
    };
    const promise = compileSceneTarget(
      renderer as unknown as T.WebGLRenderer,
      new T.Scene(),
      new T.Camera(),
      linear,
    );
    const restored = () => {
      expect(current).toBe(original);
      expect([face, mip]).toEqual([2, 1]);
      expect(viewport.toArray()).toEqual([1, 2, 30, 20]);
      expect(scissor.toArray()).toEqual([2, 3, 8, 8]);
      expect(scissorTest).toBe(true);
    };
    restored();
    finish();
    await promise;
    renderer.compileAsync = () => {
      throw new Error('compile failed');
    };
    expect(() =>
      compileSceneTarget(
        renderer as unknown as T.WebGLRenderer,
        new T.Scene(),
        new T.Camera(),
        linear,
      ),
    ).toThrow('compile failed');
    restored();
    original.dispose();
    linear.dispose();
  });
  it.each(['success', 'synchronous failure', 'asynchronous failure'] as const)(
    'borrows all GP renderables with original identities and target lighting on %s',
    async (outcome) => {
      const fixture = gpCompilationFixture();
      let finish: (object: T.Object3D) => void = () => {};
      const held = new Promise<T.Object3D>((resolve) => {
        finish = resolve;
      });
      let borrowed: T.Object3D | null = null;
      const harness = compilerHarness((view, camera, targetScene) => {
        borrowed = view;
        expect(view).not.toBe(fixture.scene);
        expect(camera).toBe(fixture.camera);
        expect(targetScene).toBe(fixture.scene);
        expect(view.parent).toBeNull();
        expect(view.children).toHaveLength(0);
        const renderables: T.Object3D[] = [];
        view.traverse((object) => renderables.push(object));
        expect(renderables).toHaveLength(fixture.retained.length);
        fixture.retained.forEach((object, index) => expect(renderables[index]).toBe(object));
        expect(new Set(renderables).size).toBe(renderables.length);
        expect(renderables).not.toContain(fixture.excluded);
        expect(renderables).not.toContain(fixture.excludedChild);
        expect(
          (renderables.find((object) => object === fixture.rider) as T.SkinnedMesh).skeleton,
        ).toBe(fixture.skeleton);
        expect(renderables.find((object) => object === fixture.instances)).toBe(fixture.instances);

        // Match Three 0.180's two light-collection traversals. The target's
        // lights, including a light below a retained mesh, must occur once.
        const targetLights: T.Object3D[] = [],
          compilationLights: T.Object3D[] = [];
        fixture.scene.traverseVisible((object) => {
          if ((object as T.Light).isLight) targetLights.push(object);
        });
        targetScene!.traverseVisible((object) => {
          if ((object as T.Light).isLight) compilationLights.push(object);
        });
        view.traverseVisible((object) => {
          if ((object as T.Light).isLight) compilationLights.push(object);
        });
        expect(targetLights).toHaveLength(2);
        expect(compilationLights).toEqual(targetLights);
        fixture.preserved();
        if (outcome === 'synchronous failure') throw new Error('sync compile failed');
        if (outcome === 'asynchronous failure')
          return Promise.reject(new Error('async compile failed'));
        return held;
      });
      const run = () =>
        compileSceneTarget(
          harness.renderer,
          fixture.scene,
          fixture.camera,
          harness.target,
          fixture.hiddenRoots,
        );
      if (outcome === 'synchronous failure') expect(run).toThrow('sync compile failed');
      else {
        const pending = run();
        harness.restored();
        fixture.preserved();
        if (outcome === 'asynchronous failure')
          await expect(pending).rejects.toThrow('async compile failed');
        else {
          finish(borrowed!);
          expect(await pending).toBe(borrowed);
        }
      }
      harness.restored();
      fixture.preserved();
      harness.dispose();
      fixture.dispose();
    },
  );
  it('rebuilds the borrowed view for lazy GP parts and keeps a supplied root once it becomes visible', async () => {
    const fixture = gpCompilationFixture(),
      views: T.Object3D[] = [],
      enumerated: T.Object3D[][] = [];
    const harness = compilerHarness(async (view) => {
      views.push(view);
      const objects: T.Object3D[] = [];
      view.traverse((object) => objects.push(object));
      enumerated.push(objects);
      return view;
    });
    const run = () =>
      compileSceneTarget(
        harness.renderer,
        fixture.scene,
        fixture.camera,
        harness.target,
        fixture.hiddenRoots,
      );
    await run();
    fixture.preserved();
    const lazy = new T.Mesh(fixture.geometry, fixture.material);
    fixture.far.add(lazy);
    fixture.hiddenFormula.visible = true;
    await run();
    expect(views[0]).not.toBe(views[1]);
    expect(enumerated[0]).not.toContain(lazy);
    expect(enumerated[0]).not.toContain(fixture.excluded);
    expect(enumerated[1]).toContain(lazy);
    expect(enumerated[1]).toContain(fixture.excluded);
    expect(enumerated[1]).toContain(fixture.excludedChild);
    fixture.retained.forEach((object) => expect(enumerated[1]).toContain(object));
    const firstAgain: T.Object3D[] = [];
    views[0].traverse((object) => firstAgain.push(object));
    expect(firstAgain).toEqual(enumerated[0]);
    fixture.far.remove(lazy);
    fixture.hiddenFormula.visible = false;
    fixture.preserved();
    harness.restored();
    harness.dispose();
    fixture.dispose();
  });
  it('keeps the original two-argument compilation path when no hidden roots are supplied', async () => {
    const fixture = gpCompilationFixture();
    const compile = vi.fn<T.WebGLRenderer['compileAsync']>(async (scene) => scene);
    const harness = compilerHarness(compile);
    await compileSceneTarget(harness.renderer, fixture.scene, fixture.camera, harness.target);
    expect(compile).toHaveBeenCalledExactlyOnceWith(fixture.scene, fixture.camera);
    fixture.preserved();
    harness.restored();
    harness.dispose();
    fixture.dispose();
  });
  it('reports individual stages and never advances a completed trace on later reads', async () => {
    let now = 0;
    const trace = new PreparationTrace(() => now),
      labels: string[] = [];
    const run = trace.run(
      (label) => labels.push(label),
      async (report) => {
        report('materials');
        now = 12;
        report('GPU');
        now = 32;
        return true;
      },
    );
    expect(await run).toBe(true);
    now = 99;
    expect(trace.snapshot()).toEqual({
      status: 'complete',
      elapsedMs: 32,
      error: null,
      stages: [
        { label: 'materials', elapsedMs: 12, complete: true },
        { label: 'GPU', elapsedMs: 20, complete: true },
      ],
    });
    expect(labels).toEqual(['materials', 'GPU']);
  });
  it('retains cancellations and actual failures without swallowing them', async () => {
    let now = 0;
    const trace = new PreparationTrace(() => now);
    expect(
      await trace.run(
        () => {},
        async (report) => {
          report('grid');
          now = 7;
          return false;
        },
      ),
    ).toBe(false);
    expect(trace.snapshot()?.status).toBe('cancelled');
    await expect(
      trace.run(
        () => {},
        async (report) => {
          report('shaders');
          throw new Error('lost context');
        },
      ),
    ).rejects.toThrow('lost context');
    expect(trace.snapshot()?.error).toBe('lost context');
    expect(trace.snapshot()?.status).toBe('failed');
  });
  it('bounds history and prevents an older cancellation from overwriting a newer session', async () => {
    const trace = new PreparationTrace(() => 0);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const old = trace.run(
      () => {},
      async (report) => {
        report('old');
        await held;
        return false;
      },
    );
    await trace.run(
      () => {},
      async (report) => {
        for (let i = 0; i < 100; i++) report(`new ${i}`);
        return true;
      },
    );
    release();
    await old;
    expect(trace.snapshot()?.status).toBe('complete');
    expect(trace.snapshot()?.stages).toHaveLength(32);
    expect(trace.snapshot()?.stages.at(-1)?.label).toBe('new 99');
  });
});
