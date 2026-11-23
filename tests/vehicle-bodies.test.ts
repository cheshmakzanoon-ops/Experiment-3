import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  F,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
  HEADER,
  CAR_STRIDE,
  H,
} from '../src/simulation/protocol.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { BODY_SHEETS, bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { buildVehicleBody, VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
import { loftRings, sampleProfile, Track } from '../src/rendering/vehicle-bodies/loft.ts';

const triangles = (root: T.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const g = o.geometry as T.BufferGeometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
};
const finite = (root: T.Object3D) => {
  let ok = true;
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const p = (o.geometry as T.BufferGeometry).getAttribute('position').array as ArrayLike<number>;
    for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) ok = false;
  });
  return ok;
};
const BINS = 24;
/** Side outline (top height per station along the car) and plan half width
 * per station of a built body, wheels included. */
function silhouette(root: T.Object3D) {
  root.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(root),
    top = new Array<number>(BINS).fill(0),
    side = new Array<number>(BINS).fill(0),
    v = new T.Vector3();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const p = (o.geometry as T.BufferGeometry).getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const b = Math.min(
        BINS - 1,
        Math.floor(((v.z - box.min.z) / (box.max.z - box.min.z)) * BINS),
      );
      top[b] = Math.max(top[b], v.y - box.min.y);
      side[b] = Math.max(side[b], Math.abs(v.x));
    }
  });
  return { top, side, length: box.max.z - box.min.z };
}
describe('WP30 procedural vehicle bodies', () => {
  it('gives every four-wheel machine its own sheet and a distinct silhouette', () => {
    const shapes: { id: string; s: ReturnType<typeof silhouette> }[] = [];
    for (const def of Object.values(VEHICLES)) {
      if (def.id === 'apx01' || def.dynamicsKind !== 'four-wheel') continue;
      expect(Object.hasOwn(BODY_SHEETS, def.id), `${def.id} has no body sheet`).toBe(true);
      const body = buildVehicleBody(1, def, bodySheetFor(def)!);
      shapes.push({ id: def.id, s: silhouette(body.lods[0].group) });
    }
    // RMS difference of the outlines plus half the length difference (m).
    // The closest pair of the first catalogue (TC-1/TC-2) measures 0.088.
    let closest = Infinity,
      pair = '';
    for (let i = 0; i < shapes.length; i++)
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i].s,
          b = shapes[j].s;
        let sum = 0;
        for (let k = 0; k < BINS; k++)
          sum += (a.top[k] - b.top[k]) ** 2 + (a.side[k] - b.side[k]) ** 2;
        const d = Math.sqrt(sum / (2 * BINS) + (a.length - b.length) ** 2 / 4);
        if (d < closest) [closest, pair] = [d, `${shapes[i].id}/${shapes[j].id}`];
      }
    expect(closest, pair).toBeGreaterThan(0.075);
  });
  it('lofts smooth, outward-facing surfaces with monotone tracks', () => {
    const track = new Track([
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ]);
    // Monotone: never overshoots the plateau.
    for (let x = 0; x <= 3; x += 0.05) expect(track.at(x)).toBeLessThanOrEqual(1 + 1e-12);
    const ellipse = sampleProfile(
      [
        [0, -1],
        [0.7, -0.7],
        [1, 0],
        [0.7, 0.7],
        [0, 1],
      ],
      [4, 4, 4, 4],
    );
    expect(ellipse).toHaveLength(17);
    const g = loftRings(
      [-1, 0, 1].map((z) => ({
        z,
        half: ellipse.map(([x, y]) => [x * (1.2 - z * z * 0.2), y] as const),
      })),
      { capStart: true, capEnd: true },
    );
    const p = g.getAttribute('position'),
      n = g.getAttribute('normal');
    let outward = 0;
    for (let i = 0; i < p.count; i++)
      if (p.getX(i) * n.getX(i) + p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i) * 0.2 > 0)
        outward++;
    expect(outward / p.count).toBeGreaterThan(0.95);
  });
  it('builds every catalogue body with three LODs, a shadow proxy and matching wheels', () => {
    for (const def of Object.values(VEHICLES)) {
      const sheet = bodySheetFor(def);
      // The Formula car has its own assets; motorcycles their bike shells.
      if (def.id === 'apx01' || def.dynamicsKind !== 'four-wheel') {
        expect(sheet).toBeNull();
        continue;
      }
      expect(sheet, def.id).not.toBeNull();
      const body = buildVehicleBody(3, def, sheet!);
      expect(body.lods).toHaveLength(3);
      const counts = body.lods.map((l) => triangles(l.group));
      // Strictly cheaper representations, within the §18.3 hypotheses.
      expect(counts[0], def.id).toBeGreaterThan(counts[1]);
      expect(counts[1], def.id).toBeGreaterThan(counts[2]);
      expect(counts[0], def.id).toBeLessThan(160000);
      expect(counts[2], def.id).toBeLessThan(12000);
      expect(triangles(body.proxy), def.id).toBeLessThan(15000);
      expect(body.proxy.castShadow && !body.proxy.visible).toBe(true);
      expect(finite(body.root), def.id).toBe(true);
      // Wheels sit on the definition's centres with its radius.
      for (const wheels of body.wheels)
        wheels.forEach((w, i) => {
          expect(w.pivot.position.x).toBeCloseTo(def.wheelPositions[i][0], 6);
          expect(w.pivot.position.z).toBeCloseTo(def.wheelPositions[i][2], 6);
          expect(w.radius).toBe(def.spec.wheelRadius);
        });
      // The near body fits the collision box (overhangs within 0.35 m).
      const box = new T.Box3().setFromObject(body.lods[0].group);
      expect(box.max.z, def.id).toBeLessThan(def.halfExtents[2] + 0.45);
      expect(box.min.z, def.id).toBeGreaterThan(-def.halfExtents[2] - 0.45);
      expect(box.max.x - box.min.x, def.id).toBeLessThan(def.halfExtents[0] * 2 + 0.45);
    }
  });
  it('updates only the correctly sized shadow tyres when their physical pose changes', () => {
    const definition = VEHICLES.eh3;
    const sheet = bodySheetFor(definition)!;
    const bodies = new VehicleBodies();
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[H.CARS] = 1;
    const o = carBase(0);
    frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('eh3');
    const hosts = [{ root: new T.Group(), lodLevel: 0 }];
    const update = () => bodies.update(frame, frame, 1, hosts);
    update();
    const mesh = bodies.shadowSubstitutes()[0].coarse as T.Mesh;
    const p = mesh.geometry.getAttribute('position') as T.BufferAttribute;
    const [{ start, count }] = p.updateRanges;
    expect(start).toBeGreaterThan(count);
    expect(start + count).toBe(p.array.length);
    const perTyre = count / 4;
    const initial = Float32Array.from(p.array);
    for (let wheel = 0; wheel < 4; wheel++) {
      const xs = [];
      for (let i = start + wheel * perTyre; i < start + (wheel + 1) * perTyre; i += 3)
        xs.push(initial[i]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(
        sheet.wheels.width[wheel < 2 ? 0 : 1],
        5,
      );
    }
    p.clearUpdateRanges();
    const firstVersion = p.version;
    frame[o + WHEEL_BASE + W.ROTATION] = 1.5;
    update();
    expect(p.version).toBe(firstVersion);
    expect(p.updateRanges).toHaveLength(0);
    frame[o + WHEEL_BASE + W.LENGTH] = 0.18;
    update();
    expect(p.version).toBe(firstVersion + 1);
    frame[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.CAMBER] = 0.05;
    update(); // A culled pass can leave the preceding range pending.
    expect(p.updateRanges).toEqual([{ start, count }]);
    expect(p.array.slice(0, start)).toEqual(initial.slice(0, start));
    expect(p.array.slice(start, start + perTyre)).not.toEqual(
      initial.slice(start, start + perTyre),
    );
    expect(p.array.slice(start + perTyre, start + 2 * perTyre)).toEqual(
      initial.slice(start + perTyre, start + 2 * perTyre),
    );
    bodies.clear();
  });
  it('follows the snapshot: definition, wheel travel, steer, phase, lamps and damage', () => {
    const bodies = new VehicleBodies();
    const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
    frame[H.CARS] = 2;
    frame[H.TIME] = 1;
    frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
    frame[carBase(1) + RACE_BASE + R.VEHICLE] = vehicleIndex('gt10m');
    const o = carBase(1);
    frame[o + F.FRONT_HEALTH] = 1;
    frame[o + F.REAR_HEALTH] = 0.02;
    frame[o + F.BRAKE] = 1;
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
      frame[p + W.LENGTH] = 0.2;
      frame[p + W.STEER] = i < 2 ? 0.1 : 0;
      frame[p + W.ROTATION] = 1.25;
      frame[p + W.LOAD] = 3000;
      frame[p + W.PRESSURE] = 155;
      frame[p + W.DISC_TEMP] = 800;
    }
    const hosts = [0, 1].map(() => ({ root: new T.Group(), lodLevel: 0 }));
    hosts[1].root.position.set(5, 1, 2);
    bodies.update(frame, frame, 1, hosts);
    expect(bodies.count).toBe(1);
    expect(hosts[0].root.visible).toBe(true);
    expect(hosts[1].root.visible).toBe(false);
    const built = (
      bodies as unknown as { bodies: Map<number, ReturnType<typeof buildVehicleBody>> }
    ).bodies.get(1)!;
    expect(built.root.position.toArray()).toEqual([5, 1, 2]);
    const gt = VEHICLES.gt10m;
    const wheel = built.wheels[0][0];
    expect(wheel.pivot.position.y).toBeCloseTo(gt.wheelPositions[0][1] - 0.2, 6);
    expect(wheel.pivot.rotation.y).toBeCloseTo(0.1, 6);
    expect(wheel.spin.rotation.x).toBeCloseTo(1.25, 6);
    expect(wheel.disc!.emissiveIntensity).toBeGreaterThan(0.5);
    expect(built.materials.tail.emissiveIntensity).toBeGreaterThan(2);
    // Rear wing hidden by recorded rear damage; LOD switch follows the host.
    expect(built.lods[0].rear.every((e) => !e.visible)).toBe(true);
    hosts[1].lodLevel = 2;
    bodies.update(frame, frame, 1, hosts);
    expect(built.lods.map((l) => l.group.visible)).toEqual([false, false, true]);
    expect(bodies.shadowSubstitutes()).toHaveLength(1);
  });
});

it('moves the Formula upper plane and the same shadow vertices in a cold mirror LOD and on replay seek', () => {
  const bodies = new VehicleBodies();
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.CARS] = 1;
  frame[o + F.FRONT_HEALTH] = frame[o + F.REAR_HEALTH] = 1;
  const hosts = [{ root: new T.Group(), lodLevel: 0 }];
  for (const id of ['fx26', 'fr3', 'jf2']) {
    frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
    frame[o + F.REAR_HEALTH] = 1;
    frame[o + RACE_BASE + R.DRS_FLAP] = 0;
    bodies.update(frame, frame, 1, hosts);
    const built = (
      bodies as unknown as { bodies: Map<number, ReturnType<typeof buildVehicleBody>> }
    ).bodies.get(0)!;
    const positions = built.proxy.geometry.getAttribute('position');
    const initial = Array.from(positions.array);
    const pivots = built.lods.map((lod) => lod.flap!.position.clone());
    frame[o + RACE_BASE + R.DRS_FLAP] = 1;
    bodies.update(frame, frame, 1, hosts);
    bodies.showFeedDetail(() => 2);
    built.lods.forEach((lod, i) => {
      expect(lod.flap!.rotation.x).toBeCloseTo(-0.4);
      expect(lod.flap!.position.distanceTo(pivots[i])).toBe(0);
      expect(lod.rear[0].children).toContain(lod.flap);
    });
    const moved: number[] = [];
    for (let v = 0; v < positions.count; v++)
      if (Math.abs(positions.getY(v) - initial[v * 3 + 1]) > 1e-5) moved.push(v);
    expect(moved.length).toBeGreaterThan(16);
    expect(Math.max(...moved) - Math.min(...moved)).toBeLessThan(400);
    bodies.restoreFeedDetail();
    frame[o + RACE_BASE + R.DRS_FLAP] = 0;
    bodies.update(frame, frame, 1, hosts);
    moved.forEach((v) => expect(positions.getY(v)).toBeCloseTo(initial[v * 3 + 1], 6));
    frame[o + F.REAR_HEALTH] = 0;
    bodies.update(frame, frame, 1, hosts);
    expect(built.lods.every((lod) => lod.rear.every((part) => !part.visible))).toBe(true);
    expect(bodies.shadowSubstitutes()).toHaveLength(0);
  }
  bodies.clear();
});

it('fits wet compounds and per-wheel damage to every Formula feed level and reads a pit swap backwards', () => {
  const bodies = new VehicleBodies();
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  const hosts = [{ root: new T.Group(), lodLevel: 0 }];
  frame[H.CARS] = 1;
  frame[H.AMBIENT] = 18;
  frame[H.RAIN] = 20;
  frame[o + F.SPEED] = 38;
  frame[o + F.COMPOUND] = 4;
  for (const model of ['jf2', 'fr3', 'fx26']) {
    frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(model);
    for (let i = 0; i < 4; i++) {
      const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
      frame[w + W.ROTATION] = (i + 1) * 0.32;
      frame[w + W.FLAT] = (0.45 * i) / 3;
      frame[w + W.GRAINING] = 0.1 * (i + 1);
      frame[w + W.BLISTERING] = 0.2 * (3 - i);
      frame[w + W.SURFACE_TEMP] = 101;
    }
    bodies.update(frame, frame, 1, hosts);
    const built = (
      bodies as unknown as { bodies: Map<number, ReturnType<typeof buildVehicleBody>> }
    ).bodies.get(0)!;
    for (const [i, state] of built.formulaTyres!.entries()) {
      expect(state.surface.value.toArray().slice(0, 2)).toEqual([1, 2]);
      expect(state.heat.value).toBe(1);
      expect(state.flat.value).toBeCloseTo((0.45 * i) / 3);
      expect(state.condition.value.w).toBeCloseTo(0.1 * (i + 1));
      expect(state.roll.value.x).toBeCloseTo(Math.cos((i + 1) * 0.32));
      for (const wheels of built.wheels) {
        const shader = {
          vertexShader: T.ShaderLib.standard.vertexShader,
          fragmentShader: T.ShaderLib.standard.fragmentShader,
          uniforms: {},
        } as T.WebGLProgramParametersWithUniforms;
        (wheels[i].tyre.material as T.Material).onBeforeCompile(shader, {} as T.WebGLRenderer);
        expect(shader.uniforms.treadFlat).toBe(state.flat);
        expect(shader.uniforms.treadRoll).toBe(state.roll);
        expect(shader.vertexShader).toContain('recordedTirePosition');
        expect(shader.fragmentShader).toContain('tireWearRelief');
      }
    }
    const dry = frame.slice();
    dry[H.RAIN] = 0;
    dry[o + F.COMPOUND] = 1;
    bodies.update(dry, dry, 1, hosts);
    bodies.showFeedDetail(() => 2);
    expect(built.formulaTyres![2].surface.value.y).toBe(0);
    bodies.restoreFeedDetail();
    bodies.update(frame, frame, 1, hosts);
    expect(built.formulaTyres![2].surface.value.y).toBe(2);
  }
  bodies.clear();
});
