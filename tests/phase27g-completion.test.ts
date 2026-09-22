import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { ExposureAdaptation, readExposureMeter } from '../src/rendering/exposure-meter.ts';
import { requireImageContent, pixelContent } from '../src/rendering/frame-capture.ts';
import { sleeveSection, tailoredSleeve, capSafetyTube } from '../src/rendering/driver-tailoring.ts';
import {
  LocalAtmosphere,
  atmosphereDensity,
  fogPockets,
  pocketDensity,
} from '../src/rendering/local-atmosphere.ts';
import { RaceComposition } from '../src/rendering/race-composition.ts';
import { Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
import { TracksideDirector } from '../src/rendering/trackside.ts';
import { graphicsPreset, validateGraphics } from '../src/rendering/options.ts';

function closedVolume(g: T.BufferGeometry) {
  const p = g.getAttribute('position'),
    n = g.getAttribute('normal'),
    ix = g.index!;
  expect([...p.array, ...n.array].every(Number.isFinite)).toBe(true);
  const edges = new Map<string, number>();
  let volume = 0;
  const key = (i: number) =>
    [p.getX(i), p.getY(i), p.getZ(i)].map((x) => Math.round(x * 1e7)).join(',');
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    v = new T.Vector3();
  for (let k = 0; k < ix.count; k += 3) {
    const ids = [ix.getX(k), ix.getX(k + 1), ix.getX(k + 2)];
    a.fromBufferAttribute(p, ids[0]);
    b.fromBufferAttribute(p, ids[1]);
    c.fromBufferAttribute(p, ids[2]);
    volume += a.dot(v.crossVectors(b, c)) / 6;
    for (let j = 0; j < 3; j++) {
      const edge = [key(ids[j]), key(ids[(j + 1) % 3])].sort().join('|');
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  expect([...edges.values()].every((n) => n === 2)).toBe(true);
  expect(volume).toBeGreaterThan(0);
  return volume;
}
describe('27G closure: measured exposure and capture integrity', () => {
  it('rejects invalid/transparent meters, trims highlights and bounds exposure', () => {
    expect(() => readExposureMeter(new Uint8Array(3))).toThrow();
    expect(readExposureMeter(new Uint8Array(192 * 4))).toBeNull();
    const p = new Uint8Array(100 * 4);
    for (let i = 0; i < 100; i++) {
      p[i * 4] = i < 10 ? 0 : i >= 90 ? 255 : 128;
      p[i * 4 + 3] = 255;
    }
    const o = readExposureMeter(p)!;
    expect(o.trimmedPixels).toBe(20);
    expect(o.logLuminance).toBeCloseTo(12 / 255);
    const state = new ExposureAdaptation();
    state.step(0, 'live', true);
    state.observe(-12, 1, state.generation);
    for (let i = 1; i <= 40; i++) state.step(i / 10, 'live', true);
    expect(state.ev).toBeGreaterThan(0.7);
    expect(state.ev).toBeLessThanOrEqual(0.85);
    const ev = state.ev;
    for (let i = 0; i < 100; i++) state.step(4, 'live', true);
    expect(state.ev).toBe(ev);
    expect(state.step(5, 'live', false)).toBe(1);
    expect(state.ev).toBe(ev);
    const stale = state.generation;
    state.step(0, 'seek', true);
    expect(state.ev).toBe(0);
    expect(state.observe(-12, 1, stale)).toBe(false);
    expect(state.samples).toBe(0);
    expect(() => state.step(NaN, 'x', true)).toThrow();
    expect(() => state.observe(0, 0, state.generation)).toThrow();
  });
  it('does not count transparent, uniform or black readbacks as valid pictures', () => {
    expect(() => requireImageContent(pixelContent(new Uint8Array(64 * 4)))).toThrow();
    const p = new Uint8Array(64 * 4);
    for (let i = 0; i < 64; i++) {
      p[i * 4 + 3] = 255;
      p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = 0;
    }
    expect(() => requireImageContent(pixelContent(p))).toThrow();
    for (let i = 0; i < 64; i++) p[i * 4] = i % 16;
    expect(() => requireImageContent(pixelContent(p))).not.toThrow();
  });
  it('saves independently switchable presentation settings without coercing strings', () => {
    const high = graphicsPreset('high');
    expect(high.autoExposure).toBe(true);
    expect(high.localFog).toBe(true);
    const restored = validateGraphics({ ...high, autoExposure: false, localFog: false }, 'high');
    expect(restored.autoExposure).toBe(false);
    expect(restored.localFog).toBe(false);
    expect(
      validateGraphics({ autoExposure: 'false', localFog: 'false' }, 'high').autoExposure,
    ).toBe(true);
  });
});
describe('27G closure: actual anatomy and safety-cell geometry', () => {
  it.each([true, false])('closes the %s sleeve without changing either bone endpoint', (upper) => {
    const g = tailoredSleeve(upper);
    closedVolume(g);
    expect(g.boundingBox!.min.y).toBe(-0.5);
    expect(g.boundingBox!.max.y).toBe(0.5);
    expect(g.boundingBox!.max.x).toBeLessThan(0.07);
    expect(sleeveSection(upper, 0.32, 0).x).toBeGreaterThan(sleeveSection(upper, 1, 0).x);
    expect(() => sleeveSection(upper, -1, 0)).toThrow();
    g.dispose();
  });
  it.each([8, 12])('closes curved halo attachment ends at %s sides', (sides) => {
    const curve = new T.CatmullRomCurve3([
      new T.Vector3(-0.3, 0, 0),
      new T.Vector3(0, 0.5, 0.3),
      new T.Vector3(0.3, 0, 0),
    ]);
    const g = capSafetyTube(new T.TubeGeometry(curve, 32, 0.033, sides, false));
    closedVolume(g);
    g.dispose();
  });
});
describe('27G closure: coherent local weather volumes', () => {
  it('places finite pockets on the same circuit, stays clear when dry, and decays with height/distance', () => {
    const pockets = fogPockets(new Track());
    expect(pockets).toHaveLength(3);
    expect(atmosphereDensity(0.12, 0)).toBe(0);
    expect(atmosphereDensity(0.9, 12)).toBeGreaterThan(0);
    const p = pockets[0];
    expect(pocketDensity(p, p.x, p.floor, p.z)).toBe(1);
    expect(pocketDensity(p, p.x, p.floor + 10, p.z)).toBeLessThan(0.2);
    expect(pocketDensity(p, p.x + p.radius * 3, p.floor, p.z)).toBeLessThan(0.001);
    expect(() => atmosphereDensity(NaN, 0)).toThrow();
  });
  it('chains material hooks once, keeps uniforms source-driven, and preserves frame bytes', () => {
    const f = new LocalAtmosphere(new Track()),
      m = new T.MeshStandardMaterial(),
      root = new T.Mesh(new T.BoxGeometry(), m);
    let calls = 0;
    m.onBeforeCompile = () => {
      calls++;
    };
    f.install(root);
    f.install(root);
    const s = {
      uniforms: {},
      vertexShader: '#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader: '#include <fog_pars_fragment>\n#include <fog_fragment>',
    } as unknown as T.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(s, {} as T.WebGLRenderer);
    expect(calls).toBe(1);
    expect(f.materialCount).toBe(1);
    expect(s.vertexShader).toContain('instanceMatrix');
    expect(s.fragmentShader).toContain('apexIntegral');
    const frame = new Simulation({ ...DEFAULT_OPTIONS, opponents: 1, weather: 'rain' }).makeFrame(),
      before = frame.slice();
    f.update(frame, true);
    expect(f.sigma.value).toBeGreaterThan(0);
    f.update(frame, false);
    expect(f.sigma.value).toBe(0);
    expect(frame).toEqual(before);
    root.geometry.dispose();
    m.dispose();
  });
});
describe('27G closure: no fabricated camera battles', () => {
  function frame() {
    const f = new Simulation({ ...DEFAULT_OPTIONS, opponents: 2 }).makeFrame();
    f[H.PHASE] = 3;
    for (let i = 0; i < 3; i++) {
      const b = carBase(i);
      f[b + F.X] = i === 2 ? 50 : i * 5;
      f[b + F.Y] = 0;
      f[b + F.Z] = 0;
      f[b + F.VX] = 10;
      f[b + F.VY] = f[b + F.VZ] = 0;
      f[b + F.SPEED] = 10;
      f[b + F.IN_PIT] = f[b + F.RETIRED] = f[b + F.FINISH] = 0;
    }
    return f;
  }
  it('frames both actual complete cars and retains a rival through the join/leave hysteresis', () => {
    const f = frame(),
      before = f.slice(),
      c = new RaceComposition();
    c.update(f, 0);
    expect(c.kind).toBe('battle');
    expect(c.participants).toEqual([0, 1]);
    expect(c.radius).toBeGreaterThan(5);
    expect(f).toEqual(before);
    f[carBase(1) + F.X] = 12;
    c.update(f, 0);
    expect(c.participants).toContain(1);
    c.reset();
    c.update(f, 0);
    expect(c.participants).toEqual([0]);
    f[carBase(1) + F.X] = 5;
    f[carBase(1) + F.VX] = -10;
    c.update(f, 0);
    expect(c.participants).toEqual([0]);
    f[carBase(1) + F.VX] = 10;
    f[carBase(1) + F.Y] = 10;
    c.update(f, 0);
    expect(c.participants).toEqual([0]);
  });
  it('does not silently claim a huge group fits after dropping the rival radius', () => {
    const track = new Track(),
      d = new TracksideDirector(track),
      p = new T.Vector3(track.points[0].x, track.points[0].y, track.points[0].z);
    d.update(0, p, new T.Vector3(), 0, 1, 1000, true);
    expect(d.subjectRadius).toBe(1000);
    expect(d.framingFits).toBe(false);
  });
});

import { flipPixelRows } from '../src/rendering/frame-capture.ts';
import { validatePhoto, DEFAULT_PHOTO } from '../src/rendering/photo-camera.ts';
it.each([2, 3])('preserves exact RGBA row orientation for height %s', (height) => {
  const pixels = Uint8Array.from({ length: 3 * height * 4 }, (_, i) => i);
  const before = pixels.slice();
  flipPixelRows(pixels, 3, height);
  for (let y = 0; y < height; y++)
    expect([...pixels.slice(y * 12, (y + 1) * 12)]).toEqual([
      ...before.slice((height - y - 1) * 12, (height - y) * 12),
    ]);
  flipPixelRows(pixels, 3, height);
  expect(pixels).toEqual(before);
});
it('refuses malformed pixel dimensions before modifying a buffer', () => {
  const pixels = new Uint8Array(16),
    before = pixels.slice();
  for (const [w, h] of [
    [0, 2],
    [2.5, 2],
    [2, 3],
    [NaN, 2],
  ])
    expect(() => flipPixelRows(pixels, w, h)).toThrow();
  expect(pixels).toEqual(before);
});
it('rejects a uniformly coloured opaque picture rather than mistaking saturation for detail', () => {
  const bytes = Uint8Array.from({ length: 64 * 4 }, (_, i) => [200, 30, 5, 255][i % 4]);
  expect(pixelContent(bytes).spatialRange).toBe(0);
  expect(() => requireImageContent(pixelContent(bytes))).toThrow();
});
it('rejects non-finite image summaries', () => {
  const valid = { opaque: 64, total: 64, minimum: 1, maximum: 200, spatialRange: 100 };
  for (const key of Object.keys(valid))
    expect(() => requireImageContent({ ...valid, [key]: NaN })).toThrow();
});
it.each(['cockpit', 'pod', 'chase', 'trackside'] as const)(
  'retains native %s camera and rejects it in a showroom',
  (view) => {
    expect(validatePhoto({ ...DEFAULT_PHOTO, view }).view).toBe(view);
    expect(validatePhoto({ ...DEFAULT_PHOTO, view, backdrop: 'studio' }).view).toBe('orbit');
    expect(validatePhoto({ ...DEFAULT_PHOTO, view, backdrop: 'headquarters' }).view).toBe('orbit');
  },
);
it('unknown native camera values fall back to the original orbit', () => {
  expect(validatePhoto({ view: 'unknown' }).view).toBe('orbit');
  expect(validatePhoto({}).view).toBe('orbit');
});
it('retains all nearby pack participants for an arbitrary followed car and never mutates frames', () => {
  const f = new Simulation({ ...DEFAULT_OPTIONS, opponents: 5 }).makeFrame();
  f[H.PHASE] = 3;
  for (let id = 0; id < 6; id++) {
    const b = carBase(id);
    f[b + F.X] = id * 1.1;
    f[b + F.Y] = 0;
    f[b + F.Z] = 0;
    f[b + F.VX] = 12;
    f[b + F.VY] = f[b + F.VZ] = 0;
    f[b + F.SPEED] = 12;
    f[b + F.RETIRED] = f[b + F.IN_PIT] = f[b + F.FINISH] = 0;
  }
  const before = f.slice(),
    group = new RaceComposition().update(f, 3);
  expect(group.kind).toBe('pack');
  expect(group.participants).toHaveLength(6);
  for (const id of group.participants) {
    const b = carBase(id);
    expect(
      new T.Vector3(f[b + F.X], f[b + F.Y], f[b + F.Z]).distanceTo(group.target) + 3.1,
    ).toBeLessThanOrEqual(group.radius + 1e-9);
  }
  expect(f).toEqual(before);
});
it('safety attachment caps preserve original analytic side normals and are idempotent', () => {
  const curve = new T.CatmullRomCurve3([
    new T.Vector3(-0.3, 0, 0),
    new T.Vector3(0, 0.5, 0.3),
    new T.Vector3(0.3, 0, 0),
  ]);
  const g = new T.TubeGeometry(curve, 32, 0.033, 12, false),
    before = Array.from(g.getAttribute('normal').array);
  capSafetyTube(g);
  expect(Array.from(g.getAttribute('normal').array).slice(0, before.length)).toEqual(before);
  const count = g.getAttribute('position').count;
  capSafetyTube(g);
  expect(g.getAttribute('position').count).toBe(count);
  g.dispose();
});
