import * as T from 'three';
import { describe, expect, it, vi } from 'vitest';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { ClosedBodyModel } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { buildVehicleBody, VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
import { sharedMaterials } from '../src/rendering/vehicle-bodies/materials.ts';
import {
  festivalDetailFor,
  festivalExhaustGeometry,
  festivalFasciaCap,
  festivalFasciaOpenings,
} from '../src/rendering/vehicle-bodies/festival-detail.ts';
import {
  festivalBonnetPockets,
  festivalLampPockets,
  festivalNoseZ,
} from '../src/rendering/vehicle-bodies/festival-nose.ts';
import {
  festivalRearZ,
  festivalSidePockets,
  festivalTailPockets,
} from '../src/rendering/vehicle-bodies/festival-rear.ts';

function modelFor(id: string) {
  const def = VEHICLES[id];
  const sheet = bodySheetFor(def) as ClosedSheet;
  return new ClosedBodyModel(bodyFrame(def), sheet, [
    sheet.wheels.width[0] / 2,
    sheet.wheels.width[1] / 2,
  ]);
}
function hits(mesh: T.Object3D, x: number, y: number, z: number, forward: number) {
  mesh.updateMatrixWorld(true);
  return new T.Raycaster(
    new T.Vector3(x, y, z),
    new T.Vector3(0, 0, forward),
    0,
    3,
  ).intersectObject(mesh, true);
}

describe('Festival vehicle exterior construction', () => {
  it('cuts real fascia apertures while keeping their painted perimeter closed', () => {
    for (const id of ['rh3', 'rs5', 'rg63', 'rp6', 'sc7', 'gt10m']) {
      const model = modelFor(id);
      for (const detail of [0, 1] as const)
        for (const rear of [false, true]) {
          const sign = rear ? -1 : 1;
          const z = rear ? model.zRear : model.zFront;
          const geometry = festivalFasciaCap(model, detail, rear);
          const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
          for (const opening of festivalFasciaOpenings(model, rear)) {
            expect(
              hits(mesh, opening.x, opening.y, z + sign, -sign),
              `${id} LOD${detail} aperture`,
            ).toHaveLength(0);
            expect(
              hits(mesh, opening.x, opening.y + opening.height * 0.69, z + sign, -sign).length,
              `${id} LOD${detail} fascia bridge`,
            ).toBeGreaterThan(0);
          }
          geometry.dispose();
          (mesh.material as T.Material).dispose();
        }
    }
  });

  it('lets a front-view ray reach the recessed radiator rather than a painted blocking face', () => {
    for (const id of ['rh3', 'rs5', 'rp6', 'sc7']) {
      const model = modelFor(id);
      const body = buildVehicleBody(0, VEHICLES[id], bodySheetFor(VEHICLES[id])!);
      for (const opening of festivalFasciaOpenings(model)) {
        // Probe between decorative grille bars rather than directly at a
        // truck's central chrome crossbar.
        const x = opening.x + opening.width * 0.11;
        const hit = hits(
          body.lods[0].group,
          x,
          opening.y + opening.height * 0.21,
          model.zFront + 1,
          -1,
        )[0];
        expect(hit, `${id} radiator exists`).toBeDefined();
        expect(hit.point.z, `${id} real recessed opening`).toBeLessThan(
          festivalNoseZ(model, x, model.zFront - 0.007),
        );
        expect(hit.point.z, `${id} bounded duct depth`).toBeGreaterThan(
          festivalNoseZ(model, x, model.zFront - opening.depth - 0.02),
        );
      }
    }
  });

  it('builds open exhaust bores with a solid metallic lip and inner wall', () => {
    const radius = 0.05;
    const geometry = festivalExhaustGeometry(radius, 0.15);
    const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({ side: T.DoubleSide }));
    expect(hits(mesh, 0, 0, -1, 1)).toHaveLength(0);
    expect(hits(mesh, radius * 0.9, 0, -1, 1).length).toBeGreaterThan(0);
    expect(hits(mesh, radius * 1.1, 0, -1, 1)).toHaveLength(0);
  });

  it('terminates rear cooling apertures inside a dark duct at chase-view angles', () => {
    for (const id of ['eh3', 'sc7', 'rg63', 'gt10m']) {
      const model = modelFor(id);
      const body = buildVehicleBody(0, VEHICLES[id], bodySheetFor(VEHICLES[id])!);
      for (const detail of [0, 1] as const) {
        const root = body.lods[detail].group;
        let linerHits = 0;
        root.updateMatrixWorld(true);
        for (const opening of festivalFasciaOpenings(model, true)) {
          for (const x of [-0.45, -0.21, 0.04, 0.37, 0.45])
            for (const y of [-0.4, -0.2, 0, 0.2, 0.4])
              for (const slope of [0, 0.4, 0.9]) {
                const at = new T.Vector3(
                  opening.x + x * opening.width,
                  opening.y + y * opening.height,
                  festivalRearZ(model, opening.x + x * opening.width, model.zRear),
                );
                const direction = new T.Vector3(0, -slope, 1).normalize();
                const ray = new T.Raycaster(
                  at.clone().addScaledVector(direction, -0.2),
                  direction,
                  0,
                  0.5,
                );
                const hit = ray.intersectObject(root, true)[0];
                expect(hit, `${id} LOD${detail} rear duct at ${x}/${y}/${slope}`).toBeDefined();
                expect(
                  hit.point.z,
                  `${id} rear duct closes before the engine/cabin`,
                ).toBeLessThanOrEqual(
                  festivalRearZ(model, hit.point.x, model.zRear + opening.depth + 0.015),
                );
                if ((hit.object as T.Mesh).material === sharedMaterials.plastic()) linerHits++;
              }
        }
        if (festivalFasciaOpenings(model, true).length) expect(linerHits).toBeGreaterThan(0);
      }
    }
  });

  it('keeps all optical emitters on the existing lamp materials and batches the extra finish roles', () => {
    const def = VEHICLES.rh3;
    const body = buildVehicleBody(0, def, bodySheetFor(def)!);
    const roles = new Map<string, number>();
    let heads = 0,
      tails = 0;
    body.lods[0].group.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      if (o.material === body.materials.head) heads++;
      if (o.material === body.materials.tail) tails++;
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
        if (material.name.startsWith('Festival '))
          roles.set(material.name, (roles.get(material.name) ?? 0) + 1);
        if (material.userData.vehicleLampLens) {
          expect(material.transparent).toBe(true);
          expect(material.depthWrite).toBe(false);
          expect(o.castShadow).toBe(false);
        }
      }
    });
    expect(heads).toBe(1);
    expect(tails).toBe(1);
    expect(roles.size).toBe(3);
    expect([...roles.values()].every((count) => count === 1)).toBe(true);
    expect(body.lods[0].group.userData.festivalBodyDetail).toBeDefined();
    expect(body.lods[1].group.userData.festivalBodyDetail).toBeDefined();
    expect(body.lods[2].group.userData.festivalBodyDetail).toBeUndefined();
    expect(festivalDetailFor(VEHICLES.apx01, modelFor('rh3').s)).toBe(false);
  });

  it('releases replaced and cleared cars once while preserving other cars and shared finishes', () => {
    type Body = ReturnType<typeof buildVehicleBody>;
    type Resource = T.BufferGeometry | T.Material | T.Texture;
    const ownedResources = (body: Body) => {
      // The suit is per car since the livery work (a livery edit recolours it in
      // place), so it is released with the body like paint, accent and helmet.
      const { paint, accent, helmet, suit, head, tail, board } = body.materials;
      const resources = new Set<Resource>([paint, accent, helmet, suit, head, tail, board]);
      if (board.map) resources.add(board.map);
      const display = body.lods[0].cabin?.display;
      if (display) resources.add(display.material);
      body.root.traverse((object) => {
        if (object instanceof T.Mesh) resources.add(object.geometry);
      });
      for (const wheels of body.wheels)
        for (const wheel of wheels) {
          for (const material of Array.isArray(wheel.tyre.material)
            ? wheel.tyre.material
            : [wheel.tyre.material])
            resources.add(material);
          if (wheel.disc) resources.add(wheel.disc);
        }
      for (const material of Array.isArray(body.proxy.material)
        ? body.proxy.material
        : [body.proxy.material])
        resources.add(material);
      return resources;
    };
    const watch = (resources: Set<Resource>) =>
      [...resources].map((resource) => vi.spyOn(resource, 'dispose'));
    const bodies = new VehicleBodies();
    const built = (bodies as unknown as { bodies: Map<number, Body> }).bodies;
    const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
    frame[H.CARS] = 2;
    for (let id = 0; id < 2; id++) {
      frame[carBase(id) + F.QW] = 1;
      frame[carBase(id) + RACE_BASE + R.VEHICLE] = vehicleIndex(id === 0 ? 'rh3' : 'rg63');
      frame[carBase(id) + F.FRONT_HEALTH] = 1;
      frame[carBase(id) + F.REAR_HEALTH] = 1;
    }
    const hosts = [0, 1].map(() => ({ root: new T.Group(), lodLevel: 0 }));
    const externalReflection = new T.Texture();
    try {
      bodies.update(frame, frame, 1, hosts);
      const first = built.get(0)!,
        other = built.get(1)!;
      // Browser number boards own a CanvasTexture; use a texture here to
      // exercise that ownership without a browser or renderer.
      first.materials.board.map = new T.Texture();
      first.materials.paint.envMap = externalReflection;
      const firstResources = ownedResources(first),
        otherResources = ownedResources(other);
      const shared = new Set<Resource>([externalReflection]);
      for (const body of [first, other])
        body.root.traverse((object) => {
          if (!(object instanceof T.Mesh)) return;
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            if (!firstResources.has(material) && !otherResources.has(material))
              shared.add(material);
        });
      const firstDisposals = watch(firstResources),
        otherDisposals = watch(otherResources),
        sharedDisposals = watch(shared);
      bodies.showFeedDetail(() => 1);
      frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('rs5');
      bodies.update(frame, frame, 1, hosts);
      bodies.restoreFeedDetail();
      expect(bodies.count).toBe(2);
      expect(first.root.parent).toBeNull();
      for (const disposal of firstDisposals) expect(disposal).toHaveBeenCalledTimes(1);
      for (const disposal of otherDisposals) expect(disposal).not.toHaveBeenCalled();
      for (const disposal of sharedDisposals) expect(disposal).not.toHaveBeenCalled();
      const replacement = built.get(0)!;
      expect(replacement.materials.paint).not.toBe(first.materials.paint);
      const replacementDisposals = watch(ownedResources(replacement));
      bodies.showFeedDetail(() => 2);
      bodies.clear();
      bodies.clear();
      bodies.restoreFeedDetail();
      expect(bodies.count).toBe(0);
      expect(bodies.root.children).toHaveLength(0);
      expect(built.size).toBe(0);
      expect(bodies.cabinOf(0)).toBeNull();
      expect(bodies.mirrorsFor(0)).toBeNull();
      for (const disposal of [...firstDisposals, ...otherDisposals, ...replacementDisposals])
        expect(disposal).toHaveBeenCalledTimes(1);
      for (const disposal of sharedDisposals) expect(disposal).not.toHaveBeenCalled();
      bodies.update(frame, frame, 1, hosts);
      expect(bodies.count).toBe(2);
      expect(built.get(0)!.materials.paint).not.toBe(replacement.materials.paint);
      bodies.clear();
      for (const disposal of sharedDisposals) expect(disposal).not.toHaveBeenCalled();
    } finally {
      bodies.clear();
      vi.restoreAllMocks();
      externalReflection.dispose();
    }
  });
});

/** The EH-3 hero pass: the pressed-flank kit (swept nose with bonded lamp pockets
 * and bonnet outlets, shoulder sweep with a pocketed side duct, pressed flank)
 * and the electric signature lighting (continuous nose blade, lit arches, tail bar). */
describe('EH-3 electric hypercar: pressed-flank kit and signature lighting', () => {
  const id = 'eh3';
  const def = VEHICLES[id];
  const sheet = bodySheetFor(def) as ClosedSheet;
  const model = modelFor(id);
  const frame = model.f;
  const body = buildVehicleBody(0, def, sheet);
  /** Car-frame vertices of every mesh of a LOD that uses a material `test` accepts. */
  const vertices = (lod: number, test: (m: T.Material) => boolean, from = body) => {
    const out: T.Vector3[] = [];
    const root = from.lods[lod].group;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      if (!materials.some(test)) return;
      const position = o.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++)
        out.push(new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld));
    });
    return out;
  };
  const bar = (m: T.Material) => !!m.userData.vehicleLightBar;

  it('switches the SC-7 kit on for the EH-3 and keeps the electric car free of exhausts', () => {
    expect(festivalDetailFor(def, sheet)).toBe(true);
    expect(sheet.frontSweep).toBeGreaterThan(0.2);
    expect(sheet.rearSweep).toBeGreaterThan(0.15);
    expect(sheet.sideSculpt).toBeGreaterThan(0.03);
    expect(sheet.bonnetVents && sheet.sideIntake).toBe(true);
    expect(sheet.extras).not.toContain('exhaust-rear');
    expect(sheet.extras).not.toContain('exhaust-side');
    expect(festivalLampPockets(model)).toHaveLength(2);
    expect(festivalBonnetPockets(model)).toHaveLength(2);
    expect(festivalTailPockets(model)).toHaveLength(2);
    expect(festivalSidePockets(model)).toHaveLength(2);
    for (const lod of [0, 1])
      expect(body.lods[lod].group.userData.festivalBodyDetail).toBeDefined();
  });

  it('lays a continuous emissive blade across the nose, swept back with the skin', () => {
    const points = vertices(0, bar).filter((v) => v.z > model.zFront - 0.6);
    expect(points.length).toBeGreaterThan(30);
    const xs = points.map((v) => v.x);
    const half = Math.max(...xs);
    expect(half).toBeGreaterThan(0.6);
    expect(Math.min(...xs)).toBeCloseTo(-half, 2);
    // Continuous: every 2 cm slice of the span holds blade vertices.
    for (let x = -half + 0.02; x < half - 0.02; x += 0.02)
      expect(
        points.some((v) => Math.abs(v.x - x) < 0.02),
        `blade slice ${x.toFixed(2)}`,
      ).toBe(true);
    // The warp carries it: the corners lie behind the centre by the nose sweep shape.
    const centre = Math.max(...points.filter((v) => Math.abs(v.x) < 0.05).map((v) => v.z));
    const corner = Math.max(...points.filter((v) => Math.abs(v.x) > half - 0.05).map((v) => v.z));
    expect(centre - corner).toBeGreaterThan(sheet.frontSweep! * 0.25);
    // And it stays on the fascia: below the bonnet crown, above the intake mouths.
    const top = Math.max(...model.ring(model.zFront, 0).half.map((p) => p[1]));
    for (const v of points) {
      expect(v.y).toBeLessThan(top + 0.02);
      expect(v.y).toBeGreaterThan(top - 0.14);
    }
  });

  it('lights each wheel arch above the tyre, inside the body, on both sides', () => {
    for (const lod of [0, 1]) {
      const all = vertices(lod, bar);
      for (const axle of [frame.frontAxle, frame.rearAxle]) {
        const hub = axle === frame.frontAxle ? frame.hubFront : frame.hubRear;
        for (const side of [-1, 1]) {
          const strip = all.filter(
            (v) => Math.abs(v.z - axle) < frame.radius + 0.05 && v.x * side > 0.2,
          );
          expect(strip.length, `LOD${lod} arch ${axle.toFixed(2)} side ${side}`).toBeGreaterThan(8);
          for (const v of strip) {
            const dz = v.z - axle;
            const tyreTop = hub + Math.sqrt(Math.max(0, frame.radius ** 2 - dz * dz));
            expect(v.y, 'lit line clears the tyre').toBeGreaterThan(tyreTop + 0.012);
            expect(Math.abs(v.x), 'inside the body').toBeLessThan(model.halfWidth(v.z) + 0.01);
          }
        }
      }
    }
  });

  it('joins the two tapered lamps with a continuous brake-driven tail bar', () => {
    const pockets = festivalTailPockets(model);
    const bridge = Math.min(...pockets.map((p) => Math.abs(p.x) - p.width * 0.4));
    const barRow = (b: typeof body) =>
      vertices(0, (m) => m === b.materials.tail, b).filter(
        (v) =>
          v.z < model.zRear + 0.03 &&
          Math.abs(v.y - pockets[0].y) < 0.02 &&
          Math.abs(v.x) < bridge + 0.05,
      );
    // One bar spans the bridge between the lamps (a box has only its end vertices).
    const tail = barRow(body);
    expect(Math.min(...tail.map((v) => v.x))).toBeLessThan(-bridge + 0.03);
    expect(Math.max(...tail.map((v) => v.x))).toBeGreaterThan(bridge - 0.03);
    expect(bridge).toBeGreaterThan(0.2);
    // A body without the signature keeps its painted bridge between the lamps.
    const sc7 = buildVehicleBody(0, VEHICLES.sc7, bodySheetFor(VEHICLES.sc7)!);
    expect(barRow(sc7).filter((v) => Math.abs(v.x) < 0.1)).toHaveLength(0);
  });

  it('is emissive and always on, one shared material, and only on the near and mid LOD', () => {
    const material = sharedMaterials.lightBar(sheet.signature!);
    expect(material.emissive.getHex()).toBe(sheet.signature);
    expect(material.emissiveIntensity).toBeGreaterThan(1.5);
    expect(sharedMaterials.lightBar(sheet.signature!)).toBe(material);
    // The same material instance is used by a second car (shared, never disposed per car).
    const second = buildVehicleBody(1, def, sheet);
    let used: T.Material | undefined;
    second.lods[0].group.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      used ??= (Array.isArray(o.material) ? o.material : [o.material]).find(bar);
    });
    expect(used).toBe(material);
    expect(vertices(0, bar).length).toBeGreaterThan(0);
    expect(vertices(1, bar).length).toBeGreaterThan(0);
    expect(vertices(2, bar)).toHaveLength(0);
    // Bodies without the sheet key carry no light bar at all.
    const sc7 = buildVehicleBody(0, VEHICLES.sc7, bodySheetFor(VEHICLES.sc7)!);
    expect(vertices(0, bar, sc7)).toHaveLength(0);
  });
});
