import { cacheRetainedArrayUniforms } from '../../src/rendering/uniform-array-cache.ts';
import { compileSceneTarget } from '../../src/rendering/preparation.ts';

// The complete installed renderer and uniform setters run against a recorded
// GL endpoint exposing the selected shader interface. Snapshots prove exact
// per-draw uniform payloads and submission descriptors, not pixels or GPU time.
import assert from 'node:assert/strict';
import { nativeRendererHarness } from './native-renderer-harness.mjs';

function arrayFixture() {
  const h = nativeRendererHarness(),
    { T, gl, renderer } = h;
  const activeUniforms = [
    { name: 'modelViewMatrix', type: 0x8b5c, size: 1 },
    { name: 'roughness', type: 0x1406, size: 1 },
    { name: 'apexFogVolumes[0]', type: 0x8b52, size: 3 },
    { name: 'studioGpShape[0]', type: 0x8b52, size: 12 },
    { name: 'studioGpFront[0]', type: 0x8b52, size: 12 },
    { name: 'directionalShadowMatrix[0]', type: 0x8b5c, size: 2 },
  ];
  const nativeParameter = gl.getProgramParameter,
    nativeUse = gl.useProgram;
  gl.getProgramParameter = (program, key) =>
    key === gl.ACTIVE_UNIFORMS ? activeUniforms.length : nativeParameter(program, key);
  gl.getActiveUniform = (_program, index) => activeUniforms[index];
  gl.getUniformLocation = (program, name) => ({ program, name });
  const states = new Map(),
    uploads = [],
    draws = [];
  let current = null;
  gl.useProgram = (program) => {
    current = program;
    nativeUse(program);
    if (!states.has(program))
      states.set(
        program,
        new Map(
          activeUniforms.map((u) => [
            u.name,
            Array(u.size * (u.type === 0x8b5c ? 16 : u.type === 0x8b52 ? 4 : 1)).fill(0),
          ]),
        ),
      );
  };
  const bytes = (value) => {
    const f =
      value instanceof Float32Array
        ? value.slice()
        : Float32Array.from(typeof value === 'number' ? [value] : value);
    return Array.from(new Uint32Array(f.buffer));
  };
  const upload = (method, location, value, transpose) => {
    assert.equal(location.program, current, 'native location must belong to bound program');
    if (transpose !== undefined) assert.equal(transpose, false);
    const data = bytes(value),
      before = states.get(current).get(location.name);
    uploads.push({
      method,
      program: current,
      name: location.name,
      data,
      identical: !!before && before.every((v, i) => v === data[i]) && before.length === data.length,
      face: renderer.getActiveCubeFace(),
    });
    // The endpoint retains the active uniform's native size; short uploads
    // replace only the supplied prefix, while oversized inputs leave state.
    if (data.length <= before.length)
      states.get(current).set(location.name, [...data, ...before.slice(data.length)]);
  };
  gl.uniform1f = (location, value) => upload('uniform1f', location, value);
  gl.uniform4fv = (location, value) => upload('uniform4fv', location, value);
  gl.uniformMatrix4fv = (location, transpose, value) =>
    upload('uniformMatrix4fv', location, value, transpose);
  for (const method of [
    'drawElements',
    'drawArrays',
    'drawElementsInstanced',
    'drawArraysInstanced',
  ]) {
    const native = gl[method];
    gl[method] = (...args) => {
      native(...args);
      draws.push({
        method,
        args,
        face: renderer.getActiveCubeFace(),
        shader: current.shaders.map((s) => s.source),
        values: Object.fromEntries(
          [...states.get(current)].map(([name, data]) => [name, [...data]]),
        ),
      });
    };
  }
  const scene = new T.Scene(),
    geometry = new T.BoxGeometry(1, 1, 1);
  const shared = {
    apexFogVolumes: { value: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) },
    studioGpShape: { value: Array.from({ length: 12 }, (_, i) => new T.Vector4(i, 0.2, 0.3, 0.4)) },
    studioGpFront: {
      value: Array.from({ length: 12 }, (_, i) => new T.Vector4(i + 20, 0.6, 0.7, 0.8)),
    },
  };
  const materials = Array.from({ length: 4 }, (_, i) => {
    const material = new T.MeshStandardMaterial({ roughness: i % 2 ? 0.4 : 0.31 });
    material.defines = { PROBE_VARIANT: Math.floor(i / 2) };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared);
      shader.fragmentShader =
        'uniform vec4 apexFogVolumes[3];\nuniform vec4 studioGpShape[12];\nuniform vec4 studioGpFront[12];\n' +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        'for (int i = 0; i < 3; i++) outgoingLight += apexFogVolumes[i].xyz * 0.0001;\nfor (int i = 0; i < 12; i++) outgoingLight += (studioGpShape[i].xyz + studioGpFront[i].xyz) * 0.0001;\n#include <opaque_fragment>',
      );
    };
    return material;
  });
  const meshes = materials.map((material, i) => {
    const mesh = new T.Mesh(geometry, material);
    mesh.position.set(i - 1.5, 0, -5);
    mesh.frustumCulled = false;
    mesh.renderOrder = i;
    scene.add(mesh);
    return mesh;
  });
  const lights = [new T.DirectionalLight(), new T.DirectionalLight()];
  lights.forEach((light, i) => {
    light.castShadow = true;
    light.shadow.matrix.elements[12] = i + 1;
    scene.add(light);
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = false;
  const target = new T.WebGLCubeRenderTarget(16),
    cube = new T.CubeCamera(0.1, 20, target);
  const prepare = async (cached = false) => {
    if (cached) {
      await compileSceneTarget(renderer, scene, cube.children[0], target, undefined, {
        cancelled: () => false,
      });
    } else {
      renderer.setRenderTarget(target);
      await renderer.compileAsync(scene, cube.children[0]);
      renderer.info.programs.forEach((program) => program.getUniforms());
      renderer.setRenderTarget(null);
    }
    return [...renderer.info.programs];
  };
  return {
    ...h,
    scene,
    geometry,
    shared,
    materials,
    meshes,
    lights,
    cube,
    target,
    uploads,
    draws,
    states,
    prepare,
    capture() {
      cube.update(renderer, scene);
    },
    disposeAll() {
      materials.forEach((m) => m.dispose());
      geometry.dispose();
      target.dispose();
      h.dispose();
    },
  };
}

async function baseline() {
  const f = arrayFixture();
  try {
    const programs = await f.prepare();
    assert.equal(programs.length, 2);
    assert.equal(f.uploads.length, 0, 'native compile and metadata do not upload values');
    f.capture();
    const first = f.uploads.filter((e) => e.name.endsWith('[0]'));
    assert.equal(first.length, 96);
    assert.equal(first.filter((e) => e.identical).length, 88);
    assert.equal(f.draws.length, 24);
    const before = f.uploads.length;
    f.capture();
    const second = f.uploads.slice(before).filter((e) => e.name.endsWith('[0]'));
    assert.equal(second.length, 96);
    assert.ok(second.every((e) => e.identical));
    return {
      nativePrograms: programs.length,
      firstCaptureDraws: 24,
      firstArrayUploads: first.length,
      firstIdenticalReuploads: 88,
      repeatArrayUploads: second.length,
      repeatIdenticalReuploads: second.length,
      scalarAndObjectMatricesRetained: true,
    };
  } finally {
    f.disposeAll();
  }
}

async function scenario(cached, actions) {
  const f = arrayFixture();
  try {
    const programs = await f.prepare(cached);
    if (cached) {
      assert.equal(
        programs.reduce((n, p) => n + cacheRetainedArrayUniforms(f.renderer, p.getUniforms()), 0),
        0,
      );
    }
    await actions(f, cached);
    return {
      draws: f.draws,
      arrayUploads: f.uploads.filter((e) => e.name.endsWith('[0]')),
      ordinaryUploads: f.uploads.filter((e) => !e.name.endsWith('[0]')),
    };
  } finally {
    f.disposeAll();
  }
}
const normalize = (entries) => entries.map(({ program, ...rest }) => ({ ...rest }));
async function check(name, actions) {
  const base = await scenario(false, actions),
    cached = await scenario(true, actions);
  assert.deepEqual(
    cached.draws,
    base.draws,
    name + ': every real cube draw receives identical shader, arguments and uniform bit payloads',
  );
  assert.deepEqual(
    normalize(cached.ordinaryUploads),
    normalize(base.ordinaryUploads),
    name + ': scalar and object-matrix behavior unchanged',
  );
  assert.ok(
    cached.arrayUploads.length < base.arrayUploads.length,
    name + ': selected unchanged uploads are actually omitted',
  );
  if (name === 'two complete captures, same values and program switches') {
    assert.equal(base.arrayUploads.length, 192);
    assert.equal(
      cached.arrayUploads.length,
      8,
      'each of four arrays initializes once per retained program',
    );
  }
  return {
    name,
    draws: base.draws.length,
    nativeArrayUploadsBefore: base.arrayUploads.length,
    nativeArrayUploadsAfter: cached.arrayUploads.length,
  };
}
const cases = new Map();
cases.set('two complete captures, same values and program switches', (f) => {
  f.capture();
  f.capture();
});
cases.set('in-place frame changes update every program owner', (f) => {
  f.capture();
  f.shared.apexFogVolumes.value[0] = 15;
  f.shared.studioGpShape.value[0].y = 0.99;
  f.shared.studioGpFront.value[11].w = -0;
  f.lights[0].shadow.matrix.elements[12] = -10;
  f.capture();
});
cases.set('native same-size flatten scratch changes between array owners', (f) => {
  f.capture();
  [f.shared.studioGpShape.value, f.shared.studioGpFront.value] = [
    f.shared.studioGpFront.value,
    f.shared.studioGpShape.value,
  ];
  f.capture();
});
cases.set('same program materials may hold different aliased array values', (f) => {
  const uniforms = f.renderer.properties.get(f.materials[1]).uniforms;
  uniforms.studioGpFront = {
    value: f.shared.studioGpFront.value.map((v) => v.clone().addScalar(100)),
  };
  f.capture();
  uniforms.studioGpFront.value[0].x -= 25;
  f.capture();
});
cases.set('nonzero-offset typed view and signed zero payload', (f) => {
  const backing = new Float32Array(20);
  backing.fill(5);
  f.shared.apexFogVolumes.value = backing.subarray(4, 16);
  f.capture();
  f.shared.apexFogVolumes.value[0] = -0;
  f.capture();
  f.shared.apexFogVolumes.value[0] = +0;
  f.capture();
});
cases.set('distinct non-first NaN payload bits are not conflated', (f) => {
  f.capture();
  const values = f.shared.apexFogVolumes.value;
  const bits = new Uint32Array(values.buffer, values.byteOffset, values.length);
  bits[1] = 0x7fc00001;
  f.capture();
  bits[1] = 0x7fc00002;
  f.capture();
});
cases.set('ordinary array bypass invalidates the preceding native cache', (f) => {
  const original = f.shared.apexFogVolumes.value;
  f.capture();
  f.shared.apexFogVolumes.value = Array.from(original, (x) => x + 100);
  f.capture();
  f.shared.apexFogVolumes.value = original;
  f.capture();
});
cases.set('SharedArrayBuffer bypass remains native and invalidates cache', (f) => {
  const original = f.shared.apexFogVolumes.value;
  f.capture();
  const shared = new Float32Array(new SharedArrayBuffer(48));
  shared.fill(50);
  f.shared.apexFogVolumes.value = shared;
  f.capture();
  shared[0] = 25;
  f.capture();
  f.shared.apexFogVolumes.value = original;
  f.capture();
});
cases.set('short native array uploads preserve the untouched suffix and invalidate cache', (f) => {
  const original = f.shared.apexFogVolumes.value;
  f.capture();
  f.shared.apexFogVolumes.value = new Float32Array([5, 6, 7, 8]);
  f.capture();
  f.shared.apexFogVolumes.value = original;
  f.capture();
});
cases.set('a native upload that mutates then throws cannot retain the old snapshot', (f) => {
  f.capture();
  const program = f.renderer.properties.get(f.materials[0]).currentProgram;
  const owner = program.getUniforms().map.apexFogVolumes;
  const native = f.gl.uniform4fv,
    failure = new Error('native upload failed after write');
  f.gl.useProgram(program.program);
  f.gl.uniform4fv = (...args) => {
    native(...args);
    throw failure;
  };
  assert.throws(
    () => owner.setValue(f.gl, new Float32Array(12).fill(50)),
    (error) => error === failure,
  );
  f.gl.uniform4fv = native;
  f.capture();
});
cases.set('foreign contexts bypass and invalidate the owner cache', (f) => {
  f.capture();
  const program = f.renderer.properties.get(f.materials[0]).currentProgram;
  const owner = program.getUniforms().map.apexFogVolumes;
  const foreign = {
    uniform4fv(location, data) {
      assert.equal(this, foreign);
      assert.equal(location, owner.addr);
      assert.ok(data instanceof Float32Array);
    },
  };
  owner.setValue(foreign, f.shared.apexFogVolumes.value);
  f.capture();
});
cases.set('foreign native setter receivers forward and invalidate retained values', (f) => {
  f.capture();
  const program = f.renderer.properties.get(f.materials[0]).currentProgram;
  const owner = program.getUniforms().map.apexFogVolumes;
  f.gl.useProgram(program.program);
  const foreignOwner = { addr: owner.addr, size: owner.size };
  owner.setValue.call(foreignOwner, f.gl, new Float32Array(12).fill(70));
  f.capture();
});
cases.set('a replaced native location is initialized even for identical bits', (f) => {
  f.capture();
  const program = f.renderer.properties.get(f.materials[0]).currentProgram;
  const owner = program.getUniforms().map.apexFogVolumes;
  f.gl.useProgram(program.program);
  owner.addr = f.gl.getUniformLocation(program.program, 'apexFogVolumes[0]');
  f.states.get(program.program).set('apexFogVolumes[0]', Array(12).fill(0));
  const before = f.uploads.length;
  owner.setValue(f.gl, f.shared.apexFogVolumes.value);
  assert.equal(f.uploads.length, before + 1, 'new native location must initialize its value');
  f.capture();
});
cases.set('disposed programs and recompiled native locations start cold', async (f, cached) => {
  f.capture();
  const old = [...f.renderer.info.programs];
  f.materials.forEach((material) => material.dispose());
  assert.equal(f.renderer.info.programs.length, 0);
  const fresh = await f.prepare(cached);
  assert.ok(fresh.every((p) => !old.includes(p)));
  if (cached)
    assert.equal(
      fresh.reduce((n, p) => n + cacheRetainedArrayUniforms(f.renderer, p.getUniforms()), 0),
      0,
    );
  f.capture();
});
export const arrayUniformProofNames = [
  'native baseline demonstrates repeated identical array uploads',
  ...cases.keys(),
];
export async function runArrayUniformProof(name) {
  if (name === arrayUniformProofNames[0]) return { name, ...(await baseline()) };
  const action = cases.get(name);
  if (!action) throw new Error('Unknown native array uniform proof');
  return check(name, action);
}
