/** Same-tick comparison of actual baseline and candidate engine modules.
 * Usage: node --experimental-transform-types scripts/engine-determinism-check.mjs
 *          --baseline /path/to/baseline [--ticks 2400] [--scenario formula]
 * Each engine/scenario runs in a fresh, sequential child. Only temporary traces
 * are written; the baseline checkout and all game assets remain untouched.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const self = fileURLToPath(import.meta.url);
const candidateRoot = resolve(dirname(self), '..');
const DT = 1 / 120;
const SCENARIOS = [
  {
    id: 'formula',
    kind: 'circuit',
    options: { mode: 'practice', vehicles: Array(4).fill('apx01') },
  },
  {
    id: 'road-car-wet',
    kind: 'circuit',
    options: { mode: 'practice', weather: 'rain', vehicles: Array(4).fill('tc1') },
  },
  {
    id: 'motogp-wet',
    kind: 'circuit',
    options: {
      mode: 'practice',
      circuit: 'aurel',
      weather: 'rain',
      vehicles: ['gpr1', 'gpr2', 'sbk1000', 'gpr1'],
    },
  },
  {
    id: 'motocross',
    kind: 'circuit',
    options: {
      mode: 'race',
      circuit: 'valley-ridge-mx',
      ruleset: 'motocross-moto',
      vehicles: ['mx450', 'mx250', 'mx450', 'mx250'],
    },
  },
  { id: 'festival-traffic', kind: 'festival', options: { vehicle: 'tc1', traffic: true } },
  {
    id: 'festival-event',
    kind: 'festival',
    options: { vehicle: 'tc1', traffic: true },
    event: 'valley-sprint',
  },
];

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function sourceIdentity(root) {
  const files = git(root, 'ls-files', '-z', '--', 'src/core', 'src/simulation')
    .split('\0')
    .filter(Boolean);
  const hash = createHash('sha256');
  for (const path of files)
    hash
      .update(path)
      .update('\0')
      .update(readFileSync(join(root, path)));
  return {
    revision: git(root, 'rev-parse', 'HEAD'),
    files: files.length,
    sha256: hash.digest('hex'),
  };
}

function checkedTicks(value) {
  const ticks = Number(value ?? 2400);
  assert(
    Number.isSafeInteger(ticks) && ticks >= 1 && ticks <= 120 * 600,
    'ticks must be an integer in [1, 72000]',
  );
  return ticks;
}

/** A stable, independent control generator; every call returns a fresh object. */
function driver(controls, tick) {
  let seed = (0x50d37e11 ^ Math.floor(tick / 60)) >>> 0;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  const random = (seed >>> 0) / 0x100000000;
  return {
    ...controls(),
    throttle: tick % 480 < 360 ? 0.68 + random * 0.3 : 0.15,
    brake: tick % 480 >= 360 ? 0.28 : 0,
    steer: (random - 0.5) * 0.075,
    rearBrake: tick % 600 >= 540 ? 0.18 : 0,
    riderLean: (random - 0.5) * 0.5,
    ers: tick % 600 < 120 ? 2 : 1,
    overtake: tick % 600 === 0,
    drs: tick % 480 < 180,
  };
}

/** Numeric vehicle state beyond the Float32 presentation frame. The schema is
 * checked byte-for-byte as well, so added/removed numeric fields cannot vanish
 * silently from a comparison. Runtime scratch vectors and static definitions
 * are not recursively serialized. */
function preciseState(sim) {
  const names = [],
    values = [];
  const add = (name, value) => {
    if (typeof value === 'number') {
      names.push(name);
      values.push(value);
    } else if (typeof value === 'boolean') {
      names.push(`${name}:bool`);
      values.push(Number(value));
    }
  };
  const scalars = (prefix, object) => {
    for (const key of Object.keys(object).sort()) add(`${prefix}.${key}`, object[key]);
  };
  for (let id = 0; id < sim.cars.length; id++) {
    const car = sim.cars[id],
      prefix = `car${id}`;
    scalars(prefix, car);
    for (const key of [
      'position',
      'orientation',
      'velocity',
      'omega',
      'force',
      'torque',
      'acceleration',
      'angularAcceleration',
      'inertia',
    ])
      scalars(`${prefix}.body.${key}`, car.body[key]);
    add(`${prefix}.body.mass`, car.body.mass);
    for (let wheel = 0; wheel < car.tires.length; wheel++)
      scalars(`${prefix}.tire${wheel}`, car.tires[wheel]);
    for (const key of ['normalLoads', 'wheelSteering', 'wheelCamber', 'cornerDamage', 'jacking'])
      for (let i = 0; i < car[key].length; i++) add(`${prefix}.${key}${i}`, car[key][i]);
    for (const key of ['input', 'clutch', 'engine', 'aero', 'hub', 'dynamics'])
      if (car[key]) scalars(`${prefix}.${key}`, car[key]);
  }
  return {
    schema: Buffer.from(JSON.stringify(names)),
    numbers: Buffer.from(Float64Array.from(values).buffer),
  };
}

function readExactly(fd, size) {
  const out = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, out, offset, size - offset, null);
    assert(count > 0, 'baseline trace ended early');
    offset += count;
  }
  return out;
}

async function sample(mode, root, trace, scenarioId, ticks) {
  const scenario = SCENARIOS.find((entry) => entry.id === scenarioId);
  assert(scenario, `unknown scenario ${scenarioId}`);
  const load = (path) => import(pathToFileURL(join(root, path)).href);
  const { DEFAULT_OPTIONS, controls } = await load('src/simulation/config.ts');
  const protocol = await load('src/simulation/protocol.ts');
  const festival = scenario.kind === 'festival';
  const sim = festival
    ? new (await load('src/simulation/open-world/session.ts')).OpenWorldSimulation({
        seed: 73021,
        tileBudget: 24,
        ...scenario.options,
      })
    : new (await load('src/simulation/world.ts')).Simulation({
        ...DEFAULT_OPTIONS,
        opponents: 3,
        seed: 73021,
        ...scenario.options,
      });
  if (scenario.event) {
    sim.command({ type: 'autopilot', value: true });
    sim.command({ type: 'start', event: scenario.event });
  }
  const fd = openSync(trace, mode === 'capture' ? 'wx' : 'r');
  const digest = createHash('sha256');
  const sections = { frame: 0, schema: 0, precise: 0, traffic: 0, status: 0 };
  let comparedBytes = 0,
    maxSpeed = 0,
    peakEntrants = 0,
    peakTraffic = 0;
  const observations = [];
  const record = (tick, label, data) => {
    const size = Buffer.allocUnsafe(4);
    size.writeUInt32LE(data.length);
    if (mode === 'capture') {
      writeSync(fd, size);
      writeSync(fd, data);
    } else {
      const length = readExactly(fd, 4).readUInt32LE();
      assert.equal(length, data.length, `${scenarioId}: ${label} length differs at tick ${tick}`);
      const expected = readExactly(fd, length);
      if (!expected.equals(data)) {
        const byte = data.findIndex((value, index) => value !== expected[index]);
        throw new Error(
          `${scenarioId}: ${label} differs at tick ${tick}, byte ${byte} (baseline ${expected[byte]}, candidate ${data[byte]})`,
        );
      }
    }
    digest.update(size).update(data);
    comparedBytes += data.length;
    sections[label]++;
  };
  try {
    for (let tick = 0; tick <= ticks; tick++) {
      if (tick > 0) {
        if (!scenario.event) {
          if (tick % 60 === 1) sim.setInput(driver(controls, tick - 1));
          const auto = tick >= Math.floor(ticks * 0.45) && tick < Math.floor(ticks * 0.7);
          if (festival) {
            if (sim.autopilot !== auto) sim.command({ type: 'autopilot', value: auto });
          } else sim.autoPlayer = auto;
        }
        sim.step(DT);
      }
      assert.equal(sim.tick, tick, `${scenarioId}: unexpected simulation tick`);
      const frame = sim.makeFrame();
      for (const value of frame)
        assert(Number.isFinite(value), `${scenarioId}: nonfinite snapshot at tick ${tick}`);
      // Both engines receive writeFrame's unchanged timing defaults (0, 0).
      // No frame field or byte is removed, normalized or rounded.
      assert.equal(frame[protocol.H.STEP_MS], 0);
      assert.equal(frame[protocol.H.DROPPED], 0);
      record(tick, 'frame', Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
      const precise = preciseState(sim);
      record(tick, 'schema', precise.schema);
      record(tick, 'precise', precise.numbers);
      maxSpeed = Math.max(maxSpeed, ...sim.cars.map((car) => car.speed));
      peakEntrants = Math.max(peakEntrants, sim.cars.length);
      if (festival) {
        const traffic = sim.trafficFrame();
        record(
          tick,
          'traffic',
          Buffer.from(traffic.buffer, traffic.byteOffset, traffic.byteLength),
        );
        peakTraffic = Math.max(peakTraffic, sim.traffic.cars.length);
        // Tile cache residency/work counters intentionally change under the
        // new prefetch policy. Compare gameplay status, retaining every other
        // field; exclude this explicitly identified operational subtree only.
        const { streaming: _streaming, ...status } = sim.status();
        record(tick, 'status', Buffer.from(JSON.stringify(status)));
      }
      if (tick === 0 || tick === ticks || tick % 600 === 0)
        observations.push({
          tick,
          phase: festival ? sim.mode : sim.race.phase,
          cars: sim.cars.length,
          playerSpeed: sim.cars[0].speed,
        });
    }
    if (mode === 'compare')
      assert.equal(
        readSync(fd, Buffer.alloc(1), 0, 1, null),
        0,
        'unexpected trailing baseline bytes',
      );
  } finally {
    closeSync(fd);
  }
  return {
    scenario: scenarioId,
    options: sim.options,
    ticks,
    observations: ticks + 1,
    sections,
    comparedBytes,
    sha256: digest.digest('hex'),
    peakEntrants,
    peakTraffic,
    maxSpeedMps: maxSpeed,
    checkpoints: observations,
    maxRssKiB: process.resourceUsage().maxRSS,
    protocol: {
      version: protocol.PROTOCOL_VERSION,
      header: protocol.HEADER,
      carStride: protocol.CAR_STRIDE,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--capture' || args[0] === '--compare') {
    const [mode, root, trace, scenario, ticks] = args;
    console.log(
      JSON.stringify(
        await sample(mode.slice(2), resolve(root), trace, scenario, checkedTicks(ticks)),
      ),
    );
    return;
  }
  const option = (flag) => {
    const at = args.indexOf(flag);
    return at < 0 ? undefined : args[at + 1];
  };
  const baselineArg = option('--baseline');
  assert(baselineArg, 'Provide --baseline /path/to/original/checkout');
  const baseline = resolve(baselineArg),
    ticks = checkedTicks(option('--ticks'));
  assert.notEqual(baseline, candidateRoot, 'baseline and candidate must be different checkouts');
  assert.equal(
    git(baseline, 'status', '--porcelain', '--', 'src/core', 'src/simulation'),
    '',
    'baseline engine sources must be clean',
  );
  const selected = option('--scenario');
  const scenarios = selected ? SCENARIOS.filter((entry) => entry.id === selected) : SCENARIOS;
  assert(scenarios.length, `unknown scenario ${selected}`);
  const before = { baseline: sourceIdentity(baseline), candidate: sourceIdentity(candidateRoot) };
  const temporary = mkdtempSync(join(tmpdir(), 'engine-determinism-'));
  const reports = [];
  const child = (mode, root, trace, scenario) => {
    const result = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=768',
        '--experimental-transform-types',
        '--no-warnings',
        self,
        `--${mode}`,
        root,
        trace,
        scenario,
        String(ticks),
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    if (result.status !== 0)
      throw new Error(
        `${scenario} ${mode} failed (${result.signal ?? result.status}):\n${result.stderr}\n${result.stdout}`,
      );
    return JSON.parse(result.stdout);
  };
  try {
    for (const scenario of scenarios) {
      const trace = join(temporary, `${scenario.id}.trace`);
      const expected = child('capture', baseline, trace, scenario.id);
      const actual = child('compare', candidateRoot, trace, scenario.id);
      assert.equal(actual.sha256, expected.sha256);
      reports.push({
        ...actual,
        baselineMaxRssKiB: expected.maxRssKiB,
        candidateMaxRssKiB: actual.maxRssKiB,
      });
      unlinkSync(trace);
      console.error(
        `${scenario.id}: ${actual.observations} complete snapshots and precise states matched; ${actual.comparedBytes} bytes compared`,
      );
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  const after = { baseline: sourceIdentity(baseline), candidate: sourceIdentity(candidateRoot) };
  assert.equal(
    after.baseline.sha256,
    before.baseline.sha256,
    'baseline sources changed during comparison',
  );
  assert.equal(
    after.candidate.sha256,
    before.candidate.sha256,
    'candidate sources changed during comparison',
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        node: process.version,
        architecture: process.arch,
        timestepSeconds: DT,
        source: before,
        comparedBytes: reports.reduce((sum, report) => sum + report.comparedBytes, 0),
        observations: reports.reduce((sum, report) => sum + report.observations, 0),
        frameExclusions: [],
        statusExclusions: ['FestivalStatus.streaming (terrain residency/work statistics)'],
        scenarios: reports,
      },
      null,
      2,
    ),
  );
}

await main();
