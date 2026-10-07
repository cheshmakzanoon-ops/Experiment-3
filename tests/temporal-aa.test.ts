import { expect, it } from 'vitest';
import * as T from 'three';
import { MotionBlur } from '../src/rendering/motion-blur.ts';
import { graphicsPreset } from '../src/rendering/options.ts';
import { SceneAmbientPass } from '../src/rendering/scene-ambient-pass.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';
import {
  TEMPORAL_AA,
  TemporalAA,
  halton,
  jitterOffset,
} from '../src/rendering/studio/temporal-aa.ts';

it('jitters by an 8-sample Halton(2,3) sequence centred on the pixel', () => {
  expect([1, 2, 3, 4, 5, 6, 7, 8].map((i) => halton(i, 2))).toEqual([
    0.5, 0.25, 0.75, 0.125, 0.625, 0.375, 0.875, 0.0625,
  ]);
  const thirds = [1 / 3, 2 / 3, 1 / 9, 4 / 9, 7 / 9, 2 / 9, 5 / 9, 8 / 9];
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((i, k) => expect(halton(i, 3)).toBeCloseTo(thirds[k], 12));
  const mean = new T.Vector2();
  for (let i = 0; i < TEMPORAL_AA.samples; i++) {
    const offset = jitterOffset(i);
    for (const v of offset.toArray()) {
      expect(v).toBeGreaterThanOrEqual(-0.5);
      expect(v).toBeLessThan(0.5);
    }
    expect(jitterOffset(i + TEMPORAL_AA.samples).equals(offset)).toBe(true);
    mean.add(offset);
  }
  expect(Math.abs(mean.x / 8)).toBeLessThan(0.07);
  expect(Math.abs(mean.y / 8)).toBeLessThan(0.07);
  // Opt-in on every preset (P17); e2e fixtures and captures never see it by default.
  for (const quality of ['low', 'medium', 'high'] as const)
    expect(graphicsPreset(quality).temporalAA).toBe(false);
});

function camera() {
  const c = new T.PerspectiveCamera(50, 16 / 9, 0.045, 7000);
  c.updateProjectionMatrix();
  c.updateMatrixWorld(true);
  return c;
}
function mockRenderer() {
  const draws: unknown[] = [];
  const renderer = {
    setRenderTarget: () => {},
    render: (object: unknown) => draws.push(object),
  } as unknown as T.WebGLRenderer;
  return { renderer, draws };
}

it('jitters only live, advancing frames and restores the exact projection', () => {
  const taa = new TemporalAA();
  taa.setSize(1280, 720);
  const cam = camera();
  const original = cam.projectionMatrix.clone();
  const inverse = cam.projectionMatrixInverse.clone();
  // Off by default, then held (frameDt 0) or not live (menu, photo, paused replay).
  expect(taa.begin(cam, true, 1 / 60)).toBe(false);
  taa.enabled = true;
  expect(taa.begin(cam, true, 0)).toBe(false);
  expect(taa.begin(cam, false, 1 / 60)).toBe(false);
  expect(cam.projectionMatrix.equals(original)).toBe(true);
  expect(taa.begin(cam, true, 1 / 60)).toBe(true);
  const jitter = jitterOffset(taa.diagnostics().index);
  const point = new T.Vector3(1.3, 0.4, -12);
  const jittered = point.clone().applyMatrix4(cam.projectionMatrix);
  const plain = point.clone().applyMatrix4(original);
  // A point moves by -jitter pixels (see the resolve's jitterUv).
  expect(((jittered.x - plain.x) * 1280) / 2).toBeCloseTo(-jitter.x, 9);
  expect(((jittered.y - plain.y) * 720) / 2).toBeCloseTo(-jitter.y, 9);
  taa.end(cam);
  expect(cam.projectionMatrix.equals(original)).toBe(true);
  expect(cam.projectionMatrixInverse.equals(inverse)).toBe(true);
  taa.dispose();
});

it('resolves in one quad, keeps history only across advancing frames, and is deterministic', () => {
  const run = () => {
    const taa = new TemporalAA();
    taa.enabled = true;
    taa.setSize(64, 36);
    const cam = camera();
    const { renderer, draws } = mockRenderer();
    const color = new T.Texture(),
      depth = new T.Texture();
    const valid: number[] = [],
      indices: number[] = [];
    type Internals = { material: T.ShaderMaterial };
    const material = (taa as unknown as Internals).material;
    for (const dt of [1 / 60, 1 / 60, 1 / 60, 0, 1 / 60, 1 / 60]) {
      const active = taa.begin(cam, true, dt);
      taa.end(cam);
      const before = draws.length;
      const image = taa.resolve(renderer, cam, color, depth);
      if (!active) {
        // Held frames: no draw, the composite reads the plain scene colour.
        expect(image).toBe(color);
        expect(draws.length).toBe(before);
        valid.push(-1);
      } else {
        expect(image).not.toBe(color);
        expect(draws.length).toBe(before + 1);
        valid.push(material.uniforms.historyValid.value);
      }
      indices.push(taa.diagnostics().index);
    }
    taa.dispose();
    return { valid, indices };
  };
  const first = run();
  expect(first.valid).toEqual([0, 1, 1, -1, 0, 1]);
  expect(run()).toEqual(first);
});

it('runs inside the scene pass: jittered scene draw, one resolve quad, held frames untouched', () => {
  const scene = new T.Scene();
  const cam = camera();
  const blur = new MotionBlur(true);
  const pass = new SceneAmbientPass(scene, cam, 4, blur);
  pass.setSize(128, 72);
  const original = cam.projectionMatrix.clone();
  const sceneJitter: number[] = [];
  const draws: unknown[] = [];
  const renderer = {
    autoClear: true,
    setRenderTarget: () => {},
    render: (object: unknown) => {
      draws.push(object);
      if (object === scene)
        sceneJitter.push(cam.projectionMatrix.elements[8] - original.elements[8]);
    },
  } as unknown as T.WebGLRenderer;
  const write = new T.WebGLRenderTarget(4, 4);
  type Internals = { compositeMaterial: T.ShaderMaterial };
  const composite = (pass as unknown as Internals).compositeMaterial;
  const frame = (live: boolean, frameDt: number) => {
    draws.length = 0;
    blur.setStrength(0.5, live);
    const presented = new Float32Array(64);
    blur.prepareFrame(presented, cam, 0, 'chase', false, frameDt);
    // The scene pass reads StudioFrame's presented step (shared uniform).
    studioUniforms.studioFrameDt.value = frameDt;
    pass.render(renderer, write);
    return draws.length;
  };
  // TAA off: 1 scene draw + 3 obscurance quads + 1 composite.
  expect(frame(true, 1 / 60)).toBe(5);
  expect(composite.uniforms.tColor.value).toBe(pass.target.texture);
  pass.temporal.enabled = true;
  expect(frame(true, 1 / 60)).toBe(6);
  expect(sceneJitter.at(-1)).not.toBe(0);
  expect(composite.uniforms.tColor.value).not.toBe(pass.target.texture);
  expect(cam.projectionMatrix.equals(original)).toBe(true);
  // Held (paused) and menu/photo frames: unjittered, no resolve, plain scene colour.
  expect(frame(true, 0)).toBe(5);
  expect(sceneJitter.at(-1)).toBe(0);
  expect(composite.uniforms.tColor.value).toBe(pass.target.texture);
  expect(frame(false, 1 / 60)).toBe(5);
  expect(sceneJitter.at(-1)).toBe(0);
  expect(blur.live).toBe(false);
  expect(pass.diagnostics().temporalAA).toMatchObject({ enabled: true, active: false });
  studioUniforms.studioFrameDt.value = 0;
  pass.dispose();
  write.dispose();
});

it('clamps scene and history input to the HalfFloat range before the history blend', () => {
  // compress(Inf) is NaN: an overflowed scene pixel must not enter the history.
  const taa = new TemporalAA();
  type Internals = { material: T.ShaderMaterial };
  const glsl = (taa as unknown as Internals).material.fragmentShader;
  expect(glsl).toContain('clamp(c, vec3(0.0), vec3(65000.0))');
  expect(glsl).toContain('compress(finiteColor(texture2D(tColor, uv).rgb))');
  expect(glsl).toContain('compress(finiteColor(sum / weight))');
  taa.dispose();
});
