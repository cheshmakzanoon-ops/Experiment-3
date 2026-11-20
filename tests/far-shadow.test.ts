import { expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  FAR_SHADOW_MARK,
  FarShadow,
  farShadowChunks,
  installFarShadowChunks,
} from '../src/rendering/far-shadow.ts';
import { StaticInstanceShadowBounds } from '../src/rendering/static-instance-shadow-bounds.ts';

/** three's WebGLProgram loop unrolling (r180), applied after light counts. */
function unroll(source: string, lights: number, shadows: number) {
  return source
    .replace(/NUM_DIR_LIGHTS/g, `${lights}`)
    .replace(/NUM_DIR_LIGHT_SHADOWS/g, `${shadows}`)
    .replace(
      /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g,
      (_m, start: string, end: string, body: string) => {
        let out = '';
        for (let i = Number(start); i < Number(end); i++)
          out += body.replace(/\[\s*i\s*\]/g, `[ ${i} ]`).replace(/UNROLLED_LOOP_INDEX/g, `${i}`);
        return out;
      },
    );
}

it('patches only the directional loop: the sun reads the far map, the marked far light adds nothing', () => {
  const original = T.ShaderChunk.lights_fragment_begin;
  // Importing the module installs the patch once; reinstalling is a no-op.
  installFarShadowChunks();
  expect(T.ShaderChunk.lights_fragment_begin).toBe(original);
  expect(original).toContain('apexFarShadow( directionalShadowMap[ 1 ]');
  expect(T.ShaderChunk.shadowmap_pars_fragment).toContain('float apexFarShadow(');
  const direct = 'RE_Direct( directLight, geometryPosition';
  // Point, spot and directional calls remain, in order.
  expect(original.split(direct)).toHaveLength(4);
  const unrolled = unroll(original, 2, 2);
  const bodies = unrolled
    .slice(unrolled.indexOf('directionalLight = directionalLights[ 0 ]'))
    .split('directionalLight = directionalLights[ 1 ]');
  // Light 0 (the sun): its own shadow, then the far map where the near one ends.
  expect(bodies[0]).toContain('vDirectionalShadowCoord[ 0 ] ) : 1.0;');
  expect(bodies[0]).toContain('#if defined( USE_SHADOWMAP ) && 2 > 1 && 0 == 0');
  // Light 1: skipped entirely when marked (both its shadow and its lighting).
  expect(bodies[1]).toMatch(
    /#if defined\( USE_SHADOWMAP \) && 2 > 1 && 1 == 1\s+if \( directionalLightShadows\[ 1 \]\.shadowIntensity >= 0\.0 \) \{/,
  );
  expect(bodies[1].indexOf('}\n\t\t#endif')).toBeGreaterThan(bodies[1].indexOf(direct));
  // A single shadowed light compiles none of it.
  expect(unroll(original, 1, 1)).toContain('#if defined( USE_SHADOWMAP ) && 1 > 1 && 0 == 0');
  expect(() => farShadowChunks('not a chunk', '')).toThrow('Unexpected three.js');
});

it('fits the far frustum to the circuit as the sun sees it, with one-texel offsets', () => {
  const far = new FarShadow(2048);
  // Unmarked until baked: an unrendered map never shades anything.
  expect(far.light.shadow.intensity).toBe(0);
  expect(far.baked).toBe(false);
  expect(far.light.intensity).toBe(0);
  expect(far.light.shadow.autoUpdate).toBe(false);
  // Not in the scene's light list until baked: no program variant for it.
  expect(far.light.visible).toBe(false);
  const bounds = new T.Box3(new T.Vector3(-500, -20, -600), new T.Vector3(400, 60, 550));
  const direction = new T.Vector3(-160, 190, -130);
  const texel = far.fit(direction, bounds);
  // Every corner of the region lies inside the shadow camera's frustum.
  const camera = far.light.shadow.camera;
  camera.position.copy(far.light.position);
  camera.lookAt(far.light.target.position);
  camera.updateMatrixWorld();
  const clip = new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const corner = new T.Vector3();
  for (let i = 0; i < 8; i++) {
    corner
      .set(
        i & 1 ? bounds.max.x : bounds.min.x,
        i & 2 ? bounds.max.y : bounds.min.y,
        i & 4 ? bounds.max.z : bounds.min.z,
      )
      .applyMatrix4(clip);
    for (const v of [corner.x, corner.y, corner.z]) expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
  }
  expect(texel).toBeGreaterThan(0.4);
  expect(texel).toBeLessThan(1);
  expect(far.light.shadow.normalBias).toBeCloseTo(texel, 9);
  expect(far.light.shadow.bias).toBeLessThan(0);
  expect(far.diagnostics().metresPerTexel).toBeCloseTo(texel, 9);
  expect(() => far.fit(direction, new T.Box3())).toThrow('Invalid far shadow region');
  far.dispose();
});

it('does not leave a temporary count inside a shadow owner interrupted before its after-hook', () => {
  const far = new FarShadow(1024),
    scene = new T.Scene(),
    sun = new T.DirectionalLight(),
    geometry = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial(),
    depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }),
    mesh = new T.InstancedMesh(geometry, material, 128),
    drawGroup = new T.Group();
  sun.castShadow = mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.position.set(10000, 0, 0);
  mesh.computeBoundingBox();
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  const owner = new StaticInstanceShadowBounds(mesh);
  const renderer = {
    shadowMap: { autoUpdate: false, enabled: true },
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    renderBufferDirect: vi.fn(() => {
      throw new Error('interrupted shadow draw');
    }),
    render: () => {
      sun.shadow.updateMatrices(sun);
      mesh.onBeforeShadow(
        gl,
        scene,
        sun.shadow.camera,
        sun.shadow.camera,
        geometry,
        depth,
        drawGroup,
      );
      // This is the real owner's conservative frustum-rejection path: it has
      // stored the count it must restore, and suppressed the empty submission.
      expect(mesh.count).toBe(0);
      gl.renderBufferDirect(sun.shadow.camera, scene, geometry, depth, mesh, null);
    },
  };
  const gl = renderer as unknown as T.WebGLRenderer;
  expect(() =>
    far.warmCasters(
      gl,
      scene,
      sun,
      new T.Vector3(1, 2, 1),
      new T.Box3(new T.Vector3(-10, -1, -10), new T.Vector3(10, 5, 10)),
    ),
  ).toThrow('interrupted shadow draw');
  expect(mesh.count).toBe(128);
  mesh.onBeforeRender(gl, scene, sun.shadow.camera, geometry, material, drawGroup);
  expect(mesh.count).toBe(128);
  expect(geometry.drawRange.count).toBe(Infinity);
  owner.dispose();
  far.dispose();
});

it('bakes shadow maps only, without cars or people, with far-only planting casting, and restores everything', () => {
  const far = new FarShadow(1024);
  const scene = new T.Scene();
  const sun = new T.DirectionalLight();
  sun.castShadow = true;
  const car = new T.Group(),
    hiddenAlready = new T.Group(),
    grove = new T.Mesh();
  hiddenAlready.visible = false;
  scene.add(car, hiddenAlready, grove);
  const previous = new T.WebGLRenderTarget(2, 2);
  const seen: unknown[] = [];
  const renderer = {
    shadowMap: { autoUpdate: false },
    target: previous as T.WebGLRenderTarget | null,
    getRenderTarget() {
      return this.target;
    },
    setRenderTarget(target: T.WebGLRenderTarget | null) {
      this.target = target;
    },
    render: vi.fn((_scene: T.Scene, camera: T.Camera) => {
      seen.push({
        car: car.visible,
        hiddenAlready: hiddenAlready.visible,
        grove: grove.castShadow,
        sun: [sun.shadow.autoUpdate, sun.shadow.needsUpdate],
        far: far.light.shadow.needsUpdate,
        farLight: far.light.visible,
        shadows: renderer.shadowMap.autoUpdate,
        target: renderer.target !== previous && renderer.target!.width === 1,
        // The bake camera sees nothing at the circuit.
        view: camera.position.y,
      });
    }),
  };
  const gl = renderer as unknown as T.WebGLRenderer;
  const options = {
    direction: new T.Vector3(1, 2, 1),
    bounds: new T.Box3(new T.Vector3(-10, 0, -10), new T.Vector3(10, 5, 10)),
    hidden: [car, hiddenAlready, null],
    farCasters: [grove],
    sun,
  };
  expect(far.baked).toBe(false);
  expect(far.bake(gl, scene, options)).toBe(true);
  expect(far.baked).toBe(true);
  expect(far.light.shadow.intensity).toBe(FAR_SHADOW_MARK);
  expect(seen).toEqual([
    {
      car: false,
      hiddenAlready: false,
      grove: true,
      sun: [false, false],
      far: true,
      farLight: true,
      shadows: true,
      target: true,
      view: -1e5,
    },
  ]);
  expect([car.visible, hiddenAlready.visible, grove.castShadow]).toEqual([true, false, false]);
  expect([sun.shadow.autoUpdate, sun.shadow.needsUpdate]).toEqual([true, false]);
  expect([far.light.shadow.needsUpdate, renderer.shadowMap.autoUpdate]).toEqual([false, false]);
  expect(renderer.target).toBe(previous);
  expect(far.bakes).toBe(1);
  expect(far.light.visible).toBe(true);
  // A failed bake restores the same state; a disabled far map never bakes.
  renderer.render.mockImplementationOnce(() => {
    throw new Error('lost');
  });
  expect(() => far.bake(gl, scene, options)).toThrow('lost');
  expect([car.visible, grove.castShadow, sun.shadow.autoUpdate]).toEqual([true, false, true]);
  expect(far.bakes).toBe(1);
  // A new map size discards the map: unmarked and out of the light list
  // until the next bake.
  far.setEnabled(true, 2048);
  expect(far.baked).toBe(false);
  expect(far.light.visible).toBe(false);
  renderer.render.mockImplementationOnce(() => {
    throw new Error('lost again');
  });
  expect(() => far.bake(gl, scene, options)).toThrow('lost again');
  expect([far.baked, far.light.visible]).toEqual([false, false]);
  expect(far.bake(gl, scene, options)).toBe(true);
  expect(far.baked).toBe(true);
  far.setEnabled(true, 2048);
  expect(far.baked).toBe(true);
  expect(far.light.visible).toBe(true);
  // Shadows switched off: no bakes, but the baked light keeps its map and its
  // place in the light list (no program rebuild); a new size waits until
  // shadows are back on.
  far.setEnabled(false, 1024);
  expect([far.enabled, far.baked, far.light.visible, far.light.castShadow]).toEqual([
    false,
    true,
    true,
    true,
  ]);
  expect(far.diagnostics().mapSize).toBe(2048);
  expect(far.bake(gl, scene, options)).toBe(false);
  expect(renderer.render).toHaveBeenCalledTimes(4);
  far.setEnabled(true, 1024);
  expect([far.enabled, far.baked, far.light.visible]).toEqual([true, false, false]);
  expect(far.diagnostics().mapSize).toBe(1024);
  expect(() => far.setEnabled(true, 0)).toThrow('Invalid far shadow size');
  far.dispose();
  previous.dispose();
});

it('warms instanced shader variants with one representative, then restores full live counts and the sun', () => {
  const far = new FarShadow(1024);
  const scene = new T.Scene();
  const sun = new T.DirectionalLight();
  sun.castShadow = true;
  const people = new T.InstancedMesh(new T.BoxGeometry(), new T.MeshStandardMaterial(), 128),
    shadowTier = new T.InstancedMesh(people.geometry, people.material, 128),
    empty = new T.InstancedMesh(people.geometry, people.material, 0);
  people.castShadow = shadowTier.castShadow = true;
  shadowTier.visible = false;
  people.setMatrixAt(127, new T.Matrix4().makeTranslation(40, 0, 0));
  people.computeBoundingSphere();
  const beforeShadow = vi.fn(() => {
    // A pass-specific owner may choose its own instance count. Warmup must
    // cap its submission after that hook without replacing the live owner.
    shadowTier.count = 96;
  });
  shadowTier.onBeforeShadow = beforeShadow;
  scene.add(people, shadowTier, empty);
  const beforeCounts = [people.count, shadowTier.count, empty.count];
  const instanceStorage = people.instanceMatrix,
    beforeSphere = people.boundingSphere,
    drawGroup = new T.Group();
  sun.position.set(3, 10, 2);
  sun.target.position.set(1, 0, 1);
  const camera = sun.shadow.camera;
  [camera.left, camera.right, camera.top, camera.bottom] = [-38, 38, 38, -38];
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const before = {
    position: sun.position.clone(),
    target: sun.target.position.clone(),
    frustum: [camera.left, camera.right, camera.top, camera.bottom, camera.near, camera.far],
  };
  const seen: unknown[] = [],
    submittedCounts: number[] = [];
  const draw = vi.fn<T.WebGLRenderer['renderBufferDirect']>(
    (_camera, _scene, _geometry, _material, object) => {
      submittedCounts.push((object as T.InstancedMesh).count);
    },
  );
  const renderer = {
    shadowMap: { autoUpdate: false, enabled: true },
    target: null as T.WebGLRenderTarget | null,
    getRenderTarget() {
      return this.target;
    },
    setRenderTarget(target: T.WebGLRenderTarget | null) {
      this.target = target;
    },
    renderBufferDirect: draw,
    render: vi.fn(() => {
      // ShadowProxies can select a previously hidden coarse tier inside the
      // shadow pass, after the view draw list was built.
      for (const mesh of [people, shadowTier, empty]) {
        const depth = new T.MeshDepthMaterial();
        mesh.onBeforeShadow(gl, scene, camera, camera, mesh.geometry, depth, drawGroup);
        gl.renderBufferDirect(camera, scene, mesh.geometry, depth, mesh, null);
        mesh.onAfterShadow(gl, scene, camera, camera, mesh.geometry, depth, drawGroup);
      }
      expect(people.instanceMatrix).toBe(instanceStorage);
      expect(people.boundingSphere!.radius).toBeGreaterThan(20);
      seen.push({
        width: camera.right - camera.left,
        sun: sun.shadow.autoUpdate,
        far: [far.light.shadow.autoUpdate, far.light.shadow.needsUpdate],
        shadows: renderer.shadowMap.autoUpdate,
      });
    }),
  };
  const gl = renderer as unknown as T.WebGLRenderer;
  const bounds = new T.Box3(new T.Vector3(-400, -20, -300), new T.Vector3(400, 60, 300));
  const direction = new T.Vector3(1, 2, 1);
  expect(far.warmCasters(gl, scene, sun, direction, bounds)).toBe(true);
  expect(submittedCounts).toEqual([1, 1, 0]);
  // One pass covering the whole region, far map skipped, sun rendered.
  expect(seen).toHaveLength(1);
  expect((seen[0] as { width: number }).width).toBeGreaterThan(700);
  expect(seen[0]).toMatchObject({ sun: true, far: [false, false], shadows: true });
  const restored = () => {
    expect(sun.position.toArray()).toEqual(before.position.toArray());
    expect(sun.target.position.toArray()).toEqual(before.target.toArray());
    expect([camera.left, camera.right, camera.top, camera.bottom, camera.near, camera.far]).toEqual(
      before.frustum,
    );
    expect([sun.shadow.bias, sun.shadow.normalBias]).toEqual([-0.0004, 0.02]);
    expect(sun.shadow.needsUpdate).toBe(true);
    expect([renderer.shadowMap.autoUpdate, renderer.target]).toEqual([false, null]);
    expect([people.count, shadowTier.count, empty.count]).toEqual(beforeCounts);
    expect(shadowTier.onBeforeShadow).toBe(beforeShadow);
    expect(shadowTier.visible).toBe(false);
    expect(people.boundingSphere).toBe(beforeSphere);
    expect(renderer.renderBufferDirect).toBe(draw);
  };
  restored();
  draw.mockImplementationOnce(() => {
    expect(people.count).toBe(1);
    throw new Error('lost');
  });
  expect(() => far.warmCasters(gl, scene, sun, direction, bounds)).toThrow('lost');
  restored();
  renderer.shadowMap.enabled = false;
  expect(far.warmCasters(gl, scene, sun, direction, bounds)).toBe(false);
  expect(renderer.render).toHaveBeenCalledTimes(2);
  far.dispose();
});

it('submits one triangle per representative warmup material group and restores the full race draw', () => {
  const far = new FarShadow(1024),
    scene = new T.Scene(),
    sun = new T.DirectionalLight();
  sun.castShadow = true;
  const g = new T.BoxGeometry(),
    actor = new T.Mesh(g, new T.MeshStandardMaterial());
  g.setDrawRange(6, 24);
  scene.add(actor);
  const ranges: number[][] = [];
  const draw = vi.fn(() => {
    ranges.push([g.drawRange.start, g.drawRange.count]);
  });
  const gl = {
    shadowMap: { enabled: true, autoUpdate: false },
    setRenderTarget: vi.fn(),
    getRenderTarget: () => null,
    renderBufferDirect: draw,
    render() {
      for (const group of g.groups)
        renderer.renderBufferDirect(
          sun.shadow.camera,
          scene,
          g,
          actor.material,
          actor,
          group as unknown as T.Group,
        );
    },
  };
  const renderer = gl as unknown as T.WebGLRenderer;
  const bounds = new T.Box3(new T.Vector3(-5, 0, -5), new T.Vector3(5, 8, 5));
  try {
    far.warmCasters(renderer, scene, sun, new T.Vector3(1, 2, 1), bounds, true);
    expect(ranges).toEqual([
      [6, 0],
      [6, 3],
      [12, 3],
      [18, 3],
      [24, 3],
      [30, 0],
    ]);
    expect(far.diagnostics().warmup).toEqual({
      groups: 4,
      availableTriangles: 8,
      submittedTriangles: 4,
    });
    expect(g.drawRange).toEqual({ start: 6, count: 24 });
    expect(gl.renderBufferDirect).toBe(draw);
    expect(sun.shadow.needsUpdate).toBe(true);
  } finally {
    g.dispose();
    actor.material.dispose();
    far.dispose();
  }
});
