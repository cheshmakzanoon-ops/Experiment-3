import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mod } from '../src/core/math.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { gpCornerShapes } from '../src/simulation/gp-corner-shape.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { VenueKit } from '../src/rendering/venue-kit/index.ts';
import {
  buildGpCourseBoards,
  gpBoardPlacement,
  gpCourseBoardPlan,
} from '../src/rendering/venue-kit/gp-course-boards.ts';

const gpVenues = ['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const;

describe('GP physical approach references', () => {
  it.each(gpVenues)(
    '%s uses the actual entry and leaves linked corners free of overlapping distances',
    (id) => {
      const track = new Track('clear', false, undefined, CIRCUITS[id]),
        originalPoints = track.points.map((p) => [p.x, p.y, p.z, p.bank, p.curvature]),
        plan = gpCourseBoardPlan(track),
        shapes = gpCornerShapes(track);
      expect(plan.filter((b) => b.distance === null)).toHaveLength(track.circuit.corners.length);
      expect(plan.filter((b) => b.distance === 200).length).toBeGreaterThanOrEqual(1);
      for (const board of plan) {
        const corner = track.circuit.corners[board.corner],
          direction = track.at(corner.s, trackPoint()).curvature;
        // The marker is on the geometrical outside, not inside the rider's
        // intended corner cut. Positive lateral and turn curvature have a
        // consistent product in Track.runoffSurface too.
        expect(direction * board.side).toBeLessThan(0);
        if (board.distance !== null) {
          expect(mod(corner.s - shapes[board.corner].entry - board.s, track.length)).toBeCloseTo(
            board.distance,
            7,
          );
          for (const offset of [-10, 0, 10])
            expect(Math.abs(track.at(board.s + offset, trackPoint()).curvature)).toBeLessThan(
              1 / 300,
            );
          for (let i = 0; i < shapes.length; i++) {
            const untilApex =
              mod(track.circuit.corners[i].s - board.s + track.length / 2, track.length) -
              track.length / 2;
            expect(untilApex < -shapes[i].exit || untilApex > shapes[i].entry).toBe(true);
          }
        }
      }
      expect(gpCourseBoardPlan(track)).toEqual(plan);
      expect(track.points.map((p) => [p.x, p.y, p.z, p.bank, p.curvature])).toEqual(originalPoints);
    },
  );

  it('moves the old Southern Sweep 50 marker out of the bend and preserves a complete preceding sequence', () => {
    const track = new Track('clear', false, undefined, CIRCUITS['cape-wrenna']),
      corner = track.circuit.corners.findIndex((c) => c.name === 'SOUTHERN SWEEP'),
      apex = track.circuit.corners[corner].s,
      plan = gpCourseBoardPlan(track).filter((b) => b.corner === corner),
      oldFifty = apex - 40 - 50,
      correctedFifty = plan.find((b) => b.distance === 50)!;
    expect(Math.abs(track.at(oldFifty, trackPoint()).curvature)).toBeGreaterThan(0.003);
    expect(Math.abs(track.at(correctedFifty.s, trackPoint()).curvature)).toBeLessThan(0.001);
    expect(oldFifty - correctedFifty.s).toBeCloseTo(100, 5);
    expect(plan.map((b) => b.distance)).toEqual([200, 150, 100, 50, null]);
  });

  it.each(['aurel', 'vellamar', 'parco-reale', 'valley-ridge-mx'] as const)(
    'does not change %s course furniture',
    (id) =>
      expect(gpCourseBoardPlan(new Track('clear', false, undefined, CIRCUITS[id]))).toEqual([]),
  );
});

/** Node canvas for construction only. Actual glyphs/GL are checked by the
 * production-material browser fixture, not inferred from this mock. */
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

describe('GP marker integration and visibility', () => {
  beforeAll(() => {
    vi.stubGlobal('document', { createElement: () => new Canvas() });
    vi.stubGlobal('HTMLCanvasElement', Canvas);
  });
  afterAll(() => vi.unstubAllGlobals());

  it('keeps each local approach visible, prints one face, and batches a complete venue into bounded resources', () => {
    const track = new Track('clear', false, undefined, CIRCUITS['cape-wrenna']),
      kit = new VenueKit(track);
    buildGpCourseBoards(kit.context);
    kit.root.sealTransforms();
    const camera = new T.PerspectiveCamera(),
      textures = new Set<T.Texture>(),
      materials = new Set<T.Material>(),
      cells = kit.context.cells;
    let boards = 0,
      triangles = 0;
    expect(cells.length).toBeGreaterThanOrEqual(9);
    for (const cell of cells) {
      const list = cell.object.userData.boards as ReturnType<typeof gpCourseBoardPlan>;
      boards += list.length;
      expect(cell.object.children).toHaveLength(3);
      for (const board of list) {
        const f = gpBoardPlacement(track, board),
          at = track.at(board.s - 38, trackPoint()),
          eye = new T.Vector3(at.x, at.y + 1.2, at.z),
          target = new T.Vector3(
            f.x + Math.sin(f.yaw) * 0.036,
            f.y + f.centre,
            f.z + Math.cos(f.yaw) * 0.036,
          );
        camera.position.copy(eye);
        camera.updateMatrixWorld(true);
        kit.update(camera, false);
        expect(cell.object.visible).toBe(true);
        const normal = new T.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
        expect(normal.dot(eye.clone().sub(target).normalize())).toBeGreaterThan(0.98);
        const hits = new T.Raycaster(eye, target.clone().sub(eye).normalize()).intersectObject(
          cell.object,
          true,
        );
        expect(hits.length).toBeGreaterThan(0);
        expect(
          (hits[0].object as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>).material.map?.name,
        ).toBe('GP course identifiers and entry-distance atlas');
      }
      cell.object.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const material = object.material as T.MeshStandardMaterial;
        materials.add(material);
        if (material.map) textures.add(material.map);
        const geometry = object.geometry as T.BufferGeometry;
        triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
        for (const attribute of Object.values(geometry.attributes))
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
        geometry.dispose();
      });
    }
    expect(textures.size).toBe(1);
    expect(materials.size).toBe(3);
    expect(triangles).toBeLessThan(boards * 40);
    camera.position.set(1e6, 1e6, 1e6);
    camera.updateMatrixWorld(true);
    kit.update(camera, false);
    expect(cells.every((cell) => !cell.object.visible)).toBe(true);
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  });
});
