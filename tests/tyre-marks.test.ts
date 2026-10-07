import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { racingLineFor } from '../src/simulation/racing-line.ts';
import {
  TYRE_MARKS,
  buildTyreMarks,
  installTyreMarkWater,
  tyreMarkZones,
  tyreMarks,
} from '../src/rendering/tyre-marks.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';

function stubCanvas() {
  class Canvas {
    width = 300;
    height = 150;
    getContext() {
      const noop = () => {};
      return new Proxy({ canvas: this }, { get: (t, k) => Reflect.get(t, k) ?? noop });
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
}
afterEach(() => vi.unstubAllGlobals());

const track = (id: 'aurel' | 'vellamar') =>
  new Track('clear', false, undefined, circuitDefinition(id));

describe('laid tyre rubber', () => {
  for (const id of ['aurel', 'vellamar'] as const)
    it(`${id}: braking zones end at corners and every mark lies on the asphalt near the line`, () => {
      const t = track(id),
        line = racingLineFor(t),
        p = trackPoint();
      const zones = tyreMarkZones(t);
      expect(tyreMarkZones(t)).toEqual(zones);
      const braking = zones.filter((z) => z.kind === 'braking');
      expect(braking.length).toBeGreaterThanOrEqual(4);
      for (const zone of braking) {
        expect(zone.strength).toBeGreaterThanOrEqual(TYRE_MARKS.minimumDrop);
        expect(zone.end).toBeGreaterThan(zone.start);
        // A braking zone ends where the line turns: a corner tighter than 200 m.
        let k = 0;
        for (let s = zone.end - 10; s <= zone.end + 30; s += 2)
          k = Math.max(k, Math.abs(line.curvatureAt(s)));
        expect(k).toBeGreaterThan(0.005);
      }
      // Exit marks stop where the next braking zone starts.
      for (const exit of zones.filter((z) => z.kind === 'exit'))
        for (const zone of braking)
          if (zone.start > exit.start) expect(exit.end).toBeLessThanOrEqual(zone.start + 1e-6);
      const marks = tyreMarks(t, zones);
      expect(marks.length).toBeGreaterThan(braking.length * 3);
      for (const mark of marks)
        for (let i = 0; i < mark.s.length; i++) {
          t.at(mark.s[i], p);
          expect(Math.abs(mark.lateral[i])).toBeLessThanOrEqual(p.width - TYRE_MARKS.width + 1e-5);
          expect(Math.abs(mark.lateral[i] - line.offsetAt(mark.s[i]))).toBeLessThanOrEqual(
            TYRE_MARKS.halfTrack + 1.05,
          );
          expect(mark.alpha[i]).toBeGreaterThanOrEqual(0);
          expect(mark.alpha[i]).toBeLessThanOrEqual(0.62);
        }
    });
  it('builds a few culled, upward-facing, non-occluding meshes on the road', () => {
    stubCanvas();
    const t = track('aurel'),
      group = new T.Group();
    const meshes = buildTyreMarks(t, group);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(Math.ceil(t.length / TYRE_MARKS.chunk));
    let triangles = 0;
    for (const mesh of meshes) {
      const material = mesh.material as T.MeshStandardMaterial;
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.vertexColors).toBe(true);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.geometry.getAttribute('color').itemSize).toBe(4);
      const normal = mesh.geometry.getAttribute('normal'),
        position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < normal.count; i++) {
        expect(normal.getY(i)).toBeGreaterThan(0.9);
        expect(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i))).toBe(true);
      }
      triangles += mesh.geometry.index!.count / 3;
    }
    expect(triangles).toBeLessThan(40000);
    expect(group.children).toHaveLength(meshes.length);
  });
  it('fades the marks under the physics water film, on the road state coordinates', () => {
    stubCanvas();
    const t = track('aurel'),
      group = new T.Group(),
      state = new T.DataTexture(new Uint8Array(4), 1, 1);
    const meshes = buildTyreMarks(t, group, undefined, state);
    const material = meshes[0].material as T.MeshStandardMaterial;
    // One shared material; draw count and blending unchanged.
    expect(new Set(meshes.map((m) => m.material)).size).toBe(1);
    expect(studioHookKeys(material)).toContain('tyre-mark-water-v2');
    for (const mesh of meshes) {
      const uv = mesh.geometry.getAttribute('trackUV');
      expect(uv.itemSize).toBe(2);
      expect(uv.count).toBe(mesh.geometry.getAttribute('position').count);
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getX(i)).toBeLessThanOrEqual(1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getY(i)).toBeLessThan(1);
      }
    }
    // Same lateral/lap mapping as the road ribbon's trackUV.
    const mark = tyreMarks(t)[0];
    expect(meshes[0].geometry.getAttribute('trackUV').getY(0)).toBeCloseTo(
      (((mark.s[0] % t.length) + t.length) % t.length) / t.length,
      5,
    );
    const shader = {
      uniforms: {} as Record<string, T.IUniform>,
      vertexShader: T.ShaderLib.physical.vertexShader,
      fragmentShader: T.ShaderLib.physical.fragmentShader,
    } as unknown as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms.apexMarkState.value).toBe(state);
    expect(shader.vertexShader).toContain('attribute vec2 trackUV;');
    expect(shader.vertexShader).toContain('vMarkTrackUV = trackUV;');
    const fade = shader.fragmentShader.indexOf(
      'texture2D(apexMarkState, vec2(vMarkTrackUV.x, fract(vMarkTrackUV.y))).r * 2.0',
    );
    expect(fade).toBeGreaterThan(shader.fragmentShader.indexOf('#include <alphamap_fragment>'));
    expect(fade).toBeLessThan(shader.fragmentShader.indexOf('#include <alphatest_fragment>'));
    expect(shader.fragmentShader).toContain(
      `smoothstep(${TYRE_MARKS.waterCover[0].toFixed(3)}, ${TYRE_MARKS.waterCover[1].toFixed(3)}`,
    );
    // Idempotent: a second install chains nothing.
    expect(installTyreMarkWater(material, state)).toBe(false);
    // Without the state texture the marks stay as before (no extra attribute).
    const plain = buildTyreMarks(t, new T.Group());
    expect(plain[0].geometry.getAttribute('trackUV')).toBeUndefined();
    expect(studioHookKeys(plain[0].material as T.Material)).not.toContain('tyre-mark-water-v2');
  });
  it('keeps the water lookup continuous for a mark across the start line', () => {
    stubCanvas();
    const t = track('aurel'),
      state = new T.DataTexture(new Uint8Array(4), 1, 1);
    const n = 25,
      s = new Float32Array(n),
      lateral = new Float32Array(n).fill(1.5),
      alpha = new Float32Array(n).fill(0.5);
    for (let k = 0; k < n; k++) s[k] = t.length - 14.4 + k * 1.2;
    const [mesh] = buildTyreMarks(t, new T.Group(), [{ s, lateral, alpha }], state);
    const uv = mesh.geometry.getAttribute('trackUV');
    // V keeps rising through the seam (no quad interpolates across the whole
    // lap) and wraps to the same lap fraction the road samples.
    for (let i = 2; i < uv.count; i++) expect(uv.getY(i)).toBeGreaterThan(uv.getY(i - 2));
    for (let i = 0; i < uv.count; i++) {
      const lap = s[i >> 1] / t.length;
      expect(uv.getY(i) - Math.floor(uv.getY(i))).toBeCloseTo(lap - Math.floor(lap), 5);
    }
    expect(uv.getY(0)).toBeLessThan(1);
    expect(uv.getY(uv.count - 1)).toBeGreaterThan(1);
    state.dispose();
  });
});
