/** Reproducible tire-contact impulse/reversal audit, independent of rendering.
 * Run with Node's --experimental-transform-types. An optional checkout path
 * runs exactly the same inputs against another revision (including v12).
 * The reported work identity is a numerical contract, not measured tire data.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url))),
  { makeTire, solveTire } = (await import(
    pathToFileURL(join(root, 'src/simulation/tire.ts')).href
  )) as typeof import('../src/simulation/tire.ts'),
  { surfaceSample } = (await import(
    pathToFileURL(join(root, 'src/simulation/track.ts')).href
  )) as typeof import('../src/simulation/track.ts'),
  dt = 1 / 240,
  speed = 40,
  tire = makeTire('medium'),
  surface = surfaceSample(),
  inputs = Array.from({ length: 32 }, (_, i) => ({
    dt,
    speed,
    lateral: i < 4 ? 0 : i < 16 ? 4 : i < 20 ? -0.001 : -4,
    load: 2200,
    drive: 0,
    brake: 0,
    camber: 0,
  }));
tire.omega = speed / tire.radius;
const rows = inputs.map((p, step) => {
  const oldLongitudinalEnergyJ = tire.longitudinalEnergy,
    oldLateralEnergyJ = tire.lateralEnergy ?? null;
  solveTire(tire, p.speed, p.lateral, p.load, p.drive, p.brake, surface, p.camber, p.dt);
  return {
    step,
    lateralSpeed: p.lateral,
    fx: tire.fx,
    fy: tire.fy,
    actualLongitudinalWorkJ: tire.fx * (tire.omega * tire.radius - p.speed) * p.dt,
    actualLateralWorkJ: -tire.fy * p.lateral * p.dt,
    reportedSlipHeatJ: tire.energy * p.dt,
    oldLongitudinalEnergyJ,
    longitudinalEnergyJ: tire.longitudinalEnergy,
    longitudinalPhysicalHeatJ: tire.longitudinalDissipation * p.dt,
    longitudinalNumericalLossJ: tire.longitudinalNumericalDissipation * p.dt,
    oldLateralEnergyJ,
    lateralEnergyJ: tire.lateralEnergy ?? null,
    lateralPhysicalHeatJ:
      tire.lateralDissipation === undefined ? null : tire.lateralDissipation * p.dt,
    lateralNumericalLossJ:
      tire.lateralNumericalDissipation === undefined
        ? null
        : tire.lateralNumericalDissipation * p.dt,
    lateralDeflectionM: tire.lateralDeflection ?? null,
    camberInputJ: tire.camberPower === undefined ? null : tire.camberPower * p.dt,
    wear: tire.wear,
    surfaceTempC: tire.surfaceTemp,
  };
});
const totalWork = rows.reduce((sum, row) => sum + row.actualLateralWorkJ, 0),
  measuredLateral = rows.every(
    (row) => row.lateralPhysicalHeatJ !== null && row.lateralNumericalLossJ !== null,
  ),
  totalHeat = measuredLateral
    ? rows.reduce((sum, row) => sum + (row.lateralPhysicalHeatJ as number), 0)
    : null,
  totalNumerical = measuredLateral
    ? rows.reduce((sum, row) => sum + (row.lateralNumericalLossJ as number), 0)
    : null,
  finalEnergy = rows.at(-1)!.lateralEnergyJ,
  hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
console.log(
  JSON.stringify(
    {
      root,
      inputSHA256: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),
      harnessSHA256: hash(fileURLToPath(import.meta.url)),
      moduleHashes: Object.fromEntries(
        ['src/simulation/tire.ts', 'src/simulation/tyre-force.ts'].map((path) => [
          path,
          hash(join(root, path)),
        ]),
      ),
      lateralBudget: {
        actualWorkJ: totalWork,
        physicalHeatJ: totalHeat,
        numericalLossJ: totalNumerical,
        finalStoredEnergyJ: finalEnergy,
        residualJ:
          totalHeat !== null && totalNumerical !== null && finalEnergy !== null
            ? totalWork - totalHeat - totalNumerical - finalEnergy
            : null,
      },
      inputs,
      rows,
    },
    null,
    2,
  ),
);
