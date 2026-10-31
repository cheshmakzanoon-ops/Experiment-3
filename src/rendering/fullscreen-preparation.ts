import * as T from 'three';
import { waitForAllPrograms, type ProgramReadinessOptions } from './preparation.ts';

/** Borrowed pass resources: the compilation owner never disposes either. */
export interface FullscreenCompilationSubject {
  material: T.Material;
  target: T.WebGLRenderTarget | null;
}

/** Explicit fullscreen programs, not a discovery render. Three's FullScreenQuad
 * renders an ordinary Mesh against its empty-scene fallback. Keep identical
 * position/uv attributes and camera without accessing its private mesh.
 * This narrow plan is bounded to AO, blur and composite (three submissions).
 * Native compile calls are synchronous/non-preemptible. The existing 45s budget
 * starts after restored submission and covers all-live readiness/cache work. */
export async function compileFullscreenTargets(
  renderer: T.WebGLRenderer,
  subjects: readonly FullscreenCompilationSubject[],
  options: ProgramReadinessOptions = {},
) {
  if (subjects.length > 3) throw new Error('Fullscreen preparation plan exceeds three materials');
  if (options.cancelled?.()) return 'cancelled' as const;
  if (!subjects.length) return 'complete' as const;
  const previous = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace(),
    mip = renderer.getActiveMipmapLevel();
  const viewport = renderer.getViewport(new T.Vector4());
  const scissor = renderer.getScissor(new T.Vector4());
  const scissorTest = renderer.getScissorTest();
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    'position',
    new T.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
  );
  geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const scene = new T.Scene();
  const mesh = new T.Mesh(geometry, subjects[0].material);
  scene.add(mesh);
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  try {
    for (const subject of subjects) {
      if (options.cancelled?.()) return 'cancelled' as const;
      if (renderer.getContext().isContextLost())
        throw new Error('WebGL context lost during fullscreen preparation');
      mesh.material = subject.material;
      renderer.setRenderTarget(subject.target);
      renderer.compile(scene, camera);
    }
  } finally {
    try {
      renderer.setRenderTarget(previous, face, mip);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
    } finally {
      scene.remove(mesh);
      geometry.dispose();
    }
  }
  // No binding, wrapper or borrowed-resource ownership survives the await.
  return waitForAllPrograms(renderer, options);
}
