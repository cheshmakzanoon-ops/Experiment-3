import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { SceneAmbientPass } from '../src/rendering/scene-ambient-pass.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';
import {
  TEMPORAL_AA,
  TemporalAA,
  temporalDepthPrecision,
  temporalDepthTolerance,
} from '../src/rendering/studio/temporal-aa.ts';

type Internals = {
  material: T.ShaderMaterial;
  history: [T.WebGLRenderTarget, T.WebGLRenderTarget];
};

const owners: TemporalAA[] = [];
beforeEach(() => {
  studioUniforms.studioCarCount.value = 0;
  studioUniforms.studioFrameDt.value = 0;
  for (const field of [studioUniforms.studioCarNow, studioUniforms.studioCarPrev])
    for (const matrix of field.value) matrix.identity();
});
afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose();
  studioUniforms.studioCarCount.value = 0;
});

function camera(near = 0.045, far = 7000) {
  const c = new T.PerspectiveCamera(58, 16 / 9, near, far);
  c.position.set(0, 1.2, 6);
  c.lookAt(0, 0.8, 0);
  c.updateMatrixWorld(true);
  return c;
}

function harness() {
  const temporal = new TemporalAA();
  owners.push(temporal);
  temporal.enabled = true;
  temporal.setSize(1600, 900);
  const internals = temporal as unknown as Internals;
  const draws: {
    valid: number;
    inverse: T.Matrix4;
    world: T.Matrix4;
    previous: T.Matrix4;
    previousCars: T.Matrix4[];
    range: T.Vector2;
    precision: T.Vector2;
  }[] = [];
  let fail = false;
  const renderer = {
    setRenderTarget: vi.fn(),
    render: () => {
      if (fail) throw new Error('deliberate resolve failure');
      const u = internals.material.uniforms;
      // Snapshot the matrices actually bound to the draw, before publication
      // updates the retained matrices for the next frame.
      draws.push({
        valid: u.historyValid.value,
        inverse: u.projectionInverse.value.clone(),
        world: u.cameraWorld.value.clone(),
        previous: u.previousViewProjection.value.clone(),
        previousCars: u.studioCarPrev.value.map((m: T.Matrix4) => m.clone()),
        range: u.previousRange.value.clone(),
        precision: u.depthPrecision.value.clone(),
      });
    },
  } as unknown as T.WebGLRenderer;
  const color = new T.Texture(),
    depth = new T.Texture();
  const frame = (c: T.PerspectiveCamera, dt = 1 / 60) => {
    temporal.begin(c, true, dt);
    const projection = c.projectionMatrix.clone();
    temporal.end(c);
    const image = temporal.resolve(renderer, c, color, depth);
    return { projection, image };
  };
  return {
    temporal,
    internals,
    draws,
    renderer,
    color,
    depth,
    frame,
    fail: (value: boolean) => (fail = value),
  };
}

function sample(point: T.Vector3, projection: T.Matrix4, view: T.Matrix4) {
  const p = new T.Vector4(point.x, point.y, point.z, 1).applyMatrix4(view).applyMatrix4(projection);
  return p.multiplyScalar(1 / p.w);
}

describe('temporal depth reprojection', () => {
  it('uses the current inverse and the previous successful jittered grid, including off-axis views', () => {
    const h = harness(),
      c = camera();
    c.setViewOffset(1800, 1000, 70, 30, 1600, 900);
    const oldView = c.matrixWorldInverse.clone();
    const old = h.frame(c);
    c.position.set(0.37, 1.28, 5.6);
    c.lookAt(0.1, 0.8, -0.2);
    c.fov = 55;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    const current = h.frame(c);
    const uniforms = h.draws[1];
    expect(uniforms.valid).toBe(1);
    const expectedMatrix = new T.Matrix4().multiplyMatrices(old.projection, oldView);
    expect(uniforms.previous.equals(expectedMatrix)).toBe(true);
    expect(uniforms.inverse.equals(current.projection.clone().invert())).toBe(true);
    for (const world of [
      new T.Vector3(0.4, 0.6, 0.2),
      new T.Vector3(-3, 0, -12),
      new T.Vector3(1, 2, -400),
    ]) {
      const pixel = sample(world, current.projection, c.matrixWorldInverse);
      const reconstructed = pixel.clone().applyMatrix4(uniforms.inverse);
      reconstructed.multiplyScalar(1 / reconstructed.w).applyMatrix4(uniforms.world);
      expect(
        Math.hypot(
          reconstructed.x - world.x,
          reconstructed.y - world.y,
          reconstructed.z - world.z,
          reconstructed.w - 1,
        ),
      ).toBeLessThan(1e-7);
      const previous = reconstructed.applyMatrix4(uniforms.previous);
      const expected = sample(world, old.projection, oldView);
      expect(previous.x / previous.w).toBeCloseTo(expected.x, 9);
      expect(previous.y / previous.w).toBeCloseTo(expected.y, 9);
      expect(previous.w).toBeCloseTo(-world.clone().applyMatrix4(oldView).z, 7);
    }
  });

  it('keeps rigid chassis history paired with the published image, not mutable shared previous state', () => {
    const h = harness(),
      c = camera();
    studioUniforms.studioCarCount.value = 1;
    const before = new T.Matrix4().makeRotationY(0.2).setPosition(-0.6, 0.3, 0.5);
    studioUniforms.studioCarNow.value[0].copy(before);
    const old = h.frame(c);
    const now = new T.Matrix4().makeRotationY(-0.4).setPosition(1.2, 0.4, -0.7);
    studioUniforms.studioCarNow.value[0].copy(now);
    studioUniforms.studioCarPrev.value[0].makeTranslation(400, 200, -100);
    const current = h.frame(c);
    const u = h.draws[1];
    expect(u.previousCars[0].equals(before)).toBe(true);
    const local = new T.Vector3(0.3, 0.5, -0.9),
      world = local.clone().applyMatrix4(now);
    const pixel = sample(world, current.projection, c.matrixWorldInverse);
    const reconstructed = pixel.clone().applyMatrix4(u.inverse);
    reconstructed.multiplyScalar(1 / reconstructed.w).applyMatrix4(u.world);
    const previousWorld = reconstructed
      .applyMatrix4(now.clone().invert())
      .applyMatrix4(u.previousCars[0]);
    const previousClip = previousWorld.applyMatrix4(u.previous);
    const expected = sample(
      local.clone().applyMatrix4(before),
      old.projection,
      c.matrixWorldInverse,
    );
    expect(previousClip.x / previousClip.w).toBeCloseTo(expected.x, 10);
    expect(previousClip.y / previousClip.w).toBeCloseTo(expected.y, 10);
  });

  it('keeps the previous near/far precision when the current projection changes', () => {
    const h = harness(),
      c = camera();
    h.frame(c);
    c.near = 0.3;
    c.far = 26000;
    c.updateProjectionMatrix();
    h.frame(c);
    expect(h.draws[1].range.toArray()).toEqual([0.045, 7000]);
    expect(h.draws[1].precision.x).toBe(temporalDepthPrecision(0.3, 26000));
    expect(h.draws[1].precision.y).toBe(temporalDepthPrecision(0.045, 7000));
  });
});

describe('linear half-float history precision', () => {
  // Three's CPU converter truncates. Select its nearest neighbouring value to
  // model the framebuffer's round-to-nearest conversion, including binades.
  function roundedHalf(value: number) {
    const bits = T.DataUtils.toHalfFloat(value);
    const a = T.DataUtils.fromHalfFloat(bits),
      b = T.DataUtils.fromHalfFloat(bits + 1);
    return value - a <= b - value ? a : b;
  }
  it.each([
    [0.045, 7000],
    [0.3, 26000],
  ])('retains geometry depth throughout the %s / %s metre production range', (near, far) => {
    const c = camera(near, far),
      precision = temporalDepthPrecision(near, far);
    for (let i = 0; i <= 1200; i++) {
      const z = near * (far / near) ** (i / 1200);
      const encoded = roundedHalf(z);
      expect(encoded).toBeGreaterThan(0);
      expect(Number.isFinite(encoded)).toBe(true);
      expect(Math.abs(encoded - z) / z).toBeLessThanOrEqual(1 / 2048);
      const clip = new T.Vector4(0, 0, -z, 1).applyMatrix4(c.projectionMatrix);
      const device = Math.fround((clip.z / clip.w) * 0.5 + 0.5);
      const view = new T.Vector4(0, 0, device * 2 - 1, 1).applyMatrix4(c.projectionMatrixInverse);
      const sourceZ = -view.z / view.w;
      // The comparison covers both source-device rounding and history rounding.
      const tolerance = temporalDepthTolerance(sourceZ, sourceZ * sourceZ * precision, precision);
      expect(Math.abs(encoded - sourceZ)).toBeLessThan(tolerance);
    }
    expect(roundedHalf(0)).toBe(0); // Reserved clear/invalid sentinel.
  });

  it('does not quantize nonlinear depth into alpha, and rejects metres of near-field occlusion', () => {
    const c = camera(0.3, 26000),
      z = 1000;
    const clip = new T.Vector4(0, 0, -z, 1).applyMatrix4(c.projectionMatrix);
    const badDepth = roundedHalf((clip.z / clip.w) * 0.5 + 0.5);
    const badView = new T.Vector4(0, 0, badDepth * 2 - 1, 1).applyMatrix4(
      c.projectionMatrixInverse,
    );
    expect(Math.abs(-badView.z / badView.w - z)).toBeGreaterThan(100);
    expect(Math.abs(roundedHalf(z) - z)).toBeLessThan(0.5);
    const precision = temporalDepthPrecision(0.3, 26000);
    expect(temporalDepthTolerance(10, 100 * precision, precision)).toBeLessThan(0.021);
    expect(temporalDepthTolerance(26000, 26000 ** 2 * precision, precision)).toBeGreaterThan(250);
  });
});

describe('temporal depth ownership and invalidation', () => {
  it('does not publish failed or unfinished resolves and restores abandoned jitter', () => {
    const h = harness(),
      c = camera();
    const plain = c.projectionMatrix.clone();
    h.frame(c);
    h.fail(true);
    expect(() => h.frame(c)).toThrow('deliberate resolve failure');
    expect(h.temporal.diagnostics()).toMatchObject({ frames: 1, historyValid: false });
    h.fail(false);
    h.frame(c);
    expect(h.draws.at(-1)!.valid).toBe(0);
    h.temporal.begin(c, true, 1 / 60);
    // Simulate a scene failure before end/resolve. The next begin restores it.
    h.frame(c);
    expect(h.draws.at(-1)!.valid).toBe(0);
    expect(c.projectionMatrix.equals(plain)).toBe(true);
  });

  it('resolves each frame once and resets on hold, cut, resize, quality restart and camera replacement', () => {
    const h = harness(),
      c = camera();
    const first = h.frame(c).image;
    expect(h.temporal.resolve(h.renderer, c, h.color, h.depth)).toBe(first);
    expect(h.draws).toHaveLength(1);
    for (const reset of [
      () => h.frame(c, 0),
      () => h.temporal.reset(),
      () => h.temporal.setSize(1920, 1080),
      () => {
        h.temporal.enabled = false;
        h.frame(c);
        h.temporal.enabled = true;
      },
    ]) {
      h.frame(c);
      expect(h.draws.at(-1)!.valid).toBe(1);
      reset();
      h.frame(c);
      expect(h.draws.at(-1)!.valid).toBe(0);
    }
    h.frame(camera());
    expect(h.draws.at(-1)!.valid).toBe(0);
    expect(h.temporal.diagnostics()).toMatchObject({
      historyDepth: 'linear-view-metres-in-alpha',
      historyBytes: 1920 * 1080 * 16,
      historyFetches: 12,
      extraDraws: 1,
    });
  });

  it('rejects unsupported camera/depth ranges without jittering or allocating another target', () => {
    const h = harness();
    const reversed = camera();
    Object.defineProperty(reversed, 'reversedDepth', { value: true });
    const webGpu = camera();
    webGpu.coordinateSystem = T.WebGPUCoordinateSystem;
    const orthographic = new T.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    for (const c of [
      reversed,
      webGpu,
      orthographic as unknown as T.PerspectiveCamera,
      camera(0.3, TEMPORAL_AA.maxDepth + 1),
      camera(0, 100),
    ]) {
      const plain = c.projectionMatrix.clone();
      expect(h.temporal.begin(c, true, 1 / 60)).toBe(false);
      // A zero-near perspective already contains NaN; preserve it unchanged.
      expect(c.projectionMatrix.elements).toEqual(plain.elements);
    }
    expect(h.internals.history).toHaveLength(2);
    for (const target of h.internals.history) {
      expect(target.texture.type).toBe(T.HalfFloatType);
      expect(target.depthBuffer).toBe(false);
    }
    expect(() => h.temporal.setSize(NaN, 10)).toThrow('Invalid temporal AA size');
  });

  it('disposes both existing targets once and restores an in-flight camera', () => {
    const h = harness(),
      c = camera();
    const disposals = h.internals.history.map((target) => {
      const listener = vi.fn();
      target.addEventListener('dispose', listener);
      return listener;
    });
    const materialDisposed = vi.fn();
    h.internals.material.addEventListener('dispose', materialDisposed);
    const plain = c.projectionMatrix.clone();
    h.temporal.begin(c, true, 1 / 60);
    h.temporal.dispose();
    h.temporal.dispose();
    expect(c.projectionMatrix.equals(plain)).toBe(true);
    for (const listener of disposals) expect(listener).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(1);
    expect(h.temporal.diagnostics()).toMatchObject({ active: false, historyValid: false });
    expect(h.temporal.resolve(h.renderer, c, h.color, h.depth)).toBe(h.color);
  });

  it.each(['logarithmicDepthBuffer', 'reversedDepthBuffer'])(
    'skips unsupported renderer %s before its first scene draw changes the camera',
    (capability) => {
      const scene = new T.Scene(),
        c = camera(),
        plain = c.projectionMatrix.clone();
      const pass = new SceneAmbientPass(scene, c);
      const output = new T.WebGLRenderTarget(16, 9);
      pass.setSize(16, 9);
      pass.temporal.enabled = true;
      pass.ambientOcclusion = false;
      studioUniforms.studioFrameDt.value = 1 / 60;
      let sceneWasUnjittered = false;
      const renderer = {
        capabilities: { [capability]: true },
        autoClear: true,
        setRenderTarget: () => {},
        render: (object: unknown) => {
          if (object === scene) sceneWasUnjittered = c.projectionMatrix.equals(plain);
        },
      } as unknown as T.WebGLRenderer;
      try {
        pass.render(renderer, output);
        expect(sceneWasUnjittered).toBe(true);
        expect(pass.temporal.diagnostics()).toMatchObject({ active: false, frames: 0 });
      } finally {
        pass.dispose();
        output.dispose();
      }
    },
  );
});
