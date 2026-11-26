# Assignment 28 — compliant suspension virtual work

## Decision

**Independent review completed; no production change accepted.** The compliant
suspension has a real mismatch between its gap derivative and its pitch-force
arm. Replacing that arm alone is not a safe correction to this reduced model.
An experiment covering both internal force stages and their numerical frequency
still turns every sampled player table jump into a rear-first crash and breaks
the MX450 wheelie failure transition. This work does not claim that the existing
spring model is conservative, or that the rejected experiment is an improved
vehicle model.

The review changes this report and retains the complete, read-only trial in
`scripts/bench/motocross-spring-work.ts`. It does not change models, character
assets, terrain, venues, calibration values, crash limits, tests or production source.
No source-level test was added to encode a known residual as desirable behavior,
or to imply acceptance of the rejected replacement.

## Equations and sign convention

For either axle, let `a` be its signed fore/aft arm (`+fa` at the front and
`-ra` at the rear), and let `H` be the corresponding fixed free-wheel height.
With positive pitch lifting the front, the adapter's compression coordinate is

```text
c = terrainHeight - cgY - a * sin(pitch) + H * cos(pitch)
J = a * cos(pitch) + H * sin(pitch)
```

Holding the sampled terrain fixed, its compression rate is
`-vy - J * pitchRate`. The actual code also includes the terrain-height changes
from forward, sideways and yaw motion. The same full `J` is already used by
the damper, projected hard stops, swept contact prediction and bottoming-rate
observation.

For the potential whose compression derivative is the spring force `F`, the
matching generalized pitch torque is `F * J`. The compliant torque currently
uses `F * a * cos(pitch)` instead. The omitted port summed over the two axles is

```text
sin(pitch) * (HF * forceFront + HR * forceRear)
```

This omission occurs in both the initial force evaluation and the subsequent
internal support stages. The bump-stop timestep frequency deliberately combines
the full gap derivative with the shorter force arm. Updating only the initial
torque would therefore leave two different compliant models within a timestep.

This is an accounting statement about the adapter's reduced heave/pitch
coordinates. It is not a claim that the entire motorcycle has only these energy
ports. Drive, tyre shear, the changing sampled height field, rider actuation,
collision projection and damping all exchange energy elsewhere. A complete
support redesign must also settle the relationship between the vertical spring
force, the terrain-normal reaction and the separately integrated grounded speed.

## Independent quantitative checks

The existing read-only `scripts/bench/motocross-spring-work.ts` contains a spring
potential antiderivative, central-difference virtual-work checks, a closed
configuration-space loop and public `DirtBikeVehicle.step()` rides. Its analytic
checks ran successfully against the current source.

| Quantity | MX250 | MX450 |
| --- | ---: | ---: |
| Nonzero work around the benchmark's closed configuration loop, current arm | 1.744832221 J | 1.839399748 J |
| Same loop with the full geometric arm | approximately 0.000000001 J | approximately 0.000000001 J |
| Omitted torque at +0.30 rad with the benchmark's 80/100 mm strokes | +551.231394003 Nm | +581.037781925 Nm |
| Geometric rear-only balance pitch | 0.664928967 rad | 0.659938199 rad |
| Current restoring rear moment at that geometric balance point | -1002.805104005 Nm | -1043.478622147 Nm |
| Current isolated rear-damper pitch power at 0.8 rad, 1 rad/s and zero heave | +265.966675115 W | +276.690347076 W |
| Same damper with the full geometric port | -83.316429722 W | -90.434507186 W |

The last two rows use a supported 150 mm rear stroke. The damper plus spring
force remains positive, so the non-tensile force clamp does not remove this
example. The damper itself is dissipative in compression space; using a different
pitch arm can give its pitch contribution the opposite sign.

The force correction also changes static initialization. On the benchmark's
+30% grade, solving force balance using the complete geometric arm reduces front
support from about 861 N to 464 N for MX250, and from about 893 N to 476 N for
MX450. It changes equilibrium pitch by about +2.41/+2.43 degrees and fork stroke
by about -33.4/-33.7 mm. These figures are properties of that isolated reduced
equilibrium experiment, not measurements of a full motorcycle at rest with all
its longitudinal contact reactions applied.

## Counterfactual scope and implementation

At the start of this assignment, the benchmark imported a temporary adapter
through a data URL after replacing one torque expression. It never wrote a
production file. That original trial was unscoped and changed only the initial
force stage; it was not a complete implementation of the proposed correction.

A second temporary experiment copied the same benchmark and changed all of the
following in its in-memory adapter:

1. Add `(FF * HF + FR * HR) * sin` to the initial torque only when
   `this.playerMotocross` is true.
2. Add `(stageFF * HF + stageFR * HR) * localSin` to every refreshed stage torque,
   under the same eligibility condition.
3. Replace the front compliance term
   `abs(fa * cos * (fa * cos + HF * sin))` with
   `(fa * cos + HF * sin) ** 2`.
4. Replace the rear compliance term
   `abs(ra * cos * (-ra * cos + HR * sin))` with
   `(-ra * cos + HR * sin) ** 2`.

The frequency calculation is already inside the player-MX branch. No spring
rates, damping, preload, rider inputs, wheel contacts, track geometry, launch
assist, initial equilibrium, crash threshold or pitch limit changed in the
trial. Relative imports were resolved to the production adapter's absolute
module URL before loading the data URL.

The complete trial is now retained in the existing benchmark, replacing its
earlier single-expression counterfactual. Its default run still reads production
source without modifying it, computes the analytic diagnostics and prints JSON
to stdout. It explicitly labels the counterfactual as rejected. An exact
comparison asserts that all four complete AI control result objects stay equal
between the two variants. There is no production toggle or generated source file.

### Public player jumps

Both bikes used Sport, the production `rideLine` input controller, 240 Hz, the
Valley Ridge `RIDGE TABLE` at 13.5 m/s and Arena Nord `TABLETOP` at 13 m/s. Each
run covered up to six simulated seconds. The player cases did not enable AI
ownership. Four corresponding AI-owned controls were also run.

| Player case | Current landing outcome | Trial landing outcome | Current pitch error | Trial pitch error |
| --- | --- | --- | ---: | ---: |
| MX250, Valley Ridge | bottomed; no crash | crash-rear | +0.000078942 rad | +1.307204700 rad |
| MX250, Arena Nord | bottomed; no crash | crash-rear | -0.076620504 rad | +1.257809762 rad |
| MX450, Valley Ridge | bottomed; no crash | crash-rear | +0.061850544 rad | +1.298288917 rad |
| MX450, Arena Nord | bottomed; no crash | crash-rear | -0.013172914 rad | +1.259913322 rad |

All four complete AI result objects were exactly equal between the production
and player-scoped trial after removing the descriptive variant field. This
check demonstrates the intended branch isolation for those controls; it is not
the broader five-discipline preservation gate.

### Public wheelies

One-second Raw full-throttle starts at the existing Valley Ridge test station
were exercised at 240 and 480 Hz.

| Bike and rate | Current result | Trial result |
| --- | --- | --- |
| MX250, 240 Hz | loop-out at 0.7375 s | loop-out at 0.570833333 s |
| MX250, 480 Hz | loop-out at 0.764583333 s | loop-out at 0.570833333 s |
| MX450, 240 Hz | loop-out at 0.6625 s | reaches 1.2 rad pitch clamp; no crash within 1 s |
| MX450, 480 Hz | loop-out at 0.658333333 s | reaches 1.2 rad pitch clamp; no crash within 1 s |

The initial unscoped, single-stage experiment also caused rear-first crashes in
all eight table-jump cases, including AI. The player-scoped, complete-stage
experiment rules out the stale stage omission and unscoped AI branch as the
explanation for the four player regressions.

## Acceptance evidence and provenance

Commands executed directly, without npm lifecycle hooks:

```bash
node --max-old-space-size=512 --experimental-transform-types scripts/bench/motocross-spring-work.ts
node --max-old-space-size=512 --experimental-transform-types /home/agent/motobound-spring-work-agent28-full-579b454ae846.ts
node node_modules/vitest/vitest.mjs run tests/motocross-contact-consistency.test.ts tests/motocross-riding.test.ts --maxWorkers=1
node node_modules/eslint/bin/eslint.js scripts/bench/motocross-spring-work.ts
```

The temporary full-stage script was used during investigation. The first command
now reproduces that complete scoped experiment directly from the retained script;
the temporary file is not required to repeat it.

Both read-only experiments completed with exit code 0 and their analytic
assertions intact. The production unit check passed **47/47 tests in two files**
(20 contact-consistency and 27 riding tests). Passing production tests do not
erase the analytic residual above. No trial was written into the production
checkout or accepted based only on its analytic work result.

The retained benchmark was rerun successfully after editing: it reproduced zero
crashes across the four current player cases versus four crashes in the trial,
and its exact AI equality assertions passed. Focused ESLint and `git diff --check`
also passed. This assignment did not run full-repository types, full-grid races
or browser tests; those remain integrated acceptance work.

Adapter SHA-256 values captured by each experiment:

- Existing benchmark run:
  `74df162bfee32214260d44db856d5d6085595d98ba14165fc61f59520b89d042`
- Player-scoped complete-stage run:
  `dfb25f5b373bf9695b7ac49c7111619e3d3ea869d05075fb0e11372987c52fad`

Other owners were integrating changes between these runs. Each comparison uses
the production and counterfactual classes loaded within its own process; these
hashes identify intermediate evidence, not the final accepted source. Raw
temporary results are in the task workspace under
`motobound-spring-work-agent28-579b454ae846.json` and
`motobound-spring-work-agent28-full-579b454ae846.json`.

## Follow-up boundary

A future conservative suspension redesign should change the force geometry,
static support initialization, drive-reaction torque and launch/wheelie handling
as one physically specified model, then pass real player riding and existing
calibrations before adoption. It should verify both internal stages, supported
grade equilibria, damper power, takeoff momentum, wheelie balance and the
recorded failure transitions. Updating an isolated torque term and then tuning
away the resulting crashes would not establish that model.
