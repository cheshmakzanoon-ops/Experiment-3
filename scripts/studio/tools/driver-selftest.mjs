// Headless check of the journey tool's keyboard driver against the production
// Simulation: `node --no-warnings --experimental-transform-types
//   scripts/studio/tools/driver-selftest.mjs [circuit] [vehicle] [seconds] [mode]`
// Prints laps, lap times and how long the car spent outside the track edge. No
// browser: it exists so the driver is tuned on the real physics in seconds.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { KeyboardDriver, headingOf } from './keyboard-driver.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (p) => import(pathToFileURL(join(root, p)).href);
const [circuit = 'aurel', vehicle = 'apx01', seconds = '150', mode = 'practice', optsJson = '{}'] =
  process.argv.slice(2);
const { Simulation } = await load('src/simulation/world.ts');
const { DEFAULT_OPTIONS, controls } = await load('src/simulation/config.ts');
const { circuitDefinition } = await load('src/simulation/circuits.ts');
const { F, HEADER, carBase } = await load('src/simulation/protocol.ts');

export function runDriver({ circuit, vehicle, seconds, mode, opponents = 0, driverOpts = {}, decision = 0.125 }) {
  const def = circuitDefinition(circuit);
  const sim = new Simulation(
    {
      ...DEFAULT_OPTIONS,
      mode,
      circuit,
      opponents,
      laps: 99,
      vehicles: Array(opponents + 1).fill(vehicle),
    },
    def,
  );
  const driver = new KeyboardDriver(sim.track, driverOpts);
  const frame = new Float32Array(HEADER + sim.cars.length * 331);
  const dt = 1 / 120;
  let steering = 0,
    clock = 0,
    last = -1,
    offTrack = 0,
    worst = 0,
    stuck = 0,
    maxSpeed = 0,
    firstOff = null;
  const laps = [];
  let lapsSeen = 0,
    input = controls();
  const total = Number(seconds) * 120;
  for (let tick = 0; tick < total; tick++) {
    if (sim.race.phase === 2 || mode !== 'race') {
      clock += dt;
      if (clock - last >= decision) {
        sim.writeFrame(frame);
        const o = carBase(0);
        const [fx, fz] = headingOf(
          frame[o + F.QX],
          frame[o + F.QY],
          frame[o + F.QZ],
          frame[o + F.QW],
        );
        const st = {
          x: frame[o + F.X],
          z: frame[o + F.Z],
          fx,
          fz,
          speed: frame[o + F.SPEED],
          s: frame[o + F.S],
        };
        const k = driver.decide(st, last < 0 ? decision : clock - last);
        last = clock;
        input = { ...controls(), throttle: Number(k.throttle), brake: Number(k.brake) };
        input.keys = k;
      }
    }
    const k = input.keys ?? { left: false, right: false };
    const want = Number(k.right) - Number(k.left);
    steering += Math.sign(want - steering) * Math.min(Math.abs(want - steering), dt * (Math.abs(want) < 0.001 ? 4.8 : 2.6));
    sim.setInput({ ...input, steer: -steering });
    sim.step(dt);
    if (tick % 12 === 0) {
      sim.writeFrame(frame);
      const o = carBase(0);
      const s = frame[o + F.S],
        lat = Math.abs(frame[o + F.LATERAL]);
      const half = sim.track.at(s, {}).width / 2;
      maxSpeed = Math.max(maxSpeed, frame[o + F.SPEED]);
      if (lat > half) {
        if (offTrack === 0) firstOff = { t: Number((tick / 120).toFixed(1)), s: Math.round(s), lat: Number(lat.toFixed(1)), kph: Math.round(frame[o + F.SPEED] * 3.6) };
        offTrack += 0.1;
      }
      worst = Math.max(worst, lat - half);
      if (frame[o + F.SPEED] < 2 && tick > 600) stuck += 0.1;
      const completed = frame[o + F.LAPS];
      if (completed > lapsSeen) {
        lapsSeen = completed;
        laps.push(Number(frame[o + F.LAST_LAP].toFixed(2)));
      }
    }
  }
  return {
    circuit,
    vehicle,
    seconds: Number(seconds),
    laps: laps.length,
    lapTimes: laps,
    offTrackSeconds: Number(offTrack.toFixed(1)),
    firstOff,
    worstExcessM: Number(worst.toFixed(2)),
    stuckSeconds: Number(stuck.toFixed(1)),
    maxKph: Math.round(maxSpeed * 3.6),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(
    JSON.stringify(runDriver({ circuit, vehicle, seconds, mode, driverOpts: JSON.parse(optsJson), decision: Number(process.env.DECISION ?? 0.125) })),
  );
