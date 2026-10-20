import * as T from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { ClosedBodyModel } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { carMaterials, type CarMaterials } from '../src/rendering/vehicle-bodies/common.ts';
import { loftRings, type Pt } from '../src/rendering/vehicle-bodies/loft.ts';
import { sharedMaterials } from '../src/rendering/vehicle-bodies/materials.ts';
import { Parts } from '../src/rendering/vehicle-bodies/parts.ts';
import { cutFestivalBodyPockets } from '../src/rendering/vehicle-bodies/festival-nose.ts';
import { festivalSidePockets } from '../src/rendering/vehicle-bodies/festival-rear.ts';
import {
  addFestivalDoorHandles,
  addFestivalSills,
  cutFestivalDoorJoints,
  festivalDoorPaths,
} from '../src/rendering/vehicle-bodies/festival-side.ts';
import type { Detail } from '../src/rendering/vehicle-bodies/wheel.ts';

function modelFor(id: string, shaped = true) {
  const definition = VEHICLES[id],
    original = bodySheetFor(definition) as ClosedSheet,
    sheet = shaped ? original : { ...original, sideSculpt: undefined };
  return new ClosedBodyModel(bodyFrame(definition), sheet, [
    sheet.wheels.width[0] / 2,
    sheet.wheels.width[1] / 2,
  ]);
}

function skin(model: ClosedBodyModel, mats: CarMaterials, detail: Detail) {
  const geometry = loftRings(
    model.stations(detail).map((z) => model.ring(z, detail)),
    {
      capStart: false,
      capEnd: false,
      material: (z, j) => model.slot(z, j, detail),
    },
  );
  cutFestivalBodyPockets(geometry, model);
  const materials = [
      mats.paint,
      sharedMaterials.plastic(),
      sharedMaterials.carbonSatin(),
      mats.accent,
      sharedMaterials.cabinLid(),
    ],
    before = new T.Mesh(geometry.clone(), materials);
  cutFestivalDoorJoints(geometry, model, detail);
  const after = new T.Mesh(geometry, materials);
  before.updateMatrixWorld(true);
  after.updateMatrixWorld(true);
  return { before, after };
}

function sideRay(model: ClosedBodyModel, z: number, y: number, side: number) {
  return new T.Raycaster(
    new T.Vector3(side * (model.halfWidth(z) + 0.3), y, z),
    new T.Vector3(-side, 0, 0),
    0,
    0.65,
  );
}

function fittings(
  model: ClosedBodyModel,
  mats: CarMaterials,
  kind: 'handles' | 'sills',
  side = 1,
  detail: Detail = 0,
) {
  const group = new T.Group(),
    parts = new Parts();
  if (kind === 'handles') addFestivalDoorHandles(parts, model, mats, side);
  else addFestivalSills(parts, model, mats, detail);
  parts.build(group, false);
  group.updateMatrixWorld(true);
  return group;
}

function part(root: T.Group, material: T.Material) {
  const mesh = root.children.find(
    (child) => child instanceof T.Mesh && child.material === material,
  );
  if (!(mesh instanceof T.Mesh)) throw new Error('Missing batched fitting');
  return mesh.geometry.getAttribute('position');
}

function envelope(attribute: T.BufferAttribute | T.InterleavedBufferAttribute, start: number) {
  const box = new T.Box3();
  for (let i = start; i < attribute.count; i++)
    box.expandByPoint(new T.Vector3().fromBufferAttribute(attribute, i));
  return box;
}

function pointSegmentDistance(p: Pt, a: Pt, b: Pt) {
  const dz = b[0] - a[0],
    dy = b[1] - a[1],
    t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dz + (p[1] - a[1]) * dy) / (dz * dz + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dz, p[1] - a[1] - t * dy);
}

/** Project the complete generated hardware envelope, not its mount point. */
function boundaryClearance(box: T.Box3, points: Pt[]) {
  const corners: Pt[] = [
    [box.min.z, box.min.y],
    [box.max.z, box.min.y],
    [box.max.z, box.max.y],
    [box.min.z, box.max.y],
  ];
  let closest = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dz = b[0] - a[0],
      dy = b[1] - a[1];
    let enter = 0,
      leave = 1;
    for (const [origin, direction, min, max] of [
      [a[0], dz, box.min.z, box.max.z],
      [a[1], dy, box.min.y, box.max.y],
    ]) {
      if (Math.abs(direction) < 1e-12) {
        if (origin < min || origin > max) enter = Infinity;
      } else {
        const lo = (min - origin) / direction,
          hi = (max - origin) / direction;
        enter = Math.max(enter, Math.min(lo, hi));
        leave = Math.min(leave, Math.max(lo, hi));
      }
    }
    if (enter <= leave) return 0;
    for (const corner of corners) closest = Math.min(closest, pointSegmentDistance(corner, a, b));
    for (const p of [a, b])
      closest = Math.min(
        closest,
        Math.hypot(
          Math.max(box.min.z - p[0], 0, p[0] - box.max.z),
          Math.max(box.min.y - p[1], 0, p[1] - box.max.y),
        ),
      );
  }
  return closest;
}

describe('RH3 and SC7 pressed flanks, recessed door joints and folded sills', () => {
  const fixtures: {
    id: string;
    model: ClosedBodyModel;
    original: ClosedBodyModel;
    mats: CarMaterials;
    details: ReturnType<typeof skin>[];
  }[] = [];
  beforeAll(() => {
    for (const id of ['rh3', 'sc7']) {
      const model = modelFor(id),
        original = modelFor(id, false),
        mats = carMaterials(0, model.s.paint, model.gaps());
      fixtures.push({
        id,
        model,
        original,
        mats,
        details: [skin(model, mats, 0), skin(model, mats, 1)],
      });
    }
  }, 120000);

  it('presses the lower flank while preserving upper-body, wheel and intake envelopes at every LOD', () => {
    for (const { id, model, original } of fixtures) {
      let maximum = 0;
      for (const detail of [0, 1, 2] as const)
        for (const z of model.stations(detail)) {
          const old = original.ring(z, detail).half,
            next = model.ring(z, detail).half,
            controls = original.control(z),
            wheel =
              Math.min(Math.abs(z - model.f.frontAxle), Math.abs(z - model.f.rearAxle)) <
              model.f.radius + 0.075,
            intake = model.s.sideIntake && z < model.f.rearAxle + model.f.radius + 0.705;
          for (let i = 0; i < old.length; i++) {
            const inset = old[i][0] - next[i][0];
            expect(next[i][1]).toBe(old[i][1]);
            expect(inset).toBeGreaterThanOrEqual(-1e-12);
            expect(inset).toBeLessThanOrEqual((id === 'rh3' ? 0.024 : 0.042) + 1e-12);
            if (wheel || intake || old[i][1] >= controls[5][1] || old[i][1] <= controls[4][1])
              expect(next[i][0]).toBe(old[i][0]);
            if (detail === 0) maximum = Math.max(maximum, inset);
          }
        }
      expect(maximum, `${id} measurable lower-flank hollow`).toBeGreaterThan(
        id === 'rh3' ? 0.02 : 0.036,
      );
    }
  });

  it('exposes real 3 mm deep dark floors, painted bevels and intact neighbouring skin on both sides', () => {
    for (const { id, model, details } of fixtures)
      for (const detail of [0, 1] as const) {
        const { before, after } = details[detail];
        let checked = 0;
        for (const path of festivalDoorPaths(model, detail))
          for (let i = 1; i < path.points.length; i++) {
            const a = path.points[i - 1],
              b = path.points[i],
              length = Math.hypot(b[0] - a[0], b[1] - a[1]),
              normal = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
            for (const side of [-1, 1]) {
              const z = a[0] + (b[0] - a[0]) * 0.43,
                y = a[1] + (b[1] - a[1]) * 0.43,
                original = sideRay(model, z, y, side).intersectObject(before)[0];
              if (!original || original.face!.materialIndex !== 0) continue;
              for (const offset of [0, -0.0021, 0.0021, -0.0048, 0.0048]) {
                const ray = sideRay(model, z + normal[0] * offset, y + normal[1] * offset, side),
                  old = ray.intersectObject(before)[0],
                  hit = ray.intersectObject(after)[0];
                expect(old, `${id}/LOD${detail} original side skin`).toBeDefined();
                expect(hit, `${id}/LOD${detail} sealed joint at segment ${i}`).toBeDefined();
                const depth = hit.distance - old.distance,
                  expected = offset === 0 ? 0.003 : Math.abs(offset) < 0.003 ? 0.0015 : 0;
                expect(
                  Math.abs(depth - expected),
                  `${id}/LOD${detail} side ${side} segment ${i}, offset ${offset}`,
                ).toBeLessThan(0.000004);
                expect(hit.face!.materialIndex).toBe(offset === 0 ? 1 : 0);
              }
              checked++;
            }
          }
        expect(checked, `${id}/LOD${detail} supported perimeter probes`).toBeGreaterThan(20);
      }
  });

  it('keeps the door boundary clear of the wheels and ahead of the SC7 intake', () => {
    for (const { id, model } of fixtures)
      for (const detail of [0, 1] as const) {
        const path = festivalDoorPaths(model, detail)[0];
        for (let i = 1; i < path.points.length; i++) {
          const a = path.points[i - 1],
            b = path.points[i];
          expect(
            Math.hypot(b[0] - a[0], b[1] - a[1]),
            'no duplicate stations or collapsed miters',
          ).toBeGreaterThan(0.001);
          for (let k = 0; k <= 8; k++) {
            const z = a[0] + ((b[0] - a[0]) * k) / 8,
              y = a[1] + ((b[1] - a[1]) * k) / 8;
            for (const [axle, hub] of [
              [model.f.frontAxle, model.f.hubFront],
              [model.f.rearAxle, model.f.hubRear],
            ])
              expect(
                Math.hypot(z - axle, y - hub),
                `${id} door seam outside wheel opening`,
              ).toBeGreaterThan(model.f.radius + 0.048);
          }
        }
        if (id === 'sc7') {
          const pocket = festivalSidePockets(model)[0];
          expect(Math.min(...path.points.map((p) => p[0]))).toBeGreaterThan(
            pocket.base.elements[14] + pocket.width / 2 + 0.04,
          );
        }
      }
  });

  it('forms outward-facing painted and dark sill surfaces that terminate inside the body before each wheel', () => {
    for (const { id, model, mats } of fixtures)
      for (const detail of [0, 1] as const) {
        const root = fittings(model, mats, 'sills', 1, detail),
          box = new T.Box3().setFromObject(root),
          z = (box.min.z + box.max.z) / 2;
        expect(box.min.z).toBeGreaterThan(model.f.rearAxle + model.f.radius + 0.08);
        expect(box.max.z).toBeLessThan(model.f.frontAxle - model.f.radius - 0.08);
        expect(root.children.map((child) => (child as T.Mesh).material)).toEqual([
          mats.paint,
          sharedMaterials.trim(),
        ]);
        for (const side of [-1, 1])
          for (const [height, material] of [
            [0.041, sharedMaterials.trim()],
            [0.09, mats.paint],
          ] as const) {
            const y = model.f.y(model.s.floor + height),
              hit = sideRay(model, z, y, side).intersectObject(root, true)[0];
            expect(hit, `${id}/LOD${detail} visible outward sill`).toBeDefined();
            expect((hit.object as T.Mesh).material).toBe(material);
            expect(hit.face!.normal.x * side).toBeGreaterThan(0.35);
            expect(
              Math.abs(hit.point.x) - model.sideX(z, y, detail),
              `${id}/LOD${detail} folded sill stands clear of the curved skin`,
            ).toBeGreaterThan(0.005);
            expect(Math.abs(hit.point.x) - model.sideX(z, y, detail)).toBeLessThan(0.024);
          }
        for (const child of root.children) {
          const positions = (child as T.Mesh).geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            const z = positions.getZ(i);
            if (Math.abs(z - box.min.z) < 1e-6 || Math.abs(z - box.max.z) < 1e-6)
              expect(
                Math.abs(positions.getX(i)) - model.sideX(z, positions.getY(i), detail),
              ).toBeLessThan(-0.008);
          }
        }
      }
  });

  it('moves the RH3 rear grip and recess together using their complete generated envelopes, leaving other handles unchanged', () => {
    for (const { id, model, original, mats } of fixtures)
      for (const side of [-1, 1]) {
        const before = fittings(original, mats, 'handles', side),
          after = fittings(model, mats, 'handles', side);
        let movedBy: number | undefined;
        const currentEnvelope = new T.Box3(),
          previousEnvelope = new T.Box3();
        for (const material of [sharedMaterials.trim(), mats.paint]) {
          const old = part(before, material),
            next = part(after, material),
            rear = id === 'rh3' ? next.count / 2 : next.count;
          expect(next.count).toBe(old.count);
          for (let i = 0; i < rear; i++) {
            expect(next.getX(i)).toBe(old.getX(i));
            expect(next.getY(i)).toBe(old.getY(i));
            expect(next.getZ(i)).toBe(old.getZ(i));
          }
          if (id === 'rh3') {
            currentEnvelope.union(envelope(next, rear));
            previousEnvelope.union(envelope(old, rear));
            const shift = next.getZ(rear) - old.getZ(rear);
            expect(shift).toBeGreaterThan(0.025);
            if (movedBy !== undefined) expect(Math.abs(shift - movedBy)).toBeLessThan(3e-7);
            movedBy = shift;
            for (let i = rear; i < next.count; i++) {
              expect(next.getY(i)).toBe(old.getY(i));
              // Generated geometry is stored in Float32 attributes.
              expect(Math.abs(next.getZ(i) - old.getZ(i) - shift)).toBeLessThan(3e-7);
            }
          }
        }
        if (id === 'rh3') {
          const perimeter = festivalDoorPaths(model)[0],
            boundary = perimeter.points.slice(perimeter.rearStart);
          expect(
            boundaryClearance(previousEnvelope, boundary),
            'previous full-height hardware touches the door joint',
          ).toBeLessThan(0.003);
          expect(
            boundaryClearance(currentEnvelope, boundary) - 0.0055 / 2,
            'clear painted margin around all rear hardware',
          ).toBeGreaterThan(0.0135);
        }
      }
  });

  it('bounds added topology and retains the production material slots with finite, normalized vertex data', () => {
    const receipts = [];
    for (const { id, details } of fixtures)
      for (const detail of [0, 1] as const) {
        const { before, after } = details[detail],
          geometry = after.geometry,
          added = (geometry.index!.count - before.geometry.index!.count) / 3;
        expect(added).toBeGreaterThan(100);
        expect(added).toBeLessThan(detail === 0 ? 15000 : 9000);
        expect(new Set(geometry.groups.map((group) => group.materialIndex))).toEqual(
          new Set(before.geometry.groups.map((group) => group.materialIndex)),
        );
        for (const name of ['position', 'normal', 'uv'])
          expect(Array.from(geometry.getAttribute(name).array).every(Number.isFinite)).toBe(true);
        const normal = geometry.getAttribute('normal');
        for (let i = 0; i < geometry.index!.count; i++) {
          const j = geometry.index!.getX(i),
            length = Math.hypot(normal.getX(j), normal.getY(j), normal.getZ(j));
          expect(length).toBeGreaterThan(0.98);
          expect(length).toBeLessThan(1.02);
        }
        receipts.push({ id, detail, addedTriangles: added });
      }
    console.info('Fresh reconstructed door geometry:', JSON.stringify(receipts));
  });
});
