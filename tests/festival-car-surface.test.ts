import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { ClosedBodyModel, Greenhouse } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import {
  roadWindowMaterial,
  roadWindowRings,
} from '../src/rendering/vehicle-bodies/road-greenhouse.ts';
import { roadMirrorLayout } from '../src/rendering/vehicle-bodies/road-mirrors.ts';
import { sharedMaterials } from '../src/rendering/vehicle-bodies/materials.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';
import {
  festivalBonnetPockets,
  festivalNoseZ,
  warpFestivalNose,
} from '../src/rendering/vehicle-bodies/festival-nose.ts';

function modelFor(id: string) {
  const definition = VEHICLES[id],
    sheet = bodySheetFor(definition) as ClosedSheet;
  return new ClosedBodyModel(bodyFrame(definition), sheet, [
    sheet.wheels.width[0] / 2,
    sheet.wheels.width[1] / 2,
  ]);
}

describe('Festival car surface construction', () => {
  it('keeps the SC-7 dashboard inside the windscreen foot and the roof finish on its own shell', () => {
    const model = modelFor('sc7'),
      body = buildVehicleBody(0, VEHICLES.sc7, model.s);
    const z = model.f.z(model.s.cabin[0]) + 0.065;
    for (const lod of body.lods) {
      const roof = lod.group.getObjectByName('Greenhouse') as T.Mesh;
      const lower = lod.group.getObjectByName('Body (lofted)') as T.Mesh;
      expect(roof.geometry.getAttribute('bodyRoof').getX(0)).toBe(1);
      expect(lower.geometry.hasAttribute('bodyRoof')).toBe(false);
    }
    const near = body.lods[0].group;
    near.updateMatrixWorld(true);
    const solids: T.Mesh[] = [];
    near.traverseVisible((node) => {
      if (
        node instanceof T.Mesh &&
        (node.name === 'Body (lofted)' || node.material === sharedMaterials.plastic())
      )
        solids.push(node);
    });
    const ray = new T.Raycaster(undefined, new T.Vector3(0, -1, 0));
    for (const x of [-0.45, -0.2, 0, 0.2, 0.45]) {
      ray.ray.origin.set(x, model.f.y(model.s.roof + 0.5), z);
      const hit = ray.intersectObjects(solids, false)[0];
      expect(hit?.object.name, `front of scuttle at x = ${x}`).toBe('Body (lofted)');
    }
    body.root.traverse((node) => {
      if (node instanceof T.Mesh) node.geometry.dispose();
    });
    body.lods[0].cabin?.display?.dispose();
  });

  it('keeps the side windows open at distance and leaves the single-cab pickup pillar-free', () => {
    for (const id of ['eh3', 'sc7', 'rh3', 'rs5', 'rm8', 'rg63', 'rp6', 'rr4', 'lx12']) {
      const model = modelFor(id),
        house = new Greenhouse(model),
        form = model.s.windowForm!;
      for (const level of [0, 1, 2] as const) {
        const rings = roadWindowRings(house, form, level, 0);
        const material = roadWindowMaterial(house, form, level);
        const spans = rings
          .slice(1)
          .map((ring, i) => ({
            z: (ring.z + rings[i].z) / 2,
            length: ring.z - rings[i].z,
          }))
          .filter(({ z }) => z > house.zRR && z < house.zRF);
        const posts = spans.filter(({ z }) => material(z, 1) === 2);
        const glass = spans
          .filter(({ z }) => material(z, 1) === 1)
          .reduce((sum, s) => sum + s.length, 0);
        expect(glass, id).toBeGreaterThan((house.zRF - house.zRR) * 0.72);
        if (id === 'rp6') expect(posts, id).toHaveLength(0);
        else {
          const width = posts.reduce((sum, s) => sum + s.length, 0);
          expect(width, id).toBeGreaterThan(0.03);
          expect(width, id).toBeLessThan(0.09);
        }
      }
    }
  });

  it('keeps each original road bonnet, its crease and its centre stripe aligned through every detail level', () => {
    for (const id of ['eh3', 'sc7', 'rh3', 'rs5', 'rm8', 'lx12', 'rg63', 'rr4', 'rp6', 'rd2']) {
      const model = modelFor(id);
      const [relief] = model.s.bonnetPress!;
      const cowl = model.f.z(model.s.cabin[0]) + 0.045,
        nose = model.zFront - 0.15;
      const station = (cowl + nose) / 2;
      const levels = ([0, 1, 2] as const).map((detail) => model.ring(station, detail).half);
      for (const [detail, profile] of levels.entries()) {
        expect(profile.at(-1)![1] - model.topY(station), id).toBeCloseTo(relief, 5);
        const start = model.deckSample(detail as 0 | 1 | 2);
        const deck = profile.slice(start);
        for (let i = 1; i < deck.length; i++) expect(deck[i][0], id).toBeLessThan(deck[i - 1][0]);
        for (const [x, y] of deck) expect(model.surfaceY(station, x), id).toBeCloseTo(y, 2);
        expect(deck.at(-2)![0] / deck[0][0], id).toBeCloseTo(0.18, 6);
        if (id === 'rm8') {
          expect(model.slot(station, profile.length - 2, detail as 0 | 1 | 2)).toBe(3);
          expect(model.slot(station, profile.length - 3, detail as 0 | 1 | 2)).toBe(0);
        }
      }
      const sideSeam = model.gaps().find((gap) => gap.n[0] > 0.5)!;
      expect(sideSeam.max[2] - sideSeam.min[2], id).toBeGreaterThan(0.35);
      for (const z of [sideSeam.min[2] + 0.015, sideSeam.max[2] - 0.015]) {
        const x = (sideSeam.d - z * sideSeam.n[2]) / sideSeam.n[0];
        expect(x, id).toBeGreaterThanOrEqual(sideSeam.min[0]);
        expect(x, id).toBeLessThanOrEqual(sideSeam.max[0]);
        expect(model.surfaceY(z, x), id).toBeGreaterThan(sideSeam.min[1]);
      }
    }
  });

  it('keeps the reflective panes outboard, aft-facing and attached at each racing distance', () => {
    for (const id of ['eh3', 'rh3', 'rp6', 'rg63']) {
      const model = modelFor(id),
        body = buildVehicleBody(0, VEHICLES[id], model.s);
      const layout = roadMirrorLayout(model);
      for (const lod of body.lods) {
        const root = lod.group;
        root.updateMatrixWorld(true);
        for (const side of [-1, 1]) {
          const ray = new T.Raycaster(
            new T.Vector3(side * layout.x, layout.y, layout.z - 0.34),
            new T.Vector3(0, 0, 1),
            0,
            0.48,
          );
          const hit = ray.intersectObject(root, true)[0];
          expect(hit, `${id} pane`).toBeDefined();
          const mat = (hit.object as T.Mesh).material;
          expect(Array.isArray(mat) ? mat[hit.face!.materialIndex] : mat).toBe(
            sharedMaterials.chrome(),
          );
          expect(hit.face!.normal.z).toBeLessThan(-0.85);
          expect(hit.face!.normal.x * side).toBeLessThan(0);
          expect(Math.abs(hit.point.x)).toBeGreaterThan(model.halfWidth(layout.z));
        }
      }
    }
  });

  it('opens the pickup load box down to the ribbed floor with wheel clearance at all distances', () => {
    const model = modelFor('rp6');
    const body = buildVehicleBody(0, VEHICLES.rp6, model.s);
    const floor = model.f.y(model.s.loadFloor!);
    for (const lod of body.lods) {
      const top = (x: number, z: number) => {
        const hit = new T.Raycaster(
          new T.Vector3(x, model.f.y(2.8), z),
          new T.Vector3(0, -1, 0),
        ).intersectObject(lod.group, true)[0];
        expect(hit).toBeDefined();
        return hit.point.y;
      };
      const axle = model.f.rearAxle;
      expect(top(0, axle)).toBeCloseTo(floor, 4);
      for (const side of [-1, 1]) {
        const tub = top(side * model.f.trackRear * 0.467, axle);
        expect(tub).toBeGreaterThan(model.f.hubRear + model.f.radius + 0.08);
        expect(top(side * (model.halfWidth(axle) * 0.92 - 0.03), axle)).toBeGreaterThan(
          tub + 0.065,
        );
      }
      expect(top(0, model.zRear + 0.06)).toBeGreaterThan(floor + 0.25);
      expect(top(0, model.f.z(model.s.cabin[3]) - 0.07)).toBeGreaterThan(floor + 0.25);
    }
  });

  it('recesses SC7 bonnet outlets into real openings with closed floors and attached perimeters', () => {
    const model = modelFor('sc7'),
      body = buildVehicleBody(0, VEHICLES.sc7, model.s);
    expect(festivalBonnetPockets(modelFor('rh3'))).toHaveLength(0);
    for (const detail of [0, 1] as const) {
      const root = body.lods[detail].group,
        skin = root.getObjectByName('Body (lofted)') as T.Mesh;
      root.updateMatrixWorld(true);
      for (const pocket of festivalBonnetPockets(model)) {
        const probe = (u: number, v: number) => {
          const x = pocket.base.elements[12] + u,
            z = pocket.base.elements[14] + v,
            y = model.surfaceY(z, Math.abs(x));
          return new T.Raycaster(new T.Vector3(x, y + 0.08, z), new T.Vector3(0, -1, 0), 0, 0.14);
        };
        for (const u of [-0.25, 0, 0.25])
          for (const v of [-0.3, 0, 0.3]) {
            const ray = probe(u * pocket.width, v * pocket.depth);
            expect(
              ray.intersectObject(skin),
              'painted skin cannot block the air outlet',
            ).toHaveLength(0);
            const hit = ray.intersectObject(root, true)[0];
            expect(hit, 'dark cavity or louvre closes every sightline').toBeDefined();
            expect(hit.distance, 'louvres stay beneath the skin').toBeGreaterThan(0.082);
            expect(hit.distance, 'the cavity has a shallow closed floor').toBeLessThan(0.12);
          }
        for (let i = 0; i < pocket.outline.length; i++) {
          const a = pocket.outline[i],
            b = pocket.outline[(i + 1) % pocket.outline.length];
          for (const scale of [0.998, 1.02]) {
            const hit = probe(
              ((a[0] + b[0]) / 2) * scale,
              ((a[1] + b[1]) / 2) * scale,
            ).intersectObject(root, true)[0];
            expect(hit, 'the pocket perimeter stays sealed').toBeDefined();
            expect(
              Math.abs(hit.distance - 0.08),
              `LOD${detail} bonnet frame ${i}/${scale}`,
            ).toBeLessThan(0.004);
          }
        }
      }
    }
    const geometries = new Set<T.BufferGeometry>();
    body.root.traverse((node) => {
      if (node instanceof T.Mesh) geometries.add(node.geometry);
    });
    for (const geometry of geometries) geometry.dispose();
  });

  it('bounds curved-surface error and shares edge splits across adjacent material groups', () => {
    for (const id of ['rh3', 'sc7', 'eh3']) {
      const model = modelFor(id),
        x0 = -0.78,
        x1 = 0.78,
        z0 = model.zFront - 0.4,
        z1 = model.zFront + 0.01;
      for (const detail of [0, 1, 2] as const) {
        const source = [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ];
        const geometry = new T.BufferGeometry();
        geometry.setAttribute(
          'position',
          new T.Float32BufferAttribute(
            source.flatMap(([x, z]) => [x, x * 0.15 + z * 0.08, z]),
            3,
          ),
        );
        geometry.setAttribute('unwarpedXZ', new T.Float32BufferAttribute(source.flat(), 2));
        geometry.setIndex([0, 2, 1, 0, 3, 2]);
        geometry.addGroup(0, 3, 0);
        geometry.addGroup(3, 3, 1);
        geometry.computeVertexNormals();
        const originalNormal = new T.Vector3().fromBufferAttribute(
          geometry.getAttribute('normal'),
          0,
        );
        warpFestivalNose(geometry, model, detail);
        const position = geometry.getAttribute('position'),
          unwarped = geometry.getAttribute('unwarpedXZ'),
          index = geometry.index!,
          edges = new Map<string, { a: number; b: number; count: number }>();
        let maximumError = 0;
        for (let k = 0; k < index.count; k += 3) {
          const triangle = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
          for (let side = 0; side < 3; side++) {
            const a = triangle[side],
              b = triangle[(side + 1) % 3],
              key = a < b ? `${a}:${b}` : `${b}:${a}`;
            const edge = edges.get(key);
            if (edge) edge.count++;
            else edges.set(key, { a, b, count: 1 });
          }
          // A dense independent barycentric grid includes samples beyond the
          // constructor's midpoint/quarter/centroid refinement probes.
          for (let u = 0; u <= 8; u++)
            for (let v = 0; v <= 8 - u; v++) {
              const weights = [u / 8, v / 8, 1 - (u + v) / 8];
              let x = 0,
                z = 0,
                renderedZ = 0;
              for (let j = 0; j < 3; j++) {
                x += unwarped.getX(triangle[j]) * weights[j];
                z += unwarped.getY(triangle[j]) * weights[j];
                renderedZ += position.getZ(triangle[j]) * weights[j];
              }
              maximumError = Math.max(
                maximumError,
                Math.abs(festivalNoseZ(model, x, z) - renderedZ),
              );
            }
        }
        expect(maximumError, `${id}/LOD${detail} maximum surface deviation`).toBeLessThan(
          [0.0006, 0.002, 0.008][detail],
        );
        expect(index.count / 3, 'bounded geometry for a broad swept panel').toBeLessThan(
          [1600, 700, 260][detail],
        );
        for (const { a, b, count } of edges.values()) {
          expect(count).toBeLessThanOrEqual(2);
          if (count === 2) continue;
          const at = (vertex: number, axis: number, value: number) =>
            Math.abs(unwarped.getComponent(vertex, axis) - value) < 1e-6;
          expect(
            [
              [0, x0],
              [0, x1],
              [1, z0],
              [1, z1],
            ].some(([axis, value]) => at(a, axis, value) && at(b, axis, value)),
            'only the original outer boundary can have unpaired edges',
          ).toBe(true);
        }
        expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
        const normal = geometry.getAttribute('normal'),
          n = new T.Vector3(),
          expected = new T.Vector3();
        for (let i = 0; i < position.count; i++) {
          const x = unwarped.getX(i),
            z = unwarped.getY(i),
            epsilon = 1e-5,
            dx =
              (festivalNoseZ(model, x + epsilon, z) - festivalNoseZ(model, x - epsilon, z)) /
              (2 * epsilon),
            dz =
              (festivalNoseZ(model, x, z + epsilon) - festivalNoseZ(model, x, z - epsilon)) /
              (2 * epsilon);
          expected
            .set(
              originalNormal.x - (dx * originalNormal.z) / dz,
              originalNormal.y,
              originalNormal.z / dz,
            )
            .normalize();
          n.fromBufferAttribute(normal, i);
          expect(n.length(), 'authored smooth normals stay normalized').toBeCloseTo(1, 5);
          expect(
            n.dot(expected),
            'shared surface normals follow the same smooth deformation',
          ).toBeGreaterThan(0.999999);
        }
        geometry.dispose();
      }
    }
  });
});
