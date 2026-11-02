import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
const marker = 'status.dataset.presentationSettled = String(';
const start = source.indexOf(marker);
if (start < 0 || source.indexOf(marker, start + marker.length) !== -1)
  throw new Error('Expected exactly one actual settled publication expression');
const end = source.indexOf('\n      );', start);
if (end < 0) throw new Error('Settled expression terminator missing');
const expression = source
  .slice(start + marker.length, end)
  .trim()
  .replace(/,$/, '');
const evaluate = runInNewContext(`(state) => {
  const { paused, restartOwnership, surfacePreparation, environmentPreparation,
    stripePreparation, restartPresentation, graphicsRecovery, resizePending,
    presentation, graphics, gridPreparationValid, brakingTripletPreparationValid } = state;
  return (${expression});
}`) as (state: ReturnType<typeof stateFor>) => boolean;

// Independent truth contract: no flag, owner requirement, or exact validator may
// be removed just because the newly ordered positive path normally passes.
const guardNames = [
  'paused',
  'notRestartPending',
  'surface',
  'environment',
  'gantry',
  'lamps',
  'banner',
  'stripe',
  'notResetPresentation',
  'notRecovery',
  'notResize',
  'notPreparationPending',
  'notLost',
  'notDisposed',
  'notQueueFailure',
  'settled',
] as const;
const all = (1 << guardNames.length) - 1;
function stateFor(mask = all, gridValid = true, boardsValid = true) {
  const enabled = (bit: number) => !!(mask & (1 << bit));
  const grid = {},
    brakingTriplet = {};
  const calls = { grid: 0, boards: 0 };
  return {
    paused: enabled(0),
    restartOwnership: { pending: !enabled(1) },
    surfacePreparation: { completed: enabled(2) },
    environmentPreparation: {
      completed: enabled(3),
      gantry: { completed: enabled(4) },
      lamps: { completed: enabled(5) },
      banner: { completed: enabled(6) },
      grid,
      brakingTriplet,
    },
    stripePreparation: { completed: enabled(7) },
    restartPresentation: enabled(8) ? undefined : {},
    graphicsRecovery: { restartRequired: !enabled(9) },
    resizePending: !enabled(10),
    presentation: { pending: !enabled(11) },
    graphics: {
      lost: !enabled(12),
      disposed: !enabled(13),
      queue: { failure: enabled(14) ? null : new Error('existing queue failure') },
      settled: enabled(15),
    },
    gridPreparationValid(owner: unknown) {
      expect(owner).toBe(grid);
      calls.grid++;
      return gridValid;
    },
    brakingTripletPreparationValid(owner: unknown) {
      expect(owner).toBe(brakingTriplet);
      calls.boards++;
      return boardsValid;
    },
    calls,
  };
}

it.each(guardNames.map((name, bit) => ({ name, bit })))(
  'publishes false without full resource scans when cheap guard $name fails',
  ({ bit }) => {
    const state = stateFor(all & ~(1 << bit));
    expect(evaluate(state)).toBe(false);
    expect(state.calls).toEqual({ grid: 0, boards: 0 });
  },
);
it.each([
  [true, true],
  [false, true],
  [true, false],
  [false, false],
])('retains exact validators on every potentially ready path: grid %s A09 %s', (grid, boards) => {
  const state = stateFor(all, grid, boards);
  expect(evaluate(state)).toBe(grid && boards);
  expect(state.calls).toEqual({ grid: 1, boards: grid ? 1 : 0 });
  // No cached success: subsequent mutation must be revalidated immediately.
  if (grid && boards) {
    state.brakingTripletPreparationValid = () => {
      state.calls.boards++;
      return false;
    };
    expect(evaluate(state)).toBe(false);
    expect(state.calls).toEqual({ grid: 2, boards: 2 });
  }
});
it('preserves the complete Boolean truth table of all sixteen cheap requirements and both validators', () => {
  for (let mask = 0; mask <= all; mask++)
    for (const grid of [false, true])
      for (const boards of [false, true]) {
        const state = stateFor(mask, grid, boards);
        expect(evaluate(state)).toBe(mask === all && grid && boards);
      }
});
it('fails closed for absent environment ownership instead of calling a resource validator', () => {
  const state = stateFor();
  Object.assign(state, { environmentPreparation: undefined });
  expect(evaluate(state)).toBe(false);
  expect(state.calls).toEqual({ grid: 0, boards: 0 });
});
