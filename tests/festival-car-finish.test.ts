import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FESTIVAL_CAR_FINISH,
  FestivalCarFinish,
  festivalFinishObservation,
} from '../src/rendering/open-world/festival-car-finish.ts';
import { FestivalCars } from '../src/rendering/open-world/festival-cars.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
import { sharedMaterials } from '../src/rendering/vehicle-bodies/materials.ts';
import { hasSpecularIBL, installSpecularIBL } from '../src/rendering/studio/ibl-energy.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';

afterEach(() => vi.restoreAllMocks());
const o = carBase(0);
function snapshot(id = 'eh3', speed = 0) {
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  frame[o + F.QW] = 1;
  frame[o + F.SPEED] = Math.abs(speed);
  frame[o + F.VZ] = speed;
  frame[o + F.FRONT_HEALTH] = frame[o + F.REAR_HEALTH] = 1;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
  for (let i = 0; i < 4; i++) {
    const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
    frame[w + W.LOAD] = 2200;
    frame[w + W.LENGTH] = 0.3;
    frame[w + W.RADIUS] = VEHICLES[id].spec.wheelRadius;
    frame[w + W.PRESSURE] = 155;
  }
  return frame;
}
function wheelValues(frame: Float32Array, values: Partial<Record<keyof typeof W, number>>) {
  for (let i = 0; i < 4; i++)
    for (const [key, value] of Object.entries(values))
      frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W[key as keyof typeof W]] = value;
}
function shaderFor(material: T.Material) {
  const shader = {
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
    uniforms: T.UniformsUtils.clone(T.ShaderLib.physical.uniforms),
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}
function materials(root: T.Object3D) {
  const set = new Set<T.Material>();
  root.traverse((node) => {
    if (node instanceof T.Mesh)
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        set.add(material);
  });
  return [...set];
}
function body(id = 'eh3') {
  const bodies = new VehicleBodies(),
    frame = snapshot(id),
    host = new T.Group();
  bodies.update(frame, frame, 1, [{ root: host, lodLevel: 0 }]);
  const root = bodies.root.children[0];
  return {
    bodies,
    root,
    frame,
    definition: VEHICLES[id],
    sheet: bodySheetFor(VEHICLES[id]) as ClosedSheet,
  };
}

describe('Festival car finish observations', () => {
  it('uses actual rain/contact water and stays dry beside a globally wet road', () => {
    const frame = snapshot('eh3', 35);
    frame[H.WATER] = 4;
    expect(festivalFinishObservation(frame).wetness).toBe(0);
    wheelValues(frame, { WATER: 0.8, LOAD: 0 });
    expect(festivalFinishObservation(frame).spray).toBe(0);
    frame[H.RAIN] = FESTIVAL_CAR_FINISH.fullRainMmHr / 2;
    expect(festivalFinishObservation(frame)).toMatchObject({ rain: 0.5, wetness: 0.5, spray: 0 });
    frame[H.RAIN] = 0;
    wheelValues(frame, { LOAD: 2200 });
    expect(festivalFinishObservation(frame).spray).toBe(1);
    frame[o + F.SPEED] = 0;
    expect(festivalFinishObservation(frame).spray).toBe(0);
  });

  it('scales one wet loaded wheel by contact coverage and uses recorded dirt without inventing soil water', () => {
    const frame = snapshot('rh3', 20);
    frame[o + WHEEL_BASE + W.WATER] = 1;
    frame[o + WHEEL_BASE + W.DIRT] = 0.8;
    frame[o + OFFROAD_BASE + O.MOISTURE] = 1;
    expect(festivalFinishObservation(frame)).toMatchObject({
      rain: 0,
      spray: 0.2,
      wetness: 0.2,
      soilWetness: 0,
    });
    expect(festivalFinishObservation(frame).dirt).toBeCloseTo(0.2, 7);
    frame[o + OFFROAD_BASE + O.MUD] = 0.6;
    expect(festivalFinishObservation(frame).dirt).toBeCloseTo(0.6);
    expect(festivalFinishObservation(frame).soilWetness).toBeCloseTo(0.6);
    frame[o + WHEEL_BASE + W.WATER] = 0;
    expect(festivalFinishObservation(frame).wetness).toBe(0);
  });

  it('keeps runoff chassis-local and signed through world yaw and reverse motion', () => {
    const frame = snapshot('eh3', 24);
    const first = festivalFinishObservation(frame).airflow;
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI * 0.71);
    const velocity = new T.Vector3(0, 0, 24).applyQuaternion(q);
    frame.set(q.toArray(), o + F.QX);
    frame.set(velocity.toArray(), o + F.VX);
    expect(festivalFinishObservation(frame).airflow).toBeCloseTo(first);
    frame.set(velocity.multiplyScalar(-1).toArray(), o + F.VX);
    expect(festivalFinishObservation(frame).airflow).toBeCloseTo(-first);
  });

  it('is bounded for absent, invalid and extreme snapshots and does not accumulate with render time', () => {
    for (const frame of [new Float32Array(), snapshot().fill(NaN), snapshot().fill(Infinity)]) {
      const observed = festivalFinishObservation(frame);
      expect(Object.values(observed).every(Number.isFinite)).toBe(true);
      expect(observed.wetness).toBe(0);
    }
    const frame = snapshot('eh3', 400);
    frame[H.RAIN] = 1000;
    wheelValues(frame, { DIRT: 8, WATER: 10 });
    const first = festivalFinishObservation(frame);
    expect(first).toMatchObject({ rain: 1, spray: 1, wetness: 1, dirt: 1, airflow: 1 });
    frame[H.TIME] = 100000;
    expect(festivalFinishObservation(frame)).toEqual(first);
    frame[H.TIME] = 0;
    expect(festivalFinishObservation(frame)).toEqual(first);
  });
});

describe('Festival car finish ownership and shader integration', () => {
  it('clones only exterior paint/glass, preserves clean glass/IBL/paint hooks and adds no scene primitives', () => {
    const b = body('eh3'),
      finish = new FestivalCarFinish();
    installSpecularIBL(b.root);
    const originals = materials(b.root),
      sharedGlass = sharedMaterials.roadGlass(),
      glassHook = sharedGlass.onBeforeCompile,
      glassKey = sharedGlass.customProgramCacheKey(),
      originalMeshes: T.Object3D[] = [];
    b.root.traverse((node) => originalMeshes.push(node));
    try {
      expect(finish.bind(b.root, b.definition, b.sheet)).toBe(true);
      const all = materials(b.root),
        clones = all.filter((m) => !originals.includes(m));
      expect(clones).toHaveLength(3);
      expect(finish.stats).toMatchObject({
        paintMaterials: 2,
        glassMaterials: 1,
        addedDraws: 0,
        addedTriangles: 0,
        addedTextures: 0,
      });
      const afterMeshes: T.Object3D[] = [];
      b.root.traverse((node) => afterMeshes.push(node));
      expect(afterMeshes).toEqual(originalMeshes);
      expect(sharedGlass.onBeforeCompile).toBe(glassHook);
      expect(sharedGlass.customProgramCacheKey()).toBe(glassKey);
      expect(
        studioHookKeys(sharedGlass).some((key) => key.startsWith('festival-car-weather')),
      ).toBe(false);
      for (const clone of clones) {
        expect(hasSpecularIBL(clone)).toBe(true);
        const shader = shaderFor(clone);
        expect(shader.uniforms.festivalCarWeather.value.toArray()).toEqual([0, 0, 0, 0]);
        expect(shader.fragmentShader).toContain('apexSpecularIBL');
        if (clone.userData.vehicleGlass) {
          const glass = clone as T.MeshPhysicalMaterial;
          expect(glass.opacity).toBe((sharedGlass as T.MeshPhysicalMaterial).opacity);
          expect(glass.blending).toBe(sharedGlass.blending);
          expect(glass.depthWrite).toBe(false);
          expect(glass.forceSinglePass).toBe(true);
          expect(shader.fragmentShader).toContain('float apexAlpha');
          expect(shader.fragmentShader).not.toContain('diffuseColor.a *=');
        } else {
          expect(shader.fragmentShader).toContain('paintGrain');
          expect(shader.fragmentShader).toContain('clearcoatNormal');
        }
      }
      // Uniform values, not hooks/programs/material versions, carry updates.
      const versions = clones.map((m) => m.version),
        keys = clones.map((m) => m.customProgramCacheKey());
      b.frame[H.RAIN] = 14;
      finish.update(b.frame, false);
      expect(finish.stats).toMatchObject({ wetness: 1, detail: 0 });
      finish.update(b.frame, true);
      expect(finish.stats.detail).toBe(1);
      expect(clones.map((m) => m.version)).toEqual(versions);
      expect(clones.map((m) => m.customProgramCacheKey())).toEqual(keys);
      expect(finish.bind(b.root, b.definition, b.sheet)).toBe(false);
    } finally {
      finish.dispose();
      b.bodies.clear();
    }
  });

  it('restores exact material slots and releases owned clones once while preserving borrowed textures and other bodies', () => {
    const a = body('rh3'),
      b = body('rh3'),
      finish = new FestivalCarFinish();
    const slots = new Map<T.Mesh, T.Material | T.Material[]>();
    a.root.traverse((node) => {
      if (node instanceof T.Mesh) slots.set(node, node.material);
    });
    const originals = materials(a.root),
      otherMaterials = materials(b.root),
      borrowed = new T.Texture();
    const paint = originals.find((m) => m.name === 'Body paint') as T.MeshPhysicalMaterial;
    paint.envMap = borrowed;
    const borrowedDispose = vi.spyOn(borrowed, 'dispose');
    const preserved = [...new Set([...originals, ...otherMaterials])].map((m) =>
      vi.spyOn(m, 'dispose'),
    );
    try {
      finish.bind(a.root, a.definition, a.sheet);
      const clones = materials(a.root).filter((m) => !originals.includes(m));
      const disposed = clones.map((m) => vi.spyOn(m, 'dispose'));
      finish.clear();
      finish.clear();
      for (const [mesh, original] of slots) expect(mesh.material).toBe(original);
      for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1);
      for (const spy of preserved) expect(spy).not.toHaveBeenCalled();
      expect(borrowedDispose).not.toHaveBeenCalled();
      expect(materials(b.root)).toEqual(otherMaterials);
      expect(finish.stats.materials).toBe(0);
    } finally {
      finish.dispose();
      a.bodies.clear();
      b.bodies.clear();
      borrowed.dispose();
    }
  });

  it('rebinds the actual followed Festival car on garage changes with independent scene probes and bounded resources', () => {
    const cars = new FestivalCars(),
      other = new FestivalCars(),
      camera = new T.PerspectiveCamera();
    const storedPaint: T.Material[] = [];
    const onBuild = cars.bodies.onBuild;
    cars.bodies.onBuild = (root) => {
      if (!storedPaint.length) {
        const shell = root.getObjectByName('Body (lofted)') as T.Mesh;
        if (Array.isArray(shell.material)) storedPaint.push(shell.material[0], shell.material[3]);
      }
      onBuild(root);
    };
    let frame = snapshot('eh3', 20);
    const update = () => cars.update(frame, frame, frame, 1, 1 / 60, 0, camera, false, 'medium');
    try {
      update();
      other.update(frame, frame, frame, 1, 1 / 60, 0, camera, false, 'medium');
      expect(cars.finish.stats).toMatchObject({ active: true, materials: 3 });
      const originalBody = cars.bodies.root.children[0];
      const originals = materials(originalBody).filter((m) =>
        m.name.includes('Festival contact finish'),
      );
      const disposed = originals.map((m) => vi.spyOn(m, 'dispose'));
      // VehicleBodies retains the pre-clone paint handles for ownership;
      // watch these separately from the actual mesh materials it renders.
      const storedDisposals = storedPaint.map((m) => vi.spyOn(m, 'dispose'));
      const wetPaint = originals.find((m) => !m.userData.vehicleGlass)!;
      const otherPaint = materials(other.bodies.root).find((m) => m.name === wetPaint.name)!;
      expect(wetPaint).not.toBe(otherPaint);
      const shader = shaderFor(wetPaint),
        otherShader = shaderFor(otherPaint);
      frame[H.RAIN] = 14;
      for (let i = 0; i < 30; i++) update();
      expect(shader.uniforms.festivalCarWeather.value.x).toBe(1);
      expect(otherShader.uniforms.festivalCarWeather.value.x).toBe(0);
      for (const spy of disposed) expect(spy).not.toHaveBeenCalled();
      for (const spy of storedDisposals) expect(spy).not.toHaveBeenCalled();
      frame = snapshot('rh3');
      update();
      expect(cars.bodies.root.children[0]).not.toBe(originalBody);
      expect(cars.finish.stats).toMatchObject({ wetness: 0, materials: 3, active: true });
      for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1);
      for (const spy of storedDisposals) expect(spy).toHaveBeenCalledTimes(1);
      expect(cars.reflectivePaint.every(hasSpecularIBL)).toBe(true);
      expect(cars.reflectivePaint.some((m) => originals.includes(m))).toBe(false);
      cars.clear();
      cars.clear();
      for (const spy of [...disposed, ...storedDisposals]) expect(spy).toHaveBeenCalledTimes(1);
      expect(cars.finish.stats.materials).toBe(0);
      expect(cars.bodies.count).toBe(0);
      expect(other.finish.stats.materials).toBe(3);
    } finally {
      cars.dispose();
      other.dispose();
    }
  });
});
