import { VEHICLE_IDS } from '../src/simulation/vehicles.ts';
import * as T from 'three';
import { G } from '../src/core/math.ts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { B, BC, BIKE_BASE, CAR_STRIDE, F, H, R, RACE_BASE, ROAD_BIKE_CONTACT,
  WHEEL_CONTACT_BASE, wheelContactBase } from '../src/simulation/protocol.ts';
import { GP_BOOT_PEDAL } from '../src/rendering/gp-rider-contact.ts';
import {
  GpRiderPosture,
  gpBodyTargets,
  gpClearJoint,
  gpRoadClearance,
  type GpRiderBodyState,
} from '../src/rendering/gp-rider-posture.ts';
import { GpRiderBody, GP_RIDER_BODY_MAX_GAP } from '../src/rendering/gp-rider-dynamics.ts';
import {
  GP_HELMET_CENTRE,
  addGpHelmetDetails,
  gpHelmetShell,
  gpHelmetSpoiler,
  gpHelmetVent,
  gpHelmetV,
  gpVisorGeometry,
} from '../src/rendering/gp-rider-helmet.ts';
import { Rider, type RiderPose } from '../src/rendering/rider.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'createLinearGradient' || key === 'createRadialGradient'
          ? () => ({ addColorStop: () => undefined })
          : key === 'measureText'
            ? () => ({ width: 10 })
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

const colours = { primary: 0xc12437, secondary: 0x18212a, accent: 0xf2e9d7 };
const riding: RiderPose = { lean: 0, offset: 0, tuck: 0, braking: 0, steer: 0, speed: 40 };

function helmetCentre(rider: Rider) {
  rider.root.updateMatrixWorld(true);
  return rider.root
    .getObjectByName('Rider head and helmet')!
    .localToWorld(new T.Vector3(...GP_HELMET_CENTRE));
}

/** Every rendered vertex of the rider, rigid or skinned, in the rider frame. */
function minimumClearance(rider: Rider, lean: number) {
  rider.root.updateMatrixWorld(true);
  const inverse = rider.root.matrixWorld.clone().invert(),
    point = new T.Vector3();
  let minimum = Infinity;
  rider.root.traverse((object) => {
    if (!(object instanceof T.Mesh) || !object.visible) return;
    if ((object.material as T.Material).colorWrite === false) return;
    const position = object.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      if (object instanceof T.SkinnedMesh) object.getVertexPosition(i, point);
      else point.fromBufferAttribute(position, i);
      point.applyMatrix4(object.matrixWorld).applyMatrix4(inverse);
      minimum = Math.min(minimum, gpRoadClearance(point, lean, 0.62, 0.08));
    }
  });
  return minimum;
}

describe('GP riding posture', () => {
  it('crouches at speed, tucks lower, sits up under braking and loads the tank on exit', () => {
    const rider = new Rider(colours, 'mid', 'leathers', 2, true),
      posture = new GpRiderPosture();
    try {
      const heights: Record<string, number> = {};
      for (const [name, pose] of [
        ['rolling', { ...riding, speed: 2.5 }],
        ['crouch', riding],
        ['tuck', { ...riding, tuck: 1, speed: 80 }],
        ['braking', { ...riding, braking: 1, speed: 60, gLong: -1.4 }],
      ] as const) {
        rider.ride(pose);
        heights[name] = helmetCentre(rider).y;
      }
      // REF_018/055: the tucked helmet drops behind the screen; REF_089: it
      // rises out of the bubble under braking; a crawl sits up the most.
      expect(heights.tuck).toBeLessThan(heights.crouch - 0.05);
      expect(heights.braking).toBeGreaterThan(heights.crouch + 0.08);
      expect(heights.rolling).toBeGreaterThan(heights.crouch + 0.05);
      // The tucked helmet crown stays near the R6 screen crown (y 0.505).
      expect(heights.tuck + 0.146).toBeLessThan(0.64);
      const seat = rider.seat;
      const exit = posture.solve({ ...riding, throttle: 1, gLong: 0.8, lean: 0.5 }, seat).pelvis.z;
      expect(exit).toBeGreaterThan(posture.solve({ ...riding, lean: 0.5 }, seat).pelvis.z + 0.02);
      const braking = posture.solve({ ...riding, braking: 1, speed: 60 }, seat);
      expect(braking.sitUp).toBeGreaterThan(0.9);
      expect(braking.chestAngles.x).toBeLessThan(
        posture.solve({ ...riding, tuck: 1, speed: 80 }, seat).chestAngles.x - 0.35,
      );
    } finally {
      rider.dispose();
    }
  });

  it('prepositions the hips through shallow steering corrections and opens the knee as the bike banks', () => {
    const pose = new GpRiderPosture(),
      seat = new T.Vector3();
    for (const sign of [-1, 1]) {
      const inside = sign === 1 ? 0 : 1;
      pose.solve({ ...riding, offset: sign * 0.115, lean: sign * 0.136 }, seat);
      const shallow = Math.abs(pose.kneePoles[inside].x);
      expect(pose.pelvis.x * sign).toBeGreaterThan(0.05);
      expect(pose.inside[inside]).toBeLessThan(0.16);
      pose.solve({ ...riding, offset: sign * 0.115, lean: sign * 0.8 }, seat);
      expect(Math.abs(pose.kneePoles[inside].x)).toBeGreaterThan(shallow + 0.26);
      expect(pose.inside[1 - inside]).toBe(0);
    }
  });

  it('hangs the hips inside and skims, never penetrates, the leaned road with knee and elbow', () => {
    for (const detail of ['high', 'mid', 'far'] as const) {
      const rider = new Rider(colours, detail, 'leathers', 2, true);
      try {
        for (const lean of [-1.15, -1, -0.6, 0, 0.6, 1, 1.15]) {
          const pose = {
            ...riding,
            lean,
            offset: Math.sign(lean) * Math.min(0.28, Math.abs(lean) * 0.3),
          };
          rider.ride(pose);
          const torso = rider.root.getObjectByName('Rider torso')!;
          if (lean) expect(torso.position.x * Math.sign(lean)).toBeGreaterThan(0.08);
          expect(minimumClearance(rider, lean)).toBeGreaterThan(-0.004);
          if (Math.abs(lean) >= 1) {
            // REF_003/030/056: at full lean the inside knee slider touches.
            const side = lean > 0 ? 'left' : 'right',
              shin = rider.root.getObjectByName(`GP ${side} shin`)!,
              knee = shin.getWorldPosition(new T.Vector3());
            expect(gpRoadClearance(knee, lean, 0.62, 0.08)).toBeLessThan(0.075);
          }
        }
      } finally {
        rider.dispose();
      }
    }
  });

  it('folds a limb about its own axis without changing bone lengths', () => {
    const root = new T.Vector3(0.3, 0.25, -0.33),
      end = new T.Vector3(0.2, -0.15, -0.36),
      joint = new T.Vector3(0.62, 0.0, -0.1),
      pole = new T.Vector3(1.0, -0.3, 0.2),
      lengths = [root.distanceTo(joint), joint.distanceTo(end)];
    expect(gpClearJoint(root, end, joint, pole, 1.0, 0.62, 0.08, 0.07)).toBe(true);
    expect(gpRoadClearance(joint, 1.0, 0.62, 0.08)).toBeCloseTo(0.07, 9);
    expect(root.distanceTo(joint)).toBeCloseTo(lengths[0], 9);
    expect(joint.distanceTo(end)).toBeCloseTo(lengths[1], 9);
    expect(gpClearJoint(root, end, joint, pole, 1.0, 0.62, 0.08, 0.07)).toBe(false);
  });

  it('plants both boots on the road at a standstill and lifts them back onto the pegs', () => {
    const rider = new Rider(colours, 'high', 'leathers', 2, true);
    try {
      for (const speed of [0, 0.3]) {
        rider.ride({ ...riding, speed, braking: 0.3 });
        rider.root.updateMatrixWorld(true);
        for (const side of ['left', 'right']) {
          const toe = rider.root
            .getObjectByName(`GP ${side} foot`)!
            .localToWorld(new T.Vector3(...GP_BOOT_PEDAL));
          expect(Math.abs(gpRoadClearance(toe, 0, 0.62, 0.08))).toBeLessThan(0.01);
          expect(Math.abs(toe.x)).toBeGreaterThan(0.25);
        }
      }
      rider.ride({ ...riding, speed: 3 });
      rider.root.updateMatrixWorld(true);
      const toe = rider.root
        .getObjectByName('GP left foot')!
        .localToWorld(new T.Vector3(...GP_BOOT_PEDAL));
      expect(gpRoadClearance(toe, 0, 0.62, 0.08)).toBeGreaterThan(0.3);
    } finally {
      rider.dispose();
    }
  });
});

function frame(
  time: number,
  values: Partial<Record<'brake' | 'speed' | 'gLong' | 'offset' | 'leanRate', number>>,
) {
  const f = new Float32Array(BIKE_BASE + 40 + 64);
  const car = 64;
  f[H.TIME] = time;
  f[car + F.BRAKE] = values.brake ?? 0;
  f[car + F.SPEED] = values.speed ?? 40;
  f[car + F.G_LONG] = values.gLong ?? 0;
  f[car + BIKE_BASE + B.RIDER_OFFSET] = values.offset ?? 0;
  f[car + BIKE_BASE + B.LEAN_RATE] = values.leanRate ?? 0;
  return f;
}
const CAR = 64;

describe('GP spring-damped rider body', () => {
  /** A 120 Hz snapshot sequence with a hard braking step at 0.5 s. */
  const sequence = Array.from({ length: 240 }, (_, i) => {
    const time = i / 120,
      braking = time >= 0.5 ? 1 : 0;
    return frame(time, {
      brake: braking,
      gLong: braking ? -1.4 : 0.1,
      speed: 60 - braking * (time - 0.5) * 12,
    });
  });
  const play = (presentations: number) => {
    const body = new GpRiderBody(),
      atSnapshots: GpRiderBodyState[] = [];
    for (let i = 1; i < sequence.length; i++) {
      for (let k = 1; k <= presentations; k++)
        body.sample(sequence[i - 1], sequence[i], k / presentations, CAR);
      atSnapshots.push({ ...body.sample(sequence[i - 1], sequence[i], 1, CAR) });
    }
    return { body, atSnapshots };
  };

  it('depends only on the snapshot sequence, not on render rate or held frames', () => {
    const once = play(1).atSnapshots,
      many = play(5).atSnapshots;
    expect(many).toEqual(once);
    const body = new GpRiderBody();
    body.sample(sequence[0], sequence[1], 1, CAR);
    const held = { ...body.sample(sequence[1], sequence[2], 0.4, CAR) };
    for (let i = 0; i < 10; i++)
      expect(body.sample(sequence[1], sequence[2], 0.4, CAR)).toEqual(held);
  });

  it('absorbs marked wheel loads, keeps boots on the pegs in flight and restores the held state', () => {
    function sample(time: number, load: number) {
      const f = new Float32Array(CAR + CAR_STRIDE);
      f[H.TIME] = time;
      f[CAR + RACE_BASE + R.VEHICLE] = VEHICLE_IDS.indexOf('gpr1');
      f[CAR + WHEEL_CONTACT_BASE] = ROAD_BIKE_CONTACT;
      f[CAR + F.G_VERT] = load;
      f[CAR + F.SPEED] = 38;
      for (const index of [0, 2]) {
        const axle = wheelContactBase(CAR, index);
        f[axle + BC.NORMAL_Y] = 1;
        f[axle + BC.LOAD] = load * 1100;
      }
      return f;
    }
    const body = new GpRiderBody();
    const cruising = sample(0, 1), landing = sample(0.08, 2.2), crest = sample(0.16, 0);
    expect(body.sample(cruising, cruising, 1, CAR).compression).toBe(0);
    const loaded = { ...body.sample(cruising, landing, 1, CAR) };
    expect(loaded.compression).toBeGreaterThan(0.006);
    expect(loaded.compression).toBeLessThan(0.039);
    expect(body.sample(cruising, landing, 1, CAR)).toEqual(loaded);
    body.sample(landing, crest, 1, CAR);
    // Let the existing downward velocity rebound while the wheels unload.
    const flight = sample(0.31, 0);
    expect(body.sample(crest, flight, 1, CAR).compression).toBeLessThan(-0.009);
    // Measured free flight has an independently reconstructible age. Test a
    // launch and descent on a bank with road-tangent speed, and one wheel
    // higher than the last wheel off the pavement.
    const ny = 0.96, nx = 0.28, launch = 2.1;
    for (const age of [0.03, 0.12, 0.32]) {
      const at = sample(0.31 + age, 0), vn = launch - G * ny * age;
      const clearance = launch * age - 0.5 * G * ny * age ** 2;
      for (const index of [0, 2]) {
        const axle = wheelContactBase(CAR, index);
        at[axle + BC.NORMAL_X] = nx;
        at[axle + BC.NORMAL_Y] = ny;
        at[axle + BC.GAP] = clearance / ny + (index === 0 ? 0.08 : 0);
      }
      at[CAR + F.VX] = vn * nx + 12 * ny;
      at[CAR + F.VY] = vn * ny - 12 * nx;
      const live = body.sample(at, at, 1, CAR).compression;
      expect(live).toBeCloseTo(-0.018 * (1 - (1 + 23 * age) * Math.exp(-23 * age)), 6);
      expect(new GpRiderBody().sample(at, at, 1, CAR).compression).toBeCloseTo(live, 10);
    }
    expect(body.sample(cruising, cruising, 1, CAR).compression).toBe(0);
    crest[CAR + F.SPEED] = 0;
    expect(new GpRiderBody().sample(crest, crest, 1, CAR).plant).toBe(0);
    const legacy = crest.slice();
    legacy[CAR + WHEEL_CONTACT_BASE] = 0;
    expect(new GpRiderBody().sample(legacy, legacy, 1, CAR).compression).toBe(0);
  });

  it('gives the body mass: the chest lunges and rebounds, then settles on its target', () => {
    const states = play(1).atSnapshots,
      onset = 59, // index of the 0.5 s snapshot
      target = gpBodyTargets(
        { ...riding, braking: 1, gLong: -1.4, speed: 50 },
        {
          compression: 0,
          sitUp: 0,
          surge: 0,
          sway: 0,
          plant: 0,
        },
      );
    // Lagged response: not at the target on the first braking snapshot.
    expect(states[onset].sitUp).toBeLessThan(0.3);
    expect(states[onset + 30].sitUp).toBeGreaterThan(0.85);
    const surge = states.slice(onset).map((s) => s.surge),
      peak = Math.max(...surge);
    expect(peak).toBeGreaterThan(target.surge * 1.1);
    expect(surge[surge.length - 1]).toBeCloseTo(target.surge, 2);
  });

  it('restarts at equilibrium after a seek, rewind or long gap, and outside riding', () => {
    const { body } = play(1),
      resets = body.resets;
    const seek = frame(30, { brake: 1, gLong: -1.4, speed: 50 });
    const state = { ...body.sample(seek, seek, 1, CAR) };
    expect(body.resets).toBe(resets + 1);
    expect(state.sitUp).toBeCloseTo(
      gpBodyTargets({ ...riding, braking: 1, speed: 50 }, { ...state }).sitUp,
      9,
    );
    const rewind = frame(29, {});
    body.sample(rewind, rewind, 1, CAR);
    expect(body.resets).toBe(resets + 2);
    const gap = frame(29 + GP_RIDER_BODY_MAX_GAP + 0.01, {});
    body.sample(rewind, gap, 1, CAR);
    expect(body.resets).toBe(resets + 3);
    const stopped = body.sample(gap, gap, 1, CAR, false);
    expect(stopped.plant).toBe(0);
  });
});

describe('GP race helmet', () => {
  it('is a closed, elongated race shell with a visor and rear spoiler', () => {
    for (const detail of ['high', 'mid', 'far'] as const) {
      const shell = gpHelmetShell(detail),
        box = shell.boundingBox!,
        size = box.getSize(new T.Vector3());
      expect(Array.from(shell.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      expect(Array.from(shell.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
      // About 0.31 m long, 0.24 m wide and 0.29 m tall: not a ball.
      expect(size.z).toBeGreaterThan(0.27);
      expect(size.z).toBeLessThan(0.32);
      expect(size.x).toBeLessThan(0.245);
      expect(size.z / size.x).toBeGreaterThan(1.15);
      expect(size.y).toBeGreaterThan(0.26);
      shell.dispose();
    }
    const spoiler = gpHelmetSpoiler('high'),
      visor = gpVisorGeometry('high');
    const surface = spoiler.getAttribute('position'),
      ink = spoiler.getAttribute('uv');
    for (let i = 0; i < surface.count; i++) {
      expect(ink.getX(i)).toBeGreaterThan(0.65);
      expect(ink.getX(i)).toBeLessThan(0.85);
      expect(ink.getY(i)).toBeCloseTo(gpHelmetV(surface.getY(i) - GP_HELMET_CENTRE[1]), 5);
    }
    const duct = gpHelmetVent(0.026, 0.04, 0.0055),
      material = new T.MeshBasicMaterial(),
      mouth = new T.Mesh(duct, material),
      ray = new T.Raycaster(new T.Vector3(0, 0.02, 0), new T.Vector3(0, -1, 0));
    expect(ray.intersectObject(mouth)).toHaveLength(0);
    ray.ray.origin.x = 0.0105;
    expect(ray.intersectObject(mouth).length).toBeGreaterThan(0);
    duct.dispose();
    material.dispose();
    expect(spoiler.boundingBox!.max.z).toBeLessThan(-0.03);
    expect(visor.boundingBox!.min.z).toBeGreaterThan(0.02);
    spoiler.dispose();
    visor.dispose();
  });
});

it('opens every mounted GP helmet duct to the outside, with a visible liner behind its lip', () => {
  const material = new T.MeshBasicMaterial(), head = new T.Group();
  const shell = new T.Mesh(gpHelmetShell('high'), material);
  head.add(shell);
  addGpHelmetDetails(head, 'high', {
    shell: material, visor: material, liner: material, trim: material,
  });
  head.updateMatrixWorld(true);
  const centre = new T.Vector3(...GP_HELMET_CENTRE);
  const vents = head.children.filter((piece) =>
    ['GP crown intake', 'GP chin vent', 'GP rear exhaust'].includes(piece.name),
  );
  expect(vents).toHaveLength(5);
  try {
    for (const vent of vents) {
      const normal = new T.Vector3(0, 1, 0).applyQuaternion(vent.quaternion);
      const outward = vent.position.clone().sub(centre).normalize();
      expect(normal.dot(outward), vent.name).toBeGreaterThan(0.55);
      const duct = head.children.find((piece) =>
        piece.name === vent.name + ' duct' && piece.position.equals(vent.position),
      )!;
      const ray = new T.Raycaster(vent.position.clone().addScaledVector(normal, 0.035), normal.clone().negate());
      const first = ray.intersectObjects([shell, vent, duct], false)[0];
      expect(first?.object, vent.name + ' backing').toBe(duct);
      const rim = vent as T.Mesh<T.BufferGeometry>;
      rim.geometry.computeBoundingBox();
      const edge = new T.Vector3(rim.geometry.boundingBox!.max.x * 0.84, 0.035, 0);
      ray.ray.origin.copy(vent.localToWorld(edge));
      expect(ray.intersectObjects([shell, vent, duct], false)[0]?.object, vent.name + ' rim').toBe(vent);
    }
  } finally {
    head.traverse((o) => { if (o instanceof T.Mesh) o.geometry.dispose(); });
    material.dispose();
  }
});
