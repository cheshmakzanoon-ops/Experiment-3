# W08C — adversarial review of record and storage boundaries

Assignment 45/60, wave 8. The review found and corrected one new ghost timing
defect. The completed-lap continuity and unsupported-mode journal changes have
no additional demonstrated defect in the reviewed paths.

The review used the original source at
`350119e8ec0606e8c5de5b3ab80df41104025679` and the integrated source released for
this repair at `6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b`. Source comparisons used
the actual sparse baseline worktree; its intentionally absent documentation,
scripts and public files were not classified as regressions. The earlier
[W03B](w03b-ghost-first-passage.md), [W03D](w03d-flashback-retention.md),
[W03F](w03f-telemetry-lap-gap.md), [W05C](w05c-records-integration.md) and
[W06E](w06e-native-records.md) reports provided the preceding acceptance context.

Owned changes:

- `src/core/ghost-lap.ts`: one indexed-query endpoint condition and its comment.
- `tests/engine-record-boundaries-review.test.ts`: three focused regression cases.
- This review note.

## Ranked finding

### 1. Medium — exact indexed knots can precede their recorded crossing; fixed

A later plateau or reversal enables the prefix-maximum distance index for the
whole ghost. Its lower-bound search correctly selects the original segment
ending at the first crossing. However, if that segment advances less than
`1e-6` metres, the existing denominator floor prevents an exact ending station
from producing an interpolation fraction of one. The returned time precedes
the recorded crossing. A plateau later in the lap can therefore change exact
query results for earlier tiny intervals that previously used the original
monotonic lookup.

The concrete witness has **20 samples**, times `0..19` seconds, stations
`[0, 1e-8, 2e-8, 3e-8, 3e-8, 1, 2, ..., 15]`, and normal finite pose fields.
`validateGhost()` accepts the complete object with lap time 19 seconds and
sectors `[6, 6, 7]`. Queries use the stored Float32 distances, avoiding a
decimal-to-Float32 equality assumption.

An actual-source probe compared the original baseline and the integrated
implementation before this repair. The new regression then confirmed the
incorrect result in the integrated implementation before production was edited.

| Stored distance | First recorded time | Original `350119e8` result | Integrated result before W08C | Corrected result |
| --- | ---: | ---: | ---: | ---: |
| `9.99999993922529e-9` | 1 | 1 | 0.00999999993922529 | 1 |
| `1.999999987845058e-8` | 2 | 2 | 1.0099999999392253 | 2 |
| `2.999999892949745e-8`, then repeated | 3 | 4 | 2.009999999051047 | 3 |

The first two rows isolate the newly introduced exact-knot regression. The
third also distinguishes the original repeated-station error from the required
earliest crossing. This is a constructed, validator-accepted boundary record,
not an observed driving-session frequency or a measured gameplay incident.

The repair returns the selected endpoint's recorded time only when an index
exists, the query exceeds the initial station, and it exactly equals that
endpoint's stored distance. The initial-station guard is necessary: a repeated
starting station belongs to the first sample, not the second sample. The
strictly increasing lookup and every interior interpolation expression remain
unchanged.

The second new regression also exposes the final indexed endpoint: a repeated
start followed by tiny positive steps previously returned
`18.009999993721976` seconds at the final stored station instead of 19 seconds.
It now returns 19, while the repeated initial station still returns zero.

## First-passage correctness and limits

For validated stations `s[i]`, the retained index is
`M[i] = max(s[0], ..., s[i])`. For a query `q > s[0]` within the recorded maximum,
let `j` be the first index with `M[j] >= q`. Then every earlier station is below
`q`, and `s[j] >= q`. In particular, `s[j - 1] < q <= s[j]`, so the original
adjacent pair `j - 1, j` is the first forward segment reaching the query. This
also explains why interpolation must use those original adjacent samples,
including after a reversal; connecting only successive record highs would
invent motion that was never recorded. The exact-endpoint repair preserves
this selection and returns `t[j]` when `q === s[j]`.

The existing test suite covers repeated stations, multiple reversals, an
initial decline, entirely stationary samples, resumed progress, repeated finish
stations and nonfinite query conventions. Its real `LapTracker`/`GhostRecorder`
case retains the recorded 10 m reversal. The new regression additionally checks
that the repeated tiny station has its first recorded time while `poseAt(3.5)`
still traverses original samples 3 and 4; the lap object remains unchanged.

The important input and numerical limits are explicit:

- `GhostPlayer` continues to require a validated recording whose samples remain
  unchanged during playback. Validation requires 20 through 18,002 samples,
  finite fields and strictly increasing sample times. It permits pauses and
  reversals in distance. The constructor does not add a second validation pass
  or protect against external mutation of the same typed array.
- Both production constructors are in `TimeTrialRecords`. Loaded data passes
  through `validateGhost()`; newly completed laps come from the validated
  recorder result. Each recorder completion owns a fresh Float32 array. New
  laps, replacement records and session transitions replace references rather
  than mutate a retained player's samples. This satisfies the cache ownership
  assumption at the reviewed consumers.
- Strictly increasing recordings retain the original binary search and exact
  arithmetic, including its handling of very small final intervals. They
  retain no distance index. Plateau/reversal recordings allocate one Float32
  per sample, bounded at **72,008 payload bytes** by the existing sample cap;
  typed-array object overhead is additional. Construction remains linear and
  each lookup logarithmic with no per-query allocation.
- Interior interpolation still divides by `max(1e-6, distance span)`. Below
  that span, it is the existing numerical policy rather than exact geometric
  linear interpolation. This repair deliberately makes no broader claim of
  mathematically exact first-passage timing throughout those tiny interiors.
- Queries before the initial station return the first time; indexed queries
  beyond the maximum return the final time. Existing NaN and infinity query
  conventions are unchanged. Pose lookup continues to use the time-ordered
  original recording independently of the distance index.

## Completed-lap gap and ownership review

The actual baseline/current diff in `completeLaps()` changes only the continuity
interval inspected for each row. At a transition row `i`, the closing lap owns
rows `[start, i)`. Checking each successor interval includes `(i - 1, i)`, which
is the capture evidence that closes the lap. The loop's largest successor index
is `i`, and the outer loop guarantees `i < data.count`, so this does not read
past the retained data.

Validity still scans only `[start, i)`. The next lap's first row therefore
closes the prior lap's continuity check without contributing its validity flag.
The returned range still ends at `i - 1`. Advancing `start` to `i` even after a
rejected lap keeps the incoming gap with the closing lap and permits a properly
observed following lap to qualify. Lap-counter jumps, distance-endpoint checks,
unfinished final laps and partial oldest ring laps retain their previous rules.

The strict rejection rule remains `gap > 0.15`; no tolerance or timestamp
coercion was introduced. Existing below/equal/above tests use an explicit
double-precision clock to distinguish the threshold from Float32 rounding.
`completeLaps()` remains a range selector over its supplied chronological data,
not a newly added validator of arbitrary malformed `PlotData` clocks.

The [W05C composition test](w05c-records-integration.md) and native case connect
this ownership rule to the actual ring/export consumers. After capture of
730 rows, the 630-row ring has wrapped to head 100. The missing interval lies
between retained rows **499 and 500**, crossing both a capture page boundary and
the CSV encoder's 500-row chunk boundary. Lap 4 is excluded, lap 5 remains, and
the next lap's invalid opening row does not contaminate lap 5. The exported
snapshot retains every Float32 field while continued recording uses the live
ring. This review found no additional boundary defect requiring another test
or production change in that path.

## Flashback journal and record-consumer review

`supportsFlashback()` permits race, endurance and practice. The UI uses the same
predicate and retains its five-use guard. The worker constructs an `InputLog`
only for those supported modes; time trial and qualifying have no journal.

The null journal affects retention only: `applyLoggedInput()` always applies
controls to the simulation, and pit/autopilot handlers always apply their
commands. Shift FIFO application, paused reset and watchdog braking continue
through that same input boundary. Telemetry and replay have their independent
`TelemetrySampler`, while time-trial ghost recording consumes accepted snapshots
on the host. None depends on journal allocation.

A missing journal rejects a rewind before recording-page flushes or
`Resimulation` construction. Existing terminal failure handling prevents a later
message from reviving that failed worker without initialization. Eligible modes
retain their history from tick zero: the 30-second selection window does not
truncate reconstruction inputs. A completed rewind discards only the replaced
future. Reinitialization into an unsupported mode releases the previous journal.

[W03D](w03d-flashback-retention.md) already compares the actual worker with its
journal retained and omitted for each unsupported mode. Each 600-second stream
has 36,000 control samples and 72,000 physics ticks; applied controls, packed
frames, telemetry rows and replay frames have equal ordered digests. Retained
journal entries fall from 36,000 to zero and copied journal control objects from
36,001 to zero. These are observed object counts, not heap-byte or frame-rate
measurements. Supported-mode reconstruction, command edges, terminal handling
and reinitialization have existing focused coverage. This review did not repeat
those long streams or claim a new performance measurement.

## Persistence and existing native evidence

The baseline/current ghost diff leaves recording, validation, metadata,
`GHOST_VERSION === 1`, the 11-field sample layout, keys and pose arithmetic
unchanged. Direct byte comparisons also found these files identical to the
original baseline: `src/core/session-identity.ts`,
`src/simulation/protocol.ts`, `src/storage/telemetry-schema.ts`,
`src/storage/recorders.ts`, `src/storage/data.ts`, and
`src/session/time-trial-records.ts`.

Compatible existing ghost saves therefore use the same persistence path and
rebuild the in-memory query index when loaded. The pre-existing identity rule
continues to interpret absent vehicle/physics fields as the default APX-01 and
physics version 1. Such an old record is accepted only for the corresponding
category; it is not silently admitted into current physics version 39.
Telemetry retains its existing 228-column schema and CSV representation.

The two native W06E record cases passed on both existing CI checkpoints:

| Checkpoint | Native IndexedDB reload / first crossing | Native capture / ring / CSV closing gap | Evidence |
| --- | --- | --- | --- |
| `9922926e786c35e84810efc8b15e75bcfaba5372` | Passed | Passed | [Browser log](evidence/checkpoint-9922926/engine-runtime-browser.log), [CI run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45573448610) |
| `6a1c76fae3736e4d814ab6d0a354f6837320731c` | Passed | Passed | [Browser log](evidence/checkpoint-6a1c76f/engine-runtime-browser.log), [CI run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45579529295) |

The IndexedDB case verifies a real page reload, independent loaded buffers,
unchanged stored reversal bytes, first-crossing HUD results and preserved reverse
pose. The native capture/CSV case verifies actual transfers, pool return,
continued live capture and the wrapped boundary described above. Both workflows
had overall failures in other native diagnostics; the table reports the two
specific record cases. These prior runs precede the narrow W08C endpoint repair.
They establish existing native boundary coverage, while the new endpoint
correction is supported by the focused checks below. No native case was rerun
under the existing local-browser restriction.

## Verification performed by this assignment

Before editing production, the new suite produced **two failures and one pass**:
the early and final exact indexed endpoints failed; the interior and strictly
increasing compatibility case passed. After the correction, the direct command
below passed **74 tests across four files**: 3 new boundary tests, 14
first-passage tests, 53 recorder/validation-bound tests and 4 ghost-lap tests.

```sh
node node_modules/vitest/vitest.mjs run tests/engine-record-boundaries-review.test.ts tests/engine-ghost-first-passage.test.ts tests/engine-ghost-bounds.test.ts tests/ghost-lap.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
node node_modules/eslint/bin/eslint.js src/core/ghost-lap.ts tests/engine-record-boundaries-review.test.ts
node node_modules/prettier/bin/prettier.cjs --check src/core/ghost-lap.ts tests/engine-record-boundaries-review.test.ts
```

Scoped ESLint and Prettier checks passed. Tests used direct binaries and one
worker. No full compiler/build, long retention stream, performance timing,
dependency installation, npm lifecycle hook, Git mutation or browser attempt was
performed. The coordinator owns publication and the final integrated gates.
Models, characters, environments, assets, authored tuning and schemas were not
modified. Ownership of the three files is released for integration.
