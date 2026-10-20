import * as T from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { ClosedBodyModel } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';
import {
  festivalRearZ,
  festivalBumperSeam,
  festivalRegistrationPocket,
  festivalSidePockets,
  festivalSidePoint,
  festivalTailPockets,
} from '../src/rendering/vehicle-bodies/festival-rear.ts';

function build(id: string, revised = true) {
  const definition = VEHICLES[id],
    original = bodySheetFor(definition) as ClosedSheet,
    sheet = revised ? original : { ...original, rearSweep: undefined },
    model = new ClosedBodyModel(bodyFrame(definition), sheet, [
      sheet.wheels.width[0] / 2,
      sheet.wheels.width[1] / 2,
    ]),
    body = buildVehicleBody(0, definition, sheet);
  for (const lod of body.lods) lod.group.updateMatrixWorld(true);
  return { model, body };
}

function mesh(root: T.Object3D, name: string) {
  const result = root.getObjectByName(name);
  if (!(result instanceof T.Mesh)) throw new Error(`Missing vehicle component ${name}`);
  return result;
}

function materialFor(hit: T.Intersection) {
  const materials = (hit.object as T.Mesh).material;
  return Array.isArray(materials) ? materials[hit.face?.materialIndex ?? 0] : materials;
}

describe('Festival rear shoulder, lamps and side intakes', () => {
  const revised = new Map<string, ReturnType<typeof build>>(),
    previous = new Map<string, ReturnType<typeof build>>();
  beforeAll(() => {
    for (const id of ['rh3', 'sc7']) {
      revised.set(id, build(id));
      previous.set(id, build(id, false));
    }
  }, 120000);

  it('opens real rear lamp pockets while retaining the painted bridge and pocket perimeter', () => {
    for (const [id, { model, body }] of revised)
      for (const detail of [0, 1]) {
        const root = body.lods[detail].group,
          cap = mesh(root, 'Sculpted rear fascia');
        for (const pocket of festivalTailPockets(model)) {
          const z = festivalRearZ(model, pocket.x, model.zRear),
            ray = new T.Raycaster(
              new T.Vector3(pocket.x, pocket.y, z - 0.2),
              new T.Vector3(0, 0, 1),
              0,
              0.4,
            );
          expect(ray.intersectObject(cap), `${id}/LOD${detail} aperture`).toHaveLength(0);
          const hits = ray.intersectObject(root, true),
            cover = hits.find((hit) => materialFor(hit).userData.vehicleLampLens),
            emitter = hits.find((hit) => materialFor(hit) === body.materials.tail);
          expect(cover, 'clear cover in the actual opening').toBeDefined();
          expect(emitter, 'separate emitting cell visible behind the cover').toBeDefined();
          expect(emitter!.distance - cover!.distance).toBeGreaterThan(0.015);
          expect(emitter!.distance - cover!.distance).toBeLessThan(0.04);
          for (let k = 0; k < pocket.outline.length; k++) {
            const a = pocket.outline[k],
              b = pocket.outline[(k + 1) % pocket.outline.length],
              x = (a[0] + b[0]) * 0.5,
              y = (a[1] + b[1]) * 0.5,
              z = festivalRearZ(model, x, model.zRear);
            const edgeRay = new T.Raycaster(
              new T.Vector3(x, y, z - 0.2),
              new T.Vector3(0, 0, 1),
              0,
              0.3,
            );
            const opaque = edgeRay
              .intersectObject(root, true)
              .find((hit) => !materialFor(hit).transparent);
            expect(opaque, `${id}/LOD${detail} sealed boundary ${k}`).toBeDefined();
            expect(opaque!.point.z - z).toBeLessThan(0.016);
          }
        }
        const center = festivalTailPockets(model)[0];
        const bridge = new T.Raycaster(
          new T.Vector3(0, center.y, model.zRear - 0.2),
          new T.Vector3(0, 0, 1),
          0,
          0.3,
        );
        expect(bridge.intersectObject(cap).length, 'painted center bridge').toBeGreaterThan(0);
      }
  });

  it('cuts both SC7 side intakes into the curved skin and places their closed throat inside the body', () => {
    const { model, body } = revised.get('sc7')!;
    for (const detail of [0, 1]) {
      const root = body.lods[detail].group,
        skin = mesh(root, 'Body (lofted)');
      for (const pocket of festivalSidePockets(model))
        for (const u of [-0.26, 0, 0.23]) {
          const point = festivalSidePoint(model, pocket, [pocket.side * pocket.width * u, 0]),
            ray = new T.Raycaster(
              point.clone().add(new T.Vector3(pocket.side * 0.2, 0, 0)),
              new T.Vector3(-pocket.side, 0, 0),
              0,
              0.32,
            );
          expect(
            ray.intersectObject(skin),
            `LOD${detail} side ${pocket.side} opening`,
          ).toHaveLength(0);
          const hit = ray.intersectObject(root, true).find((hit) => !materialFor(hit).transparent);
          expect(hit, 'the side duct terminates in a real dark throat').toBeDefined();
          expect(hit!.distance, 'duct is recessed, not an external applique').toBeGreaterThan(0.22);
          expect(hit!.distance, 'closed well before the opposite body skin').toBeLessThan(0.29);
        }
    }
  });

  it('cuts a sealed, painted registration well and shapes the lower bumper independently of the tailgate', () => {
    for (const [id, { model, body }] of revised) {
      const pocket = festivalRegistrationPocket(model)!;
      for (const detail of [0, 1]) {
        const root = body.lods[detail].group,
          cap = mesh(root, 'Sculpted rear fascia'),
          z = festivalRearZ(model, 0, model.zRear, pocket.y),
          ray = new T.Raycaster(
            new T.Vector3(0, pocket.y, z - 0.2),
            new T.Vector3(0, 0, 1),
            0,
            0.3,
          );
        expect(ray.intersectObject(cap), `${id}/LOD${detail} registration aperture`).toHaveLength(
          0,
        );
        const hit = ray
          .intersectObject(root, true)
          .find((candidate) => !materialFor(candidate).transparent);
        expect(hit, 'closed registration mounting plate').toBeDefined();
        expect(hit!.distance).toBeGreaterThan(0.23);
        expect(hit!.distance).toBeLessThan(0.26);
        for (let k = 0; k < pocket.outline.length; k++) {
          const a = pocket.outline[k],
            b = pocket.outline[(k + 1) % pocket.outline.length],
            x = (a[0] + b[0]) / 2,
            y = (a[1] + b[1]) / 2,
            z = festivalRearZ(model, x, model.zRear, y),
            edge = new T.Raycaster(new T.Vector3(x, y, z - 0.2), new T.Vector3(0, 0, 1), 0, 0.3)
              .intersectObject(root, true)
              .find((candidate) => !materialFor(candidate).transparent);
          expect(edge, `${id}/LOD${detail} well edge ${k}`).toBeDefined();
          expect(materialFor(edge!), 'painted well joins the painted rear skin').toBe(
            body.materials.paint,
          );
          expect(Math.abs(edge!.distance - 0.2)).toBeLessThan(0.006);
        }
      }
      const top = festivalBumperSeam(model),
        bottom = Math.min(...model.ring(model.zRear, 0).half.map((point) => point[1])),
        middle = (top + bottom) / 2,
        crown = festivalRearZ(model, 0, model.zRear, middle);
      expect(
        model.zRear - crown,
        'a real curved bumper crown, not only an overlaid seam',
      ).toBeGreaterThan(0.03);
      expect(model.zRear - crown).toBeLessThan(0.04);
      expect(festivalRearZ(model, 0, model.zRear, top)).toBe(model.zRear);
      expect(festivalRearZ(model, 0, model.zRear, bottom)).toBe(model.zRear);
      for (const detail of [0, 1]) {
        const hit = new T.Raycaster(
          new T.Vector3(0, middle, crown - 0.2),
          new T.Vector3(0, 0, 1),
          0,
          0.3,
        ).intersectObject(mesh(body.lods[detail].group, 'Sculpted rear fascia'))[0];
        expect(hit, 'the rendered lower cap follows the bumper crown').toBeDefined();
        expect(Math.abs(hit.point.z - crown)).toBeLessThan(detail === 0 ? 0.002 : 0.004);
      }
    }
  });

  it('keeps the side duct perimeter sealed to the evaluated body, without a protruding square frame', () => {
    const { model, body } = revised.get('sc7')!;
    for (const detail of [0, 1])
      for (const pocket of festivalSidePockets(model))
        for (let k = 0; k < pocket.outline.length; k++) {
          const a = pocket.outline[k],
            b = pocket.outline[(k + 1) % pocket.outline.length],
            point = festivalSidePoint(model, pocket, [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]),
            ray = new T.Raycaster(
              point.clone().add(new T.Vector3(pocket.side * 0.2, 0, 0)),
              new T.Vector3(-pocket.side, 0, 0),
              0,
              0.3,
            ),
            hit = ray.intersectObject(body.lods[detail].group, true)[0];
          expect(hit, `LOD${detail} edge ${k} side ${pocket.side}`).toBeDefined();
          expect(Math.abs(hit!.distance - 0.2)).toBeLessThan(0.018);
        }
  });

  it('closes the SC7 lower cap-to-side junction under oblique rear-quarter rays', () => {
    const { model, body } = revised.get('sc7')!,
      floor = Math.min(...model.ring(model.zRear, 0).half.map((point) => point[1])),
      top = festivalBumperSeam(model);
    for (const detail of [0, 1])
      for (const side of [-1, 1])
        for (let k = 0; k < 13; k++) {
          const y = floor + 0.013 + ((k + 0.37) / 13) * (top - floor - 0.026),
            x = side * model.sideX(model.zRear, y),
            z = festivalRearZ(model, x, model.zRear, y),
            ray = new T.Raycaster(
              new T.Vector3(x + side * 0.012, y, z - 0.016),
              new T.Vector3(-side * 0.6, 0, 0.8),
              0,
              0.029,
            ),
            hit = ray
              .intersectObject(body.lods[detail].group, true)
              .find((candidate) => !materialFor(candidate).transparent);
          expect(hit, `LOD${detail} side ${side} bumper height ${k} has no sky slit`).toBeDefined();
        }
  });

  it('curves only the rear overhang while preserving a monotone surface and the wheel envelope', () => {
    for (const { model } of revised.values()) {
      const start = model.f.rearAxle - model.f.radius - 0.09;
      for (const x of [-model.s.width / 2, -0.3, 0, 0.3, model.s.width / 2]) {
        for (const y of [
          model.f.y(model.s.floor),
          model.f.y(0.23),
          festivalBumperSeam(model),
          model.f.y(model.s.tail),
          model.f.y(model.s.roof),
        ]) {
          for (let k = 0; k <= 12; k++) {
            const z = start + 0.001 + (k / 12) * (model.zFront - start);
            expect(
              festivalRearZ(model, x, z, y),
              'entire front and tyre envelope remains fixed',
            ).toBe(z);
          }
          for (let k = 0; k < 40; k++) {
            const z = model.zRear - 0.08 + (k / 39) * (start - model.zRear + 0.08);
            const slope =
              (festivalRearZ(model, x, z + 0.0001, y) - festivalRearZ(model, x, z, y)) / 0.0001;
            expect(slope, 'rear mapping cannot fold or reverse its surface').toBeGreaterThan(0.35);
          }
        }
      }
      expect(
        festivalRearZ(model, model.halfWidth(model.zRear), model.zRear) - model.zRear,
      ).toBeGreaterThan(0.08);
    }
  });

  it('retains finite smooth normals, material batches, and a bounded geometry increase at every LOD', () => {
    const inventory = (root: T.Object3D) => {
      let triangles = 0,
        meshes = 0,
        invalidNormals = 0;
      const materials = new Set<T.Material>();
      root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        meshes++;
        triangles +=
          (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material);
        for (const name of ['position', 'normal']) {
          const attribute = object.geometry.getAttribute(name);
          if (!attribute) continue;
          for (let i = 0; i < attribute.count; i++) {
            const x = attribute.getX(i),
              y = attribute.getY(i),
              z = attribute.getZ(i);
            if (![x, y, z].every(Number.isFinite))
              throw new Error(`${name} contains non-finite vertex`);
            if (
              name === 'normal' &&
              Math.hypot(x, y, z) > 0.001 &&
              Math.abs(Math.hypot(x, y, z) - 1) > 0.0001
            )
              invalidNormals++;
          }
        }
      });
      expect(invalidNormals, 'unit surface normals').toBe(0);
      return { triangles, meshes, materials: materials.size };
    };
    for (const [id, { body }] of revised)
      for (const detail of [0, 1, 2]) {
        const current = inventory(body.lods[detail].group),
          baseline = inventory(previous.get(id)!.body.lods[detail].group);
        expect(current.materials, `${id}/LOD${detail} material budget`).toBe(baseline.materials);
        expect(current.meshes, `${id}/LOD${detail} mesh budget`).toBe(baseline.meshes);
        expect(current.triangles, `${id}/LOD${detail} triangle budget`).toBeLessThan(
          baseline.triangles * 1.15 + 1500,
        );
      }
  });
});
