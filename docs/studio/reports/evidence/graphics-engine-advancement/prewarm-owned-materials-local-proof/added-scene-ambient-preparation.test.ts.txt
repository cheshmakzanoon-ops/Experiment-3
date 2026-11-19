import { expect, it, vi } from 'vitest';
import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SceneAmbientPass } from '../src/rendering/scene-ambient-pass.ts';
import { programHarness } from './helpers/three-program-harness.ts';

type PassOwners = {
  obscurance: T.WebGLRenderTarget;
  blurred: T.WebGLRenderTarget;
  obscuranceMaterial: T.ShaderMaterial;
  blurMaterial: T.ShaderMaterial;
  compositeMaterial: T.ShaderMaterial;
  quad: FullScreenQuad;
};

function fixture() {
  const h = programHarness(),
    pass = new SceneAmbientPass(new T.Scene(), new T.PerspectiveCamera(), 4),
    passOwners = pass as unknown as PassOwners,
    writeBuffer = new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType });
  pass.setSize(960, 600);
  let mesh!: T.Object3D, camera!: T.Camera;
  passOwners.quad.render({
    render(object: T.Object3D, view: T.Camera) {
      mesh = object;
      camera = view;
    },
  } as unknown as T.WebGLRenderer);
  const originalMaterial = passOwners.quad.material;
  const materials = [
    passOwners.obscuranceMaterial,
    passOwners.blurMaterial,
    passOwners.compositeMaterial,
  ];
  const materialState = () =>
    materials.map((material) => ({
      version: material.version,
      defines: { ...material.defines },
      vertexShader: material.vertexShader,
      fragmentShader: material.fragmentShader,
      uniforms: Object.fromEntries(
        Object.entries(material.uniforms).map(([name, uniform]) => {
          const value = uniform.value;
          return [
            name,
            value instanceof T.Vector2 || value instanceof T.Vector3 || value instanceof T.Matrix4
              ? value.toArray()
              : value,
          ];
        }),
      ),
    }));
  return {
    ...h,
    pass,
    passOwners,
    materials,
    writeBuffer,
    mesh,
    camera,
    originalMaterial,
    materialState,
    dispose() {
      pass.dispose();
      originalMaterial.dispose();
      writeBuffer.dispose();
    },
  };
}

it('prepares the actual enabled fullscreen owners before scene work without drawing or changing pass state', async () => {
  const h = fixture(),
    unrelated = Object.assign(new T.MeshStandardMaterial(), {
      defines: { UNRELATED_PENDING: 1 },
    }),
    geometry = new T.BoxGeometry();
  h.renderer.compile(new T.Mesh(geometry, unrelated), new T.PerspectiveCamera());
  const unrelatedProgram = [...h.owners.get(unrelated)!.values()][0];
  const originalCompile = h.renderer.compileAsync.bind(h.renderer);
  const compilations: {
    object: T.Object3D;
    camera: T.Camera;
    material: T.Material;
    target: T.WebGLRenderTarget | null;
  }[] = [];
  h.renderer.compileAsync = (object, camera, scene) => {
    compilations.push({
      object,
      camera,
      material: (object as T.Mesh).material as T.Material,
      target: h.renderer.getRenderTarget(),
    });
    return originalCompile(object, camera, scene);
  };
  const forbidden = Object.fromEntries(
    ['drawArrays', 'drawElements', 'flush', 'finish'].map((method) => [
      method,
      vi.fn(() => {
        throw new Error(`Unexpected native ${method}`);
      }),
    ]),
  );
  Object.assign(h.renderer.getContext(), forbidden);
  const before = h.state(),
    passBefore = h.pass.diagnostics(),
    materialBefore = h.materialState();
  h.stage('before-scene');
  await h.pass.prepare(h.renderer, h.writeBuffer, () => false);
  expect(compilations).toEqual(
    [h.passOwners.obscurance, h.passOwners.blurred, h.writeBuffer].map((target, index) => ({
      object: h.mesh,
      camera: h.camera,
      material: h.materials[index],
      target,
    })),
  );
  expect(h.camera).toBeInstanceOf(T.OrthographicCamera);
  expect(h.state()).toEqual(before);
  expect(h.passOwners.quad.material).toBe(h.originalMaterial);
  expect(h.pass.diagnostics()).toEqual(passBefore);
  expect(h.materialState()).toEqual(materialBefore);
  expect(h.render).not.toHaveBeenCalled();
  for (const operation of Object.values(forbidden)) expect(operation).not.toHaveBeenCalled();
  const owned = h.materials.flatMap((material) => [...h.owners.get(material)!.values()]);
  expect(owned).toHaveLength(3);
  expect(h.queries.filter((query) => query.kind === 'program-log')).toEqual(
    owned.map((program) => ({
      kind: 'program-log',
      program: program.program,
      stage: 'before-scene',
    })),
  );
  expect(h.queries.some((query) => query.program === unrelatedProgram.program)).toBe(false);

  // Real Three first-use initialization is cached: reentry and every actual
  // fullscreen draw target, including the second blur, add no native query.
  const queries = [...h.queries];
  await h.pass.prepare(h.renderer, h.writeBuffer, () => false);
  h.stage('after-scene');
  for (const [material, target] of [
    [h.passOwners.obscuranceMaterial, h.passOwners.obscurance],
    [h.passOwners.blurMaterial, h.passOwners.blurred],
    [h.passOwners.blurMaterial, h.passOwners.obscurance],
    [h.passOwners.compositeMaterial, h.writeBuffer],
  ] as const) {
    h.passOwners.quad.material = material;
    h.renderer.setRenderTarget(target);
    h.passOwners.quad.render(h.renderer);
  }
  expect(h.queries).toEqual(queries);
  expect(h.materials.flatMap((material) => [...h.owners.get(material)!.values()])).toEqual(owned);
  unrelated.dispose();
  geometry.dispose();
  h.dispose();
});

it('prepares only the composite with AO disabled and acquires its actual screen-target variant', async () => {
  const h = fixture();
  h.pass.ambientOcclusion = false;
  await h.pass.prepare(h.renderer, h.writeBuffer, () => false);
  expect(h.owners.has(h.passOwners.obscuranceMaterial)).toBe(false);
  expect(h.owners.has(h.passOwners.blurMaterial)).toBe(false);
  const linear = [...h.owners.get(h.passOwners.compositeMaterial)!.values()];
  expect(linear).toHaveLength(1);
  const before = h.state();
  h.pass.renderToScreen = true;
  await h.pass.prepare(h.renderer, h.writeBuffer, () => false);
  const screen = [...h.owners.get(h.passOwners.compositeMaterial)!.values()];
  expect(screen).toHaveLength(2);
  expect(screen).toContain(linear[0]);
  expect(h.state()).toEqual(before);
  expect(h.render).not.toHaveBeenCalled();
  expect(h.queries.filter((query) => query.kind === 'program-log')).toHaveLength(2);
  const queries = [...h.queries];
  h.passOwners.quad.material = h.passOwners.compositeMaterial;
  h.renderer.setRenderTarget(null);
  h.passOwners.quad.render(h.renderer);
  expect(h.queries).toEqual(queries);
  h.dispose();
});

it.each(['disabled', 'cancelled'] as const)(
  'does no native preparation when initially %s',
  async (state) => {
    const h = fixture(),
      before = h.state();
    h.pass.enabled = state !== 'disabled';
    await h.pass.prepare(h.renderer, h.writeBuffer, () => state === 'cancelled');
    expect(h.created).toEqual([]);
    expect(h.queries).toEqual([]);
    expect(h.render).not.toHaveBeenCalled();
    expect(h.state()).toEqual(before);
    expect(h.passOwners.quad.material).toBe(h.originalMaterial);
    h.dispose();
  },
);

it('restores borrowed state before awaiting, cancels metadata, and reuses retained programs on live reentry', async () => {
  const h = fixture(),
    before = h.state(),
    originalCompile = h.renderer.compileAsync.bind(h.renderer);
  let cancelled = false,
    finish: (value: T.Object3D) => void = () => {};
  h.renderer.compileAsync = (object, camera) => {
    h.renderer.compile(object, camera);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const pending = h.pass.prepare(h.renderer, h.writeBuffer, () => cancelled);
  expect(h.created).toHaveLength(1);
  const retained = h.cache.programs[0];
  expect(h.state()).toEqual(before);
  expect(h.passOwners.quad.material).toBe(h.originalMaterial);
  expect(h.queries).toEqual([]);
  cancelled = true;
  finish(h.mesh);
  await pending;
  expect(h.created).toHaveLength(1);
  expect(h.queries).toEqual([]);
  cancelled = false;
  h.renderer.compileAsync = originalCompile;
  await h.pass.prepare(h.renderer, h.writeBuffer, () => cancelled);
  expect(h.cache.programs).toHaveLength(3);
  expect(h.cache.programs).toContain(retained);
  expect(h.queries.filter((query) => query.kind === 'program-log')).toHaveLength(3);
  expect(h.state()).toEqual(before);
  h.dispose();
});

it('does not query or recreate native owners when the pass is disposed during compilation', async () => {
  const h = fixture(),
    before = h.state();
  let finish: (value: T.Object3D) => void = () => {};
  h.renderer.compileAsync = (object, camera) => {
    h.renderer.compile(object, camera);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const pending = h.pass.prepare(h.renderer, h.writeBuffer, () => false);
  h.pass.dispose();
  expect(h.deleted).toHaveLength(1);
  h.retire();
  finish(h.mesh);
  await pending;
  expect(h.created).toHaveLength(1);
  expect(h.queries).toEqual([]);
  expect(h.render).not.toHaveBeenCalled();
  expect(h.state()).toEqual(before);
  expect(h.passOwners.quad.material).toBe(h.originalMaterial);
  h.originalMaterial.dispose();
  h.writeBuffer.dispose();
});

it('restores state on native compilation failure and leaves later owners untouched', async () => {
  const h = fixture(),
    before = h.state();
  h.failCompile('APEX depth-aware obscurance blur');
  await expect(h.pass.prepare(h.renderer, h.writeBuffer, () => false)).rejects.toThrow(
    'Interrupted APEX depth-aware obscurance blur compilation',
  );
  expect(h.state()).toEqual(before);
  expect(h.passOwners.quad.material).toBe(h.originalMaterial);
  expect(h.owners.has(h.passOwners.compositeMaterial)).toBe(false);
  expect(h.queries.filter((query) => query.kind === 'program-log')).toHaveLength(1);
  expect(h.render).not.toHaveBeenCalled();
  h.failCompile(null);
  await h.pass.prepare(h.renderer, h.writeBuffer, () => false);
  expect(h.created).toHaveLength(3);
  expect(h.queries.filter((query) => query.kind === 'program-log')).toHaveLength(3);
  h.dispose();
});

it('propagates asynchronous compile rejection without resolving metadata or advancing a pass', async () => {
  const h = fixture(),
    before = h.state(),
    error = new Error('Parallel compile failed');
  h.renderer.compileAsync = (object, camera) => {
    h.renderer.compile(object, camera);
    return Promise.reject(error);
  };
  await expect(h.pass.prepare(h.renderer, h.writeBuffer, () => false)).rejects.toBe(error);
  expect(h.created).toHaveLength(1);
  expect(h.queries).toEqual([]);
  expect(h.state()).toEqual(before);
  expect(h.passOwners.quad.material).toBe(h.originalMaterial);
  expect(h.pass.frames).toBe(0);
  h.dispose();
});
