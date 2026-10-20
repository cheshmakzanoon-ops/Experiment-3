import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { ClosedBodyModel } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';
import {
  festivalLampPockets,
  festivalLampEdge,
  festivalNoseZ,
  type FestivalLampPocket,
} from '../src/rendering/vehicle-bodies/festival-nose.ts';
import { festivalFasciaOpenings } from '../src/rendering/vehicle-bodies/festival-detail.ts';

function build(id: string, sweep = true) {
  const definition = VEHICLES[id],
    source = bodySheetFor(definition) as ClosedSheet;
  const sheet = sweep ? source : { ...source, frontSweep: undefined };
  const model = new ClosedBodyModel(bodyFrame(definition), sheet, [
    sheet.wheels.width[0] / 2,
    sheet.wheels.width[1] / 2,
  ]);
  return { model, body: buildVehicleBody(0, definition, sheet) };
}
function component(root: T.Object3D, name: string) {
  const object = root.getObjectByName(name);
  if (!(object instanceof T.Mesh)) throw new Error(`Missing production component: ${name}`);
  return object;
}
function project(
  model: ClosedBodyModel,
  pocket: FestivalLampPocket,
  x: number,
  y: number,
  z: number,
) {
  const point = new T.Vector3(x, y, z).applyMatrix4(pocket.base);
  point.z = festivalNoseZ(model, point.x, point.z);
  return point;
}
function pocketRay(model: ClosedBodyModel, pocket: FestivalLampPocket, x: number, z: number) {
  const start = project(model, pocket, x, 0.105, z),
    end = project(model, pocket, x, -0.085, z);
  return new T.Raycaster(start, end.clone().sub(start).normalize(), 0, start.distanceTo(end));
}

describe('RH3 and SC7 integrated front ends', () => {
  it('cuts actual lamp holes, retains nearby painted skin and exposes recessed optics', () => {
    for (const id of ['rh3', 'sc7']) {
      const { model, body } = build(id);
      for (const detail of [0, 1]) {
        const root = body.lods[detail].group,
          skin = component(root, 'Body (lofted)');
        root.updateMatrixWorld(true);
        for (const pocket of festivalLampPockets(model)) {
          for (const [x, z] of [
            [0, 0],
            [-0.18, 0.08],
            [0.18, -0.08],
          ]) {
            const probe = pocketRay(model, pocket, x * pocket.width, z * pocket.depth);
            expect(
              probe.intersectObject(skin),
              `${id}/LOD${detail} physical lamp aperture`,
            ).toHaveLength(0);
          }
          const neighbour = pocketRay(model, pocket, -pocket.side * pocket.width * 0.66, 0);
          expect(
            neighbour.intersectObject(skin).length,
            'bonnet skin beside the opening stays closed',
          ).toBeGreaterThan(0);
          const probe = pocketRay(model, pocket, 0, -0.005);
          const hits = probe.intersectObject(root, true);
          const emitter = hits.find(
            (hit) => (hit.object as T.Mesh).material === body.materials.head,
          );
          expect(emitter, 'real projector visible through the skin opening').toBeDefined();
          const surfaceDistance = probe.ray.origin.distanceTo(project(model, pocket, 0, 0, -0.005));
          expect(emitter!.distance, 'projector sits inside the body').toBeGreaterThan(
            surfaceDistance + 0.003,
          );
          expect(emitter!.distance).toBeLessThan(surfaceDistance + 0.06);
          const pane = hits.find((hit) => {
            const material = (hit.object as T.Mesh).material;
            return !Array.isArray(material) && material.userData.vehicleLampLens;
          });
          expect(pane, 'bonded cover remains ahead of its emitters').toBeDefined();
          expect(pane!.distance).toBeLessThan(emitter!.distance);
          for (let k = 0; k < pocket.outline.length; k++) {
            const a = pocket.outline[k],
              b = pocket.outline[(k + 1) % pocket.outline.length];
            for (const scale of [0.985, 1.015]) {
              const x = (a[0] + b[0]) * 0.5 * scale,
                z = (a[1] + b[1]) * 0.5 * scale;
              const probe = pocketRay(model, pocket, x, z);
              const hit = probe.intersectObject(root, true).find((hit) => {
                const material = (hit.object as T.Mesh).material;
                const faceMaterial = Array.isArray(material)
                  ? material[hit.face?.materialIndex ?? 0]
                  : material;
                return !faceMaterial.transparent;
              });
              expect(hit, `${id}/LOD${detail} sealed lamp perimeter ${k}/${scale}`).toBeDefined();
              const edge = festivalLampEdge(model, pocket, [x, z]);
              edge.z = festivalNoseZ(model, edge.x, edge.z);
              expect(
                hit!.distance,
                'the reveal closes at the painted skin, not the cavity floor',
              ).toBeLessThan(probe.ray.origin.distanceTo(edge) + 0.022);
            }
          }
          const at = project(model, pocket, 0, 0, 0);
          const below = new T.Raycaster(
            new T.Vector3(at.x, model.f.ground - 0.2, at.z),
            new T.Vector3(0, 1, 0),
            0,
            2,
          );
          const floor = below.intersectObject(skin)[0];
          expect(floor, 'lamp cuts never remove the underbody').toBeDefined();
          expect(floor.point.y).toBeLessThan(at.y - 0.15);
        }
      }
    }
  });

  it('closes curved cooling ducts at front-quarter heights without exposing the world behind the bumper', () => {
    for (const id of ['rh3', 'sc7']) {
      const { model, body } = build(id);
      for (const detail of [0, 1]) {
        const root = body.lods[detail].group;
        root.updateMatrixWorld(true);
        for (const opening of festivalFasciaOpenings(model))
          for (const u of [-0.4, -0.18, 0.03, 0.21, 0.4])
            for (const v of [-0.35, 0, 0.35])
              for (const slope of [0, 0.45, 0.9]) {
                const x = opening.x + u * opening.width;
                const at = new T.Vector3(
                  x,
                  opening.y + v * opening.height,
                  festivalNoseZ(model, x, model.zFront),
                );
                const direction = new T.Vector3(0, -slope, -1).normalize();
                const ray = new T.Raycaster(
                  at.clone().addScaledVector(direction, -0.2),
                  direction,
                  0,
                  0.5,
                );
                const hit = ray.intersectObject(root, true)[0];
                expect(
                  hit,
                  `${id}/LOD${detail} closed curved duct ${u}/${v}/${slope}`,
                ).toBeDefined();
                expect(hit.point.z).toBeGreaterThan(
                  festivalNoseZ(model, x, model.zFront - opening.depth - 0.02),
                );
              }
      }
    }
  });

  it('curves the painted nose and its ducts while leaving wheel arches exactly at their previous positions', () => {
    for (const id of ['rh3', 'sc7']) {
      const { model, body } = build(id),
        baseline = build(id, false).body;
      for (const detail of [0, 1, 2]) {
        const revised = component(body.lods[detail].group, 'Body (lofted)').geometry;
        const original = component(baseline.lods[detail].group, 'Body (lofted)').geometry;
        const before = original.getAttribute('position'),
          after = revised.getAttribute('position');
        const fixedLimit = model.f.frontAxle + model.f.radius + 0.045;
        let fixed = 0,
          swept = 0;
        for (let i = 0; i < before.count; i++) {
          if (before.getZ(i) <= fixedLimit) {
            if (
              before.getX(i) !== after.getX(i) ||
              before.getY(i) !== after.getY(i) ||
              before.getZ(i) !== after.getZ(i)
            )
              throw new Error(`${id}/LOD${detail}: geometry moved behind the nose at vertex ${i}`);
            fixed++;
          } else if (before.getZ(i) - after.getZ(i) > 0.03) swept++;
        }
        expect(fixed).toBeGreaterThan(before.count * 0.75);
        expect(swept).toBeGreaterThan(10);
        if (detail < 2) {
          const fascia = component(body.lods[detail].group, 'Sculpted front fascia').geometry;
          fascia.computeBoundingBox();
          const depth = fascia.boundingBox!.max.z - fascia.boundingBox!.min.z;
          expect(depth, 'bumper is no longer one flat plane').toBeGreaterThan(0.08);
          expect(depth).toBeLessThan(0.18);
        }
      }
    }
  });

  it('keeps the nose mapping monotone, bounded and normal-consistent', () => {
    for (const id of ['rh3', 'sc7']) {
      const { model, body } = build(id);
      for (const x of [-1.1, -0.7, 0, 0.7, 1.1]) {
        let previous = -Infinity;
        for (let z = model.zFront - 1; z < model.zFront + 0.12; z += 0.003) {
          const mapped = festivalNoseZ(model, x, z);
          expect(mapped, 'no folded longitudinal surfaces').toBeGreaterThan(previous);
          expect(mapped).toBeLessThanOrEqual(z);
          previous = mapped;
        }
      }
      for (const detail of [0, 1]) {
        const geometry = component(body.lods[detail].group, 'Sculpted front fascia').geometry;
        const normal = geometry.getAttribute('normal'),
          position = geometry.getAttribute('position');
        for (let i = 0; i < normal.count; i++) {
          expect(normal.getZ(i), 'all front cap normals face forward').toBeGreaterThan(0.8);
          expect(
            normal.getX(i) * position.getX(i),
            'curved shoulders face outboard',
          ).toBeGreaterThanOrEqual(-1e-8);
        }
      }
    }
    const other = build('rs5').model;
    expect(festivalLampPockets(other)).toHaveLength(0);
    expect(festivalNoseZ(other, 0.8, other.zFront)).toBe(other.zFront);
  });
});
