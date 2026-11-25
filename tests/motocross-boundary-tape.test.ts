import { F, H, CAR_STRIDE, HEADER, carBase } from '../src/simulation/protocol.ts';
import { MxVenueWind } from '../src/rendering/offroad/mx-venue-wind.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

describe('MX boundary tape', () => {
  it('strings one ribbon between the course-edge stakes, knee high and just outside the legal edge', () => {
    const track = rigTrack('valley-ridge-mx'),
      surface = Track.offroadOf(track) as TrackTerrainSurface,
      dressing = new MxCourseDressing(track),
      nearest = trackPoint();
    try {
      const tape = dressing.turf.getObjectByName('MX boundary tape') as T.Mesh;
      expect(tape).toBeInstanceOf(T.Mesh);
      expect(dressing.stats.tapeSpans).toBeGreaterThan(60);
      // One submission, a few thousand triangles at most.
      expect(tape.geometry.index!.count / 3).toBeLessThan(6000);
      expect((tape.material as T.MeshStandardMaterial).side).toBe(T.DoubleSide);
      const position = tape.geometry.getAttribute('position');
      let lowest = Infinity,
        highest = -Infinity;
      for (let i = 0; i < position.count; i += 7) {
        const lateral = track.nearest(position.getX(i), position.getZ(i), nearest);
        const edge = surface.course.legalWidth(nearest.width, nearest.s, lateral);
        expect(Math.abs(lateral)).toBeGreaterThan(edge + 0.05);
        const above = position.getY(i) - surface.terrain.baseHeight(nearest.s, lateral);
        lowest = Math.min(lowest, above);
        highest = Math.max(highest, above);
      }
      // Knee height with a few centimetres of sag between posts.
      expect(lowest).toBeGreaterThan(0.35);
      expect(highest).toBeLessThan(0.75);
    } finally {
      dressing.dispose();
    }
  });

  it('lets a passing bike push and release each ribbon section in turn while the stake ties hold', () => {
    const wind = new MxVenueWind();
    wind.set(0, 0);
    const dressing = new MxCourseDressing(rigTrack('valley-ridge-mx'), wind);
    try {
      const tape = dressing.turf.getObjectByName('MX boundary tape') as T.Mesh<
        T.BufferGeometry, T.MeshStandardMaterial
      >;
      const g = tape.geometry, pos = g.getAttribute('position') as T.BufferAttribute;
      const binding = g.getAttribute('mxTapeBind') as T.BufferAttribute;
      const wake = g.getAttribute('mxTapeWake') as T.BufferAttribute;
      const normal = new T.Vector3().fromBufferAttribute(g.getAttribute('normal'), 8);
      const forward = new T.Vector3(-normal.z, 0, normal.x);
      const centre = new T.Vector3().fromBufferAttribute(pos, 8);
      const frame = new Float32Array(HEADER + CAR_STRIDE), b = carBase(0);
      frame[H.CARS] = 1;
      const sample = (age: number, away = 2, height = 0, speed = 24) => {
        const along = (age + 0.032 * Math.abs(away) - 0.055) * speed;
        frame[b + F.X] = centre.x - normal.x * away + forward.x * along;
        frame[b + F.Z] = centre.z - normal.z * away + forward.z * along;
        frame[b + F.Y] = centre.y + height;
        frame[b + F.VX] = forward.x * speed;
        frame[b + F.VZ] = forward.z * speed;
        dressing.update(20 + age, frame);
        return wake.getX(8);
      };
      sample(-0.035);
      expect(wake.getX(4)).toBeGreaterThan(wake.getX(12) + 0.12);
      const arrival = sample(0.06);
      expect(arrival).toBeGreaterThan(0.65);
      const version = wake.version;
      expect(sample(0.06)).toBe(arrival);
      expect(wake.version).toBe(version);
      expect(sample(0.365)).toBeLessThan(-0.30);
      expect(sample(0.675)).toBeGreaterThan(0.07);
      expect(sample(1)).toBe(0);
      expect(sample(0.06, -2)).toBeCloseTo(-arrival, 4);
      expect(sample(0.06, 9)).toBe(0);
      expect(sample(0.06, 2, 4)).toBe(0);
      expect(sample(0.06, 2, 0, 0)).toBe(0);
      expect(sample(0.06)).toBe(arrival);
      for (let start = 0; start < pos.count; start += 18) {
        for (const tie of [start, start + 1, start + 16, start + 17]) {
          expect(binding.getX(tie)).toBe(0);
          expect(wake.getX(tie)).toBe(0);
        }
        expect(binding.getX(start + 8)).toBe(1);
        expect(wake.getX(start + 8)).toBe(wake.getX(start + 9));
      }
      expect(pos.version).toBe(0);
      dressing.update(0);
      expect(wake.getX(8)).toBe(0);
      const src = T.ShaderLib.standard;
      const shader = {
        vertexShader: src.vertexShader, fragmentShader: src.fragmentShader,
        uniforms: T.UniformsUtils.clone(src.uniforms),
      } as StudioShader;
      tape.material.onBeforeCompile(shader, {} as T.WebGLRenderer);
      expect(shader.uniforms.mxVenueWind).toBe(wind);
      expect(shader.vertexShader).toContain('objectNormal * mxTapeCos');
      for (const t of [5, 26, 5]) {
        dressing.update(t);
        expect(shader.uniforms.mxTapeTime.value).toBe(t);
      }
    } finally {
      dressing.dispose();
    }
  });

  it('leaves the arena to its padded lane dividers', () => {
    const dressing = new MxCourseDressing(rigTrack('arena-nord-sx'));
    expect(dressing.stats.tapeSpans).toBe(0);
    expect(dressing.turf.getObjectByName('MX boundary tape')).toBeUndefined();
    dressing.dispose();
  });
});


it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
  'grounds every %s takeoff and landing marker and perimeter blade on its rendered triangle',
  (venue) => {
    const track = rigTrack(venue),
      view = new TerrainView(track),
      dressing = new MxCourseDressing(track);
    const ray = new T.Raycaster(),
      down = new T.Vector3(0, -1, 0),
      at = new T.Vector3();
    const matrix = new T.Matrix4(),
      point = new T.Vector3(),
      colour = new T.Color();
    const ties: T.Vector3[] = [];
    try {
      view.group.updateMatrixWorld(true);
      for (const name of ['Surveyed jump lip and landing markers', 'MX course-edge stakes']) {
        const markers = dressing.root.getObjectByName(name) as T.InstancedMesh;
        const jump = name.startsWith('Surveyed'),
          paints = new Set<number>();
        for (let i = 0; i < markers.count; i++) {
          markers.getMatrixAt(i, matrix);
          point.setFromMatrixPosition(matrix);
          ray.set(at.copy(point).addScaledVector(down, -4), down);
          const hit = ray.intersectObject(view.group, true)[0];
          expect(hit).toBeDefined();
          // Jump collars sit flush. Perimeter blades embed twelve mm. These
          // independent triangle rays also see overlapping neighbouring lanes.
          expect(Math.abs(point.y - hit.point.y + (jump ? 0 : 0.012))).toBeLessThan(0.002);
          if (jump) {
            markers.getColorAt(i, colour);
            paints.add(colour.getHex());
            expect(colour.getHex()).toBe(matrix.elements[5] > 0.8 ? 0xe98243 : 0xe2dcc1);
          } else
            ties.push(
              new T.Vector3(0, 0.58, 0.006 * Math.sin((Math.PI * 0.58) / 0.82)).applyMatrix4(
                matrix,
              ),
            );
        }
        if (jump) expect(paints.size).toBe(2);
      }
      if (venue === 'valley-ridge-mx') {
        const tape = dressing.turf.getObjectByName('MX boundary tape') as T.Mesh;
        const pos = tape.geometry.getAttribute('position');
        for (let start = 0; start < pos.count; start += 18)
          for (const end of [start, start + 16]) {
            point
              .fromBufferAttribute(pos, end)
              .add(at.fromBufferAttribute(pos, end + 1))
              .multiplyScalar(0.5);
            expect(ties.some((tie) => tie.distanceToSquared(point) < 0.000001)).toBe(true);
          }
      }
    } finally {
      view.dispose();
      dressing.dispose();
    }
  },
);
