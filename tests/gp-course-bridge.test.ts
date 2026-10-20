import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mod } from '../src/core/math.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { gpCornerShapes } from '../src/simulation/gp-corner-shape.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { VenueKit } from '../src/rendering/venue-kit/index.ts';
import { VenueKitContext } from '../src/rendering/venue-kit/context.ts';
import {
  buildGpCourseBridge,
  gpCourseBridgeSite,
} from '../src/rendering/venue-kit/gp-course-bridge.ts';

class Canvas {
  width = 300;
  height = 150;
  getContext() {
    const noop = () => {};
    return new Proxy(
      {
        canvas: this,
        measureText: () => ({ width: 40 }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        createPattern: () => ({ setTransform: noop }),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
      },
      { get: (target, key) => Reflect.get(target, key) ?? noop },
    );
  }
}

describe('GP architectural approach landmarks', () => {
  beforeAll(() => {
    vi.stubGlobal('document', { createElement: () => new Canvas() });
    vi.stubGlobal('HTMLCanvasElement', Canvas);
  });
  afterAll(() => vi.unstubAllGlobals());

  it.each(['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const)(
    '%s keeps real road clearance, grounds its supports and bounds visible resources',
    (id) => {
      const track = new Track('clear', false, undefined, CIRCUITS[id]),
        before = track.points.map((p) => [p.x, p.y, p.z, p.width, p.bank, p.curvature]),
        kit = new VenueKit(track),
        site = gpCourseBridgeSite(kit.context);
      expect(site).not.toBeNull();
      if (!site) throw new Error('Missing safe GP course bridge site');
      expect(gpCourseBridgeSite(kit.context)).toEqual(site);
      const corner = track.circuit.corners[site.corner],
        shape = gpCornerShapes(track)[site.corner];
      expect(mod(corner.s - shape.entry - site.s, track.length)).toBeCloseTo(site.approachDistance, 6);
      expect(site.approachDistance).toBeGreaterThanOrEqual(240);
      expect(site.approachDistance).toBeLessThanOrEqual(400);
      for (const offset of [-40, -20, 0, 20, 40]) {
        const p = track.at(site.s + offset, trackPoint());
        expect(Math.abs(p.curvature)).toBeLessThanOrEqual(1 / 700);
        expect(p.s).toBeGreaterThanOrEqual(track.pit.mergeEnd + 25);
        expect(p.s).toBeLessThanOrEqual(track.length - track.pit.divergeStart - 25);
      }

      const root = buildGpCourseBridge(kit.context)!;
      expect(root).not.toBeNull();
      kit.root.sealTransforms();
      root.updateMatrixWorld(true);
      expect(root.children).toHaveLength(5);
      let triangles = 0;
      const materials = new Set<T.Material>(),
        textures = new Set<T.Texture>(),
        vertex = new T.Vector3(),
        p = track.at(site.s, trackPoint());
      root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const geometry = object.geometry as T.BufferGeometry,
          position = geometry.getAttribute('position');
        triangles += (geometry.index?.count ?? position.count) / 3;
        materials.add(object.material as T.Material);
        for (const value of Object.values(object.material))
          if (value instanceof T.Texture) textures.add(value);
        for (const attribute of Object.values(geometry.attributes))
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
        for (let i = 0; i < position.count; i++) {
          vertex.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
          const lateral = (vertex.x - p.x) * p.nx + (vertex.z - p.z) * p.nz;
          if (Math.abs(lateral) < p.width + 1)
            expect(vertex.y).toBeGreaterThanOrEqual(site.underside - 0.002);
        }
      });
      expect(triangles).toBeLessThan(9000);
      expect(textures.size).toBe(1);
      for (const x of [-site.left, site.right]) {
        const wx = site.x + p.nx * x,
          wz = site.z + p.nz * x,
          side = x < 0 ? -1 : 1;
        // Entire 2.7 m footing lies several metres behind the physics boundary.
        expect(Math.abs(x) - 1.35 - track.boundaryAt(p, side)).toBeGreaterThan(3.4);
        expect(kit.blocks(wx, wz)).toBe(true);
        const ground = site.ground[x < 0 ? 0 : 1],
          ray = new T.Raycaster(new T.Vector3(wx, ground + 1, wz), new T.Vector3(0, -1, 0));
        const hits = ray.intersectObject(root, true);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].point.y).toBeCloseTo(ground + 0.32, 4);
      }
      const camera = new T.PerspectiveCamera(),
        cell = kit.context.cells.find((c) => c.object === root)!;
      camera.position.set(p.x - p.tx * 90, p.y + 1.3, p.z - p.tz * 90);
      camera.updateMatrixWorld(true);
      kit.update(camera, false);
      expect(cell.object.visible).toBe(true);
      camera.position.set(1e6, 1e6, 1e6);
      camera.updateMatrixWorld(true);
      kit.update(camera, false);
      expect(cell.object.visible).toBe(false);
      expect(track.points.map((p) => [p.x, p.y, p.z, p.width, p.bank, p.curvature])).toEqual(before);
      root.traverse((object) => {
        if (object instanceof T.Mesh) object.geometry.dispose();
      });
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  );

  it('omits the landmark when every support site is occupied', () => {
    const kit = new VenueKitContext(new Track('clear', false, undefined, CIRCUITS.haarveld));
    vi.spyOn(kit, 'blocks').mockReturnValue(true);
    expect(gpCourseBridgeSite(kit)).toBeNull();
    expect(buildGpCourseBridge(kit)).toBeNull();
    expect(kit.root.children).toHaveLength(0);
  });

  it.each(['aurel', 'vellamar', 'parco-reale', 'valley-ridge-mx'] as const)(
    'leaves %s architecture and materials alone',
    (id) => {
      const kit = { track: new Track('clear', false, undefined, CIRCUITS[id]) } as VenueKitContext;
      expect(gpCourseBridgeSite(kit)).toBeNull();
      expect(buildGpCourseBridge(kit)).toBeNull();
    },
  );
});
