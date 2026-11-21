import * as T from 'three';
import { describe, expect, it } from 'vitest';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import { mxTeamVanGeometry } from '../src/rendering/offroad/mx-paddock-models.ts';
import { MxVenueWind } from '../src/rendering/offroad/mx-venue-wind.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

const draws = (root: T.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof T.Mesh) n++;
  });
  return n;
};

describe('motocross event feather flags', () => {
  it('stands clusters of three on the outdoor turns inside the existing cloth/steel batches', () => {
    const dressing = new MxCourseDressing(rigTrack('valley-ridge-mx'));
    try {
      expect(dressing.stats.flags).toBeGreaterThanOrEqual(9);
      expect(dressing.stats.flags % 3).toBe(0);
      // Merged into the printed-cloth and galvanised-frame batches.
      const cloth = dressing.root.getObjectByName('MX printed woven barriers') as T.Mesh;
      cloth.geometry.computeBoundingBox();
      expect(cloth.geometry.boundingBox!.max.y - cloth.geometry.boundingBox!.min.y).toBeGreaterThan(
        3,
      );
      // The flags add none; the bale and van instances add one each.
      expect(draws(dressing.root)).toBeLessThanOrEqual(16);
      expect(
        Object.values(cloth.geometry.attributes).every((a) =>
          Array.from(a.array).every(Number.isFinite),
        ),
      ).toBe(true);
    } finally {
      dressing.dispose();
    }
  });

  it('leaves the fleet headlamps and amber indicators visible ahead of the bevelled metal', () => {
    const g = mxTeamVanGeometry(), van = new T.Mesh(g, new T.MeshBasicMaterial());
    const finish = g.getAttribute('mxFinish'), colours = g.getAttribute('color');
    try {
      for (const sign of [-1, 1]) {
        for (const [x, y, expected] of [[0.65, 0.99, 0xd5dbd5], [0.82, 0.99, 0xc18139], [0.72, 1.098, 0x879da2]]) {
          const hits = new T.Raycaster(new T.Vector3(sign * x, y, 4), new T.Vector3(0, 0, -1)).intersectObject(van);
          const front = hits[0], paint = hits.find(hit => finish.getX(hit.face!.a) > 0.9)!;
          const tone = new T.Color(expected), vertex = front.face!.a;
          expect(colours.getX(vertex)).toBeCloseTo(tone.r, 2);
          expect(colours.getY(vertex)).toBeCloseTo(tone.g, 2);
          expect(colours.getZ(vertex)).toBeCloseTo(tone.b, 2);
          expect(paint.distance - front.distance).toBeGreaterThan(0.004);
          expect(paint.distance - front.distance).toBeLessThan(0.012);
        }
      }
    } finally {
      van.material.dispose();
      g.dispose();
    }
  });

  it('stacks bales on the turn outsides and parks vans behind the service canopies, clear of the course', () => {
    const track = rigTrack('valley-ridge-mx'),
      course = (Track.offroadOf(track) as TrackTerrainSurface).course,
      dressing = new MxCourseDressing(track),
      point = trackPoint(),
      m = new T.Matrix4(),
      p = new T.Vector3();
    try {
      expect(dressing.stats.bales).toBeGreaterThan(15);
      expect(dressing.stats.vans).toBeGreaterThan(3);
      for (const [name, margin] of [
        ['MX round straw bales', 0.9],
        ['MX team vans', 5],
      ] as const) {
        const mesh = dressing.root.getObjectByName(name) as T.InstancedMesh;
        expect(mesh).toBeInstanceOf(T.InstancedMesh);
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          p.setFromMatrixPosition(m);
          const lateral = track.nearest(p.x, p.z, point);
          expect(Math.abs(lateral), `${name} ${i}`).toBeGreaterThan(
            course.legalWidth(point.width, point.s, lateral) + margin,
          );
          expect(Number.isFinite(p.y)).toBe(true);
        }
      }
      const fleet = dressing.root.getObjectByName('MX team vans') as T.InstancedMesh;
      const crews = fleet.geometry.getAttribute('mxVanCrew') as T.InstancedBufferAttribute;
      expect(crews.isInstancedBufferAttribute).toBe(true);
      expect(crews.count).toBe(fleet.count);
      const service = dressing.trackside.plan.sites.map((site, index) => ({ site, index })).filter(({site}) => site.type === 'service');
      for (let i = 0; i < fleet.count; i++) {
        fleet.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const nearest = service.reduce((a, b) => Math.hypot(a.site.x - p.x, a.site.z - p.z) < Math.hypot(b.site.x - p.x, b.site.z - p.z) ? a : b);
        expect(crews.getX(i)).toBe(nearest.index % 4);
      }
      for (const site of dressing.trackside.plan.sites) {
        const vans = dressing.root.getObjectByName('MX team vans') as T.InstancedMesh;
        for (let i = 0; i < vans.count; i++) {
          vans.getMatrixAt(i, m);
          p.setFromMatrixPosition(m);
          expect(Math.hypot(site.x - p.x, site.z - p.z)).toBeGreaterThan(site.radius + 2.5);
        }
      }
    } finally {
      dressing.dispose();
    }
  });

  it('pins the sail seams and replays the same wind field in the colour and two shadow passes', () => {
    const wind = new MxVenueWind();
    const dressing = new MxCourseDressing(rigTrack('valley-ridge-mx'), wind);
    try {
      const cloth = dressing.root.getObjectByName('MX printed woven barriers') as T.Mesh;
      const binding = cloth.geometry.getAttribute('mxCloth') as T.BufferAttribute;
      const amplitudes = Array.from({ length: binding.count }, (_, i) =>
        Math.hypot(binding.getX(i), binding.getY(i)),
      );
      expect(amplitudes.filter((a) => a === 0).length).toBeGreaterThan(dressing.stats.flags * 8);
      expect(Math.max(...amplitudes)).toBeCloseTo(0.15, 5);
      expect(amplitudes.filter((a) => a > 0.1).length).toBeGreaterThan(dressing.stats.flags);
      const clock = (material: T.Material, kind: 'standard' | 'depth' | 'distanceRGBA') => {
        const src = T.ShaderLib[kind];
        const shader = {
          vertexShader: src.vertexShader,
          fragmentShader: src.fragmentShader,
          uniforms: T.UniformsUtils.clone(src.uniforms),
        } as StudioShader;
        material.onBeforeCompile(shader, {} as T.WebGLRenderer);
        expect(shader.vertexShader).toContain('transformed.xz += mxCloth.xy');
        expect(shader.uniforms.mxVenueWind).toBe(wind);
        return shader.uniforms.mxClothTime;
      };
      const time = clock(cloth.material as T.Material, 'standard');
      expect(clock(cloth.customDepthMaterial!, 'depth')).toBe(time);
      expect(clock(cloth.customDistanceMaterial!, 'distanceRGBA')).toBe(time);
      wind.set(3,4);
      expect(wind.value.x).toBeCloseTo(0.6,12);
      expect(wind.value.y).toBeCloseTo(0.8,12);
      const held = wind.value.toArray();
      wind.set(-3,-4);
      expect(wind.value.z).toBe(held[2]);
      expect(wind.value.x).toBe(-held[0]);
      wind.set(0,0);
      expect(wind.value.length()).toBe(0);
      wind.set(3,4);
      expect(wind.value.toArray()).toEqual(held);
      for (const value of [8.25, 19.5, 19.5, 8.25]) {
        dressing.update(value);
        expect(time.value).toBe(value);
      }
      expect(binding.version).toBe(0);
    } finally {
      dressing.dispose();
    }
  });

  it('leaves the indoor stadium without flags', () => {
    const dressing = new MxCourseDressing(rigTrack('arena-nord-sx'));
    try {
      expect(dressing.stats.flags).toBe(0);
      expect(dressing.stats.bales + dressing.stats.vans).toBe(0);
    } finally {
      dressing.dispose();
    }
  });
});
