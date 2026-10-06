import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import {
  createStudioUniforms,
  STUDIO_CAR_HALF_EXTENTS,
  STUDIO_MAX_CARS,
  STUDIO_SEEK_SECONDS,
  STUDIO_UNIFORM_NAMES,
  StudioFrame,
  studioCarLocal,
  studioGlsl,
  studioGust,
  studioUniforms,
  useStudioUniforms,
  type StudioUniforms,
} from '../src/rendering/studio/studio-frame.ts';
import { chainShaderHook, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';

interface CarState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed?: number;
  length?: number;
  radius?: number;
}
function snapshot(time: number, cars: CarState[], wind: [number, number] = [1.5, 0.6]) {
  const frame = new Float32Array(HEADER + cars.length * CAR_STRIDE);
  frame[H.TIME] = time;
  frame[H.CARS] = cars.length;
  frame[H.WIND_X] = wind[0];
  frame[H.WIND_Z] = wind[1];
  cars.forEach((car, id) => {
    const o = carBase(id);
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), car.yaw);
    frame[o + F.X] = car.x;
    frame[o + F.Y] = car.y;
    frame[o + F.Z] = car.z;
    frame[o + F.QX] = q.x;
    frame[o + F.QY] = q.y;
    frame[o + F.QZ] = q.z;
    frame[o + F.QW] = q.w;
    frame[o + F.SPEED] = car.speed ?? 0;
    for (let wheel = 0; wheel < 4; wheel++) {
      const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
      frame[p + W.LENGTH] = car.length ?? 0.25;
      frame[p + W.RADIUS] = car.radius ?? 0.335;
    }
  });
  return frame;
}
function rig(aspect = 16 / 9) {
  const camera = new T.PerspectiveCamera(58, aspect, 0.045, 7000);
  const sun = new T.DirectionalLight();
  const scene = new T.Scene();
  scene.add(camera, sun, sun.target);
  sun.position.set(-140, 235, -115);
  return { camera, sun, scene };
}
function place(r: ReturnType<typeof rig>, x: number, y = 1.2, z = -6) {
  r.camera.position.set(x, y, z);
  r.camera.lookAt(x, 0.5, z + 20);
  r.camera.updateProjectionMatrix();
  r.scene.updateMatrixWorld(true);
  r.camera.updateMatrixWorld(true);
}
/** Every uniform value in GPU upload order, as bytes. */
function bytes(u: StudioUniforms) {
  const values: number[] = [];
  for (const name of STUDIO_UNIFORM_NAMES) {
    const value = u[name].value as unknown;
    const list = Array.isArray(value) ? value : [value];
    for (const item of list)
      if (typeof item === 'number') values.push(item);
      else values.push(...(item as { toArray(): number[] }).toArray());
  }
  return Buffer.from(new Float64Array(values).buffer);
}
const grid: CarState[] = [
  { x: 0, y: 0.6, z: 0, yaw: 0, speed: 40 },
  { x: 3, y: 0.62, z: 12, yaw: 0.3, speed: 38 },
  { x: -2, y: 0.58, z: 25, yaw: -0.2, speed: 41 },
];
function advance(cars: CarState[], dt: number) {
  return cars.map((car) => ({
    ...car,
    x: car.x + Math.sin(car.yaw) * (car.speed ?? 0) * dt,
    z: car.z + Math.cos(car.yaw) * (car.speed ?? 0) * dt,
  }));
}

describe('StudioFrame uniforms are shared by identity', () => {
  function compile(material: T.Material, id: 'standard' | 'physical') {
    const source = T.ShaderLib[id];
    const shader = {
      uniforms: T.UniformsUtils.clone(source.uniforms),
      vertexShader: source.vertexShader,
      fragmentShader: source.fragmentShader,
    } as unknown as StudioShader;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    return shader;
  }

  it('binds the same objects into every material and sees each update', () => {
    const road = new T.MeshPhysicalMaterial(),
      tree = new T.MeshStandardMaterial();
    chainShaderHook(road, 'grounding-v1', (shader) =>
      useStudioUniforms(shader, ['studioCarPose', 'studioCarCount'], 'fragment'),
    );
    chainShaderHook(tree, 'wind-v1', (shader) =>
      useStudioUniforms(shader, ['studioWind', 'studioTime'], 'both'),
    );
    const a = compile(road, 'physical'),
      b = compile(tree, 'standard'),
      c = compile(tree, 'standard');
    expect(a.uniforms.studioCarPose).toBe(studioUniforms.studioCarPose);
    expect(a.uniforms.studioCarCount).toBe(studioUniforms.studioCarCount);
    expect(b.uniforms.studioWind).toBe(studioUniforms.studioWind);
    expect(c.uniforms.studioWind).toBe(b.uniforms.studioWind);
    expect(c.uniforms.studioTime).toBe(studioUniforms.studioTime);
    // The application frame writes the module-level objects.
    const frame = new StudioFrame();
    expect(frame.uniforms).toBe(studioUniforms);
    const r = rig();
    place(r, 0);
    frame.update(snapshot(12.5, grid), r.camera, r.sun, 'chase:0');
    expect(b.uniforms.studioTime.value).toBe(12.5);
    expect((c.uniforms.studioWind.value as T.Vector4).z).toBe(12.5);
    expect(a.uniforms.studioCarCount.value).toBe(3);
  });

  it('declares only the requested uniforms, guarded against repeat declarations', () => {
    const material = new T.MeshStandardMaterial();
    chainShaderHook(material, 'first-v1', (s) => useStudioUniforms(s, ['studioTime'], 'vertex'));
    chainShaderHook(material, 'second-v1', (s) =>
      useStudioUniforms(s, ['studioTime', 'studioCarNow', 'studioCarPrev'], 'vertex'),
    );
    const shader = compile(material, 'standard');
    const vertex = shader.vertexShader;
    expect(vertex.split('uniform float studioTime;').length - 1).toBe(2);
    expect(vertex.split('#ifndef STUDIO_DECLARED_studioTime').length - 1).toBe(2);
    expect(vertex).toContain('uniform mat4 studioCarNow[STUDIO_MAX_CARS];');
    expect(vertex).toContain(`#define STUDIO_MAX_CARS ${STUDIO_MAX_CARS}`);
    expect(vertex).toContain('vec3 studioRigidToLocal( mat4 m, vec3 p )');
    expect(vertex).toContain('#ifndef STUDIO_CAR_HELPERS');
    expect(vertex).not.toContain('studioWind');
    expect(shader.fragmentShader).not.toContain('studio');
    expect(vertex.indexOf('#include <common>')).toBeLessThan(vertex.indexOf('studioTime'));
  });

  it('describes the declared GLSL type of every uniform', () => {
    const glsl = studioGlsl(STUDIO_UNIFORM_NAMES);
    for (const declaration of [
      'uniform float studioTime;',
      'uniform float studioFrameDt;',
      'uniform vec4 studioWind;',
      'uniform vec3 studioSunDir;',
      'uniform mat4 studioViewProj;',
      'uniform mat4 studioPrevViewProj;',
      'uniform int studioCarCount;',
      'uniform mat4 studioCarNow[STUDIO_MAX_CARS];',
      'uniform mat4 studioCarPrev[STUDIO_MAX_CARS];',
      'uniform vec4 studioCarPose[STUDIO_MAX_CARS];',
    ])
      expect(glsl).toContain(declaration);
    expect(glsl).toContain(
      `#define STUDIO_CAR_HALF_LENGTH ${STUDIO_CAR_HALF_EXTENTS.length.toFixed(2)}`,
    );
    expect(() => studioGlsl(['studioNope' as never])).toThrow(/Unknown studio uniform/);
  });
});

describe('StudioFrame determinism', () => {
  it('the same presented buffer yields byte-identical uniform values', () => {
    const run = () => {
      const frame = new StudioFrame(createStudioUniforms());
      const r = rig();
      place(r, 0);
      frame.update(snapshot(10, grid), r.camera, r.sun, 'chase:0');
      place(r, 0.5);
      frame.update(snapshot(10.05, advance(grid, 0.05)), r.camera, r.sun, 'chase:0');
      return bytes(frame.uniforms);
    };
    expect(run().equals(run())).toBe(true);
  });

  it('held frames report no motion and stay byte-identical', () => {
    const frame = new StudioFrame(createStudioUniforms());
    const r = rig();
    place(r, 0);
    frame.update(snapshot(10, grid), r.camera, r.sun, 'chase:0');
    place(r, 0.5);
    const held = snapshot(10.05, advance(grid, 0.05));
    frame.update(held, r.camera, r.sun, 'chase:0');
    expect(frame.uniforms.studioFrameDt.value).toBeCloseTo(0.05, 6);
    frame.update(held, r.camera, r.sun, 'chase:0');
    const first = bytes(frame.uniforms);
    frame.update(held, r.camera, r.sun, 'chase:0');
    expect(bytes(frame.uniforms).equals(first)).toBe(true);
    const u = frame.uniforms;
    expect(u.studioFrameDt.value).toBe(0);
    expect(u.studioPrevViewProj.value.equals(u.studioViewProj.value)).toBe(true);
    for (let id = 0; id < grid.length; id++)
      expect(u.studioCarPrev.value[id].equals(u.studioCarNow.value[id])).toBe(true);
  });

  it('advancing frames carry the previous view and chassis matrices', () => {
    const frame = new StudioFrame(createStudioUniforms());
    const u = frame.uniforms;
    const r = rig();
    place(r, 0);
    frame.update(snapshot(10, grid), r.camera, r.sun, 'chase:0');
    const viewProj = u.studioViewProj.value.clone();
    const cars = u.studioCarNow.value.slice(0, 3).map((m) => m.clone());
    place(r, 0.5);
    frame.update(snapshot(10.1, advance(grid, 0.1)), r.camera, r.sun, 'chase:0');
    expect(u.studioFrameDt.value).toBeCloseTo(0.1, 5);
    expect(u.studioPrevViewProj.value.equals(viewProj)).toBe(true);
    expect(u.studioViewProj.value.equals(viewProj)).toBe(false);
    const expected = new T.Matrix4().multiplyMatrices(
      r.camera.projectionMatrix,
      r.camera.matrixWorldInverse,
    );
    expect(u.studioViewProj.value.equals(expected)).toBe(true);
    for (let id = 0; id < 3; id++) {
      expect(u.studioCarPrev.value[id].equals(cars[id])).toBe(true);
      expect(u.studioCarNow.value[id].equals(cars[id])).toBe(false);
    }
  });
});

describe('StudioFrame cuts, seeks and resizes', () => {
  function primed(aspect = 16 / 9) {
    const frame = new StudioFrame(createStudioUniforms());
    const r = rig(aspect);
    place(r, 0);
    frame.update(snapshot(10, grid), r.camera, r.sun, 'chase:0');
    place(r, 0.5);
    return { frame, r, u: frame.uniforms };
  }
  function expectStill(u: StudioUniforms) {
    expect(u.studioFrameDt.value).toBe(0);
    expect(u.studioPrevViewProj.value.equals(u.studioViewProj.value)).toBe(true);
    for (let id = 0; id < u.studioCarCount.value; id++)
      expect(u.studioCarPrev.value[id].equals(u.studioCarNow.value[id])).toBe(true);
  }
  const next = snapshot(10.05, advance(grid, 0.05));

  it('a camera cut (view key change) restarts the history', () => {
    const { frame, r, u } = primed();
    const cuts = frame.diagnostics().cuts;
    frame.update(next, r.camera, r.sun, 'cockpit:0');
    expectStill(u);
    expect(frame.diagnostics().cuts).toBe(cuts + 1);
  });

  it('an explicit reset() restarts the history', () => {
    const { frame, r, u } = primed();
    frame.reset();
    frame.update(next, r.camera, r.sun, 'chase:0');
    expectStill(u);
  });

  it.each([
    ['a rewind', 9.5],
    ['a forward seek', 10 + STUDIO_SEEK_SECONDS + 0.01],
  ])('%s restarts the history', (_label, time) => {
    const { frame, r, u } = primed();
    frame.update(snapshot(time, grid), r.camera, r.sun, 'chase:0');
    expectStill(u);
  });

  it('a resize (aspect change) restarts the history', () => {
    const { frame, r, u } = primed();
    r.camera.aspect = 4 / 3;
    r.camera.updateProjectionMatrix();
    frame.update(next, r.camera, r.sun, 'chase:0');
    expectStill(u);
  });

  it('a teleported or newly joined car has no history; the others keep theirs', () => {
    const { frame, r, u } = primed();
    const before = u.studioCarNow.value.slice(0, 3).map((m) => m.clone());
    const moved = advance(grid, 0.05);
    moved[1] = { ...moved[1], x: moved[1].x + 60 };
    moved.push({ x: 8, y: 0.6, z: 40, yaw: 0, speed: 30 });
    frame.update(snapshot(10.05, moved), r.camera, r.sun, 'chase:0');
    expect(u.studioCarCount.value).toBe(4);
    expect(u.studioCarPrev.value[0].equals(before[0])).toBe(true);
    expect(u.studioCarPrev.value[2].equals(before[2])).toBe(true);
    expect(u.studioCarPrev.value[1].equals(u.studioCarNow.value[1])).toBe(true);
    expect(u.studioCarPrev.value[3].equals(u.studioCarNow.value[3])).toBe(true);
  });

  it('slots beyond the car count are cleared deterministically', () => {
    const { frame, r, u } = primed();
    frame.update(snapshot(10.05, advance(grid, 0.05).slice(0, 1)), r.camera, r.sun, 'chase:0');
    expect(u.studioCarCount.value).toBe(1);
    for (let id = 1; id < STUDIO_MAX_CARS; id++) {
      expect(u.studioCarNow.value[id].equals(new T.Matrix4())).toBe(true);
      expect(u.studioCarPrev.value[id].equals(new T.Matrix4())).toBe(true);
      expect(u.studioCarPose.value[id].toArray()).toEqual([0, 0, 0, 0]);
    }
  });
});

describe('StudioFrame values', () => {
  it('poses each car as (x, z, yaw, groundY) consistent with its chassis matrix', () => {
    const frame = new StudioFrame(createStudioUniforms());
    const r = rig();
    place(r, 0);
    const car: CarState = { x: 14, y: 0.6, z: -30, yaw: 0.7, length: 0.21, radius: 0.33 };
    frame.update(snapshot(4, [car]), r.camera, r.sun, 'chase:0');
    const pose = frame.uniforms.studioCarPose.value[0];
    expect(pose.x).toBeCloseTo(14, 5);
    expect(pose.y).toBeCloseTo(-30, 5);
    expect(pose.z).toBeCloseTo(0.7, 5);
    // Level car: every tyre contact sits mount 0.05 - suspension - radius below the chassis.
    expect(pose.w).toBeCloseTo(0.6 + 0.05 - 0.21 - 0.33, 5);
    const local = new T.Vector3(0.8, 0.4, 2.5);
    const world = local.clone().applyMatrix4(frame.uniforms.studioCarNow.value[0]);
    const footprint = studioCarLocal(pose, world);
    expect(footprint.x).toBeCloseTo(0.8, 5);
    expect(footprint.z).toBeCloseTo(2.5, 5);
    expect(footprint.y).toBeCloseTo(world.y - pose.w, 6);
    expect(STUDIO_CAR_HALF_EXTENTS).toEqual({ length: 2.8, width: 1.0 });
  });

  it('carries clamped wind, presented time and a bounded deterministic gust', () => {
    const frame = new StudioFrame(createStudioUniforms());
    const r = rig();
    place(r, 0);
    frame.update(snapshot(33.25, grid, [55, -2]), r.camera, r.sun, 'chase:0');
    const wind = frame.uniforms.studioWind.value;
    expect([wind.x, wind.y, wind.z]).toEqual([40, -2, 33.25]);
    expect(wind.w).toBe(studioGust(33.25, 40, -2));
    expect(studioGust(33.25, 0, 0)).toBe(0);
    for (let t = 0; t < 120; t += 0.37) {
      const calm = studioGust(t, 1.5, 0.6),
        storm = studioGust(t, 4.2 * Math.SQRT1_2, 4.2 * Math.SQRT1_2);
      expect(calm).toBeGreaterThan(0);
      expect(storm).toBeGreaterThan(calm);
      expect(storm).toBeLessThan(1);
    }
  });

  it('points studioSunDir at the sun from its target', () => {
    const frame = new StudioFrame(createStudioUniforms());
    const r = rig();
    r.sun.target.position.set(10, 0, 10);
    r.sun.position.set(10 - 140, 235, 10 - 115);
    place(r, 0);
    frame.update(snapshot(1, grid), r.camera, r.sun, 'chase:0');
    const expected = new T.Vector3(-140, 235, -115).normalize();
    expect(frame.uniforms.studioSunDir.value.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('rejects a non-finite presented time', () => {
    const frame = new StudioFrame(createStudioUniforms());
    const r = rig();
    place(r, 0);
    expect(() => frame.update(snapshot(NaN, grid), r.camera, r.sun, 'chase:0')).toThrow(
      'Invalid studio frame time',
    );
  });
});

describe('renderer integration contract', () => {
  const source = readFileSync(new URL('../src/rendering/renderer.ts', import.meta.url), 'utf8');
  const body = (name: string) => {
    const start = source.indexOf(`\n  ${name}(`);
    return source.slice(start, source.indexOf('\n  }\n', start));
  };

  it('updates once per frame, after the shadow anchor and the matrix update', () => {
    const draw = body('draw');
    expect(source.split('this.studioFrame.update(').length - 1).toBe(1);
    const update = draw.indexOf('this.studioFrame.update(');
    expect(update).toBeGreaterThan(draw.indexOf('shadowAnchor('));
    expect(update).toBeGreaterThan(draw.indexOf('this.camera.updateMatrixWorld(true);'));
    expect(update).toBeLessThan(draw.indexOf('this.composer.render();'));
  });

  it('resets the motion history on race reset and resize', () => {
    expect(body('reset')).toContain('this.studioFrame.reset();');
    expect(body('resize')).toContain('this.studioFrame.reset();');
  });
});
