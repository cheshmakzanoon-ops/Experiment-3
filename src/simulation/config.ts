import { clamp } from '../core/math.ts';
export type Compound = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet';
export type WeatherPreset = 'clear' | 'changeable' | 'rain';
export type Assist = 'sport' | 'raw';
export interface Setup {
  frontWing: number;
  rearWing: number;
  brakeBias: number;
  diffPower: number;
  diffCoast: number;
  frontSpring: number;
  rearSpring: number;
  frontARB: number;
  rearARB: number;
  frontRide: number;
  rearRide: number;
  frontPressure: number;
  rearPressure: number;
  frontCamber: number;
  rearCamber: number;
  frontToe: number;
  rearToe: number;
}
export const DEFAULT_SETUP: Setup = {
  frontWing: 0.55,
  rearWing: 0.58,
  brakeBias: 0.56,
  diffPower: 0.5,
  diffCoast: 0.25,
  frontSpring: 115000,
  rearSpring: 125000,
  frontARB: 26000,
  rearARB: 21000,
  frontRide: 0.065,
  rearRide: 0.075,
  frontPressure: 155,
  rearPressure: 148,
  frontCamber: -0.044,
  rearCamber: -0.023,
  frontToe: -0.001,
  rearToe: 0.002,
};
export const SETUP_LIMITS: Record<keyof Setup, readonly [number, number]> = {
  frontWing: [0, 1],
  rearWing: [0, 1],
  brakeBias: [0.48, 0.68],
  diffPower: [0, 1],
  diffCoast: [0, 1],
  frontSpring: [85000, 165000],
  rearSpring: [85000, 175000],
  frontARB: [0, 55000],
  rearARB: [0, 55000],
  frontRide: [0.045, 0.1],
  rearRide: [0.045, 0.11],
  frontPressure: [130, 190],
  rearPressure: [130, 190],
  frontCamber: [-0.07, 0],
  rearCamber: [-0.05, 0],
  frontToe: [-0.005, 0.005],
  rearToe: [-0.005, 0.005],
};
export function validateSetup(value: unknown): Setup {
  if (!value || typeof value !== 'object') throw new Error('Setup must be an object');
  const out = { ...DEFAULT_SETUP };
  for (const key of Object.keys(out) as (keyof Setup)[]) {
    const n = (value as Record<string, unknown>)[key];
    if (n === undefined) continue;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`Invalid setup ${key}`);
    const [a, b] = SETUP_LIMITS[key];
    out[key] = clamp(n, a, b);
  }
  return out;
}
export const COMPOUNDS: Record<
  Compound,
  { mu: number; ideal: number; lifeJ: number; waterTolerance: number; color: number }
> = {
  soft: { mu: 1.92, ideal: 96, lifeJ: 29e6, waterTolerance: 0.09, color: 0xe7444f },
  medium: { mu: 1.84, ideal: 92, lifeJ: 40e6, waterTolerance: 0.1, color: 0xf6cf45 },
  hard: { mu: 1.76, ideal: 90, lifeJ: 55e6, waterTolerance: 0.11, color: 0xe1e1db },
  intermediate: { mu: 1.57, ideal: 70, lifeJ: 30e6, waterTolerance: 1.2, color: 0x49bb82 },
  wet: { mu: 1.43, ideal: 60, lifeJ: 25e6, waterTolerance: 3.2, color: 0x529bea },
};
export const VEHICLE = {
  dryMass: 770,
  wheelRadius: 0.335,
  wheelInertia: 1.8,
  wheelbase: 3.44,
  track: 1.66,
  inertia: [510, 1220, 1080] as const,
  restLength: 0.25,
  travel: 0.17,
  maxSteer: 0.38,
  finalDrive: 3.7,
  gearRatios: [-3.1, 0, 3.3, 2.8, 2.35, 2.02, 1.78, 1.59, 1.44, 1.31],
  idleRPM: 4200,
  shiftRPM: 12300,
  limiterRPM: 13700,
  maxBatteryJ: 4e6,
  motorPowerW: 100000,
  regenPowerW: 70000,
  brakeTorque: 13200,
  airDensity: 1.225,
  torqueCurve: [
    [4000, 360],
    [6500, 460],
    [9000, 510],
    [11000, 490],
    [12500, 450],
    [13700, 360],
  ] as const,
};
export interface SessionOptions {
  mode: 'race' | 'practice';
  laps: number;
  opponents: number;
  weather: WeatherPreset;
  assist: Assist;
  compound: Compound;
  setup: Setup;
  seed: number;
}
export const DEFAULT_OPTIONS: SessionOptions = {
  mode: 'race',
  laps: 3,
  opponents: 7,
  weather: 'clear',
  assist: 'sport',
  compound: 'medium',
  setup: { ...DEFAULT_SETUP },
  seed: 73021,
};
export function validateOptions(v: unknown): SessionOptions {
  if (!v || typeof v !== 'object') throw new Error('Invalid session options');
  const o = v as Partial<SessionOptions>;
  return {
    mode: o.mode === 'practice' ? 'practice' : 'race',
    laps: clamp(Math.round(Number(o.laps) || 3), 1, 10),
    opponents: clamp(Math.round(Number(o.opponents) || 0), 0, 11),
    weather: o.weather === 'rain' || o.weather === 'changeable' ? o.weather : 'clear',
    assist: o.assist === 'raw' ? 'raw' : 'sport',
    compound: o.compound && Object.hasOwn(COMPOUNDS, o.compound) ? o.compound : 'medium',
    setup: validateSetup(o.setup ?? DEFAULT_SETUP),
    seed: Number.isFinite(o.seed) ? (o.seed as number) >>> 0 : 73021,
  };
}
export interface Controls {
  throttle: number;
  brake: number;
  clutch: number;
  manualClutch: boolean;
  steer: number;
  shift: number;
  ers: 0 | 1 | 2;
  pit: boolean;
  reverse: boolean;
}
export const controls = (): Controls => ({
  throttle: 0,
  brake: 0,
  clutch: 0,
  manualClutch: false,
  steer: 0,
  shift: 0,
  ers: 1,
  pit: false,
  reverse: false,
});
export const DRIVERS = [
  'YOU',
  'A. MOREAU',
  'K. SATO',
  'M. VEGA',
  'N. LIND',
  'R. SILVA',
  'J. COLE',
  'E. PARK',
  'L. ROSSI',
  'S. KAYA',
  'D. BELL',
  'T. AZIZ',
];
export const LIVERIES = [
  0xec4c2f, 0x54c8c0, 0xf2c95d, 0x7696ed, 0xe6dfce, 0xb58ce4, 0x5aaa7a, 0xe079ac, 0xdc9c5a,
  0x6a9ca8, 0xd1d3d8, 0x93aa4b,
];
