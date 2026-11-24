// Independent pre-optimization writer for byte-level snapshot regression checks.
// Keep its linear rank/registry lookups so the production fast path has an oracle.
import { COMPOUNDS } from '../../src/simulation/config.ts';
import { writeBikeBlock } from '../../src/simulation/bike-vehicle.ts';
import { writeOffroadBlock } from '../../src/simulation/offroad/session.ts';
import {
  BIKE_BASE,
  CAR_STRIDE,
  DEBRIS_BASE,
  DEBRIS_STRIDE,
  F,
  H,
  HEADER,
  K,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  SKID_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../src/simulation/protocol.ts';
import { VEHICLE_IDS } from '../../src/simulation/vehicles.ts';
import { particulateExtinctionPerKm, reportedSurface } from '../../src/simulation/weather.ts';
import { writeWheelContact } from '../../src/simulation/wheel-contact-state.ts';
import { writeWheelRotation } from '../../src/simulation/wheel-rotation.ts';
import type { Simulation } from '../../src/simulation/world.ts';

const COMPOUND_IDS = Object.keys(COMPOUNDS);

export function referenceWorldSnapshot(
  sim: Simulation,
  out: Float32Array,
  stepMs = 0,
  dropped = 0,
) {
  if (out.length !== HEADER + sim.cars.length * CAR_STRIDE)
    throw new Error('Invalid snapshot buffer');
  out[H.TIME] = sim.race.time;
  out[H.PHASE] = sim.race.phase;
  out[H.RACE_TIME] = sim.race.raceTime;
  out[H.LIGHTS] = sim.race.lights;
  out[H.RAIN] = sim.track.rain;
  out[H.CLOUD] = sim.track.cloud;
  out[H.AMBIENT] = sim.track.ambient;
  out[H.FLAG] = sim.race.flag === 'CHEQUERED' ? 2 : sim.race.control.flags[0];
  out[H.STEP_MS] = stepMs;
  out[H.DROPPED] = dropped;
  out[H.WATER] = sim.track.meanWater();
  out[H.TICK] = sim.tick;
  out[H.CARS] = sim.cars.length;
  out[H.LENGTH] = sim.track.length;
  out[H.WIND_X] = sim.track.windX;
  out[H.WIND_Z] = sim.track.windZ;
  const sc = sim.race.safetyCar;
  out[H.SC_PHASE] = sc.phase;
  out[H.SC_S] = sc.s;
  out[H.SC_SPEED] = sc.phase >= 2 ? sc.speed : 0;
  out[H.DRS_ENABLED] = Number(sim.race.drsActive);
  let leaderLaps = 0;
  for (const lap of sim.race.laps) leaderLaps = Math.max(leaderLaps, lap.completed);
  out[H.LAP_LEADER] = leaderLaps + 1;
  out[H.FORMATION] = 0;
  out[H.EXTINCTION] = particulateExtinctionPerKm(sim.track.visibility);
  out[H.DUST] = sim.track.dust;
  for (let id = 0; id < sim.cars.length; id++) {
    const c = sim.cars[id],
      b = c.body,
      t = sim.race.laps[id],
      o = carBase(id),
      q = b.orientation;
    out[o + F.X] = b.position.x;
    out[o + F.Y] = b.position.y;
    out[o + F.Z] = b.position.z;
    out[o + F.QX] = q.x;
    out[o + F.QY] = q.y;
    out[o + F.QZ] = q.z;
    out[o + F.QW] = q.w;
    out[o + F.VX] = b.velocity.x;
    out[o + F.VY] = b.velocity.y;
    out[o + F.VZ] = b.velocity.z;
    out[o + F.WX] = b.omega.x;
    out[o + F.WY] = b.omega.y;
    out[o + F.WZ] = b.omega.z;
    out[o + F.SPEED] = c.speed;
    out[o + F.STEER] = c.steer;
    out[o + F.RPM] = c.rpm;
    out[o + F.GEAR] = c.gear;
    out[o + F.THROTTLE] = c.throttle;
    out[o + F.BRAKE] = c.brake;
    out[o + F.FUEL] = c.fuel;
    out[o + F.BATTERY] = c.battery;
    out[o + F.AERO_FRONT] = c.aero.front + c.aero.floor * 0.46;
    out[o + F.AERO_REAR] = c.aero.rear + c.aero.floor * 0.54;
    out[o + F.DRAG] = c.aero.drag;
    out[o + F.FRONT_HEALTH] = c.frontHealth;
    out[o + F.FLOOR_HEALTH] = c.floorHealth;
    out[o + F.REAR_HEALTH] = c.rearHealth;
    out[o + F.S] = c.s;
    out[o + F.LATERAL] = c.lateral;
    out[o + F.LAPS] = t.completed;
    out[o + F.LAP_TIME] = t.lapTime;
    out[o + F.BEST_LAP] = t.best;
    out[o + F.LAST_LAP] = t.last;
    out[o + F.PENALTY] = t.penalty;
    out[o + F.PIT_PHASE] = c.pitPhase;
    out[o + F.IN_PIT] = Number(c.inPit);
    out[o + F.AI_TARGET] = c.aiTarget;
    out[o + F.G_LONG] = c.gLong;
    out[o + F.G_LAT] = c.gLat;
    out[o + F.G_VERT] = c.gVert;
    out[o + F.RANK] = sim.race.order.indexOf(id) + 1;
    out[o + F.FINISH] = c.finishTime;
    out[o + F.WAKE] = c.wake;
    out[o + F.SLIP_ENERGY] = c.tires.reduce((sum, w) => sum + w.energy, 0);
    out[o + F.BOTTOM_ENERGY] = c.bottomEnergy;
    const r = o + RACE_BASE,
      status = sim.race.sectorStatus;
    out[r + R.DRS] = sim.race.drs.state[id];
    out[r + R.DRS_ELIGIBLE] = Number(sim.race.drs.eligibleZone[id] >= 0);
    out[r + R.TYRE_AGE_LAPS] = t.completed - sim.race.stintStart[id];
    out[r + R.NEXT_COMPOUND] = c.pitRequested ? COMPOUND_IDS.indexOf(c.nextCompound) : -1;
    out[r + R.OVERTAKE] = c.overtakeClock;
    out[r + R.SECTOR_STATUS] = status[id * 3] + 4 * status[id * 3 + 1] + 16 * status[id * 3 + 2];
    out[r + R.DRS_FLAP] = c.drsFlap;
    out[r + R.VEHICLE] = Math.max(0, VEHICLE_IDS.indexOf(c.definition.id));
    writeBikeBlock(out, o + BIKE_BASE, c);
    writeOffroadBlock(out, o + OFFROAD_BASE, c, sim.offroad);
    const k = o + SKID_BASE,
      skid = c.skid;
    out[k + K.CONTACTS] = skid.contacts;
    out[k + K.LOAD] = skid.normalLoad;
    out[k + K.SLIDE_POWER] = skid.slidingPower;
    out[k + K.DAMPING_POWER] = skid.dampingPower;
    out[k + K.SPARK_POWER] = skid.sparkPower;
    out[k + K.SPARK_X] = skid.point.x;
    out[k + K.SPARK_Y] = skid.point.y;
    out[k + K.SPARK_Z] = skid.point.z;
    out[k + K.NORMAL_X] = skid.normal.x;
    out[k + K.NORMAL_Y] = skid.normal.y;
    out[k + K.NORMAL_Z] = skid.normal.z;
    out[k + K.VELOCITY_X] = skid.velocity.x;
    out[k + K.VELOCITY_Y] = skid.velocity.y;
    out[k + K.VELOCITY_Z] = skid.velocity.z;
    out[k + K.SLIDE_WORK] = skid.slidingWorkJ;
    out[k + K.SPARK_WORK] = skid.sparkWorkJ;
    out[k + K.TOTAL_WORK] = skid.totalWorkJ;
    out[o + F.IMPACT] = c.impact;
    out[o + F.COMPOUND] = COMPOUND_IDS.indexOf(c.tires[0].compound);
    out[o + F.PIT_STOPS] = c.pitStops;
    out[o + F.MOTOR_POWER] = c.motorPower;
    out[o + F.REGEN_POWER] = c.regenerationPower;
    out[o + F.FRONT_RIDE] = c.frontRideHeight;
    out[o + F.REAR_RIDE] = c.rearRideHeight;
    out[o + F.BRAKE_BIAS] = c.setup.brakeBias;
    out[o + F.DIFF_POWER] = c.setup.diffPower;
    out[o + F.DIFF_COAST] = c.setup.diffCoast;
    out[o + F.ERS_MODE] = c.input.ers;
    out[o + F.JACK_HEIGHT] = c.jackHeight;
    out[o + F.SIDEPOD_HEALTH] = c.sidepodHealth;
    out[o + F.LOST_MASS] = c.lostMass;
    out[o + F.SUSPENSION_DAMAGE] = c.suspensionDamage;
    out[o + F.SECTOR] = t.sector;
    out[o + F.SECTOR_1] = t.sectors[0] || t.lastSectors[0];
    out[o + F.SECTOR_2] = t.sectors[1] || t.lastSectors[1];
    out[o + F.SECTOR_3] = t.sectors[2] || t.lastSectors[2];
    out[o + F.LAP_VALID] = Number(t.valid);
    out[o + F.LAST_LAP_VALID] = Number(t.lastValid && t.lastPenalty === 0);
    out[o + F.LAST_LAP_ASSISTED] = Number(t.lastAssisted);
    out[o + F.WARNINGS] = t.warnings;
    out[o + F.PIT_YIELDING] = Number(c.pitYielding);
    out[o + F.RETIRED] = Number(c.retired);
    out[o + F.MASS] = c.body.mass;
    out[o + F.CLUTCH_PEDAL] = c.definition.bike?.manualClutch && !c.input.manualClutch ? 0 : c.input.clutch;
    out[o + F.CLUTCH_ENGAGEMENT] = c.clutch.engagement;
    out[o + F.CLUTCH_TORQUE] = c.clutch.transmittedTorque;
    out[o + F.CLUTCH_SLIP_POWER] = c.clutch.slipPower;
    out[o + F.ENGINE_TORQUE] = c.engineOutputTorque;
    out[o + F.LOCAL_FLAG] = sim.race.control.flags[id];
    out[o + F.CAUTION_DISTANCE] = sim.race.control.zoneDistance[id];
    out[o + F.CAUTION_SPEED] = sim.race.control.zoneSpeed[id];
    out[o + F.BLUE_CAR] = sim.race.control.blueCar[id];
    out[o + F.CONTROL_SEQUENCE] = sim.race.control.sequence;
    out[o + F.CONTROL_PENALTIES] = sim.race.control.penaltyCount[id];
    out[o + F.PIT_CLOCK] = c.pitClock;
    out[o + F.LAP_DELTA] = t.reference.delta(c.s, t.lapTime);
    out[o + F.DELTA_VALID] = Number(t.active && t.reference.bestTime > 0);
    const brain = sim.ai[id].brain;
    out[o + F.AI_STRESS] = brain.stress;
    out[o + F.AI_TIRE_CARE] = brain.tireCare;
    out[o + F.AI_ERROR_COUNT] = brain.errors.events;
    out[o + F.AI_STEER_ERROR] = brain.errors.steer;
    out[o + F.AI_PEDAL_ERROR] = brain.errors.pedal;
    out[o + F.AI_DEFENDING] = brain.defence.offset;
    out[o + F.AI_PACE] = brain.pace;
    for (let i = 0; i < c.debris.pieces.length; i++) {
      const piece = c.debris.pieces[i],
        p = o + DEBRIS_BASE + i * DEBRIS_STRIDE;
      out[p] = piece.kind;
      out[p + 1] = piece.position.x;
      out[p + 2] = piece.position.y;
      out[p + 3] = piece.position.z;
      out[p + 4] = piece.rotation;
      out[p + 5] = piece.age;
      out[p + 6] = piece.mass;
      out[p + 7] = Number(piece.active);
    }
    writeWheelRotation(out, o, c.tires);
    writeWheelContact(out, o, c);
    for (let i = 0; i < 4; i++) {
      const w = c.tires[i],
        p = o + WHEEL_BASE + i * WHEEL_STRIDE;
      out[p + W.OMEGA] = w.omega;
      out[p + W.LOAD] = w.load;
      out[p + W.FX] = w.fx;
      out[p + W.FY] = w.fy;
      out[p + W.SLIP] = w.slip;
      out[p + W.ANGLE] = w.angle;
      out[p + W.SURFACE_TEMP] = w.surfaceTemp;
      out[p + W.CARCASS_TEMP] = w.carcassTemp;
      out[p + W.WEAR] = w.wear;
      out[p + W.DIRT] = w.dirt;
      out[o + F.MARBLE_PICKUP_FR + i] = w.marblePickup;
      out[p + W.COMPRESSION] = w.compression;
      out[p + W.DISC_TEMP] = w.discTemp;
      out[p + W.WATER] = w.water;
      out[p + W.SURFACE] = reportedSurface(w.surface, c.contacts[i]?.frozen, c.contacts[i]?.rubber ?? 0);
      out[p + W.ROTATION] = w.rotation;
      out[p + W.FLAT] = w.flatSpot;
      out[p + W.PRESSURE] = w.pressure;
      out[p + W.RADIUS] = w.radius;
      out[p + W.BLISTERING] = w.blistering;
      out[p + W.GRAINING] = w.graining;
      out[p + W.PUNCTURED] = Number(w.punctured);
      out[p + W.SUSPENSION_DAMAGE] = c.cornerDamage[i];
      out[p + W.SLIP_POWER] = w.energy;
      out[p + W.LENGTH] = w.length;
      out[p + W.STEER] = c.wheelSteering[i];
      out[p + W.CAMBER] = c.wheelCamber[i];
    }
  }
  return out;
}
