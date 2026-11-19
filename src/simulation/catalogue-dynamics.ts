import type { VehicleDefinition } from './vehicles.ts';
import type { VehicleDynamics } from './vehicle-dynamics.ts';
import { defaultSuspension } from './suspension.ts';
import { LEGACY_ENGINE } from './powertrain.ts';

type Pair = readonly [number, number];
interface HardwareProfile {
  /** Front/rear negative camber gain, radians per metre of bump. */
  camber: Pair;
  /** Front/rear roll-centre heights, metres above the contact patch. */
  rollCentre: Pair;
  /** Roll-centre migration per metre of mean bump. */
  migration: number;
  /** Front/rear braking force-line slopes, tan(theta), not percentages. */
  antiBrake: Pair;
  /** Drive force-line slope, applied only to a driven axle. */
  antiDrive: number;
  progression: number;
  /** Intake opening/closing time constants and torque interruption, seconds. */
  intake: Pair;
  shift: number;
  pumping: number;
}

/** Original engineering calibration for the existing fictional hardware.
 * These are family defaults, not manufacturer measurements. Existing spring,
 * bar, ride-height, tyre, engine-inertia and driveline sheets remain authoritative.
 * Small nonzero link paths divide existing load transfer between links and
 * springs; they do not add weight or an artificial grip multiplier. */
const PROFILES = {
  singleSeater: {
    camber: [0.28, 0.2],
    rollCentre: [0.025, 0.045],
    migration: -0.2,
    antiBrake: [0.012, 0.006],
    antiDrive: 0.016,
    progression: 0.04,
    intake: [0.022, 0.03],
    shift: 0.055,
    pumping: 0.008,
  },
  historicSingle: {
    camber: [0.18, 0.12],
    rollCentre: [0.035, 0.055],
    migration: -0.15,
    antiBrake: [0.006, 0.004],
    antiDrive: 0.012,
    progression: 0.02,
    intake: [0.04, 0.04],
    shift: 0.18,
    pumping: 0.012,
  },
  endurance: {
    camber: [0.24, 0.18],
    rollCentre: [0.03, 0.05],
    migration: -0.2,
    antiBrake: [0.012, 0.008],
    antiDrive: 0.018,
    progression: 0.04,
    intake: [0.025, 0.035],
    shift: 0.06,
    pumping: 0.01,
  },
  gt: {
    camber: [0.28, 0.2],
    rollCentre: [0.04, 0.06],
    migration: -0.25,
    antiBrake: [0.015, 0.008],
    antiDrive: 0.02,
    progression: 0.04,
    intake: [0.04, 0.04],
    shift: 0.075,
    pumping: 0.015,
  },
  touring: {
    camber: [0.25, 0.18],
    rollCentre: [0.055, 0.075],
    migration: -0.3,
    antiBrake: [0.02, 0.012],
    antiDrive: 0.015,
    progression: 0.04,
    intake: [0.05, 0.045],
    shift: 0.095,
    pumping: 0.02,
  },
  club: {
    camber: [0.2, 0.14],
    rollCentre: [0.045, 0.065],
    migration: -0.2,
    antiBrake: [0.012, 0.008],
    antiDrive: 0.016,
    progression: 0.03,
    intake: [0.055, 0.045],
    shift: 0.14,
    pumping: 0.018,
  },
  historicRoad: {
    camber: [0.12, 0],
    rollCentre: [0.045, 0.07],
    migration: -0.1,
    antiBrake: [0.006, 0.004],
    antiDrive: 0.012,
    progression: 0.03,
    intake: [0.065, 0.05],
    shift: 0.22,
    pumping: 0.02,
  },
  road: {
    camber: [0.2, 0.16],
    rollCentre: [0.055, 0.075],
    migration: -0.25,
    antiBrake: [0.022, 0.012],
    antiDrive: 0.018,
    progression: 0.06,
    intake: [0.075, 0.05],
    shift: 0.18,
    pumping: 0.025,
  },
  roadSport: {
    camber: [0.25, 0.2],
    rollCentre: [0.04, 0.065],
    migration: -0.2,
    antiBrake: [0.016, 0.01],
    antiDrive: 0.02,
    progression: 0.04,
    intake: [0.04, 0.035],
    shift: 0.08,
    pumping: 0.015,
  },
  utility: {
    camber: [0.1, 0],
    rollCentre: [0.065, 0.1],
    migration: -0.15,
    antiBrake: [0.018, 0.01],
    antiDrive: 0.025,
    progression: 0.08,
    intake: [0.09, 0.06],
    shift: 0.2,
    pumping: 0.035,
  },
  rally: {
    camber: [0.15, 0.12],
    rollCentre: [0.06, 0.08],
    migration: -0.2,
    antiBrake: [0.014, 0.008],
    antiDrive: 0.016,
    progression: 0.06,
    intake: [0.045, 0.04],
    shift: 0.07,
    pumping: 0.018,
  },
  historicRally: {
    camber: [0.12, 0.08],
    rollCentre: [0.05, 0.075],
    migration: -0.15,
    antiBrake: [0.008, 0.005],
    antiDrive: 0.014,
    progression: 0.04,
    intake: [0.05, 0.045],
    shift: 0.17,
    pumping: 0.018,
  },
  kart: {
    camber: [0, 0],
    rollCentre: [0, 0],
    migration: 0,
    antiBrake: [0, 0],
    antiDrive: 0,
    progression: 0,
    intake: [0.015, 0.012],
    shift: 0.045,
    pumping: 0,
  },
} as const satisfies Record<string, HardwareProfile>;
export type CatalogueHardwareFamily = keyof typeof PROFILES;

/** Explicit family selection keeps the pickup, classic road car and the
 * dual-clutch supercar distinct inside the broad Festival 'road' class. */
export function catalogueHardwareFamily(def: VehicleDefinition): CatalogueHardwareFamily {
  switch (def.classId) {
    case 'formula':
    case 'formula-junior':
    case 'formula-feeder':
    case 'formula-entry':
      return 'singleSeater';
    case 'historic':
    case 'historic-aero':
    case 'historic-turbo':
    case 'historic-prototype':
      return 'historicSingle';
    case 'hypercar':
    case 'prototype':
      return 'endurance';
    case 'experimental':
      return def.tireFamily === 'formula-slick' ? 'singleSeater' : 'endurance';
    case 'gt':
    case 'gt-sport':
      return 'gt';
    case 'touring':
      return 'touring';
    case 'club':
      return 'club';
    case 'vintage':
      return 'historicRoad';
    case 'rally':
    case 'rallycross':
      return 'rally';
    case 'historic-rally':
      return 'historicRally';
    case 'offroad':
      return 'utility';
    case 'kart':
      return 'kart';
    case 'road':
      if (def.tireFamily === 'all-terrain') return 'utility';
      if (def.tireFamily === 'historic') return 'historicRoad';
      return def.id === 'sc7' ? 'roadSport' : 'road';
    default:
      return 'road';
  }
}

export function catalogueHardware(
  def: VehicleDefinition,
): Pick<VehicleDynamics, 'suspension' | 'engine' | 'gearbox'> {
  const p = PROFILES[catalogueHardwareFamily(def)],
    power = def.spec.engine,
    electric = def.powertrain === 'electric',
    singleRatio = def.spec.gearRatios.length === 3;
  return {
    suspension: defaultSuspension({
      front: {
        camberGain: p.camber[0],
        rollCentreHeight: p.rollCentre[0],
        rollCentreGain: p.migration,
        antiBrake: p.antiBrake[0],
        antiDrive: def.drivetrain === 'rwd' ? 0 : p.antiDrive,
        progression: p.progression,
      },
      rear: {
        camberGain: p.camber[1],
        rollCentreHeight: p.rollCentre[1],
        rollCentreGain: p.migration,
        antiBrake: p.antiBrake[1],
        antiDrive: def.drivetrain === 'fwd' ? 0 : p.antiDrive,
        progression: p.progression,
      },
    }),
    engine: Object.freeze({
      ...LEGACY_ENGINE,
      inertia: power?.inertia ?? LEGACY_ENGINE.inertia,
      frictionBase: power?.frictionBase ?? LEGACY_ENGINE.frictionBase,
      frictionViscous: power?.frictionPerRad ?? LEGACY_ENGINE.frictionViscous,
      throttleRise: electric ? 0.012 : p.intake[0],
      throttleFall: electric ? 0.01 : p.intake[1],
      pumping: electric ? 0 : p.pumping,
    }),
    gearbox: Object.freeze({
      // Single-ratio motors/direct karts have no upshift interruption. The
      // automatic road transmissions are explicitly authored exceptions to
      // the ordinary manual-road shift; the SC-7 has its own DCT family.
      shiftTime: singleRatio ? 0 : def.id === 'rs5' ? 0.1 : def.id === 'lx12' ? 0.14 : p.shift,
      shiftCut: singleRatio ? 0 : 1,
    }),
  };
}
