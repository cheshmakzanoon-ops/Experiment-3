# Current development status

Updated 2026-11-18 after the graphics, physics and publication audit of `main`.
The dated studio reports remain useful history; their November 5 test counts and
unfinished-patch instructions are not the current status of the repository.

## Evidence baseline

The latest committed full CI report at the start of this repair is
[Build and validation run 43839758878](../ci-reports/build-and-validation.md),
for source `8b168cb2985647ae99b3476cd83d2c5e6471ccc1` on November 16.
It records successful build/validation, scenario, offroad-scenario and wet-presentation
jobs; **6,307 unit tests passed and one failed**. All eight browser shards and owner QA
were canceled at their 90-minute job limit, and publication was skipped. This is not a
green release. The earlier **625 files / 6,179 passing tests** figure describes the
November 5 run only.

The audit inspected the main history through
`2b5afc838cc654f14f0bac1d7fe410827a7a8df5`, a report-only descendant of that source.
Three.js remains the production renderer. No engine migration was made in this repair.

## Repairs and how they are checked

| Confirmed issue | Change | Verification contract |
| --- | --- | --- |
| A cold-cache GP ghost installed translucent materials before the occlusion bake had read opaque geometry, causing an empty-grid exception | Bake GP occlusion before installing ghost presentation, and release owned motorcycle/catalogue resources on disposal | `tests/ghost-vehicle.test.ts` builds both GP definitions, checks translucent ghost appearance and verifies the occlusion cache returns to baseline |
| Default Medium MX lost detailed dust silhouettes, ground fade and arena shafts behind a High-only gate | Separate Medium-and-up atmosphere from High/Ultra surface and vegetation detail | `tests/motocross-dust-ground.test.ts`, `tests/motocross-arena-lighting.test.ts`; the rendered dust fixture now explicitly switches High → Medium → Low → High |
| Festival displayed graphics options without running the corresponding complete exposure, temporal/post-processing and shadow path | Wire those existing systems into the actual Festival frame/lifecycle and report active shadow maps truthfully | Festival pipeline, shadow, photo, quality and disposal tests; fresh browser images remain required |
| Academy night preview opened on the lightweight showroom, whose draw forces day lighting and omits venue lights | Upgrade to the actual circuit before opening the explicit preview, preserve held simulation snapshots, and apply reference lighting after the upgrade; stop LIVE for that explicit fixed-light preview | `e2e/08-reference-implementation.spec.ts` now requires `presentationPurpose='circuit'` and retains the nearby-light, held-frame and reversible-control assertions; fresh browser execution pending |
| Player road motorcycles could turn opposite to a held steering input at walking speed | Enable the existing low-speed balance model for player road bikes, including dirt bikes on roads; retain GP/expert and AI scope | `tests/road-bike-low-speed.test.ts` checks both steering signs and blend speeds; strict calibration checks cover the seven affected models |
| Changed handling could reuse old records/ghosts | Advance simulation identity to v25 and reject v24 identities | `tests/session-identity.test.ts` |
| Pages rebuilt and deployed independently of the failing full validation workflow | Pages and downloadable releases consume the same exact `apex-formula-release` artifact from a successful first-party main run, with product/source/asset/IP checks | `tests/ci-workflow.test.ts` and `tests/branchless-release.test.ts` |
| Report-bot commits advanced main and made strict SHA publication checks reject otherwise identical validated source | Require validated ancestry and allow only `ci-reports/**`, root `README.md` and explicitly listed status/handover prose files; preserve the validated build SHA and block all other changed inputs | `tests/release-source.test.ts` covers real git ancestry, source/assets/tests/workflow edits, machine-consumed Markdown, renames and unknown commits |
| Complete scenery/pit surveys were scheduled like short browser cases, and cancellation hid failure details | Account for existing expensive survey workloads across twelve partitions and persist/print each failure before suite completion | `tests/browser-shard-plan.test.ts` preserves exact-once assignment and serial suites; `tests/browser-progress-reporter.test.ts` retains failure location and worker errors; inventory-only verification assigned all 347 cases exactly once |

The added dirt-bike handover regression verifies that the existing AI substeps and
player contact/grip settings remain correctly scoped when control changes; it does not
claim a separate handover defect was found or repaired.

The browser changes do not skip cases, relax assertions, extend test deadlines or remove
release gates. Better scheduling and diagnostics do **not** establish that the rendering
stalls are fixed. The committed sunset scenery failure is a timed-out `page.evaluate`,
not evidence that a shadow-count limit was exceeded. The Academy night failure observed
zero nearby lights instead of four; the later night-boolean assertion was not reached.
The venue-preview repair targets that cause. Other held-preview timeouts and an Academy
transition remaining in `loading` still need fresh browser evidence.

## Verification still needed

The repair passes the production build (including TypeScript and the IP guard), full
ESLint, content validation and bundle-budget checks. Focused groups passed: 104 physics
tests, 192 Festival/Ultra/fixture tests, 113 release/CI tests and 31 ghost/MX rendering
tests. These groups overlap and must not be added into a unique-test total. Strict
calibration passed all seven affected motorcycle models, and four ordinary-road AI
scenarios retained identical before/after snapshot hashes.

The unfiltered local unit run is still in progress at this implementation snapshot.
It exposed a release-test assertion pointing to the verifier's former inline location;
that assertion was corrected and the six release/CI suites passed again, including an
executed demo-artifact refusal. Its final result and the new GitHub run must be read
before calling the branch green; older report files are evidence for their recorded
commit only. Local Chromium could not launch in
the repair environment because its process-singleton socket was denied (`EPERM`), so
there is no fresh local WebGL capture or hardware performance claim for these changes.

Real-GPU frame times/load times, Steam Deck behavior, desktop packages, Steam-client
integration and human handling/art approval remain separate release gates. See
[RELEASE_GATES.md](studio/RELEASE_GATES.md) and
[HARDWARE_BENCHMARK.md](studio/HARDWARE_BENCHMARK.md).

## Art and historical work

MotoGP Round 3 landed on November 11 in
`25c3f306bfe231aef448a98fbc2cdc59e6499914`; Motocross Round 3 landed the same day in
`1bffdae9af25ede0c155a2b68dc13a260c411e86`. Do not reapply their archived patches.
The broad open-world Round 3 grass/terrain/art patch remains incomplete and unapplied;
the focused Festival pipeline repairs above do not claim to deliver that art pass.
The [patch archive](studio/hyperrealism-wip/README.md) records the distinction.

Recent MX/SX lighting, haze, color and camera revisions are authored choices. The audit
did not establish them as objective regressions, and this repair does not blindly roll
them back. The original Formula player model's substitution for an owner-only licensed
model is a product/licensing decision; the owner-only asset remains excluded by the
blocking IP guard. Neither restoring that asset nor a wholesale motorcycle-solver rewrite
is part of these defect fixes.
