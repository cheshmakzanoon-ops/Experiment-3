import * as T from 'three';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MxTerrainNormalEdges } from '../src/rendering/offroad/mx-terrain-normal-edges.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { COURSE_CELL } from '../src/simulation/offroad/course.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { TERRAIN } from '../src/simulation/terrain.ts';
import { Track } from '../src/simulation/track.ts';

const meshesOf = (view: TerrainView) => view.group.children as T.Mesh[];
const attribute = (mesh: T.Mesh, name: string) =>
  mesh.geometry.getAttribute(name) as T.BufferAttribute;
const snapshot = (view: TerrainView) =>
  meshesOf(view).map((mesh) =>
    ['position', 'normal', 'apexSoilState'].map((name) => {
      const array = attribute(mesh, name).array;
      // Verify every uploaded byte without asking deep equality to enumerate
      // millions of typed-array properties for each replay comparison.
      return createHash('sha256')
        .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
        .digest('hex');
    }),
  );

function expectContinuous(view: TerrainView, rowSize: number) {
  const meshes = meshesOf(view);
  let heightError = 0,
    normalError = 0,
    wearError = 0;
  for (let strip = 0; strip < meshes.length; strip++) {
    const current = meshes[strip],
      next = meshes[(strip + 1) % meshes.length],
      end = attribute(current, 'position').count - rowSize;
    for (let c = 0; c < rowSize; c++) {
      heightError = Math.max(
        heightError,
        Math.abs(
          attribute(current, 'position').getY(end + c) - attribute(next, 'position').getY(c),
        ),
      );
      for (let component = 0; component < 3; component++) {
        normalError = Math.max(
          normalError,
          Math.abs(
            attribute(current, 'normal').getComponent(end + c, component) -
              attribute(next, 'normal').getComponent(c, component),
          ),
        );
        if (component > 0)
          wearError = Math.max(
            wearError,
            Math.abs(
              attribute(current, 'apexSoilState').getComponent(end + c, component) -
                attribute(next, 'apexSoilState').getComponent(c, component),
            ),
          );
      }
    }
  }
  expect(heightError).toBeLessThan(1e-5);
  expect(normalError).toBe(0);
  expect(wearError).toBe(0);
}

/** Unequal longitudinal triangle areas and a missing cell beside the join
 * distinguish correct face weighting from averaging two unit normals. */
function strip(from: number, to: number) {
  const stations = [-1.7, -0.35, 0, 0.55, 2.4],
    positions: number[] = [],
    index: number[] = [];
  for (let row = from; row <= to; row++)
    for (let column = 0; column < 3; column++) {
      const x = column - 1,
        z = stations[row];
      positions.push(x, z * z * 0.7 + x * z * 0.25, z);
    }
  for (let row = from; row < to; row++)
    for (let column = 0; column < 2; column++) {
      if (row === 2 && column === 1) continue;
      const a = (row - from) * 3 + column;
      index.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

describe('continuous motocross terrain lighting and live rut receivers', () => {
  it('matches one welded mesh across unequal triangles and clipped cells, without repeat-update drift', () => {
    const whole = strip(0, 4),
      left = strip(0, 2),
      right = strip(2, 4),
      leftEdges = new MxTerrainNormalEdges(left, 3),
      rightEdges = new MxTerrainNormalEdges(right, 3);
    const check = () => {
      leftEdges.join(rightEdges);
      for (let c = 0; c < 3; c++)
        for (let component = 0; component < 3; component++) {
          const expected = whole.getAttribute('normal').getComponent(6 + c, component);
          expect(left.getAttribute('normal').getComponent(6 + c, component)).toBeCloseTo(
            expected,
            6,
          );
          expect(right.getAttribute('normal').getComponent(c, component)).toBeCloseTo(expected, 6);
        }
    };
    check();
    for (let c = 0; c < 3; c++) {
      const height = whole.getAttribute('position').getY(3 + c) - 0.09 * (c + 1);
      whole.getAttribute('position').setY(3 + c, height);
      left.getAttribute('position').setY(3 + c, height);
    }
    whole.computeVertexNormals();
    left.computeVertexNormals();
    leftEdges.refresh();
    check();
    const stable = right.getAttribute('normal').array.slice();
    for (let i = 0; i < 12; i++) check();
    expect(right.getAttribute('normal').array).toEqual(stable);
    for (const geometry of [whole, left, right]) geometry.dispose();
  });

  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s keeps shared/lap heights, wear and area normals exact through sparse updates and replay',
    (id) => {
      const track = rigTrack(id),
        terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain,
        source = terrain.hash(),
        view = new TerrainView(track),
        meshes = meshesOf(view),
        cols = terrain.renderColumns,
        rowSize = cols + 1,
        c = Math.round(-terrain.lateralMin / (COURSE_CELL.lateral * 2)),
        boundary = attribute(meshes[1], 'mxCourse').getY(0);
      view.record({ reset: true, wetness: 0, blocks: new Float32Array() }, 0, true);
      expectContinuous(view, rowSize);
      const original = snapshot(view),
        nextPositions = attribute(meshes[1], 'position'),
        nextNormal = attribute(meshes[1], 'normal'),
        positionVersion = nextPositions.version,
        previousNormal = new T.Vector3().fromBufferAttribute(nextNormal, c);
      // A rut one row BEFORE the seam changes the next strip's lighting,
      // but must not re-upload that strip's unchanged positions or soil.
      view.record(
        {
          reset: false,
          wetness: 0,
          blocks: new Float32Array([(boundary - 1) * cols + c, 0.08, 0.6]),
        },
        1,
        true,
      );
      expect(nextPositions.version).toBe(positionVersion);
      expect(
        new T.Vector3().fromBufferAttribute(nextNormal, c).distanceTo(previousNormal),
      ).toBeGreaterThan(1e-4);
      expectContinuous(view, rowSize);
      const firstRut = snapshot(view);
      // Both the actual seam row and lap zero must update both copies.
      view.record(
        {
          reset: false,
          wetness: 0.6,
          blocks: new Float32Array([boundary * cols + c, 0.12, 0.8, c, 0.1, 0.7]),
        },
        2,
        true,
      );
      expectContinuous(view, rowSize);
      const live = snapshot(view),
        versions = meshes.map((mesh) =>
          ['position', 'normal', 'apexSoilState'].map((name) => attribute(mesh, name).version),
        );
      view.showAt(2);
      expect(
        meshes.map((mesh) =>
          ['position', 'normal', 'apexSoilState'].map((name) => attribute(mesh, name).version),
        ),
      ).toEqual(versions);
      view.showAt(0);
      expect(snapshot(view)).toEqual(original);
      view.showAt(1);
      expect(snapshot(view)).toEqual(firstRut);
      view.showLive();
      expect(snapshot(view)).toEqual(live);
      expect(terrain.hash()).toBe(source);
      view.dispose();
    },
  );

  it('samples both displayed triangles, shared rows, lap wrap and replay without reading future physical wear', () => {
    const track = rigTrack('valley-ridge-mx'),
      terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain,
      view = new TerrainView(track),
      cols = terrain.renderColumns,
      c = Math.round(-terrain.lateralMin / 0.5),
      lateral = terrain.lateralMin + c * 0.5,
      row = 95,
      samples = [
        [0.2, 0.3],
        [0.7, 0.6],
      ];
    const before = samples.map(([x, z]) => view.heightAt(row + z, lateral + x * 0.5));
    view.record(
      {
        reset: true,
        wetness: 0,
        blocks: new Float32Array([
          row * cols + c,
          0.015,
          0.2,
          row * cols + c + 1,
          0.11,
          0.7,
          (row + 1) * cols + c,
          0.09,
          0.6,
          (row + 1) * cols + c + 1,
          0.02,
          0.3,
        ]),
      },
      10,
      true,
    );
    expect(view.heightAt(row + 0.3, lateral + 0.1)).toBeCloseTo(
      before[0] - (0.015 * 0.5 + 0.11 * 0.2 + 0.09 * 0.3),
      5,
    );
    expect(view.heightAt(row + 0.6, lateral + 0.35)).toBeCloseTo(
      before[1] - (0.11 * 0.4 + 0.09 * 0.3 + 0.02 * 0.3),
      5,
    );
    expect(view.heightAt(96, lateral)).toBeCloseTo(terrain.baseHeight(96, lateral) - 0.09, 5);
    const live = view.heightAt(row + 0.3, lateral + 0.1);
    view.showAt(0);
    expect(view.heightAt(row + 0.3, lateral + 0.1)).toBe(before[0]);
    view.showLive();
    expect(view.heightAt(row + 0.3, lateral + 0.1)).toBe(live);
    const last = meshesOf(view).at(-1)!,
      p = attribute(last, 'position'),
      start = terrain.renderRows - 1,
      finalSpan = track.length - start,
      a = p.count - 2 * (cols + 1) + c;
    expect(view.heightAt(start + finalSpan * 0.5, lateral)).toBeCloseTo(
      (p.getY(a) + p.getY(a + cols + 1)) * 0.5,
      6,
    );
    expect(view.heightAt(-finalSpan * 0.5, lateral)).toBeCloseTo(
      view.heightAt(track.length - finalSpan * 0.5, lateral),
      10,
    );
    expect(view.heightAt(track.length, lateral)).toBe(view.heightAt(0, lateral));
    expect(view.heightAt(36, terrain.lateralMin - 2)).toBe(
      terrain.baseHeight(36, terrain.lateralMin - 2),
    );
    view.dispose();
  });

  it('keeps maximum permitted rut displacement inside fixed bounds without extra GPU attributes', () => {
    const view = new TerrainView(rigTrack('valley-ridge-mx')),
      point = new T.Vector3();
    for (const mesh of meshesOf(view)) {
      const geometry = mesh.geometry,
        position = geometry.getAttribute('position'),
        sphere = geometry.boundingSphere!,
        box = geometry.boundingBox!;
      expect(attribute(mesh, 'normal').usage).toBe(T.DynamicDrawUsage);
      expect(Object.keys(geometry.attributes).sort()).toEqual(
        [
          'apexSoilLayers',
          'apexSoilState',
          'color',
          'mxCourse',
          'mxCourseWidth',
          'mxSoilMix',
          'normal',
          'position',
          'uv',
          'uv1',
        ].sort(),
      );
      for (let vertex = 0; vertex < position.count; vertex += 17) {
        point.fromBufferAttribute(position, vertex);
        point.y -= TERRAIN.maxDepth;
        expect(sphere.containsPoint(point)).toBe(true);
        expect(box.containsPoint(point)).toBe(true);
      }
    }
    view.dispose();
  });
});
