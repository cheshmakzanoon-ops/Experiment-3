import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { gpCornerShapes } from '../src/simulation/gp-corner-shape.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { kerbHeight } from '../src/simulation/contact.ts';
import { CircuitScene, circuitKerbHeight } from '../src/rendering/circuit.ts';
import { gpCornerPaint, gpEdgeDesign } from '../src/rendering/venue-kit/gp-edge-design.ts';
import { kerbStyleAt, runoffStyleAt } from '../src/rendering/venue-plan.ts';
import { installCircuitFinish } from '../src/rendering/circuit-finish.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import {
  installKerbFinish,
  installRunoffFinish,
} from '../src/rendering/studio/kerb-runoff-finish.ts';

const venues = [
  'poggio-alto',
  'cape-wrenna',
  'haarveld',
  'montejaral',
  'steinhorn',
  'zafra-night',
] as const;
const tracks = new Map(
  venues.map((id) => [id, new Track('clear', false, undefined, CIRCUITS[id])]),
);
const ribbonHost = (track: Track) =>
  Object.assign(Object.create(CircuitScene.prototype) as CircuitScene, {
    track,
    surfaces: new T.Group(),
  });

describe('GP course paint follows the real bend and preserves its contact surface', () => {
  it.each(venues)(
    '%s has distinct outside entry/exit and inside apex paint with no seam at the lap wrap',
    (id) => {
      const track = tracks.get(id)!,
        shapes = gpCornerShapes(track),
        original = track.points.map((p) => [p.x, p.y, p.z, p.bank, p.curvature]);
      let sideDifference = 0;
      for (let i = 0; i < shapes.length; i++) {
        const shape = shapes[i],
          apex = track.circuit.corners[i].s,
          outside = shape.direction === 'left' ? -1 : 1;
        if (shape.direction === 'straight') continue;
        expect(gpCornerPaint(track, apex, outside * 12)).toBeCloseTo(1, 9);
        expect(gpCornerPaint(track, apex, -outside * 12)).toBeCloseTo(-1, 9);
        const entry = apex - shape.entry * 0.7,
          outer = gpCornerPaint(track, entry, outside * 12),
          inner = gpCornerPaint(track, entry, -outside * 12);
        expect(outer).toBeGreaterThan(0.6);
        expect(Math.abs(inner)).toBeLessThan(0.001);
        sideDifference++;
      }
      expect(sideDifference).toBeGreaterThan(8);
      for (let s = -15; s < track.length; s += 11.3) {
        for (const side of [-1, 1]) {
          const paint = gpCornerPaint(track, s, side * 12);
          expect(Math.abs(paint)).toBeLessThanOrEqual(1);
          expect(gpCornerPaint(track, s + track.length * 2, side * 12)).toBeCloseTo(paint, 9);
        }
      }
      expect(track.points.map((p) => [p.x, p.y, p.z, p.bank, p.curvature])).toEqual(original);
    },
  );

  it.each(venues)(
    '%s keeps one venue scheme while the corner envelope changes on each side',
    (id) => {
      const track = tracks.get(id)!,
        styles = new Set<number>(),
        kerbs = new Set<number>();
      for (let s = 0; s < track.length; s += 13) {
        styles.add(runoffStyleAt(track, s));
        kerbs.add(kerbStyleAt(track, s));
      }
      expect(styles.has(4)).toBe(false); // No random artificial-turf finish on GP paved aprons.
      expect(styles.size).toBe(1);
      expect(kerbs.size).toBe(1);
      const corner = track.circuit.corners[0],
        shape = gpCornerShapes(track)[0],
        renderer = ribbonHost(track),
        material = new T.MeshStandardMaterial(),
        options = {
          start: corner.s - shape.entry,
          end: corner.s + shape.exit,
          step: 2,
          columns: 4,
          offset: (s: number, t: number) => (t * 2 - 1) * (track.at(s, trackPoint()).width + 4),
        };
      // Compare identical production geometry with and without the cosmetic
      // attributes. Paint must not alter width, vertices, indices or normals.
      renderer.ribbon(material, options);
      const base = [...renderer.surfaces.children] as T.Mesh[];
      renderer.surfaces.clear();
      renderer.ribbon(material, { ...options, runoff: true });
      const painted = renderer.surfaces.children as T.Mesh[];
      expect(painted.length).toBe(base.length);
      for (let chunk = 0; chunk < painted.length; chunk++) {
        const geometry = painted[chunk].geometry,
          before = base[chunk].geometry,
          uv = geometry.getAttribute('uv'),
          paint = geometry.getAttribute('gpCornerPaint');
        for (const name of ['position', 'normal'])
          expect(Array.from(geometry.getAttribute(name).array)).toEqual(
            Array.from(before.getAttribute(name).array),
          );
        expect(Array.from(geometry.index!.array)).toEqual(Array.from(before.index!.array));
        expect(paint.count).toBe(uv.count);
        for (let i = 0; i < uv.count; i++)
          expect(paint.getX(i)).toBeCloseTo(
            gpCornerPaint(track, uv.getY(i) * 5, uv.getX(i) * 5),
            3,
          );
        geometry.dispose();
        before.dispose();
      }
      material.dispose();
    },
  );

  it('leaves car and motocross venue paint selection untouched', () => {
    for (const id of ['aurel', 'vellamar', 'parco-reale', 'valley-ridge-mx'] as const) {
      const track = new Track('clear', false, undefined, CIRCUITS[id]);
      expect(gpEdgeDesign(track)).toBeNull();
      expect(gpCornerPaint(track, 40, 11)).toBe(0);
    }
  });
});

describe('rendered pit-crossing kerbs use the same lane membership as contact', () => {
  it.each(['cape-wrenna', 'poggio-alto'] as const)(
    '%s flattens the correct side at pit entry and merge',
    (id) => {
      const track = tracks.get(id)!,
        side = track.pit.side,
        p = trackPoint();
      let flattened = 0,
        raised = 0;
      for (let s = 0; s < track.length; s += 0.5) {
        track.at(s, p);
        for (const across of [0.18, 0.55, 0.92]) {
          const lateral = side * (p.width + across),
            height = circuitKerbHeight(track, s, lateral, across);
          if (track.inPitLane(s, lateral)) {
            expect(height).toBe(0);
            flattened++;
            // The other edge of the circuit is not part of this pit lane.
            expect(circuitKerbHeight(track, s, -lateral, across)).toBeCloseTo(
              kerbHeight(s, across),
              12,
            );
          } else {
            expect(height).toBeCloseTo(kerbHeight(s, across), 12);
            raised++;
          }
        }
      }
      expect(flattened).toBeGreaterThan(30);
      expect(raised).toBeGreaterThan(500);
    },
  );
});

describe('GP edge shader variants', () => {
  it('uses independent cache identities for every palette and retains microfinish before weather', () => {
    const keys = new Set<string>();
    for (const track of tracks.values())
      for (const kind of ['kerb', 'paint'] as const) {
        const material = new T.MeshStandardMaterial(),
          design = gpEdgeDesign(track)!;
        installCircuitFinish(material, kind);
        if (kind === 'kerb') installKerbFinish(material, track.length, design);
        else installRunoffFinish(material, track.length, design);
        keys.add(material.customProgramCacheKey());
        const shader = {
          uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
          vertexShader: T.ShaderLib.standard.vertexShader,
          fragmentShader: T.ShaderLib.standard.fragmentShader,
        } as unknown as StudioShader;
        material.onBeforeCompile(shader, {} as T.WebGLRenderer);
        expect(shader.fragmentShader).toContain('apexEdgeScuffs');
        if (kind === 'paint') {
          expect(shader.vertexShader).toContain('attribute float gpCornerPaint');
          expect(shader.fragmentShader).toContain('smoothstep(.05, .7, vGpCornerPaint)');
        }
        material.dispose();
      }
    expect(keys.size).toBe(venues.length * 2);
  });
});
