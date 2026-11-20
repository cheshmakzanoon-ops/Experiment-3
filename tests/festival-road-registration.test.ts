import * as T from 'three';
import { expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { ClosedBodyModel } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { addFestivalRegistration } from '../src/rendering/vehicle-bodies/festival-registration.ts';
import { festivalDoorPaths } from '../src/rendering/vehicle-bodies/festival-side.ts';
import {
  festivalLampPockets,
  festivalNoseZ,
} from '../src/rendering/vehicle-bodies/festival-nose.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { Parts } from '../src/rendering/vehicle-bodies/parts.ts';

it('fits ten distinct registrations into one shared sheet with rear-facing readable UVs at every distance', () => {
  const ids = ['eh3', 'sc7', 'rh3', 'rs5', 'rm8', 'rg63', 'rp6', 'rr4', 'lx12', 'rd2'];
  const graphics = new Set(),
    plates = new Set<string>();
  for (const id of ids) {
    const sheet = bodySheetFor(VEHICLES[id]) as ClosedSheet,
      frame = bodyFrame(VEHICLES[id]);
    const model = new ClosedBodyModel(frame, sheet, [
      sheet.wheels.width[0] / 2,
      sheet.wheels.width[1] / 2,
    ]);
    expect(festivalDoorPaths(model).length, id).toBe(sheet.style === 'saloon' ? 2 : 1);
    const outside = model.halfWidth(model.zFront);
    expect(festivalNoseZ(model, outside, model.zFront)).toBeLessThan(model.zFront - 0.045);
    expect(festivalNoseZ(model, outside, frame.frontAxle)).toBe(frame.frontAxle);
    expect(festivalLampPockets(model).length).toBe(sheet.bondedHeadlamps ? 2 : 0);
    for (const detail of [0, 1, 2] as const) {
      const parts = new Parts();
      addFestivalRegistration(parts, model, id, detail);
      const [mesh] = parts.build(new T.Group(), false),
        g = mesh.geometry;
      const material = mesh.material as T.MeshStandardMaterial;
      graphics.add(material.map);
      const position = g.getAttribute('position'),
        uv = g.getAttribute('uv');
      const normal = g.getAttribute('normal');
      let left = Infinity,
        right = -Infinity,
        leftUV = 0,
        rightUV = 0;
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        if (x < left) {
          left = x;
          leftUV = uv.getX(i);
        }
        if (x > right) {
          right = x;
          rightUV = uv.getX(i);
        }
        expect(normal.getZ(i)).toBeLessThan(-0.999);
      }
      expect(leftUV).toBeGreaterThan(rightUV);
      if (detail === 0) {
        const texture = material.map as T.DataTexture;
        const bytes = texture.image.data!;
        const ox = Math.floor(rightUV * 256) - 1,
          oy =
            Math.floor(Math.min(...Array.from({ length: uv.count }, (_, i) => uv.getY(i))) * 256) -
            1;
        const ink = [];
        for (let y = 3; y < 29; y++)
          for (let x = 20; x < 125; x++) {
            const p = ((oy + y) * 256 + ox + x) * 4;
            if (bytes[p] === 0x26 && bytes[p + 1] === 0x35) ink.push(y * 128 + x);
          }
        expect(ink.length).toBeGreaterThan(200);
        plates.add(ink.join(','));
      }
      g.dispose();
    }
  }
  expect(graphics.size).toBe(1);
  expect(plates.size).toBe(10);
});
