import * as T from 'three';
import { waitForAllPrograms } from '../../src/rendering/preparation.ts';

/** Native program statuses only: query instrumentation forwards each original
 * call and never manufactures pending/ready results or disables shader errors. */
export async function probeProgramReadiness(canvas: HTMLCanvasElement) {
  const renderer = new T.WebGLRenderer({ canvas });
  const gl = renderer.getContext();
  const extension = gl.getExtension('KHR_parallel_shader_compile');
  if (!extension) {
    renderer.dispose();
    throw new Error('KHR_parallel_shader_compile unavailable for readiness coverage probe');
  }
  const adapter = gl.getExtension('WEBGL_debug_renderer_info');
  const backend = adapter ? String(gl.getParameter(adapter.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const target = new T.WebGLRenderTarget(64, 64, { type: T.HalfFloatType });
  const scene = new T.Scene(),
    oldScene = new T.Scene(),
    camera = new T.PerspectiveCamera(45, 1, 0.1, 100),
    geometry = new T.BoxGeometry(),
    shared = new T.MeshStandardMaterial({ transparent: true, side: T.DoubleSide }),
    older = new T.MeshBasicMaterial({ color: 0x22aa88 });
  camera.position.z = 5;
  const vertices = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
  const weights = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
  const mesh = new T.Mesh(geometry, shared),
    instances = new T.InstancedMesh(geometry, shared, 1),
    skinned = new T.SkinnedMesh(geometry, shared),
    bone = new T.Bone(),
    skeleton = new T.Skeleton([bone]);
  skinned.add(bone);
  skinned.bind(skeleton);
  mesh.position.x = -1.5;
  skinned.position.x = 1.5;
  scene.add(mesh, instances, skinned, new T.HemisphereLight());
  oldScene.add(new T.Mesh(geometry, older));
  const baselineQueries: WebGLProgram[] = [],
    coverageQueries: WebGLProgram[] = [];
  const primedPrograms = new Set<WebGLProgram>();
  const queries = {
    compile: {} as Record<string, number>,
    prime: {} as Record<string, number>,
    render: {} as Record<string, number>,
  };
  let phase: 'compile' | 'coverage' | 'render' = 'compile';
  let cacheDepth = 0;
  let yields = 0;
  const restore: (() => void)[] = [];
  const wrap = (
    owner: object,
    key: string,
    observe: (
      original: (...args: unknown[]) => unknown,
      receiver: unknown,
      args: unknown[],
    ) => unknown,
  ) => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    const original = Reflect.get(owner, key) as (...args: unknown[]) => unknown;
    restore.push(() => {
      if (descriptor) Object.defineProperty(owner, key, descriptor);
      else Reflect.deleteProperty(owner, key);
    });
    Object.defineProperty(owner, key, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? false,
      writable: true,
      value: function (this: unknown, ...args: unknown[]) {
        return observe(original, this, args);
      },
    });
  };
  const observeReflection = (method: string, args: unknown[]) => {
    if (phase === 'coverage' && cacheDepth === 0)
      throw new Error(`Readiness queried ${method} outside native cache initialization`);
    const counters = queries[phase === 'coverage' ? 'prime' : phase];
    counters[method] = (counters[method] ?? 0) + 1;
    if (phase === 'coverage' && method === 'getProgramInfoLog')
      primedPrograms.add(args[0] as WebGLProgram);
  };
  try {
    wrap(gl, 'getProgramParameter', (original, receiver, args) => {
      if (args[1] === extension.COMPLETION_STATUS_KHR) {
        if (phase === 'compile') baselineQueries.push(args[0] as WebGLProgram);
        if (phase === 'coverage') coverageQueries.push(args[0] as WebGLProgram);
      } else {
        const parameter =
          args[1] === gl.LINK_STATUS
            ? 'LINK_STATUS'
            : args[1] === gl.ACTIVE_UNIFORMS
              ? 'ACTIVE_UNIFORMS'
              : args[1] === gl.ACTIVE_ATTRIBUTES
                ? 'ACTIVE_ATTRIBUTES'
                : String(args[1]);
        observeReflection(`getProgramParameter:${parameter}`, args);
      }
      return Reflect.apply(original, receiver, args);
    });
    for (const method of [
      'getProgramInfoLog',
      'getShaderInfoLog',
      'getActiveUniform',
      'getActiveAttrib',
      'getUniformLocation',
      'getAttribLocation',
    ])
      wrap(gl, method, (original, receiver, args) => {
        observeReflection(method, args);
        return Reflect.apply(original, receiver, args);
      });
    renderer.setRenderTarget(target);
    // Submit an older live program, with no readiness wait of its own. It may
    // already finish on a fast driver; coverage must not depend on that timing.
    renderer.compile(oldScene, camera);
    const olderPrograms = [...(renderer.info.programs ?? [])];
    const compiling = renderer.compileAsync(scene, camera);
    renderer.setRenderTarget(null);
    await compiling;
    const programs = [...(renderer.info.programs ?? [])];
    // Observe the actual library cache getters rather than inventing a helper
    // phase callback. All native reflection/log calls must be nested here.
    for (const program of programs)
      for (const method of ['getUniforms', 'getAttributes'])
        wrap(program, method, (original, receiver, args) => {
          cacheDepth++;
          try {
            return Reflect.apply(original, receiver, args);
          } finally {
            cacheDepth--;
          }
        });
    phase = 'coverage';
    const complete = await waitForAllPrograms(renderer, {
      batchSize: 2,
      initializeCaches: true,
      yieldControl: async () => {
        yields++;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      },
    });
    phase = 'render';
    const before = programs.length;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    return {
      three: T.REVISION,
      backend,
      complete,
      sharedMaterialCount: new Set([mesh.material, instances.material, skinned.material]).size,
      generatedPrograms: before,
      programsAfterDraw: renderer.info.programs?.length ?? 0,
      baselineChecked: new Set(baselineQueries).size,
      allChecked: new Set(coverageQueries).size,
      olderPrograms: olderPrograms.length,
      olderChecked: olderPrograms.every((program) => coverageQueries.includes(program.program)),
      eachChecked: programs.every((program) => coverageQueries.includes(program.program)),
      cacheQueries: queries,
      eachPrimed: programs.every((program) => primedPrograms.has(program.program)),
      shaderErrorsEnabled: renderer.debug.checkShaderErrors,
      yields,
      glError: gl.getError(),
    };
  } finally {
    for (const undo of restore.reverse()) undo();
    renderer.setRenderTarget(null);
    skeleton.dispose();
    instances.dispose();
    geometry.dispose();
    shared.dispose();
    older.dispose();
    target.dispose();
    renderer.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
