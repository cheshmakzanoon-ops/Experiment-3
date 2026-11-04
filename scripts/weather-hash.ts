// Determinism witness for the weather presets: SHA-256 of the FULL presented
// snapshot (every header slot, every car block) plus the physical road state
// grids, at fixed session times, for a 3-car seeded session per preset.
// Run it on a baseline commit and on a branch and diff the two JSON files: a
// preset whose physics must not change has to produce identical hashes.
//
//   node --experimental-transform-types scripts/weather-hash.ts \
//     [--weathers clear,changeable,rain] [--times 50,100,150] [--out file.json] [--vehicle gpr1]
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS, type WeatherPreset } from '../src/simulation/config.ts';

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const weathers = arg('weathers', 'clear,changeable,rain,fog,storm,dust').split(
  ',',
) as WeatherPreset[];
const times = arg('times', '50,100,150').split(',').map(Number);
const out = arg('out', '');
const vehicle = arg('vehicle', '');
const DT = 1 / 120;

const sha = (...parts: ArrayBufferView[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
  return h.digest('hex').slice(0, 16);
};

const result: Record<string, Record<string, { frame: string; road: string }>> = {};
for (const weather of weathers) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit: 'aurel',
    mode: 'race',
    laps: 3,
    opponents: 2,
    weather,
    seed: 4417,
    ...(vehicle ? { vehicles: Array(3).fill(vehicle) } : {}),
  });
  sim.autoPlayer = true;
  const frame = new Float32Array(sim.makeFrame().length);
  const rows: Record<string, { frame: string; road: string }> = {};
  let next = 0;
  for (let tick = 0; next < times.length; tick++) {
    sim.step(DT);
    if (sim.race.time >= times[next]) {
      sim.writeFrame(frame);
      const t = sim.track;
      rows[String(times[next])] = {
        frame: sha(frame),
        road: sha(t.water, t.rubber, t.marbles, t.temperature, t.substrateTemperature),
      };
      next++;
    }
    if (tick > 400 * 120) throw new Error('session did not reach the requested time');
  }
  result[weather] = rows;
  console.log(weather.padEnd(11), JSON.stringify(rows));
}
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
