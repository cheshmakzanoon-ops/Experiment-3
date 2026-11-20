import * as T from 'three';
import { describe, expect, it, vi } from 'vitest';
import { FestivalHeadlamps } from '../src/rendering/open-world/festival-headlamps.ts';
import { bodyFrame } from '../src/rendering/vehicle-bodies/frame.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { ClosedBodyModel } from '../src/rendering/vehicle-bodies/closed-body.ts';
import { festivalFaceLamps } from '../src/rendering/vehicle-bodies/festival-face-lamps.ts';
import {
  festivalLampPockets,
  festivalNoseZ,
} from '../src/rendering/vehicle-bodies/festival-nose.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

describe('followed festival car road illumination', () => {
  it('projects from both physical housings and dips both beams with the posed car', () => {
    const rig = new FestivalHeadlamps(),
      holder = new T.Object3D();
    holder.position.set(123, 45, -678);
    holder.rotation.set(0.18, -1.4, 0.13);
    for (const id of ['rh3', 'eh3', 'sc7', 'rp6', 'rg63', 'rm8', 'rs5', 'rr4', 'lx12', 'rd2']) {
      const def = VEHICLES[id],
        sheet = bodySheetFor(def) as ClosedSheet,
        f = bodyFrame(def);
      const model = new ClosedBodyModel(f, sheet, [
        sheet.wheels.width[0] / 2,
        sheet.wheels.width[1] / 2,
      ]);
      const conventional = festivalFaceLamps(model),
        bonded = festivalLampPockets(model);
      rig.update(holder, def, 0.8);
      rig.root.updateMatrixWorld(true);
      const lights = rig.root.children.filter((o): o is T.SpotLight => o instanceof T.SpotLight);
      expect(lights).toHaveLength(2);
      lights.forEach((light, i) => {
        const source = conventional.length
          ? new T.Vector3(conventional[i].x, conventional[i].y, model.zFront)
          : new T.Vector3().setFromMatrixPosition(bonded[i].base);
        source.z = festivalNoseZ(model, source.x, source.z);
        expect(light.position.distanceTo(source), id).toBeLessThan(0.016);
        expect(light.target.position.y).toBeCloseTo(f.ground, 8);
        expect(light.target.position.z - light.position.z).toBeCloseTo(30, 1);
        const world = new T.Vector3().setFromMatrixPosition(light.matrixWorld);
        expect(
          world.distanceTo(source.applyQuaternion(holder.quaternion).add(holder.position)),
          id,
        ).toBeLessThan(0.016);
        expect(light.intensity).toBe(56);
        expect(light.castShadow).toBe(false);
      });
      expect(lights[0].map).toBe(lights[1].map);
    }
    const light = rig.root.children[0] as T.SpotLight;
    const mask = light.map as T.DataTexture;
    const { data, width } = mask.image;
    const value = (x: number, y: number) =>
      data[(Math.floor(y * width) * width + Math.floor(x * width)) * 4];
    expect(value(0.5, 0.43)).toBeGreaterThan(220);
    expect(value(0.5, 0.6)).toBe(0);
    expect(value(0.1, 0.43)).toBeLessThan(value(0.5, 0.43));
    rig.update(holder, VEHICLES.rh3, 0);
    expect(rig.root.visible).toBe(false);
    rig.update(null, VEHICLES.rh3, 1);
    expect(rig.root.visible).toBe(false);
    const dispose = vi.spyOn(mask, 'dispose');
    rig.clear();
    expect(dispose).not.toHaveBeenCalled();
    rig.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
