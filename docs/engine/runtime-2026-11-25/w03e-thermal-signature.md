# W03E — frozen default thermal signature

Assignment 17/60, wave 3. Read `SESSION.md`, W01E and the prior engine
advancement surface/cache contracts. Production ownership is limited to
`src/simulation/surface-thermal.ts`; added only
`tests/engine-frozen-thermal-signature.test.ts` and this report.

## Change

`prepareMatrix()` skips its repeated signature refresh only when
`parameters === SURFACE_THERMAL`. That exported object is frozen, and
`prepare()` still refreshes the signature after setting timestep and air
transfer. Both actual Track solvers use this default object.

Every caller-owned parameter object retains the existing per-rainfall
refresh, including mutable matrix-parameter edits between cells. The
existing same-rain early return remains in its original position. No
arithmetic, coefficients, cache storage/order, weather validation, physics,
tuning, Track code or protected content changed.

## Exactness and operation evidence

The temporary probe loaded the actual original thermal module from session
baseline `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`, changing only import URLs
and stripping TypeScript for execution. Original-source SHA-256:
`9af1582d816e0600512c550d3dbed465f08425b903691e6230d05e54b2bf5c12`.

- **3,084 default columns / 12,336 scalar comparisons**, all `Object.is`
  exact: two passes over 128 cell slots for 12 preparations, plus standalone
  `advance()` rainfall restoration. Covered clear/wet rain, changing ambient,
  cloud and wind, sheltered exposure, dt 0.5/0.25/1/0.125, zero film and
  drainage of 1e-15.
- **20 mutable columns / 80 scalar comparisons**, all exact against the
  original module: each matrix parameter edited after preparation, same-rain
  calls retained their previous matrix, then changed rain invalidated both
  previously populated cell slots.
- Actual default Aurel `Track.evolve` ran four 0.5-second updates for each
  preset below. For the original comparator, only the thermal matrix method
  was replaced with the baseline module's method; all other Track code and
  inputs were shared. Six complete surface arrays (temperature, substrate
  temperature, water, rubber, marbles and frozen cover) matched byte-for-byte
  after every tick: **1,032,192 bytes**, plus **132 exact weather/clock scalars**.

| Preset | Cell updates | Matrix requests, both | Original refreshes | New refreshes | `log1p`, both |
| ------ | -----------: | --------------------: | -----------------: | ------------: | ------------: |
| Clear  |       14,336 |                14,344 |                 10 |             8 |        14,336 |
| Rain   |       14,336 |                14,344 |             14,349 |             8 |             0 |
| Storm  |       14,336 |                14,344 |             14,349 |             8 |             0 |

The eight refreshes are the two exposure preparations per update. This is an
operation-count result, not a measured elapsed-time, Simulation or FPS gain.
No additional persistent storage is introduced.

## Focused verification

Passed **30 tests in three files**: new frozen-signature suite (8), existing
surface-coefficients suite (7), existing surface-thermal suite (15).

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-frozen-thermal-signature.test.ts tests/engine-surface-coefficients.test.ts tests/surface-thermal.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
```

Exactness/operation probe, retained as session-local reproducible work:

```sh
NODE_OPTIONS=--max-old-space-size=512 node --no-warnings --experimental-transform-types /home/agent/motobound-engine-1a587ba11b3c/tmp/w03e-thermal-exact.mjs
```

Limits: four ticks per Track preset are a narrow caller witness; variable dt
is direct-solver coverage because Track uses fixed half-second surface ticks.
No full Simulation comparison, reserved timing benchmark, browser/native run,
compiler/full build, dependency operation or Git mutation was performed by
this agent. Root owns the hosted compiler/build gates.
