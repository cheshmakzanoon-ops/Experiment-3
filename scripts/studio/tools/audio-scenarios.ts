import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../../src/simulation/protocol.ts';
import { VEHICLE_IDS, vehicleDefinition, vehicleIndex } from '../../../src/simulation/vehicles.ts';
import { engineCharacter, soundFamilyFor } from '../../../src/audio/sound-profiles.ts';
import type { AudioView } from '../../../src/audio/spatial.ts';
import { MATERIAL } from '../../../src/simulation/surface-material.ts';

/** Surfaces rendered for rolling noise (SURFACE and MATERIAL share ids 0..5). */
export const SURFACES: Record<string, number> = {
  ASPHALT: MATERIAL.ASPHALT,
  KERB: MATERIAL.KERB,
  GRASS: MATERIAL.GRASS,
  GRAVEL: MATERIAL.GRAVEL,
  DIRT: MATERIAL.DIRT,
  MUD: MATERIAL.MUD,
  SAND: MATERIAL.SAND,
  SNOW: MATERIAL.SNOW,
  ICE: MATERIAL.ICE,
};
const surfaces = SURFACES;

/** Synthetic presented snapshots for the offline audio rig (audio-render.mjs).
 * Every scenario is a pure function of time returning the same Float32Array
 * layout the physics worker publishes (protocol.ts), so the production audio
 * graph runs on it unchanged. Engine states follow the vehicle's own gear
 * ratios, torque curve and rev range; they are NOT recorded from the physics
 * simulation (that is a stated limit of the rig, see docs/studio/reports/audio.md). */

export const SAMPLE_RATE = 48000;
/** Seconds between presented frames: 12 render quanta (128 frames) = 32 ms, a
 * little slower than the game's ~25-33 ms update so the throttle in
 * RacingAudio.update never skips a step. */
export const FRAME_STEP = 1536 / SAMPLE_RATE;

export interface ViewSpec {
  mode: 'cockpit' | 'chase' | 'trackside';
  /** Listener velocity (m/s) for the wind bed (cockpit/chase: the car's own speed). */
  speed?: number;
}

export interface ScenarioMeta {
  id: string;
  group: string;
  vehicle: string | null;
  family: string | null;
  label: string;
  seconds: number;
  view: ViewSpec['mode'];
  /** Times (s) of discrete events: gear changes, impacts, landings, cues. */
  events: number[];
  /** Expected engine fundamental (Hz) every 50 ms, or null. */
  f0: number[] | null;
  /** Free-form tags the analysis keys on (stem name, surface, slip level...). */
  tags: Record<string, string | number | boolean>;
}

export interface Scenario extends ScenarioMeta {
  frameAt: (t: number) => Float32Array;
  viewAt: (t: number) => AudioView;
  /** Mixer overrides for the run (stems): bus level 0..1. */
  buses?: Partial<Record<'engine' | 'effects' | 'ambience' | 'ui' | 'music', number>>;
  /** Bypass the master dynamics for a pre-limiter measurement. */
  bypassDynamics?: boolean;
}

export function blankFrame(cars = 1): Float32Array {
  const f = new Float32Array(HEADER + CAR_STRIDE * cars);
  f[H.CARS] = cars;
  f[H.AMBIENT] = 18;
  f[H.PHASE] = 2;
  for (let i = 0; i < cars; i++) f[carBase(i) + F.QW] = 1;
  return f;
}

export function torqueAt(curve: readonly (readonly [number, number])[], rpm: number): number {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i];
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1];
      return t0 + ((t1 - t0) * (rpm - r0)) / Math.max(1e-6, r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

export interface PowerState {
  rpm: number;
  torque: number;
  speed: number;
  gear: number;
  throttle: number;
  brake: number;
}

/** The kinds of engine scenario the rig renders for every machine. */
export type EngineKind = 'idle' | 'mid' | 'redline' | 'lift' | 'shift' | 'pull';
export const ENGINE_KINDS: readonly EngineKind[] = [
  'idle',
  'mid',
  'redline',
  'lift',
  'shift',
  'pull',
];

function friction(id: string, rpm: number) {
  const e = vehicleDefinition(id).spec.engine;
  return (e?.frictionBase ?? 12) + (e?.frictionPerRad ?? 0.04) * ((rpm * Math.PI * 2) / 60);
}

/** Road speed (m/s) for an engaged gear at `rpm`. */
export function speedAt(id: string, gear: number, rpm: number): number {
  const s = vehicleDefinition(id).spec;
  const ratio = s.gearRatios[gear + 1] ?? s.gearRatios[s.gearRatios.length - 1];
  return (((rpm * Math.PI * 2) / 60) * s.wheelRadius) / (ratio * s.finalDrive);
}

/** Forward gear count (gearRatios: reverse, neutral, 1..n). */
export const forwardGears = (id: string) => vehicleDefinition(id).spec.gearRatios.length - 2;

interface Plan {
  seconds: number;
  at: (t: number) => PowerState;
  events: number[];
}

const SHIFT_DEAD_TIME = 0.14;

export function enginePlan(id: string, kind: EngineKind): Plan {
  const d = vehicleDefinition(id),
    s = d.spec,
    limiter = s.limiterRPM,
    peak = Math.max(...s.torqueCurve.map((p) => p[1]));
  const full = (rpm: number, throttle: number) => torqueAt(s.torqueCurve, rpm) * throttle;
  const lone = forwardGears(id);
  const cruiseGear = Math.max(1, Math.min(lone, Math.ceil(lone * 0.6)));
  const steady = (rpm: number, throttle: number, gear: number): PowerState => ({
    rpm,
    torque: throttle > 0.05 ? full(rpm, throttle) : -friction(id, rpm),
    speed: speedAt(id, gear, rpm),
    gear,
    throttle,
    brake: 0,
  });
  if (kind === 'idle') {
    const rpm = s.idleRPM;
    return {
      seconds: 3,
      events: [],
      at: () => ({
        rpm,
        torque: Math.min(60, peak * 0.05),
        speed: 0,
        gear: 1,
        throttle: 0,
        brake: 0,
      }),
    };
  }
  if (kind === 'mid')
    return { seconds: 3, events: [], at: () => steady(limiter * 0.62, 0.6, cruiseGear) };
  if (kind === 'redline')
    return { seconds: 3, events: [], at: () => steady(limiter * 0.97, 1, cruiseGear) };
  if (kind === 'lift') {
    // 1 s flat out, lift, revs fall away through 1.6 s, back on the throttle.
    const high = limiter * 0.92,
      low = limiter * 0.55;
    return {
      seconds: 4,
      events: [1, 3],
      at: (t) => {
        if (t < 1) return steady(high, 1, cruiseGear);
        if (t < 3) {
          const k = 1 - Math.exp(-(t - 1) / 0.7);
          const rpm = high + (low - high) * k;
          return { ...steady(rpm, 0, cruiseGear), brake: 0 };
        }
        const k = Math.min(1, (t - 3) / 0.9);
        return steady(low + (high - low) * k * 0.8, 1, cruiseGear);
      },
    };
  }
  // shift / pull: climb each gear to the shift point, then change up.
  const climbTime = (g: number) => 1.1 + 0.12 * g;
  const gearsUsed = kind === 'shift' ? Math.min(2, lone - 1) : Math.min(5, lone);
  const first = kind === 'shift' ? Math.max(1, Math.min(lone - 1, cruiseGear - 1)) : 1;
  const segments: { g: number; t0: number; t1: number; lo: number; hi: number }[] = [];
  let t = kind === 'pull' ? 0.5 : 0; // launch: a half second of clutch slip at 55 % revs
  const rpmFor = (g: number, prev: number | null) => {
    const hi = s.shiftRPM * 0.985;
    if (prev === null) return [limiter * (kind === 'pull' ? 0.5 : 0.55), hi] as const;
    const ratio = s.gearRatios[g + 2] / s.gearRatios[g + 1]; // new / old: revs fall on an upshift
    return [Math.max(s.idleRPM * 1.2, prev * ratio), hi] as const;
  };
  let hiPrev: number | null = null;
  const events: number[] = [];
  for (let k = 0; k < Math.max(1, gearsUsed); k++) {
    const g = first + k;
    if (g > lone) break;
    const [lo, hi] = rpmFor(g - 1, hiPrev);
    const ct = climbTime(g);
    segments.push({ g, t0: t, t1: t + ct, lo: k === 0 ? lo : Math.max(lo, 1), hi });
    t += ct;
    hiPrev = hi;
    if (g < lone && k + 1 < Math.max(1, gearsUsed)) {
      events.push(t);
      t += SHIFT_DEAD_TIME;
    }
  }
  const total = t + 0.6;
  return {
    seconds: Math.ceil(total * 2) / 2,
    events,
    at: (now) => {
      if (kind === 'pull' && now < 0.5) {
        const k = now / 0.5;
        const rpm = s.idleRPM + (limiter * 0.5 - s.idleRPM) * Math.min(1, k * 1.4);
        return {
          rpm,
          torque: full(rpm, 0.8),
          speed: speedAt(id, 1, rpm) * k * k,
          gear: 1,
          throttle: 1,
          brake: 0,
        };
      }
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (now >= seg.t0 && now < seg.t1) {
          const k = (now - seg.t0) / (seg.t1 - seg.t0);
          const rpm = seg.lo + (seg.hi - seg.lo) * k;
          return steady(rpm, 1, seg.g);
        }
        const next = segments[i + 1];
        if (next && now >= seg.t1 && now < next.t0) {
          // Dead time: torque cut, throttle lifted, revs fall to the next gear's.
          const k = (now - seg.t1) / (next.t0 - seg.t1);
          const rpm = seg.hi + (next.lo - seg.hi) * k;
          return { ...steady(rpm, 0.1, next.g), torque: -friction(id, rpm) };
        }
      }
      const last = segments[segments.length - 1];
      return steady(last.hi, 1, last.g);
    },
  };
}

/** Expected fundamental (Hz) the engine voice should be playing. */
export function expectedF0(id: string, state: PowerState): number {
  const p = engineCharacter(vehicleDefinition(id)).profile;
  if (p.firingsPerRev === 0) return Math.max(50, state.speed * p.motorHzPerMS * 0.25);
  return Math.max(50, (state.rpm / 60) * p.firingsPerRev);
}

/** Per-wheel load (N) of a machine at rest with a driver. */
export const wheelLoadN = (id: string) => ((vehicleDefinition(id).spec.dryMass + 80) * 9.81) / 4;

export interface CarSetup {
  vehicle: string;
  state: PowerState;
  /** Wheels carry load and roll on `surface` (SURFACE / MATERIAL index), or none. */
  surface?: number | null;
  slipPower?: number;
  slip?: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vz?: number;
  impact?: number;
  inPit?: boolean;
}

export function setCar(frame: Float32Array, id: number, c: CarSetup): void {
  const o = carBase(id);
  frame[o + F.X] = c.x ?? 0;
  frame[o + F.Y] = c.y ?? 0.5;
  frame[o + F.Z] = c.z ?? 0;
  frame[o + F.QW] = 1;
  frame[o + F.VX] = c.vx ?? 0;
  frame[o + F.VZ] = c.vz ?? 0;
  frame[o + F.SPEED] = c.state.speed;
  frame[o + F.RPM] = c.state.rpm;
  frame[o + F.GEAR] = c.state.gear;
  frame[o + F.THROTTLE] = c.state.throttle;
  frame[o + F.BRAKE] = c.state.brake;
  frame[o + F.ENGINE_TORQUE] = c.state.torque;
  frame[o + F.IMPACT] = c.impact ?? 0;
  frame[o + F.IN_PIT] = c.inPit ? 1 : 0;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(c.vehicle);
  const load = c.surface === null ? 0 : wheelLoadN(c.vehicle);
  for (let i = 0; i < 4; i++) {
    const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
    frame[p + W.LOAD] = load;
    frame[p + W.OMEGA] =
      c.state.speed / Math.max(0.1, vehicleDefinition(c.vehicle).spec.wheelRadius);
    frame[p + W.SURFACE] = c.surface ?? 0;
    frame[p + W.SLIP_POWER] = c.slipPower ?? 0;
    frame[p + W.SLIP] = c.slip ?? 0;
  }
}

export const cockpitView = (speed = 0): AudioView => ({
  x: 0,
  y: 1,
  z: 0,
  vx: 0,
  vy: 0,
  vz: speed,
  rightX: 1,
  rightY: 0,
  rightZ: 0,
  interior: true,
  followedCar: 0,
});
export const chaseView = (speed = 0): AudioView => ({
  ...cockpitView(speed),
  z: -6,
  y: 2,
  interior: false,
});
export const tracksideView = (): AudioView => ({
  ...cockpitView(0),
  x: 12,
  y: 1.5,
  z: 0,
  vz: 0,
  rightX: 0,
  rightZ: 1,
  interior: false,
});

/** Machines the detailed suites render (one or two per sound character). */
export const REPRESENTATIVES = [
  'apx01', // hybrid turbo V6 formula
  'hf67', // historic V8 formula
  'tc1', // turbo four touring
  'gt8f', // cross-plane V8 GT
  'gt10m', // V10 GT
  'gs4', // flat six
  'sc7', // V12 supercar
  'hy9', // hypercar hybrid
  'eh3', // electric hypercar
  'xh3', // fuel-cell prototype
  'sk125', // shifter kart (two-stroke)
  'dk100', // direct-drive kart
  'dx8', // trophy truck
  'rp6', // desert pickup
  'bg2', // desert buggy
  'gpr1', // GP bike V4
  'gpr2', // GP bike inline four
  'sbk1000', // superbike
  'nr900', // triple roadster
  'cr750', // two-stroke classic
  'mx450', // motocross single
  'mx250', // two-stroke motocross
] as const;

export const ALL_VEHICLES: readonly string[] = VEHICLE_IDS;

function engineScenario(
  vehicle: string,
  kind: EngineKind,
  view: ViewSpec['mode'],
  group: string,
): Scenario {
  const plan = enginePlan(vehicle, kind),
    d = vehicleDefinition(vehicle);
  const f0: number[] = [];
  for (let t = 0; t < plan.seconds; t += 0.05) f0.push(expectedF0(vehicle, plan.at(t)));
  return {
    id: `${group}__${vehicle}__${kind}__${view}`,
    group,
    vehicle,
    family: soundFamilyFor(d),
    label: `${d.name} ${kind} (${view})`,
    seconds: plan.seconds,
    view,
    events: plan.events,
    f0,
    tags: { kind, class: d.classId },
    frameAt: (t) => {
      const f = blankFrame();
      // Engine stem: no wheel load, no wind, no weather - only the voice and power unit.
      setCar(f, 0, { vehicle, state: plan.at(t), surface: null });
      return f;
    },
    viewAt: () =>
      view === 'cockpit' ? cockpitView() : view === 'chase' ? chaseView() : tracksideView(),
  };
}

/** All engine scenarios: the full six-kind suite for the representatives in the
 * cockpit, mid + redline for every catalogue machine (balance and distinctness),
 * and the chase view of the pull for the representatives. */
export function engineScenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const v of REPRESENTATIVES)
    for (const kind of ENGINE_KINDS) out.push(engineScenario(v, kind, 'cockpit', 'engine'));
  for (const v of ALL_VEHICLES)
    for (const kind of ['mid', 'redline'] as const) {
      if ((REPRESENTATIVES as readonly string[]).includes(v)) continue;
      out.push(engineScenario(v, kind, 'cockpit', 'engine'));
    }
  for (const v of REPRESENTATIVES) out.push(engineScenario(v, 'pull', 'chase', 'engine'));
  return out;
}

/** Everything that is not the engine: tyres, surfaces, wind, weather, impacts,
 * landings. Rendered with a representative formula car in the cockpit unless
 * stated; the engine is silent by construction only where the frame says so,
 * so these are measured as `effects`/`ambience` stems with the engine bus down
 * (the rig sets the bus levels). */
export function effectScenarios(): Scenario[] {
  const out: Scenario[] = [];
  const car = 'apx01';
  const state: PowerState = {
    rpm: 9000,
    torque: 400,
    speed: 60,
    gear: 5,
    throttle: 0.7,
    brake: 0,
  };
  const scene = (
    id: string,
    group: string,
    label: string,
    tags: ScenarioMeta['tags'],
    seconds: number,
    build: (f: Float32Array, t: number) => void,
    options: Partial<Scenario> & { vehicle?: string; speed?: number; view?: ViewSpec['mode'] } = {},
  ) => {
    const vehicle = options.vehicle ?? car,
      speed = options.speed ?? state.speed;
    out.push({
      id,
      group,
      vehicle,
      family: soundFamilyFor(vehicleDefinition(vehicle)),
      label,
      seconds,
      view: options.view ?? 'cockpit',
      events: options.events ?? [],
      f0: null,
      tags,
      buses: options.buses ?? { engine: 0 },
      bypassDynamics: options.bypassDynamics,
      frameAt: (t) => {
        const f = blankFrame();
        setCar(f, 0, { vehicle, state: { ...state, speed }, surface: surfaces.ASPHALT });
        f[H.TIME] = t;
        build(f, t);
        return f;
      },
      viewAt: () => cockpitView(speed),
    });
  };
  // Tyre squeal: the sum of the four wheels' slip power (W) at 60 m/s.
  for (const [name, power] of [
    ['light', 25000],
    ['moderate', 60000],
    ['heavy', 120000],
    ['locked', 260000],
  ] as const)
    scene(
      `tyre__squeal__${name}`,
      'tyre',
      `Tyre squeal ${name}`,
      { stem: 'effects', slip: name },
      3,
      (f) => {
        for (let i = 0; i < 4; i++) {
          const p = carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE;
          f[p + W.SLIP_POWER] = power;
          f[p + W.SLIP] = name === 'locked' ? -0.9 : 0.15;
        }
      },
    );
  // Rolling noise per surface at 50 m/s.
  for (const [name, surface] of Object.entries(surfaces))
    scene(
      `surface__${name.toLowerCase()}`,
      'surface',
      `Rolling on ${name.toLowerCase()}`,
      { stem: 'effects', surface: name.toLowerCase() },
      3,
      (f) => {
        for (let i = 0; i < 4; i++)
          f[carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE + W.SURFACE] = surface;
      },
      { speed: 50 },
    );
  // Wind at speed: the engine is silent, the bed follows the listener's airspeed.
  for (const speed of [30, 60, 90])
    scene(
      `wind__${speed}`,
      'wind',
      `Wind at ${speed} m/s`,
      { stem: 'ambience', speed },
      3,
      (f) => {
        for (let i = 0; i < 4; i++) f[carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE + W.LOAD] = 0;
      },
      { speed },
    );
  // Atmosphere: precipitation, gusts, dust, fog, thunder.
  const weather: [string, string, (f: Float32Array, t: number) => void][] = [
    [
      'rain-light',
      'Light rain',
      (f) => {
        f[H.RAIN] = 4;
        f[H.AMBIENT] = 14;
      },
    ],
    [
      'rain-heavy',
      'Heavy rain',
      (f) => {
        f[H.RAIN] = 30;
        f[H.AMBIENT] = 12;
        f[H.WATER] = 0.8;
      },
    ],
    [
      'storm',
      'Thunderstorm',
      (f, t) => {
        f[H.RAIN] = 55;
        f[H.AMBIENT] = 11;
        f[H.WATER] = 1;
        f[H.WIND_X] = 9;
        f[H.WIND_Z] = 4;
        f[H.TIME] = 40 + t;
      },
    ],
    [
      'snow',
      'Snowfall',
      (f) => {
        f[H.RAIN] = 5;
        f[H.AMBIENT] = -3;
      },
    ],
    [
      'dust',
      'Dust storm',
      (f) => {
        f[H.EXTINCTION] = 6;
        f[H.DUST] = 1;
        f[H.WIND_X] = 11;
        f[H.WIND_Z] = 4;
        f[H.AMBIENT] = 32;
      },
    ],
    [
      'fog',
      'Dense fog',
      (f) => {
        f[H.EXTINCTION] = 10;
        f[H.DUST] = 0;
        f[H.AMBIENT] = 6;
      },
    ],
    [
      'gale',
      'Gale',
      (f) => {
        f[H.WIND_X] = 14;
        f[H.WIND_Z] = 6;
      },
    ],
  ];
  for (const [name, label, build] of weather)
    scene(
      `weather__${name}`,
      'weather',
      label,
      { stem: 'ambience', weather: name },
      4,
      (f, t) => {
        for (let i = 0; i < 4; i++) f[carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE + W.LOAD] = 0;
        build(f, t);
      },
      { speed: 0, view: 'trackside' },
    );
  // Collision hits: F.IMPACT steps (the contact bus fires on a rise).
  for (const [name, level] of [
    ['light', 0.25],
    ['medium', 0.6],
    ['heavy', 1.1],
  ] as const)
    scene(
      `impact__${name}`,
      'impact',
      `Collision ${name}`,
      { stem: 'effects', impact: name },
      2,
      (f, t) => {
        f[carBase(0) + F.IMPACT] = t > 0.5 && t < 0.52 ? level : 0;
        if (t >= 0.52) f[carBase(0) + F.IMPACT] = level * Math.exp(-(t - 0.5) * 6);
      },
      { events: [0.5] },
    );
  // Airborne and landing (dirt bike flight, landing speeds in m/s).
  for (const landing of [2, 5, 8])
    scene(
      `airborne__landing${landing}`,
      'airborne',
      `Flight then landing at ${landing} m/s`,
      { stem: 'effects', landing },
      3,
      (f, t) => {
        const base = carBase(0) + OFFROAD_BASE;
        const flying = t > 0.4 && t < 1.4;
        f[base + O.AIRBORNE] = flying ? 1 : 0;
        f[base + O.LANDING_SPEED] = t >= 1.4 ? landing : 0;
        f[carBase(0) + F.VY] = flying ? -landing : 0;
        for (let i = 0; i < 4; i++)
          f[carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE + W.LOAD] = flying ? 0 : wheelLoadN('mx450');
        f[H.TIME] = t;
      },
      { vehicle: 'mx450', speed: 25, events: [1.4], buses: { engine: 1 } },
    );
  return out;
}

/** The full mixes: the reference scenes the level balance is judged on. */
export function mixScenarios(): Scenario[] {
  const out: Scenario[] = [];
  const mix = (
    id: string,
    label: string,
    vehicle: string,
    kind: EngineKind,
    view: ViewSpec['mode'],
    extra: (f: Float32Array, t: number) => void,
    options: {
      surface?: number;
      slipPower?: number;
      seconds?: number;
      tags?: ScenarioMeta['tags'];
    } = {},
  ) => {
    const plan = enginePlan(vehicle, kind);
    const speedOf = (t: number) => plan.at(t).speed;
    out.push({
      id: `mix__${id}`,
      group: 'mix',
      vehicle,
      family: soundFamilyFor(vehicleDefinition(vehicle)),
      label,
      seconds: options.seconds ?? plan.seconds,
      view,
      events: plan.events,
      f0: null,
      tags: { scene: id, ...(options.tags ?? {}) },
      frameAt: (t) => {
        const f = blankFrame();
        const s = plan.at(Math.min(t, plan.seconds));
        setCar(f, 0, {
          vehicle,
          state: s,
          surface: options.surface ?? surfaces.ASPHALT,
          slipPower: options.slipPower ?? 0,
        });
        f[H.TIME] = t;
        extra(f, t);
        return f;
      },
      viewAt: (t) =>
        view === 'cockpit'
          ? cockpitView(speedOf(Math.min(t, plan.seconds)))
          : view === 'chase'
            ? chaseView(speedOf(Math.min(t, plan.seconds)))
            : tracksideView(),
    });
  };
  const none = () => undefined;
  mix(
    'formula-pull',
    'Formula pull through five gears, cockpit',
    'apx01',
    'pull',
    'cockpit',
    none,
    {
      slipPower: 10000,
    },
  );
  mix('formula-pull-chase', 'Formula pull, chase camera', 'apx01', 'pull', 'chase', none, {
    slipPower: 10000,
  });
  mix('gt-pull', 'Cross-plane V8 GT pull, cockpit', 'gt8f', 'pull', 'cockpit', none, {
    slipPower: 10000,
  });
  mix('electric-pull', 'Electric hypercar pull, cockpit', 'eh3', 'pull', 'cockpit', none);
  mix('kart-pull', 'Shifter kart pull, cockpit', 'sk125', 'pull', 'cockpit', none);
  mix('truck-pull', 'Trophy truck pull on dirt, cockpit', 'dx8', 'pull', 'cockpit', none, {
    surface: surfaces.DIRT ?? surfaces.GRAVEL,
  });
  mix('gp-bike-pull', 'GP bike pull, cockpit', 'gpr1', 'pull', 'cockpit', none);
  mix('mx-pull', 'Motocross pull on dirt', 'mx450', 'pull', 'cockpit', none, {
    surface: surfaces.DIRT ?? surfaces.GRAVEL,
  });
  mix(
    'formula-braking-squeal',
    'Formula heavy braking with tyre squeal',
    'apx01',
    'lift',
    'cockpit',
    (f) => {
      for (let i = 0; i < 4; i++) {
        const p = carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE;
        f[p + W.SLIP_POWER] = 90000;
        f[p + W.SLIP] = -0.5;
      }
      f[carBase(0) + F.BRAKE] = 1;
    },
  );
  mix(
    'formula-rain',
    'Formula pull in heavy rain',
    'apx01',
    'pull',
    'cockpit',
    (f) => {
      f[H.RAIN] = 30;
      f[H.AMBIENT] = 12;
      f[H.WATER] = 0.8;
      for (let i = 0; i < 4; i++) f[carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE + W.WATER] = 1.2;
    },
    { slipPower: 10000 },
  );
  mix(
    'formula-storm',
    'Formula pull in a thunderstorm',
    'apx01',
    'pull',
    'cockpit',
    (f, t) => {
      f[H.RAIN] = 55;
      f[H.AMBIENT] = 11;
      f[H.WATER] = 1;
      f[H.WIND_X] = 9;
      f[H.WIND_Z] = 4;
      f[H.TIME] = 40 + t;
    },
    { slipPower: 10000 },
  );
  mix('formula-snow', 'Formula pull in snowfall', 'apx01', 'pull', 'cockpit', (f) => {
    f[H.RAIN] = 5;
    f[H.AMBIENT] = -3;
  });
  mix('formula-dust', 'Formula pull in a dust storm', 'apx01', 'pull', 'cockpit', (f) => {
    f[H.EXTINCTION] = 6;
    f[H.DUST] = 1;
    f[H.WIND_X] = 11;
    f[H.WIND_Z] = 4;
    f[H.AMBIENT] = 32;
  });
  mix('formula-fog', 'Formula pull in fog', 'apx01', 'pull', 'cockpit', (f) => {
    f[H.EXTINCTION] = 10;
    f[H.AMBIENT] = 6;
  });
  // Twelve cars on the grid at full revs: the worst case for summing and clipping.
  out.push(gridScenario());
  out.push(passbyScenario());
  return out;
}

function gridScenario(): Scenario {
  const cars = 12,
    vehicles = [
      'apx01',
      'fx26',
      'jf2',
      'hf67',
      'hy9',
      'pr2',
      'gt8f',
      'tc1',
      'fe4',
      'fr3',
      'hy11',
      'xf2',
    ];
  return {
    id: 'mix__grid-12-cars',
    group: 'mix',
    vehicle: 'apx01',
    family: 'v6-turbo-hybrid',
    label: 'Twelve cars revving on the grid, chase view',
    seconds: 3,
    view: 'chase',
    events: [],
    f0: null,
    tags: { scene: 'grid-12-cars', worstCase: true },
    frameAt: () => {
      const f = blankFrame(cars);
      for (let i = 0; i < cars; i++) {
        const v = vehicles[i % vehicles.length],
          limiter = vehicleDefinition(v).spec.limiterRPM;
        setCar(f, i, {
          vehicle: v,
          state: { rpm: limiter * 0.95, torque: 500, speed: 0, gear: 1, throttle: 1, brake: 1 },
          surface: surfaces.ASPHALT,
          x: (i % 2 ? 1 : -1) * 3 * (1 + Math.floor(i / 2) * 0.3),
          z: 8 + Math.floor(i / 2) * 8,
        });
      }
      return f;
    },
    viewAt: () => chaseView(0),
  };
}

function passbyScenario(): Scenario {
  const v = 'apx01',
    seconds = 4;
  return {
    id: 'mix__passby',
    group: 'mix',
    vehicle: v,
    family: 'v6-turbo-hybrid',
    label: 'Formula car passing a trackside listener at 70 m/s',
    seconds,
    view: 'trackside',
    events: [2],
    f0: null,
    tags: { scene: 'passby' },
    frameAt: (t) => {
      const f = blankFrame(2);
      const state: PowerState = {
        rpm: 11000,
        torque: 450,
        speed: 70,
        gear: 6,
        throttle: 1,
        brake: 0,
      };
      setCar(f, 0, { vehicle: v, state, surface: 0, x: 0, z: (t - 2) * 70, vz: 70 });
      setCar(f, 1, {
        vehicle: 'tc1',
        state: { ...state, rpm: 5000 },
        surface: null,
        x: 40,
        z: -400,
      });
      return f;
    },
    viewAt: () => tracksideView(),
  };
}
