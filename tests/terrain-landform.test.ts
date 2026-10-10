import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { terrainFor } from '../src/rendering/terrain.ts';
import { grassApronOffset } from '../src/rendering/ground-profile.ts';
import { clamp } from '../src/core/math.ts';
import {
  APRON_OUTER,
  APRON_SKIRT_METRES,
  SKIRT_EMBED,
  apronSkirtHeight,
} from '../src/rendering/studio/apron-skirt.ts';
import {
  FAR,
  TERRAIN_FINISH_HOOK,
  installTerrainFinish,
  terrainTrackDistance,
} from '../src/rendering/studio/terrain-finish.ts';
import { installCircuitFinish } from '../src/rendering/circuit-finish.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';

describe('apron skirt', () => {
  for (const circuit of [CIRCUITS.aurel, CIRCUITS.vellamar]) {
    const track = new Track('clear', false, undefined, circuit);
    const ground = terrainFor(track);
    it(`${circuit.id}: starts on the apron edge and lands within 0.1 m of the terrain`, () => {
      const p = trackPoint();
      let worst = 0;
      for (let s = 0; s < track.length; s += 7)
        for (const side of [-1, 1]) {
          track.at(s, p);
          const l0 = side * (p.width + APRON_OUTER);
          // Row 0 is exactly the apron's own outer edge height.
          expect(apronSkirtHeight(track, (x, z) => ground.height(x, z), s, l0, 0)).toBeCloseTo(
            grassApronOffset(track, s, l0),
            10,
          );
          const l1 = side * (p.width + APRON_OUTER + APRON_SKIRT_METRES);
          const y =
            p.y +
            p.bank * clamp(l1, -12, 12) +
            apronSkirtHeight(track, (x, z) => ground.height(x, z), s, l1, 1);
          const terrain = ground.height(p.x + p.nx * l1, p.z + p.nz * l1);
          worst = Math.max(worst, Math.abs(y - terrain));
        }
      expect(worst).toBeLessThanOrEqual(0.1);
      expect(worst).toBeCloseTo(SKIRT_EMBED, 6);
    });
  }
});

describe('far landscape finish', () => {
  it('measures every terrain vertex distance to the circuit, capped', () => {
    const track = new Track();
    const g = new T.PlaneGeometry(5500, 5500, 40, 40).rotateX(-Math.PI / 2);
    const values = terrainTrackDistance(track, g);
    expect(g.getAttribute('trackDistance').count).toBe(g.getAttribute('position').count);
    expect(Math.min(...values)).toBeLessThan(80);
    expect(Math.max(...values)).toBe(FAR.cap);
    // A vertex on the circuit reads (nearly) zero.
    const p = track.at(500, trackPoint());
    const one = new T.BufferGeometry().setAttribute(
      'position',
      new T.Float32BufferAttribute([p.x, 0, p.z], 3),
    );
    expect(terrainTrackDistance(track, one)[0]).toBeLessThan(15);
  });

  it('chains the canopy, rock and meadow finish after the circuit terrain finish', () => {
    const material = new T.MeshStandardMaterial();
    installCircuitFinish(material, 'terrain');
    expect(installTerrainFinish(material)).toBe(true);
    expect(installTerrainFinish(material)).toBe(false);
    expect(studioHookKeys(material)).toEqual([TERRAIN_FINISH_HOOK]);
    const shader = {
      uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as unknown as StudioShader;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    const f = shader.fragmentShader;
    expect(shader.vertexShader).toContain('attribute float trackDistance;');
    // Runs after the circuit's own terrain shading so it is not overpainted.
    expect(f.indexOf('D17 far landscape')).toBeGreaterThan(f.indexOf('float dryLand='));
    expect(f).toContain('normal = apexTerrainRelief( normal, apexCanopyHeight );');
    expect(FAR.forestFrom).toBe(350);
  });
});
