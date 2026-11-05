# CI keeper: the offroad gate, the cancelled vehicle step, a clean-runner audit

Branch `studio/ci-offroad`, cut from `main` at `eccc6d0` and rebased onto `eab1d91` (the two commits in
between touch only `docs/studio/BOARD.md` and one `.blend`, so everything below ran on the same simulation). Honesty rule as in `release.md`:
**verified** means a command was run in this sandbox and is listed; anything that needs a GitHub
runner, a Windows or macOS machine, a GPU or the Blender mirror says so. Sandbox: 4 shared CPUs,
software GL, no network except the proxy.

## Result

| Failure in the first real CI run (`0b8ec67`) | Cause | Status |
| --- | --- | --- |
| `offroad-scenarios`: `event arena-nord-supercross: car 0 was parked 21.1 s (at 108.7 m, 38.4 s)` | The field stops in the 7 m hairpin that opens the stadium: the riders' heading guard (limit 0.5 rad) trips on the yaw lag every bike has in a corner that tight (details below). | **Fixed in `src/simulation/offroad/ai.ts`.** Full gate passes: longest stop 13.8 s (was 21.1), the 20 s limit is untouched. |
| `scenarios`: `npm run test:vehicles` "cancelled" | The 15 minute job cap, not a cancellation: job started 17:43:18Z, step cancelled 17:58:33Z (15 min 15 s), the steps before it had used 12 min 40 s, `ci.yml` has no concurrency group, no fail-fast matrix and no `needs` on that job. | Fixed (`cb6c147`): 25 minute cap, asserted in `tests/ci-workflow.test.ts`. |
| `desktop-packages`: both `windows-latest` legs died in `actions/checkout` (`invalid path '...offroad-suite-test:bikes.log'`, run 41915488028) | Five tracked files had a `:` in their name. | Fixed (`e582884`): renamed, `tests/windows-checkout-paths.test.ts` keeps every tracked path Windows-creatable. |
| Browser shards, `wet-presentation`, `owner-qa` died at `playwright install` | `ubuntu-latest` became Ubuntu 26.04, which Playwright 1.55.1 cannot install Chromium on. | Fixed upstream in `eccc6d0` (45 workflows pinned to `ubuntu-24.04`); this branch adds a test so none can float again. First real browser-shard results are still pending. |

## 1. The offroad gate: root cause

### Reproduction

The CI numbers are reproducible bit for bit: on a clean checkout of `eccc6d0` the gate prints
`event arena-nord-supercross: 531.74 s race ... longest stop 21.1 s` and
`FAIL event arena-nord-supercross: car 0 was parked 21.1 s (at 108.7 m, 38.4 s)`, the same two
numbers as the GitHub log. The simulation is deterministic across machines. `docs/offroad-races.json`
(13.49 s for this event) was **stale evidence from an older tree**, not a pass: nothing compares it
with a run (CI writes its reports to `$RUNNER_TEMP`), and the repository history is a single root
commit (`395d7df`), so there is nothing to bisect; the earlier agent's "bisect" worktrees all failed
the same way (21.1 to 26.7 s).

Car 0 is not special. `scripts/offroad-races.ts` runs with `sim.autoPlayer = true`, so car 0 is just
one of ten AI riders (`DirtBikeAIDriver`); it is the one that happened to wait longest.

### Trace of the start (event seed 41003, ten MX-450s from the 10-slot gate)

Everything happens at s = 95 to 125 m: **turn one**, a 7 m radius 180 degree left with a 1.2 m berm
(`venues.ts` `arenaPath`), 100 m after the gate; the TRIPLE follows 14 m after its exit.

| Race time | What the trace shows |
| --- | --- |
| 8.5 to 10 s | The field reaches the hairpin at 7 to 10 m/s. Leaders brake to 4 to 6 m/s; riders within 7 m behind them are capped by the traffic planner (`limBy="follow"`/`"close"`, target 0 m/s at 9 m/s). Car 1 has lean -0.52 rad at full steering demand and its heading error reaches **-0.50 rad**. |
| 9.25 to 9.5 s | Car 1's steering falls from -1.00 to **-0.60**: `headingGuard` (`HEADING_LIMIT = 0.5`) takes over (it flickers on the 0.5 boundary, then holds from 11.5 s). Its target is capped at 2.8 to 4.5 m/s and its throttle, brake and steering are overridden while the corner is still being raced. |
| 11.5 to 13.5 s | Heading error -0.59, -0.79, -0.88, -1.00, -1.11, -1.29 rad with steering pinned at -0.60, lean only -0.2 and 3.3 to 4.0 m/s: the bike cannot turn and drives straight onto the outer berm and the wall behind it (lateral 5.45 m, wall at about 5.5 m). It is **pinned** (0.03 m/s, throttle 1.0). |
| 13.5 to 17.5 s | The pinned bike is a "stalled car" to everyone behind it (planner `wait=` ids). Riders stop nose to tail in the corner. The marshals push it out after `STUCK_SECONDS` (4 s) plus a traffic refresh: a 4.3 s stop. |
| 17.5 s on | The pushed bike restarts from rest at the track edge (lateral 3.8 m), tangent heading, accelerates to 7 m/s, runs wide, the guard flips it across the track (steer +0.6) and it pins on the **opposite** wall (lateral -5.17 m, s = 125 m): another 4.3 s. Each rider released from the queue repeats it; some crash on the wall (a 185 kg MX-450 exceeds the 3200 J crash limit above about 5.9 m/s). |
| 17.2 to 38.4 s | Car 0 waits at s = 108.6 m, v = 0 (planner `wait=` 9, then 3, then 2): five riders pinned or fallen one after another at the same wall. **21.1 s.** |

Stops of 8 s and more in the first 100 s of this race: nine at s = 106 to 123 m (9.4, 15.8, 16.3, 21.1,
16.2, 14.9, 8.4, 19.9, 20.2 s), plus two ordinary 9.3 and 9.9 s crash remounts at the triple's lip
(s = 165 m, BIKE_RECOVERY). Of ten riders, one had not cleared the hairpin 70 s after the start.

It is systematic, not a seed accident: over 24 seeds (the event with its seed replaced by 41003 and
1 to 23, first 100 s of race time) **9 of 24 exceed 20 s** on main, up to 54.5 s.

### Why the guard misfires (the cause)

`headingGuard` exists for "a rider rejoining from wide of a berm" (it stands a leaned bike up before a
normal racing target carries it across the next wall). It compares the bike's heading with the
course's tangent *at the bike*, and starts at 0.5 rad. A bike turns by leaning, so in a corner its
heading **trails** the tangent by the yaw rate the corner asks for (curvature x speed) times the time
the lean takes to come up: at turn one that is 0.13 1/m x 6 to 8 m/s x ~0.5 s, **about 0.5 rad**,
measured 0.46 to 0.47 rad on a solo bike (no traffic) at 6.4 to 7.4 m/s. The guard's trigger sits exactly on
that lag, so it fired on the riders of every pack that went through the corner, took their speed
and steering authority away mid-corner, and the corner became a car park. The guard's own recovery
(target floor 2.8 m/s, steering clamp 0.6; between 2 and 5 m/s a bike's steering blends from direct bars at half lock to the lean controller) cannot
turn a bike through 1 rad in a 9 m wide lane, which is what turns each trip into a pin.

### The fix

`src/simulation/offroad/ai.ts`: `headingGuardLimit(error, curvature, speed)` replaces the bare
`HEADING_LIMIT`. On a straight, and for a heading that is *ahead* of the course, nothing changes (0.5
rad). A rider whose heading **trails** a turning course (error with the sign of the course's
curvature) is allowed the lag: `min(0.5, 1 s x |curvature| x speed)` on top of 0.5. A rider facing
across the lane (the test case of `motocross-ai.test.ts`, 0.9 rad on a straight) is treated exactly as
before; in a corner it takes 1.0 rad at racing speed.

Constants: `YAW_LAG_SECONDS = 1` (the measured lag is ~0.5 s; 1 s is deliberately generous) and
`YAW_LAG_MAX = 0.5` (a trailing bike beyond 1 rad is not in a corner any more). They are physical
bounds, not fitted to a seed. `SIMULATION_VERSION` 23 to **24** (`src/core/session-identity.ts`, comment
and `tests/session-identity.test.ts`, whose `it.each` now includes 23): seeded motocross, supercross
and supermoto sessions whose AI riders trail a corner by more than 0.5 rad move differently.

### Judging the earlier WIP (rejected)

The uncommitted work this branch was resumed from shortened `STUCK_SECONDS` from 4 s to 1 s
(marshals free a pinned bike after 1 s). Rejected, for three reasons:

1. **It breaks seven existing tests that encode the 4 s contract** (`motocross-ai.test.ts`: "assists
   only after four seconds of actual drive" and five more; `motocross-shoulder-recovery.test.ts`:
   first push between 4 and 6 s). Passing them would mean rewriting their thresholds.
2. **It is not robust.** On the 8 seeds of the first experiment it still leaves one at 28.8 s (two
   riders fall one after another on the same wall while five wait), and it treats the symptom: the pins
   and the wall crashes still happen, they are only shorter.
3. It claims the cause is the dwell; the trace says the cause is the guard.

### What else was tried (throwaway worktree, env switches; first 100 s, seeds 41003 and 1 to 7)

| Variant | Longest stop per seed (s) | Seeds over 20 s |
| --- | --- | --- |
| main (before) | 21.1 22.4 18.7 22.1 9.8 27.4 35.7 28.1 | 6 of 8 |
| marshals after 1 s (the WIP) | 6.8 11.6 9.7 10.3 9.4 14.7 11.2 **28.8** | 1 (and 7 tests fail) |
| guard steering clamp 0.6 to 1.0 | 18.1 16.0 11.7 15.9 13.2 11.6 **40.8** 16.4 | 1 |
| follow reserve and `close` rule x 0.5 | 22.4 10.0 10.0 13.4 29.0 9.8 16.8 9.6 | 2 (and it cuts the longitudinal margins that `bike-ai.ts` says bike traffic scaling must never cut) |
| `close` rule only x 0.5 | 9.7 17.1 20.7 14.5 9.8 13.9 13.6 26.8 | 2 |
| turn one 12 m wide instead of 8.4 m | 16.1 18.2 13.6 23.8 28.1 25.8 17.5 20.9 | 4 |
| slow riders keep to the middle of the lane | 20.7 17.5 16.1 17.1 34.8 25.7 21.9 18.3 | 4 |
| lean-limit cap on corner speed | no effect on a solo pass | n/a |
| guard limit 0.9 flat | 9.8 14.2 17.2 18.1 10.9 13.8 9.9 10.8 | 0 |
| guard limit 0.8 flat | 13.3 14.7 14.5 19.4 12.2 11.2 10.0 9.6 | 0 |
| **shipped** (trailing lag, `min(0.5, 1 s x k x v)`) | 13.3 13.0 11.3 10.9 16.0 9.8 15.7 22.4 | 1 |
| lag allowed on both sides | 15.6 9.4 9.8 12.5 9.8 10.1 16.6 10.7 | 0 |

The two-sided variant and the flat limits score marginally better on these eight seeds; the shipped
one was kept because it changes nothing on straights or for a heading that is ahead of the course,
and the difference is inside the noise of one chaotic pile-up. The shipped values were then
**validated on 16 seeds that played no part in choosing them (8 to 23)**.

### Before and after

First 100 s of the arena-nord-supercross event, 24 seeds (41003 and 1 to 23), longest stop of any rider:

| | median | mean | max | over 20 s |
| --- | --- | --- | --- | --- |
| main (before) | 18.4 s | 19.5 s | 54.5 s | **9 of 24** |
| fixed | 12.6 s | 12.9 s | 22.4 s | **1 of 24** (seed 7) |

On the 16 held-out seeds: before 3 of 16 over 20 s (23.7, 22.3, 54.5), after 0 of 16 (max 18.9).

Turn one on lap one, seed 41003 (first rider in to last rider out of s = 95 to 125 m):

| | before | after |
| --- | --- | --- |
| first in to last out | 60.9 s | 27.8 s |
| mean time through | 31.2 s | 12.2 s |
| rider-seconds below 1 m/s in the corner | 256 | 47 |
| marshal pushes (first 70 s) | 10 | 4 |

(seeds 1, 2, 3: first in to last out 62.1, 61.0, 38.7 s before, 27.7, 27.7, 36.0 s after.)

The full offroad gate (`offroad-calibration.ts` then `offroad-races.ts`, unset `OFFROAD_RACE`, run from a
scratch directory like the CI step):

| Race | before: race s / longest stop s / crashes | after |
| --- | --- | --- |
| Valley Ridge motocross moto | 283.59 / 9.4 / 0 | 290.46 / 10.4 / 0 |
| Arena Nord supercross main (8 riders) | 282.96 / 16.4 / 4 | 306.05 / 12.2 / 2 |
| Kestrel rallycross heat | 246.88 / 0.0 / 0 | unchanged |
| Pinewood special stage | 178.53 / 0.4 / 0 | unchanged |
| event valley-ridge-mx-moto-1 | 397.11 / 9.8 / 0 | 370.70 / 9.5 / 1 |
| event valley-ridge-mx-moto-2 | 717.04 / 15.4 / 3 | 714.78 / 14.2 / 5 |
| **event arena-nord-supercross** | 531.74 / **21.1** / 7 (**FAIL**) | 560.05 / **13.8** / 6 |
| event valley-ridge-supermoto | 316.27 / 13.6 / 3 | 307.99 / 13.3 / 2 |
| event kestrel-rallycross-heat | 246.88 / 0.0 / 0 | unchanged |
| event pinewood-special-stage | 219.09 / 0.4 / 0 | unchanged |
| calibration | 20 jump runs, 0 band failures | identical report |

`docs/offroad-calibration.json` has identical content after the change (compared as parsed JSON) and was not touched.
`docs/offroad-races.json` was regenerated from the fresh run (the committed one predated even the
unfixed tree: e.g. its supermoto event took 401 s, the real one takes 316 s).

### Still true after the fix

- 1 of 24 seeds still has a 22.4 s stop at turn one (seed 7): a rider wedged against the wall that the
  traffic planner is also holding in the queue accrues no marshal effort (by design, "a continuously
  queued rider accrues no effort"), so three fallen riders in a row cost 22 s. The gate seed has 6 s
  of margin; a different event seed could still fail.
- The restart point after a push or remount is the nearest legal edge (0.9 m inside), i.e. the outer
  berm of the hairpin, with tangent heading and zero speed, which is where the next pin comes from.
- The TRIPLE starts 14 m after the hairpin exit; each seed still has several 9.3 to 9.9 s crash
  remounts at its lip (s = 165 m). Those are ordinary BIKE_RECOVERY stops, inside the limit.

## 2. Verification (commands run, results)

| Command | Result |
| --- | --- |
| `node --experimental-transform-types scripts/offroad-calibration.ts` then `scripts/offroad-races.ts` (scratch cwd, final code) | exit 0, 0 band failures, `passed: true`, no failures |
| same on `eccc6d0` (the CI tree) | exit 1, `FAIL event arena-nord-supercross: car 0 was parked 21.1 s (at 108.7 m, 38.4 s)` (reproduces CI) |
| `npx vitest run --maxWorkers=2 tests/offroad tests/motocross tests/bike-session tests/session-identity tests/wildcard-series tests/ci-workflow tests/windows-checkout-paths` | 71 files, 779 tests passed (before the Linux-runner test was added) |
| the same plus every other suite that touches dirt bikes, the arena venues, ghosts, records or the Steam hooks (`circuit-catalogue-wave2`, `meeting-flow`, `ghost-vehicle`, `collision-continuous`, `demo-edition`, `steam-integration`, `vehicle-catalogue`, `startup`, `pit-session-eligibility`, `results-settings`, `snapshot-interpolation`, `open-world-bikes`, `records-board`, `net-records`, `net-lifecycle`, `steam-leaderboards`) | 89 files, 1020 tests passed (final tree, includes the new `motocross-heading-guard.test.ts` at 33 s and the Linux-runner test) |
| `scripts/wildcard-races.ts` on the 9 wildcard events with a dirt bike or an off-road venue, `--no-write` | 9 of 9 PASS (knobblies-on-the-banking, red-canyon-scramble, supermoto-after-dark, supermoto-meets-the-joker, forest-stage-on-slicks, the-long-way-round, grand-tourers-on-gravel, supermoto-on-the-roof, supermoto-in-the-night-market); nothing written |
| `npx tsc --noEmit` | clean (final tree) |
| `npx eslint` on `ai.ts`, `session-identity.ts` and the four changed or new tests | clean (final tree) |
| the 7 tests the WIP broke (`motocross-ai`, `motocross-shoulder-recovery`) | fail on the WIP (7 failed, 12 passed), pass on the shipped code |
| the gate twice more on the final tree | the two runs are identical to each other (every field but wall time) and the calibration report equals the committed one |

New tests: `tests/motocross-heading-guard.test.ts` (the limit as a pure function: unchanged on straights
and for a heading ahead of the course, the lag on both hands, saturation, a rider facing across the lane
still taken over; and the turn-one regression: the arena event's first 50 s leave nobody parked 18 s or
more, it was 21.1 s) and a Linux-runner test in `tests/ci-workflow.test.ts`.

## 3. Workflow audit (56 files in `.github/workflows`)

Method: YAML parse of every file; every `npm run` target checked against `package.json`; every repo
path used by a `run:` step checked against the tree; `uses:` versions; `runs-on`; `apt-get`
ordering; artifact names against `needs`; 40-hex ids against git objects; `secrets.`/`vars.`; and,
for each workflow, whether its `paths:` filter would have fired on the last 25 commits of `main`.
Only `ci.yml`, `deploy-playable-pages.yml` and `publish-playable-cdn.yml` (a `workflow_run`) have no
path filter. Most of the others fire when their own file or their authoring scripts change.

Found fine: all actions are on current majors (`checkout@v4`, `setup-node@v4`, `upload/download-artifact@v4`,
pages `v4`/`v5`, `github-script@v7`; no `set-output`, no `@main`); every `npm run` target exists; no `secrets.`
anywhere (only `github.token` and the repository variable `MOTOBOUND_STORE_APPID`, whose absence only changes
a button); no `apt-get install` runs before an index refresh (`playwright install --with-deps` refreshes it);
all `needs:` and artifact names resolve; `package-lock.json` and `desktop/package-lock.json` are v3 and
committed; the 6,449 tracked paths contain no Windows-reserved character, device name, trailing dot or space,
no case-only clash, longest 138 characters.

Ranked list of what could fail on a clean runner for a non-game reason:

| Rank | Where | Problem | Evidence | Action |
| --- | --- | --- | --- | --- |
| 1 | `ci.yml` browser x8, `wet-presentation`, `owner-qa` | Chromium install on a floating image | run `0b8ec67`: all failed at `playwright install` on Ubuntu 26.04 | Fixed in `eccc6d0`; **new test** forbids `ubuntu-latest` anywhere. The first real browser-shard run is still pending: expect game-side or software-GL findings next (90 min cap each). |
| 2 | `ci.yml` `scenarios` | 15 min cap exhausted | step cancelled at 15 min 15 s | **Fixed** (25 min, asserted). Headroom: 12:40 + ~2:15 of 25:00. |
| 3 | `desktop-packages.yml` Windows | `:` in tracked file names | run 41915488028 | **Fixed** (rename and test). The Windows and macOS legs have never run past checkout; the Windows smoke is `continue-on-error`; `windows-latest` and `macos-latest` still float (same class as the Ubuntu 26.04 break) and `concurrency: cancel-in-progress` ends a run `cancelled` when a second push lands. Not changed: which image is current cannot be checked from here. |
| 4 | `deploy-playable-pages.yml` | Runs on **every** push to main, ungated by CI; `actions/configure-pages@v5` with `enablement: true` cannot enable Pages with `GITHUB_TOKEN`, so it fails with "Resource not accessible by integration" unless Pages is already on (and on a private repository without a Pages plan); a duplicate full build. | static reading | Not changed (repository setting). Gate it on `ci.yml` or run it on `workflow_run` like the CDN publisher. |
| 5 | `main-only.yml` | Fires on **any edit of `ci.yml`** (this branch edits it), `exit 1`s with `::error::Unmerged branch ... retained` while any remote branch is not an ancestor of main (the `studio/*` branches until merged), and force-deletes the merged ones. | static reading | Not changed (documented intent, `docs/REPOSITORY_MAP.md`). Drop `ci.yml` from its `paths:`. |
| 6 | about 35 one-shot authoring / candidate / snapshot workflows | They fire only when their own file or authoring script changes. Four depend on history that is not in this clone: `phase27h-author.yml` checks out `3b52d03...`, `phase27h-verified.yml` asserts `BASE_COMMIT a7985160...` is an ancestor and calls the missing `e2e/21-venue-landmark.spec.ts`, `phase27h-production.yml` and `a32-candidate.yml` fetch commits and blobs by id (12 ids, none a local object). | `git cat-file` | Dormant; if touched, these four fail. Delete them once their outputs are committed. |
| 7 | 25 workflows | Blender 5.2.2 from `download.blender.org` with a pinned sha256 | `grep` | Cannot be fetched from this sandbox (the proxy returns 403), so unverified. A pruned mirror would fail all authoring runs. |
| 8 | `motocross-r3-authoring`, `horizon-source-snapshot`, `publish-mx-trackside-assets`, `solvane-offline-review` | `ubuntu-slim` (15 min platform cap): `motocross-r3-authoring` asks for 20 min, uses `sudo apt-get` and Blender on that image. `secondary-stands-authoring` is on `ubuntu-22.04`, `secondary-stands-macos-authoring` on `macos-14`. | static reading | Dormant; not changed. |
| 9 | Firing most often on ordinary merges (`motogp-review` 16 of 25 commits, `settings-transition-validation` 13, `settings-validation` 12, `aurel-quarry`/`aurel-vegetation`/`scenery-shadow` 11) | Browser jobs on software GL under xvfb, never run on a real runner after the pin | static reading | Watch the first runs; no static defect found. |

Changed in this audit: only the test that locks the Linux pin. Everything above rank 3 is a repository
or runner setting, or dormant, or cannot be checked offline.

## 4. Files

`src/simulation/offroad/ai.ts` (`headingGuardLimit`, `YAW_LAG_*`), `src/core/session-identity.ts` (v24),
`tests/session-identity.test.ts`, `tests/motocross-heading-guard.test.ts` (new), `tests/ci-workflow.test.ts`,
`docs/offroad-races.json` (regenerated), this report. Earlier on the branch: `.github/workflows/ci.yml`
(25 min), five renamed log files and `INVENTORY.tsv`, `tests/windows-checkout-paths.test.ts`.

## 5. Next tasks, ranked

1. Make the pinned-and-queued case end: a rider wedged against the barrier (`|lateral|` beyond the legal width)
   should accrue marshal effort even while the planner holds it (seed 7, 22.4 s), and the restart point
   after a push should be the racing lane, not the outer berm, in a corner that tight.
2. Run the whole gate over a spread of seeds in CI (the gate runs one seed per race); a nightly 24-seed
   sweep of `arena-nord-supercross` would have caught this before the first CI run.
3. Gate `deploy-playable-pages.yml` behind `ci.yml`; take `ci.yml` out of `main-only.yml`'s paths; pin
   `windows-latest` and `macos-latest` once their current images are known.
4. Delete the dormant one-shot workflows (rank 6 above) so a stray edit cannot turn them red.
5. Re-run the first full CI on this branch and read the browser shards: they have never executed on a real runner.
