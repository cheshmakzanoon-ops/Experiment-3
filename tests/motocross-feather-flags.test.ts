import * as T from 'three';
import { describe, expect, it } from 'vitest';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import { mxServiceTyre, mxServiceWheelDish, mxServiceWheelLip, MX_VAN_TYRE_SETTLE } from '../src/rendering/offroad/mx-service-wheel.ts';
import { fitMxScrim } from '../src/rendering/offroad/mx-track-scrim.ts';
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

  it('grounds the deformed van tyres and exposes the brake drum through six real wheel apertures', () => {
    const tyre = mxServiceTyre();
    const p = tyre.getAttribute('position'), n = tyre.getAttribute('normal');
    const footprint = new T.Box3(), point = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i);
      expect(point.y + 0.355).toBeGreaterThanOrEqual(MX_VAN_TYRE_SETTLE - 1e-6);
      if (Math.abs(point.y + 0.355 - MX_VAN_TYRE_SETTLE) < 1e-6) footprint.expandByPoint(point);
      expect(new T.Vector3().fromBufferAttribute(n, i).length()).toBeCloseTo(1, 4);
    }
    expect(footprint.max.z - footprint.min.z).toBeGreaterThan(0.14);
    expect(footprint.max.x - footprint.min.x).toBeGreaterThan(0.10);
    tyre.computeBoundingBox();
    expect(tyre.boundingBox!.max.y).toBeCloseTo(0.355, 5);
    tyre.dispose();
    const material = new T.MeshBasicMaterial();
    for (const side of [-1, 1]) {
      const dish = new T.Mesh(mxServiceWheelDish(side), material);
      const lip = new T.Mesh(mxServiceWheelLip(side), material);
      const shoot = (mesh: T.Mesh, radius: number, angle: number) =>
        new T.Raycaster(new T.Vector3(side * .25, radius * Math.sin(angle), -side * radius * Math.cos(angle)),
          new T.Vector3(-side, 0, 0)).intersectObject(mesh)[0];
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        expect(shoot(dish, .123, angle)).toBeUndefined();
        expect(side * shoot(dish, .123, angle + Math.PI / 6).point.x).toBeGreaterThan(.05);
        expect(side * shoot(lip, .181, angle + .02).point.x).toBeGreaterThan(.078);
      }
      dish.geometry.dispose(); lip.geometry.dispose();
    }
    material.dispose();
  });

  it('centres four rolled eyelets and their paired ties on each sloped scrim with the print facing either lane', () => {
    for (const side of [-1, 1]) {
      const posts: [T.Vector3, T.Vector3] = [new T.Vector3(-4, 0, 0), new T.Vector3(4, 0.8, 0)];
      const panel = new T.PlaneGeometry(1, 1, 24, 5);
      const uv = panel.getAttribute('uv'), pos = panel.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const t = side < 0 ? 1 - uv.getX(i) : uv.getX(i);
        pos.setXYZ(i, -4 + 8 * (0.004 + 0.992 * t), 0.8 * t + 0.25 + 0.72 * uv.getY(i), 0);
      }
      const kit = fitMxScrim(panel, posts, side);
      expect(kit).toHaveLength(12);
      const panelWidth = panel.getAttribute('mxScrimPanel').getZ(0);
      expect(panelWidth).toBeCloseTo(8 * 0.992, 5);
      for (let eye = 0; eye < 4; eye++) {
        kit[eye * 3].computeBoundingBox();
        const centre = kit[eye * 3].boundingBox!.getCenter(new T.Vector3());
        expect(Math.abs(centre.x)).toBeCloseTo(panelWidth / 2 - 0.048, 4);
        const t = ((centre.x + 4) / 8 - 0.004) / 0.992;
        expect(centre.y).toBeCloseTo(0.8 * t + 0.25 + (eye % 2 ? 0.72 - 0.026 : 0.026), 4);
        for (const tie of kit.slice(eye * 3 + 1, eye * 3 + 3)) {
          tie.computeBoundingBox();
          expect(tie.boundingBox!.distanceToPoint(centre)).toBeLessThan(0.007);
          const post = posts[centre.x < 0 ? 0 : 1];
          expect(Math.min(Math.abs(tie.boundingBox!.min.x - post.x), Math.abs(tie.boundingBox!.max.x - post.x))).toBeLessThan(0.003);
        }
      }
      for (const piece of kit) piece.dispose();
      panel.dispose();
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
        expect(shader.fragmentShader).toContain('if (eye < .0085');
        expect(shader.fragmentShader.includes('if (!gl_FrontFacing)')).toBe(kind === 'standard');
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
