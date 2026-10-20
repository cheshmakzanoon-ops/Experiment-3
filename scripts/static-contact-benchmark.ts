/** Reproduce the same parking scenario against the current or another checkout:
 * node --experimental-transform-types scripts/static-contact-benchmark.ts [checkout]
 * JSON goes to stdout; this harness never writes a report into either checkout.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Vec3 } from '../src/core/math.ts';
import type { SurfaceSample, TrackPoint } from '../src/simulation/track.ts';

if (process.argv.length > 3) throw new Error('Expected at most one checkout path');
const root = realpathSync(
    resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url))),
  ),
  harnessPath = fileURLToPath(import.meta.url),
  hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex'),
  scenario = {
    gradeDegrees: 10,
    settleSeconds: 8,
    observationSeconds: 20,
    axes: ['x', 'z'] as const,
    ratesHz: [60, 120, 240] as const,
    vehicle: 'apx01',
    compound: 'medium',
    assistance: 'sport',
    fuelKg: 0,
    gear: 0,
    automaticShifting: false,
    throttle: 0,
    brake: 1,
    placementS: 0,
    placementOffsetM: 0,
  };

/** Content identity, including uncommitted source and the imported geometry
 * fixture. Paths and file hashes are sorted and delimited unambiguously. */
function sourceIdentity() {
  const files: [string, string][] = [];
  function visit(relative: string) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else files.push([path, hash(readFileSync(join(root, path)))]);
    }
  }
  visit('src/core');
  visit('src/simulation');
  files.push([
    'scripts/dynamics-fixtures.ts',
    hash(readFileSync(join(root, 'scripts/dynamics-fixtures.ts'))),
  ]);
  return {
    scope: ['src/core/**', 'src/simulation/**', 'scripts/dynamics-fixtures.ts'],
    fileCount: files.length,
    sha256: hash(JSON.stringify(files)),
  };
}

function gitIdentity() {
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    // An extracted revision nested inside another repository is not its HEAD.
    if (realpathSync(git('rev-parse', '--show-toplevel')) !== root) return null;
    return {
      head: git('rev-parse', 'HEAD'),
      dirty: git('status', '--porcelain', '--untracked-files=normal') !== '',
    };
  } catch {
    return null;
  }
}

const before = sourceIdentity(),
  harnessSHA256 = hash(readFileSync(harnessPath)),
  git = gitIdentity(),
  { Vehicle } = (await import(
    pathToFileURL(join(root, 'src/simulation/vehicle.ts')).href
  )) as typeof import('../src/simulation/vehicle.ts'),
  { DynamicsTrack } = (await import(
    pathToFileURL(join(root, 'scripts/dynamics-fixtures.ts')).href
  )) as typeof import('./dynamics-fixtures.ts'),
  { SIMULATION_VERSION } = (await import(
    pathToFileURL(join(root, 'src/core/session-identity.ts')).href
  )) as typeof import('../src/core/session-identity.ts');

/** Analytic plane only. Forces, wheel constraints, suspension and integration
 * all remain those of the selected checkout's production Vehicle. */
class InclineTrack extends DynamicsTrack {
  readonly grade = Math.tan((scenario.gradeDegrees * Math.PI) / 180);
  constructor(readonly axis: 'x' | 'z') {
    super();
  }
  override at(s: number, out: TrackPoint) {
    super.at(s, out);
    out.y = this.axis === 'z' ? this.grade * s : 0;
    out.gradient = this.axis === 'z' ? this.grade : 0;
    out.bank = this.axis === 'x' ? this.grade : 0;
    return out;
  }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    out.height = this.grade * (this.axis === 'x' ? x : z);
    out.normal
      .set(this.axis === 'x' ? -this.grade : 0, 1, this.axis === 'z' ? -this.grade : 0)
      .normalize();
    return out;
  }
  override cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    const denominator = down.y - this.grade * down[this.axis],
      distance = (this.grade * origin[this.axis] - origin.y) / denominator;
    if (denominator >= -1e-6 || distance < 0 || distance > maximum) return Infinity;
    this.sample(origin.x + down.x * distance, origin.z + down.z * distance, out);
    return distance;
  }
}

const measurements = [];
for (const axis of scenario.axes)
  for (const rateHz of scenario.ratesHz) {
    const track = new InclineTrack(axis),
      car = new Vehicle(0);
    car.place(track, scenario.placementS, scenario.placementOffsetM);
    car.fuel = scenario.fuelKg;
    car.gear = scenario.gear;
    car.autoShift = scenario.automaticShifting;
    car.input.throttle = scenario.throttle;
    car.input.brake = scenario.brake;
    for (let i = 0; i < scenario.settleSeconds * rateHz; i++) car.step(1 / rateHz, track);
    const start = car.body.position[axis];
    for (let i = 0; i < scenario.observationSeconds * rateHz; i++) car.step(1 / rateHz, track);
    measurements.push({
      axis,
      rateHz,
      driftM: car.body.position[axis] - start,
      endSpeedMps: car.body.velocity.length(),
      wheelsLocked: car.tires.every((tire) => tire.omega === 0),
    });
  }
const after = sourceIdentity(),
  stable = before.sha256 === after.sha256 && harnessSHA256 === hash(readFileSync(harnessPath));
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      checkout: root,
      simulationVersion: SIMULATION_VERSION,
      source: { git, before, after, stable, harnessSHA256 },
      inputSHA256: hash(JSON.stringify(scenario)),
      scenario,
      measurements,
    },
    null,
    2,
  ),
);
if (!stable) process.exitCode = 1;
