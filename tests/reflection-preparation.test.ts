import { expect, it, vi } from 'vitest';
import * as T from 'three';
import { WebGLCubeUVMaps } from 'three/src/renderers/webgl/WebGLCubeUVMaps.js';
import { ReflectionSystem } from '../src/rendering/reflections.ts';
import { compileProbeBlur } from '../src/rendering/pmrem-preparation.ts';
import { programHarness } from './helpers/three-program-harness.ts';

function linearTarget() {
  return new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType });
}

it('exposes the unprepared Three conversion issuing its first metadata queries after the scene', () => {
  const h = programHarness(),
    source = new T.WebGLCubeRenderTarget(256),
    maps = new WebGLCubeUVMaps(h.renderer);
  h.stage('after-six-faces');
  maps.get(source.texture);
  const conversion = h.cache.programs.find((program) => program.name === 'CubemapToCubeUV')!;
  expect(h.queries.filter((query) => query.program === conversion.program)).toEqual([
    { kind: 'program-log', program: conversion.program, stage: 'after-six-faces' },
  ]);
  maps.dispose();
  source.dispose();
});

it('reuses the exact installed Three conversion handle and first-use metadata before scene work', async () => {
  const h = programHarness(),
    reflection = new ReflectionSystem(),
    target = linearTarget(),
    previous = h.state();
  reflection.beginProbePreparation(h.renderer, target);
  expect(h.state()).toEqual(previous);
  expect(h.created).toHaveLength(3);
  expect(h.queries).toEqual([]);
  expect(h.render).not.toHaveBeenCalled();
  await Promise.resolve(); // The existing photographed-asset wait.
  reflection.completeProbePreparation();
  const warmed = h.cache.programs[0],
    handle = warmed.program;
  expect(warmed.usedTimes).toBe(1);
  expect(h.queries.map((query) => query.kind)).toEqual([
    'program-log',
    'shader-log',
    'shader-log',
    'program-log',
    'shader-log',
    'shader-log',
    'program-log',
    'shader-log',
    'shader-log',
  ]);
  const source = new T.WebGLCubeRenderTarget(256),
    maps = new WebGLCubeUVMaps(h.renderer);
  h.stage('after-six-faces');
  const atlas = maps.get(source.texture);
  expect(atlas.mapping).toBe(T.CubeUVReflectionMapping);
  const conversion = h.cache.programs.filter((program) => program.name === 'CubemapToCubeUV');
  expect(conversion).toEqual([warmed]);
  expect(conversion[0].program).toBe(handle);
  expect(warmed.usedTimes).toBe(2);
  expect(h.queries.filter((query) => query.program === handle)).toEqual([
    { kind: 'program-log', program: handle, stage: 'before-scene' },
  ]);
  reflection.dispose();
  expect(warmed.usedTimes).toBe(1);
  expect(h.deleted).not.toContain(handle);
  maps.dispose();
  expect(h.deleted.filter((program) => program === handle)).toHaveLength(1);
  source.dispose();
  target.dispose();
});

it('retains the exact r180 blur handle through two sky captures and the later CubeUV consumer', () => {
  expect(T.REVISION).toBe('180');
  const h = programHarness(),
    reflection = new ReflectionSystem(),
    target = linearTarget(),
    before = h.state();
  reflection.beginProbePreparation(h.renderer, target);
  expect(h.state()).toEqual(before);
  expect(h.render).not.toHaveBeenCalled();
  reflection.completeProbePreparation();
  const blur = h.cache.programs.find((program) => program.name === 'SphericalGaussianBlur')!;
  expect(blur).toBeDefined();
  const handle = h.created.find((program) => program === blur.program)!;
  const fragment = handle.shaders.find((shader) => shader.type === 35632)!.source!;
  // Compare with the actual unprepared consumer, not a copied shader. Three's
  // source modules and packaged build have different whitespace; the exact
  // packaged-build hash is retained separately with the CI trace attribution.
  const cold = programHarness(),
    coldSource = new T.WebGLCubeRenderTarget(256),
    coldMaps = new WebGLCubeUVMaps(cold.renderer);
  coldMaps.get(coldSource.texture);
  const coldBlur = cold.cache.programs.find((program) => program.name === 'SphericalGaussianBlur')!;
  const coldHandle = cold.created.find((program) => program === coldBlur.program)!;
  expect(fragment).toBe(coldHandle.shaders.find((shader) => shader.type === 35632)!.source);
  coldMaps.dispose();
  coldSource.dispose();
  expect(blur.usedTimes).toBe(1);
  h.stage('sky-captures');
  for (let bin = 0; bin < 2; bin++) {
    const sky = new T.PMREMGenerator(h.renderer);
    const atlas = sky.fromScene(new T.Scene(), 0.04, 0.1, 700000, { size: 256 });
    expect(blur.usedTimes).toBe(2);
    expect(h.cache.programs.filter((program) => program.name === 'SphericalGaussianBlur')).toEqual([
      blur,
    ]);
    sky.dispose();
    atlas.dispose();
    expect(blur.usedTimes).toBe(1);
    expect(h.deleted).not.toContain(handle);
  }
  h.stage('after-six-faces');
  const source = new T.WebGLCubeRenderTarget(256),
    maps = new WebGLCubeUVMaps(h.renderer);
  maps.get(source.texture);
  expect(blur.usedTimes).toBe(2);
  expect(h.cache.programs.filter((program) => program.name === 'SphericalGaussianBlur')).toEqual([
    blur,
  ]);
  expect(h.queries.filter((query) => query.program === handle)).toEqual([
    { kind: 'program-log', program: handle, stage: 'before-scene' },
  ]);
  reflection.dispose();
  expect(blur.usedTimes).toBe(1);
  expect(h.deleted).not.toContain(handle);
  maps.dispose();
  expect(h.deleted.filter((program) => program === handle)).toHaveLength(1);
  source.dispose();
  target.dispose();
});

it('cleans up both native owners if blur compilation fails, and can then retry', () => {
  const h = programHarness(),
    reflection = new ReflectionSystem(),
    target = linearTarget(),
    before = h.state();
  const releaseTarget = vi.spyOn(T.WebGLRenderTarget.prototype, 'dispose');
  try {
    h.failCompile('SphericalGaussianBlur');
    expect(() => reflection.beginProbePreparation(h.renderer, target)).toThrow(
      'Interrupted SphericalGaussianBlur compilation',
    );
    expect(h.render).not.toHaveBeenCalled();
    expect(h.state()).toEqual(before);
    expect(h.deleted).toHaveLength(h.created.length);
    expect(new Set(h.deleted)).toEqual(new Set(h.created));
    expect(h.cache.programs).toEqual([]);
    // Unused output and retained ping-pong descriptors both have an owner.
    expect(releaseTarget).toHaveBeenCalledTimes(2);
    h.failCompile(null);
    reflection.beginProbePreparation(h.renderer, target);
    reflection.completeProbePreparation();
  } finally {
    releaseTarget.mockRestore();
    reflection.dispose();
    target.dispose();
  }
});

it('rejects an incompatible private PMREM interface before using it', () => {
  expect(() => compileProbeBlur({} as T.PMREMGenerator, 256)).toThrow(
    'Reflection blur preparation requires the Three r180 PMREM interface',
  );
});

it('prepares once across repeated quality entry and selects its linear reference over a canvas variant', () => {
  const h = programHarness(),
    target = linearTarget();
  h.renderer.setRenderTarget(null);
  const canvasOwner = new T.PMREMGenerator(h.renderer);
  canvasOwner.compileCubemapShader();
  const canvasProgram = h.cache.programs[0];
  const reflection = new ReflectionSystem();
  reflection.beginProbePreparation(h.renderer, target);
  const linearProgram = h.cache.programs[1];
  expect(linearProgram.cacheKey).not.toBe(canvasProgram.cacheKey);
  // Cancelled High may retain a linked owner while Low does not consume it.
  // Re-entering High before metadata completion must acquire no extra ref.
  reflection.beginProbePreparation(h.renderer, target);
  expect(h.queries).toEqual([]);
  expect(linearProgram.usedTimes).toBe(1);
  reflection.completeProbePreparation();
  reflection.beginProbePreparation(h.renderer, target);
  reflection.completeProbePreparation();
  expect(h.created).toHaveLength(4);
  expect(linearProgram.usedTimes).toBe(1);
  expect(h.queries.filter((query) => query.kind === 'program-log')).toEqual([
    { kind: 'program-log', program: linearProgram.program, stage: 'before-scene' },
    { kind: 'program-log', program: h.cache.programs[2].program, stage: 'before-scene' },
    { kind: 'program-log', program: h.cache.programs[3].program, stage: 'before-scene' },
  ]);
  reflection.dispose();
  canvasOwner.dispose();
  target.dispose();
});

it('restores the exact target, face, mip, viewport and scissor after an interrupted compilation', () => {
  const h = programHarness(),
    reflection = new ReflectionSystem(),
    target = linearTarget(),
    previous = h.state();
  h.failCompile('CubemapToCubeUV');
  expect(() => reflection.beginProbePreparation(h.renderer, target)).toThrow(
    'Interrupted CubemapToCubeUV compilation',
  );
  expect(h.state()).toEqual(previous);
  expect(h.cache.programs).toEqual([]);
  expect(h.deleted).toEqual(h.created);
  h.failCompile(null);
  reflection.beginProbePreparation(h.renderer, target);
  reflection.completeProbePreparation();
  reflection.dispose();
  target.dispose();
});

it('does no late work after disposal and gives a replacement renderer its own live program', async () => {
  const old = programHarness(),
    reflection = new ReflectionSystem(),
    target = linearTarget();
  reflection.beginProbePreparation(old.renderer, target);
  const pending = Promise.resolve().then(() => reflection.completeProbePreparation());
  reflection.dispose();
  old.retire();
  await pending;
  reflection.beginProbePreparation(old.renderer, target);
  expect(old.queries).toEqual([]);
  expect(old.deleted).toHaveLength(old.created.length);
  expect(new Set(old.deleted)).toEqual(new Set(old.created));
  const next = programHarness(),
    replacement = new ReflectionSystem();
  replacement.beginProbePreparation(next.renderer, target);
  replacement.completeProbePreparation();
  expect(next.created).toHaveLength(3);
  expect(next.created[0]).not.toBe(old.created[0]);
  expect(next.queries.filter((query) => query.kind === 'program-log')).toHaveLength(3);
  expect(() => replacement.beginProbePreparation(old.renderer, target)).toThrow(
    'Reflection preparation belongs to another renderer',
  );
  replacement.dispose();
  target.dispose();
});
