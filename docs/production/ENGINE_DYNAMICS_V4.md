# Engine dynamics v4

Published on `main` as `14270a4058ec547102b4aedb5430faac9c52fc7c`, this update
improves wheel/chassis momentum, continuous contacts, live timing and snapshot
animation. The world retains its 120 Hz tick and two 1/240-second vehicle
substeps. Drawing does not advance physics. Follow-up `5ba247c` changes formatting only.

This increment introduced physical-model compatibility **4**, retaining snapshot
protocol **13** and network protocol **2**. The later concurrent motocross update
`c182751` introduces physics **5**, and MotoGP follow-up `9d5c558` introduces
physics **6**. Both are preserved. The final build and browser attempt below cover
immutable `5ba247c` (physics 4), before those subsequent updates. Record identity
separates each physics category from older records
(`src/core/session-identity.ts`).

## 1. Wheel and chassis angular momentum

Signed momentum along steered/cambered wheel axles, including airborne wheels,
exchanges angular impulse with the chassis when speed or direction changes.
Symmetric impulses surround implicit midpoint drift with the gyrostat equation.
Reused vectors carry endpoints; no hidden rotor momentum persists between calls.

This operator-split approximation leaves tyre drive, brake and contact equations
separate from chassis rotation. It does not add fully coupled free-bearing
wheels, engine crank gyros or motorcycle multibody dynamics. See
`docs/production/WHEEL_MOMENTUM.md` and `tests/wheel-momentum.test.ts`.

## 2. Continuous chassis contacts

Both world paths capture poses before each substep and query their swept paths
after integration. Oriented boxes use all 15 separating axes, linear centre
travel, shortest-arc rotation and bounds covering swept corners. The earliest
contact adjusts remaining positional travel before another search, allowing
impact chains within a substep.

Paths are consumed once and reject changed entrants or discontinuities. Endpoint
handling, restitution 0.08, friction 0.3, rotational effective mass, damage and
depenetration remain.

One box and one response point approximate each chassis; deformation, limbs and
wheel manifolds are outside this solver. Static colliders/ambient traffic keep
existing paths. Impulse-induced angular drift follows next substep. Queries are
limited to 80 iterations and events to `max(8, 2 * carCount)` per substep, with
exhaustion diagnostics rather than a universal no-tunnelling guarantee. See
`docs/continuous-chassis-collision.md`.

## 3. A continuous live presentation clock

Eight reusable history slots select measured pairs at a nominal 1/30-second
delay. Packet arrivals no longer restart the visible interval. Owned copies let
worker buffers be recycled; festival traffic uses the same pair as the riders.

Missing observations hold the newest pose. Stalls or backlog above 0.1 second
rebuild the anchor. Pause shows an exact frame; resumption excludes paused wall
time. Rewinds, equal-time commands and field/replacement changes reset history.
Replay keeps its recorded timeline. These bounds are policy choices, not host
latency guarantees. See `src/rendering/live-frame-clock.ts`.

## 4. Coherent vehicle and rider presentation

Endpoint velocities drive compatible cubic Hermite motion, preserving airborne
apexes, with shortest-path quaternion interpolation. Models and `PresentedFrame`
share Float32 poses across Formula cars, catalogue bodies and festival bikes.

Hermite requires positive spans ≤0.5 s, unchanged contacts, coherent displacement
and finite endpoint acceleration ≤120 m/s²; other plausible spans use linear
positions. Replacements, equal-time pairs and teleports hold a complete entrant
until the boundary. These guards cannot recover every unrecorded impact.

GP/MX controls and posture share that interval. Heading uses its shortest arc;
tumble retains full turns. Crash/remount states respect recorded boundaries.
Detached riders hide with inactive distance models and reattach on recovery.
Incoming GP hand contact is retained.

Wheel phase infers full turns from angular velocities and bounds tangents at
impulses. GP/MX wheels use it; the chain follows the rear wheel and the front
lever samples front brake. Tyre replacement, Formula gear/ERS, cockpit/service
states and model identity use consistent discrete boundaries. Unrecorded speed
changes remain ambiguous. See `src/rendering/snapshot-interpolation.ts`,
`src/rendering/wheel-pose.ts` and `tests/bike-animation.test.ts`.

## Publication and verification

The preserved ancestry is:

| Commit                | Role                                                                                |
| --------------------- | ----------------------------------------------------------------------------------- |
| `2dc5a0a`             | Reconstruction base after environment recovery                                      |
| `9e5ff53`             | Incoming MotoGP contact and race-control work                                       |
| `d099215`             | Published wheel/chassis momentum increment                                          |
| `794c90c` → `d9d7d16` | Incoming festival effects/landings and CI correction                                |
| `14270a4`             | Published collision, live-clock and presentation changes                            |
| `5ba247c`             | Formatting-only traffic call cleanup; final tested source                           |
| `c182751`             | Subsequent concurrent motocross contact/roost update, physics 5; preserved          |
| `9d5c558`             | Subsequent MotoGP chassis/guidance/traction and replay update, physics 6; preserved |

The engine commit's tree is `4efba22b8e5c4755ed7e18a5e3e81da085bb6e91`.
The festival integration preserves its open-world work, adds one
`beginStep(contact)` capture call and passes `dt * 0.5` to the existing `solve`.
The companion `engine-v4-validation.json` records full
commit IDs, evidence references and exact hash encodings.

### Completed focused runs

These are fresh reconstruction results from before one or more upstream merges.
They are not a complete test gate on the final published tree.

| Scope                                                     | Result                               | Evidence qualification                                                |
| --------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| Wheel momentum, integrator stability, record identity     | 24 passed / 3 files; 27.64 s         | `docs/production/wheel-momentum-validation.json`                      |
| Continuous-collision suite                                | 22 passed / 1 file; 41.88 s          | Retained terminal result; predates incoming GP world/grid integration |
| Live clock, worker pause, open-world worker, replay clock | 25 passed / 4 files; 88.71 s         | Retained terminal summary; includes 17 clock cases                    |
| Presentation                                              | 66 distinct passing cases / 5 suites | Overlapping development runs; `presentation-validation.json`          |

Presentation evidence retains commands, excerpt hashes and 13 package hashes.
A pit fixture changed from 1.3 to 1.8 s because withdrawal starts at 1.35 s;
production code/assertion stayed unchanged. Scoped lint/diff checks passed.
Development `tsc --noEmit` passed without a final-source guard. Geometry tests
use a no-op canvas and do not verify rendered pixels.

An earlier broader run passed 55/57 assertions: CCD 20/21, physics 21/21, contact
5/5 and MX 9/10. The failures were a chain fixture expecting no exhausted budget
and the existing MX timeout; two worker RPC timeouts also occurred. The chain
fixture was corrected, with a separate test retaining the tight cascade's budget
exhaustion checks. No runtime limit or acceptance threshold was relaxed.

### Three incomplete integration attempts

These attempts used the pre-festival integrated source with unchanged assertions
and test timeouts:

| Attempt                                                    | Outer bound | Observed wall time | Captured outcome                              |
| ---------------------------------------------------------- | ----------- | ------------------ | --------------------------------------------- |
| Eight-rider MX stadium start                               | 180 s       | 183.660 s          | Empty log; no JSON/assertion report           |
| Poggio full GP grid and first normal tick                  | 180 s       | 182.617 s          | Empty log; no JSON/assertion report           |
| Merged GP contact and bike presentation, 12 selected cases | 300 s       | 320.639 s          | Startup banner only; no JSON/assertion report |

All ended with wrapper exit 124 and unchanged inputs. Workers were absent after
cleanup. No case-level outcome or cause of the stall was established. Observed
time includes termination/reaping and may exceed the process bound.

These guards precede the festival integration. Collision hashes sorted paths
and raw bytes; presentation hashes paths and per-file SHA-256 hex, covering
726 source files or all 1,382 guarded inputs. The JSON gives exact delimiters and
digests: these encodings are not interchangeable. Excerpt hashes identify only
included text, not independently archived logs.

### Published-source verification

A separate direct-Node execution of the existing Poggio GP placement and first
normal-tick assertions **passed** on `14270a4`: exit zero, **18.731 seconds**,
12 bikes, one tick, zero swept contacts and no sweep limits. All **728 source
files** were unchanged. Their manifest fingerprint is
`68059accef78c3f71fa7da423efd92c1d2be861a70a6c98b4be6aa2b55866dbe`, using
lexical depth-first directory traversal and repository-relative path + NUL +
lowercase raw-file SHA-256 hex + newline (not global full-path sort order).
This one production scenario is separate from the earlier Vitest timeout; it
does not replace that outcome or constitute a complete GP race/animation gate.

| Final evidence                                                     | Captured outcome                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Formatting recheck / lint on 30 changed TypeScript files / content | Passed: 7.245 / 32.486 / 47.162 s; source stable per step                     |
| Typecheck, production build and input-stability guard              | Passed; directly observed guard exit 0; all 728 source files unchanged        |
| Production build identity                                          | Passed; recomputed all 731 inputs and verified the generated entry module     |
| One browser driving/mirror attempt                                 | Failed at Chromium launch (`SIGTRAP`), before any test; exit 1 after 24.775 s |
| Complete repository test gate or general performance comparison    | Not established                                                               |

The initial 30-file formatting check found one multiline call in `free-roam.ts`;
`5ba247c` only condenses that call. Final checks target that follow-up; the GP
receipt remains tied to `14270a4`.

The guarded command was `node --experimental-transform-types
scripts/source-stability.ts -- npm run build`. It completed the pinned LOD
prebuild, `tsc --noEmit`, Vite bundling and the existing input guard. The original
outer Python monitor disappeared after a session transport interruption. Its
600-second bound and exit capture were lost. A detached monitor observed the
same identity-verified build process exit with status 0 at 17:35:48 UTC, before
its replacement 17:36:10 UTC cap. No duplicate build or termination was used.
The raw Vite log reports `built in 10m 6s` and warns about large chunks.

The independent build check repeated Vite's exact SHA-256 byte algorithm over
all source files plus `package-lock.json`, `index.html` and `vite.config.ts`.
Its fingerprint is
`02db92eb9d3e79035d8205d78882f83425e07e93c48e96f56b71d8f3aa5fa6d1`.
Both `BUILD_IDENTITY.json` and the generated entry module carry this fingerprint
and commit `5ba247c`. This is distinct from the source-only and per-file-hash
manifest encodings elsewhere in this record.

The one original application test selected manual right steering and live
mirrors without autopilot. It kept the existing configuration: requested
SwiftShader, 1440 × 900, 300-second test timeout, 60-second menu/assertion limits,
one worker and zero retries. Global setup failed in `chromium.launch()` with
`SIGTRAP`; no backend proof, gameplay assertion, page trace or gameplay screenshot
was produced. Crashpad's missing CPU-frequency sysfs messages do not establish
the crash cause. Source, test/config and built-entry manifests matched before
and after, and no owned browser/server processes remained.

The validation JSON embeds completed receipts/logs and references the unchanged
presentation companion and already committed rotor evidence. Large per-file
manifests are omitted; source digests retain their exact scope/order.

### Subsequent upstream preservation

While verification used frozen `5ba247c`, concurrent `c182751` added motocross
sprung-contact traction, independent rear-pedal control, lit soil fragments and
terrain-normal continuity, and advanced physics compatibility to 5. Its direct
child `9d5c558` then added MotoGP rear chassis geometry, road-derived corner
guidance, current-contact-load traction and replay-seek preparation, advancing
physics compatibility to 6. The evidence commit is based on that newer upstream
tree without overwriting either update. This report's build and browser results
do not certify those later changes. Their own reports are
`docs/production/motocross-contact-and-roost-20261019.md` and
`docs/production/motogp-corner-drive/README.md`.

## Recovery and limits

The environment reset before the earlier engine tree reached GitHub, losing its
checkout, reports and benchmarks. Work was reconstructed against current
upstream. Only the live-frame clock was recovered byte-for-byte from a retained
read. Earlier full-suite/timing results do not certify this reconstruction.

No manufacturer calibration, general speedup or complete hyperrealism is claimed.
The successful production build, incomplete browser acceptance and subsequent
upstream updates retain separate source identities and outcomes.
