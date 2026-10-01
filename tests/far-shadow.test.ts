import { expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  FAR_SHADOW_MARK,
  FarShadow,
  farShadowChunks,
  installFarShadowChunks,
} from '../src/rendering/far-shadow.ts';

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
  expect(far.light.shadow.intensity).toBe(FAR_SHADOW_MARK);
  expect(far.light.intensity).toBe(0);
  expect(far.light.shadow.autoUpdate).toBe(false);
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
  expect(far.bake(gl, scene, options)).toBe(true);
  expect(seen).toEqual([
    {
      car: false,
      hiddenAlready: false,
      grove: true,
      sun: [false, false],
      far: true,
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
  // A failed bake restores the same state; a disabled far map never bakes.
  renderer.render.mockImplementationOnce(() => {
    throw new Error('lost');
  });
  expect(() => far.bake(gl, scene, options)).toThrow('lost');
  expect([car.visible, grove.castShadow, sun.shadow.autoUpdate]).toEqual([true, false, true]);
  expect(far.bakes).toBe(1);
  far.setEnabled(false, 1024);
  expect(far.bake(gl, scene, options)).toBe(false);
  expect(renderer.render).toHaveBeenCalledTimes(2);
  expect(() => far.setEnabled(true, 0)).toThrow('Invalid far shadow size');
  far.dispose();
  previous.dispose();
});
