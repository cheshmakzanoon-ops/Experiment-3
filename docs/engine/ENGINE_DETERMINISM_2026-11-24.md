# Engine determinism evidence — 24 November 2026

## Result

All six baseline/candidate scenarios passed. Each ran **2,400 fixed ticks at
120 Hz**, or **20 simulated seconds**, and compared the initial state plus every
subsequent tick. In total, **14,406 complete presentation snapshots and selected
high-precision vehicle-state records matched byte for byte**. The two Festival
scenarios additionally compared 4,802 traffic snapshots and gameplay-status
records.

This check imports and executes the actual original and improved simulation
modules in separate processes. It does not compare the improved engine against
a newly generated expectation from itself. The reusable harness is
[`scripts/engine-determinism-check.mjs`](../../scripts/engine-determinism-check.mjs);
the complete machine-readable receipt is
[`ENGINE_DETERMINISM_2026-11-24.json`](ENGINE_DETERMINISM_2026-11-24.json).

## Source boundary

| Item | Revision |
|---|---|
| Original engine | [`a0ae513e7982f0b4719296519752e0ae5f1983f8`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/a0ae513e7982f0b4719296519752e0ae5f1983f8) |
| Improved engine through wave 8 | [`c4e62c642d912037e5e9262b1b89d4fbfd9677fe`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/c4e62c642d912037e5e9262b1b89d4fbfd9677fe) |

The harness requires a clean baseline `src/core` and `src/simulation` tree. It
hashes every tracked file in those two directories before and after the complete
run and fails if either tree changes during execution. Both manifests contained
189 files and remained unchanged. Their SHA-256 digests were:

- Original: `37e137aee5380dd562f87d8b1ca1a3bc689df60827f04b372045911fef582e01`
- Improved: `acb982165cab861986c88ef021e58dceffcf8403c60ccf8ea2edc883d8eb3d49`

These receipts describe the wave 8 source boundary. Subsequent engine changes
require another comparison if they can affect the simulated outputs.

## Scenarios and observed coverage

All scenarios use seed 73021. Non-event scenarios receive a fresh, deterministic
control object every 60 ticks, varying throttle, service brake, steering, rear
brake, rider lean, ERS, overtake and DRS requests. The player hands over to the
existing autopilot between ticks 1,080 and 1,679 and then resumes scripted input.
The Festival event uses its normal route-following autopilot throughout.

| Scenario | Actual engine and vehicles | Observations compared | Relevant observed behavior |
|---|---|---:|---|
| Formula | `Simulation`, four `apx01` entrants, clear practice | 2,401 | All four entrants run; the field reaches 81.815 m/s |
| Wet road cars | `Simulation`, four `tc1` entrants, rainy practice | 2,401 | Scripted controls and AI handover on wet pavement |
| Wet road motorcycles | `Simulation`, `gpr1`, `gpr2`, `sbk1000`, `gpr1`, rainy Aurel practice | 2,401 | Road-bike adapters, separate rear brake and AI handover |
| Motocross | `Simulation`, alternating `mx450`/`mx250`, Valley Ridge MX, motocross race | 2,401 | Grid/countdown/racing transitions; terrain and rider-lean controls |
| Festival traffic | `OpenWorldSimulation`, `tc1`, traffic enabled, 24-tile budget | 2,401 | Free roam, an encountered event card, route autopilot and up to 17 ambient vehicles |
| Festival event | `OpenWorldSimulation`, `tc1`, `valley-sprint` | 2,401 | Four entrants; countdown to a running route race; traffic correctly absent during the event |

The Formula, road-car, road-motorcycle and motocross entries exercise their
existing dynamics adapters through the shared circuit simulation. Festival
exercises its separate session runtime and shared vehicle systems. The commercial
game/style names used in the request do not represent four imported game engines.

## What is compared

Each tick compares the **entire Float32 presentation buffer**, including all
header and entrant fields, as raw bytes. Protocol version 17, header size 24 and
car stride 331 agree. No snapshot field is discarded, rounded, normalized or
hidden. The simulation writes its ordinary default diagnostic timing arguments,
`stepMs = 0` and `dropped = 0`, in both processes; these fields are checked too.
Every snapshot is also required to contain only finite values.

Beyond the Float32 output, the harness compares Float64 encodings of selected
vehicle state: all own numeric/boolean vehicle scalars; body position,
orientation, velocity, angular velocity, force, torque, acceleration, angular
acceleration, inertia and mass; tyre scalars; per-wheel loads, steering, camber,
damage and jacking; and numeric/boolean input, clutch, engine, aero, hub and bike
dynamics scalars. It compares the ordered field-name schema as well, so a missing
or added captured field cannot silently disappear. It does not recursively
serialize every internal object, scratch vector or static definition.

Festival additionally compares every raw traffic-frame byte and the JSON encoding
of each gameplay status. **`FestivalStatus.streaming` is the sole excluded status
subtree.** It contains terrain residency and work counters, which intentionally
change with the new cache/prefetch policy and can depend on work-budget timing.
No vehicle position, route progress, traffic pose or gameplay-status field is
excluded on that basis.

The candidate reads the baseline's temporary trace and performs direct buffer
equality on each section at each tick. A mismatch reports its scenario, tick,
section and byte offset. SHA-256 digests are additional receipts, not a substitute
for the per-record byte comparison. The aggregate 673,708,384 compared bytes
include repeated field schemas and status text as well as numeric output; this
number is not the size of the game's live state.

## Reproduction and resource use

With both revisions checked out and the existing dependencies available:

```sh
node --experimental-transform-types scripts/engine-determinism-check.mjs \
  --baseline /path/to/clean-original-checkout --ticks 2400
```

The baseline directory is an argument; no workspace-specific directory is embedded
in the script. `--scenario formula` can select one of the six named scenarios.
The script emits the JSON receipt on stdout and progress messages on stderr. It
uses direct Node execution and never runs asset-generating npm lifecycle hooks.

The completed run used Node 24.22.3 on x64. Each baseline or candidate scenario
ran in a fresh sequential child with a 768 MiB heap limit. Observed peak process
RSS was approximately 209–246 MiB; a single temporary trace reached about 154 MB.
Each trace was deleted immediately after comparison, and the temporary directory
was removed after the run. The original checkout, assets and production source
were not modified. Scoped ESLint and whitespace checks passed; formatting was
applied only to the new harness.

## Limits

This is evidence of unchanged results for these six finite same-tick workloads.
It is not an exhaustive proof for every vehicle, track, collision configuration,
weather condition or long-running session, and it does not test a complete race
finish in every mode. Both engines ran in the same JavaScript runtime, so this
does not establish cross-browser or cross-platform floating-point equivalence.

Worker catch-up limits, wall-time scheduling, asynchronous resource ownership,
native GPU/audio behavior and overall FPS are outside this check. The improved
worker deliberately bounds overdue wall-time work; this harness compares equal
physics tick counts and does not undo that scheduling policy. Runtime memory
measurements document the verification workload and are not a memory-performance
claim for the game.
