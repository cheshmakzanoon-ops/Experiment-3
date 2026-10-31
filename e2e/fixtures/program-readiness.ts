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
  const originalQuery = gl.getProgramParameter;
  const descriptor = Object.getOwnPropertyDescriptor(gl, 'getProgramParameter');
  const baselineQueries: WebGLProgram[] = [],
    coverageQueries: WebGLProgram[] = [];
  let phase: 'compile' | 'coverage' | 'render' = 'compile';
  gl.getProgramParameter = function (program, parameter) {
    if (parameter === extension.COMPLETION_STATUS_KHR) {
      if (phase === 'compile') baselineQueries.push(program);
      if (phase === 'coverage') coverageQueries.push(program);
    } else if (phase === 'coverage') {
      throw new Error('Readiness must only query COMPLETION_STATUS_KHR');
    }
    return originalQuery.call(this, program, parameter);
  };
  let yields = 0;
  try {
    renderer.setRenderTarget(target);
    // Submit an older live program, with no readiness wait of its own. It may
    // already finish on a fast driver; coverage must not depend on that timing.
    renderer.compile(oldScene, camera);
    const olderPrograms = [...(renderer.info.programs ?? [])];
    const compiling = renderer.compileAsync(scene, camera);
    renderer.setRenderTarget(null);
    await compiling;
    const programs = [...(renderer.info.programs ?? [])];
    phase = 'coverage';
    const complete = await waitForAllPrograms(renderer, {
      batchSize: 2,
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
      shaderErrorsEnabled: renderer.debug.checkShaderErrors,
      yields,
      glError: gl.getError(),
    };
  } finally {
    if (descriptor) Object.defineProperty(gl, 'getProgramParameter', descriptor);
    else Reflect.deleteProperty(gl, 'getProgramParameter');
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
