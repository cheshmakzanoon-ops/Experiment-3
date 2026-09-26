import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { F, H, CAR_STRIDE, HEADER, carBase } from '../src/simulation/protocol.ts';
import {
  PIT_CREW_MAX_DISTANCE,
  PIT_SERVICE_CENTER,
  PIT_SERVICE_HALF_EXTENTS,
  PIT_SERVICE_RADIUS,
} from '../src/rendering/pit-presentation.ts';
import { RaceComposition } from '../src/rendering/race-composition.ts';
import { TracksideDirector, type BroadcastSubjectVisibility } from '../src/rendering/trackside.ts';
import { installWetRoad } from '../src/rendering/materials.ts';
import {
  LIGHT_FOOTPRINT_GLSL,
  lightFootprintRoughness,
  VENUE_LAMP_RADIUS,
  VENUE_LAMP_WIDTH,
  VENUE_LAMP_DEPTH,
} from '../src/rendering/light-footprint.ts';

const track = new Track();
const velocity = new T.Vector3();
function subject() {
  const p = trackPoint();
  track.at(0, p);
  const target = new T.Vector3(p.x, p.y + 1, p.z);
  const visibility: BroadcastSubjectVisibility = {
    points: Array.from({ length: 8 }, (_, i) =>
      target.clone().add(new T.Vector3((i & 4 ? 1 : -1) * 4, i & 2 ? 1 : -1, (i & 1 ? 1 : -1) * 3)),
    ),
    anchor: target.clone(),
    maxDistance: 5000,
  };
  return { target, visibility };
}
function isRig(from: T.Vector3, director: TracksideDirector, id: number) {
  return from.equals(director.rigs[id].position);
}

describe('pit service subject visibility', () => {
  it('rotates all eight probes with the presented car without allocating or mutating a frame', () => {
    const c = new RaceComposition(),
      f = new Float32Array(HEADER + CAR_STRIDE),
      o = carBase(0);
    f[H.CARS] = 1;
    f[H.PHASE] = 3;
    f[o + F.IN_PIT] = 1;
    f[o + F.PIT_PHASE] = 3;
    f[o + F.PIT_CLOCK] = 1.8;
    f[o + F.X] = 22;
    f[o + F.Y] = 0.7;
    f[o + F.Z] = -35;
    const q = new T.Quaternion().setFromEuler(new T.Euler(0.1, 1.3, -0.05));
    [F.QX, F.QY, F.QZ, F.QW].forEach((field, i) => (f[o + field] = q.toArray()[i]));
    const before = f.slice();
    c.update(f, 0);
    const visibility = c.visibility!;
    expect(visibility.points).toHaveLength(8);
    expect(visibility.maxDistance).toBe(PIT_CREW_MAX_DISTANCE);
    expect(visibility.anchor.toArray()).toEqual([f[o + F.X], f[o + F.Y], f[o + F.Z]]);
    const rotation = new T.Quaternion(
      f[o + F.QX],
      f[o + F.QY],
      f[o + F.QZ],
      f[o + F.QW],
    ).normalize();
    expect(
      c.target.distanceTo(
        PIT_SERVICE_CENTER.clone().applyQuaternion(rotation).add(visibility.anchor),
      ),
    ).toBeLessThan(1e-10);
    for (const point of visibility.points) {
      const local = point.clone().sub(c.target).applyQuaternion(rotation.clone().invert());
      expect(Math.abs(local.x)).toBeCloseTo(PIT_SERVICE_HALF_EXTENTS.x, 10);
      expect(Math.abs(local.y)).toBeCloseTo(PIT_SERVICE_HALF_EXTENTS.y, 10);
      expect(Math.abs(local.z)).toBeCloseTo(PIT_SERVICE_HALF_EXTENTS.z, 10);
      expect(point.distanceTo(c.target)).toBeCloseTo(PIT_SERVICE_RADIUS, 10);
    }
    c.update(f, 0);
    expect(c.visibility).toBe(visibility);
    expect(f).toEqual(before);
    f[o + F.SPEED] = 2;
    c.update(f, 0);
    expect(c.visibility).toBeUndefined();
    f[o + F.SPEED] = 0;
    c.update(f, 0);
    expect(c.visibility).toBe(visibility);
    f[o + F.IN_PIT] = 0;
    c.update(f, 0);
    expect(c.visibility).toBeUndefined();
    c.reset();
    expect(c.visibility).toBeUndefined();
  });
  it('does not mistake a clear centre for a clear crew: chooses an existing better lens', () => {
    const { target, visibility } = subject();
    let calls = 0;
    const d: TracksideDirector = new TracksideDirector(track, (from, to) => {
      calls++;
      return !to.equals(target) && isRig(from, d, 0);
    });
    d.update(0, target, velocity, 1 / 60, 16 / 9, PIT_SERVICE_RADIUS, true, visibility);
    expect(d.activeId).not.toBe(0);
    expect(d.subjectSampleCount).toBe(9);
    expect(d.subjectVisibleSamples).toBe(9);
    expect(d.position.equals(d.rigs[d.activeId].position)).toBe(true);
    expect(calls).toBeLessThanOrEqual(20 * 9);
    const id = d.activeId,
      gaze = d.gaze.clone();
    for (let i = 0; i < 20; i++)
      d.update(0, target, velocity, 0, 16 / 9, PIT_SERVICE_RADIUS, true, visibility);
    expect(d.activeId).toBe(id);
    expect(d.gaze.equals(gaze)).toBe(true);
    expect(d.cuts).toBe(1);
  });
  it('never trades an unobstructed car for eight empty but visible boundary points', () => {
    const { target, visibility } = subject();
    const d: TracksideDirector = new TracksideDirector(track, (from, to) =>
      isRig(from, d, 0) ? !to.equals(target) : to.equals(target),
    );
    d.update(0, target, velocity, 1 / 60, 16 / 9, PIT_SERVICE_RADIUS, true, visibility);
    expect(d.activeId).toBe(0);
    expect(d.subjectVisibleSamples).toBe(1);
    expect(d.occluded).toBe(false);
  });
  it('cannot approve an out-of-range camera or an entirely obstructed subject', () => {
    const { target, visibility } = subject();
    const d = new TracksideDirector(track, () => true);
    d.update(0, target, velocity, 1 / 60, 16 / 9, PIT_SERVICE_RADIUS, true, visibility);
    expect(d.subjectVisibleSamples).toBe(0);
    expect(d.occluded).toBe(true);
    expect(d.framingFits).toBe(false);
    const clear = new TracksideDirector(track);
    clear.update(0, target, velocity, 1 / 60, 16 / 9, PIT_SERVICE_RADIUS, true, {
      ...visibility,
      maxDistance: 0.001,
    });
    expect(clear.subjectWithinRange).toBe(false);
    expect(clear.framingFits).toBe(false);
  });
  it('never shrinks a visibility-qualified service subject to obtain a false fit', () => {
    const { target, visibility } = subject(),
      d = new TracksideDirector(track);
    d.update(0, target, velocity, 0, 9 / 16, 1000, false, {
      ...visibility,
      maxDistance: PIT_CREW_MAX_DISTANCE,
    });
    expect(d.subjectRadius).toBe(1000);
    expect(d.framingFits).toBe(false);
  });
  it('rejects a clearer but distant lens when its mechanics would be culled', () => {
    const { target, visibility } = subject();
    const d = new TracksideDirector(
      track,
      (from, to) => from.distanceTo(target) <= PIT_CREW_MAX_DISTANCE && !to.equals(target),
    );
    d.update(0, target, velocity, 1 / 60, 16 / 9, PIT_SERVICE_RADIUS, true, {
      ...visibility,
      maxDistance: PIT_CREW_MAX_DISTANCE,
    });
    expect(d.subjectWithinRange).toBe(true);
    expect(d.position.distanceTo(target)).toBeLessThanOrEqual(PIT_CREW_MAX_DISTANCE);
    expect(d.subjectVisibleSamples).toBe(1);
  });
  it('seeks to the new physical subject and resets the visibility diagnostics', () => {
    const { target, visibility } = subject();
    const d = new TracksideDirector(track);
    d.update(0, target, velocity, 0, 16 / 9, PIT_SERVICE_RADIUS, true, visibility);
    const p = trackPoint();
    track.at(track.length / 2, p);
    const next = new T.Vector3(p.x, p.y + 1, p.z);
    const moved = {
      ...visibility,
      anchor: next,
      points: visibility.points.map((v) => v.clone().sub(target).add(next)),
    };
    d.update(track.length / 2, next, velocity, 0, 16 / 9, PIT_SERVICE_RADIUS, true, moved);
    expect(d.activeId).toBe(10);
    expect(d.gaze.equals(next)).toBe(true);
    d.reset();
    expect(d.subjectSampleCount).toBe(1);
    expect(d.subjectWithinRange).toBe(true);
  });
  it('bounds the probe workload and rejects invalid subject data', () => {
    const { target, visibility } = subject();
    const d = new TracksideDirector(track);
    for (const bad of [
      { ...visibility, points: Array.from({ length: 9 }, () => target) },
      { ...visibility, points: [new T.Vector3(NaN, 0, 0)] },
      { ...visibility, anchor: new T.Vector3(Infinity, 0, 0) },
      { ...visibility, maxDistance: -1 },
      { ...visibility, maxDistance: NaN },
    ])
      expect(() => d.update(0, target, velocity, 0, 16 / 9, PIT_SERVICE_RADIUS, true, bad)).toThrow(
        'Invalid broadcast subject visibility',
      );
  });
});

describe('venue lamp water-film footprint', () => {
  it('derives the finite emitter from the existing board area', () => {
    expect(VENUE_LAMP_WIDTH).toBe(3.2);
    expect(VENUE_LAMP_DEPTH).toBe(1.3);
    expect(Math.PI * VENUE_LAMP_RADIUS ** 2).toBeCloseTo(4.16, 12);
  });
  it('bounds the lobe, preserves zero-footprint lights and fades with distance', () => {
    for (const roughness of [0, 0.055, 0.22, 0.48, 0.9, 1]) {
      expect(lightFootprintRoughness(roughness, 0, 0)).toBe(roughness);
      let previous = 1;
      for (const distance of [0, 1, 5, 15, 30, 60, 135, 1000, 1e9]) {
        const result = lightFootprintRoughness(roughness, distance, VENUE_LAMP_RADIUS);
        expect(result).toBeGreaterThanOrEqual(roughness - 1e-15);
        expect(result).toBeLessThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(previous);
        previous = result;
      }
      expect(previous).toBeCloseTo(roughness, 4);
    }
  });
  it('rejects non-finite and physically invalid parameters', () => {
    for (const args of [
      [NaN, 10, 1],
      [0.2, Infinity, 1],
      [0.2, 10, -1],
      [1.1, 10, 1],
      [-1, 10, 1],
      [0.2, -10, 1],
    ])
      expect(() => lightFootprintRoughness(...(args as [number, number, number]))).toThrow();
  });
  for (const physical of [false, true])
    it(`chains the real ${physical ? 'physical' : 'standard'} shader and restores the lobe after each point light`, () => {
      const m = physical
        ? new T.MeshPhysicalMaterial({ clearcoat: 1 })
        : new T.MeshStandardMaterial();
      const texture = new T.DataTexture();
      let called = false;
      m.onBeforeCompile = () => {
        called = true;
      };
      installWetRoad(m, texture, true, VENUE_LAMP_RADIUS);
      const source = physical ? T.ShaderLib.physical : T.ShaderLib.standard;
      const shader = {
        vertexShader: source.vertexShader,
        fragmentShader: source.fragmentShader,
        uniforms: T.UniformsUtils.clone(source.uniforms),
      } as Parameters<T.Material['onBeforeCompile']>[0];
      m.onBeforeCompile(shader, {} as T.WebGLRenderer);
      expect(called).toBe(true);
      expect(shader.uniforms.roadLampRadius.value).toBe(VENUE_LAMP_RADIUS);
      expect(shader.fragmentShader).toContain(LIGHT_FOOTPRINT_GLSL);
      expect(shader.fragmentShader.match(/float savedRoadCoatRoughness/g)).toHaveLength(1);
      expect(shader.fragmentShader).toContain(
        'material.clearcoatRoughness = savedRoadCoatRoughness;',
      );
      const pointBegin = shader.fragmentShader.indexOf('PointLight pointLight;'),
        pointEnd = shader.fragmentShader.indexOf('SpotLight spotLight;');
      const originalSpotAndSun = T.ShaderChunk.lights_fragment_begin.slice(
        T.ShaderChunk.lights_fragment_begin.indexOf('SpotLight spotLight;'),
      );
      expect(shader.fragmentShader).toContain(originalSpotAndSun);
      expect(shader.fragmentShader.indexOf('float savedRoadCoatRoughness')).toBeGreaterThan(
        pointBegin,
      );
      expect(
        shader.fragmentShader.indexOf('material.clearcoatRoughness = savedRoadCoatRoughness;'),
      ).toBeLessThan(pointEnd);
      expect(m.customProgramCacheKey()).toContain('venue-lamp-footprint-v1');
      m.dispose();
      texture.dispose();
    });
});
