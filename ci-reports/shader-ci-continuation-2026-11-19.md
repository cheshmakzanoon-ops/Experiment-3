# Published inactive shader work and CI transport correction — 19 November 2026

The accepted application and CI changes are on [main at `f80309f`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/f80309fce06e97ada17cde1ef330971d9af6ffd9), tree `48ec011f2caaf5a68137dd3e02f8b14f26ee427b`. Publication was a non-force, expected-head update from `54a09a0`; the remote head and tree were independently verified. Its parent is the separately tested [shader commit `669a44d`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/669a44de6d542abb5010bcc880b08c0b00efe444).

**No physics change is included. Simulation version remains 27 and protocol version remains 17.** All simulation source, original race assertions, original startup deadlines, package versions and Playwright configuration remain identical to the preceding main. The full release gate still requires every original validation job to succeed.

## Published changes

- Graphics settings now compile local fog out when that feature is disabled. Other atmosphere effects remain active. Repeated setting changes reuse the two program variants; ordinary weather changes continue to use uniforms.
- Uniform-masked surface materials skip their weather calculation when both wetness and snow cover are exactly zero. Nonzero weather keeps its original calculation. No epsilon or quality reduction was introduced.
- Browser jobs in the main and graphics workflows use official HTTPS Ubuntu package sources before installing dependencies. The helper covers legacy sources, deb822 sources and the hosted runner's `apt-mirrors.txt`, while retaining suites, signing options and mirror metadata. Package selections and test deadlines are unchanged.

The [publication receipt](evidence/inactive-shader-work-20261119/publication.json) records the protected source identities. The application, test and fixture bytes at `f80309f` are identical to the shader candidate tested in the paired run; the child commit adds only the CI transport correction.

## Completed shader and startup evidence

[Paired run 44642706691](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44642706691) compared baseline `54a09a0` with candidate `669a44d` using independently built, identified artifacts and the original application cases.

| Check | Result |
| --- | --- |
| Focused local shader/atmosphere/settings tests | 179 passed in 11 files |
| Guarded production build, typecheck, scoped lint and bundle/IP checks | Passed; initial JavaScript 3.57 MB gzip against a 4 MB limit |
| SwiftShader component cases | 4/4 passed |
| Mesa llvmpipe component cases | 4/4 passed |
| Weather comparisons against the frozen original shader | All 40 rows exact in RGBA8 output |
| Disabled fog, held frames and restored frames | Exact; four native local-fog uniforms absent when disabled |
| Repeated fog toggles | Two program variants reused without growth |
| Aerial perspective, cloud shadow, grounding and active-fog controls | Each still changes rendered channels |
| Original Low menu/settings cases | Baseline 4/4; candidate 4/4 |
| Original High application case | Both fail the same 90-second paused-readiness assertion |
| Existing workflow/release-gate tests after the HTTPS change | 82 passed |

The Low suite reported 2.7 minutes on baseline and 2.2 minutes on candidate. These are single-pair, whole-test observations; they do not isolate preparation cost or establish a repeated hardware performance result. Both High cases still report `loading` when `paused` is required. No job reached its overall job cap. The High startup problem remains open.

The compact [evidence package](evidence/inactive-shader-work-20261119/README.md) retains numerical component reports, source/run/job identities, original artifact digests, startup outcomes and a payload hash manifest. It separates the component proof from startup and the local HTTPS fixture audit.

## Main validation

[Build and validation run 44646348452](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44646348452) is validating the published `f80309f` source. Its lint/content/typecheck, full build, demo build, IP checks, exact-source artifact preservation and road-scenario gate have passed. Unit and application validation remain in progress; no successful release or complete green CI is claimed.

The separate [Graphics advancement run 44646348213](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44646348213) has completed these jobs on that exact source:

- GPU component job `135989810197`: all seven cases pass. Chromium/system setup took 31.925 seconds and Mesa installation took 3.227 seconds. Its log contains no HTTP mirror retry or fetch-error lines.
- Gameplay job `135989810747`: the complete driving/capture/replay case passes, with a 2.6-minute suite. Chromium/system setup took 44.616 seconds and Mesa installation took 2.368 seconds, with no mirror retry/error lines.
- High job `135989810437`: the original 90-second assertion still fails at `graphics-high-journey.spec.ts:698`, expected `paused`, received `loading`. Package setup completed successfully, with no mirror retry/error lines; this is an application readiness failure.

The setup observations establish that the previous HTTP fallback stall did not recur in those completed jobs. They do not claim a general installation-time benchmark.

The separate settings workflows also completed their actual tests. [Settings interaction run 44646348313](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44646348313) reports three passes, one failure and three original owner/review skips; its dependent QA job is skipped. [Settings transition run 44646348624](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44646348624) reports five passes and one failure. Both failures are the original Low paused-grid readiness assertion at `30-menu-access.spec.ts:162`, still `loading` at 60 seconds. Both settings-transition dimensions pass. These overlapping runs are additional evidence that startup is not reliably resolved; their case counts must not be summed with the paired comparison as unique cases.

The unrelated branch-consolidation workflow stopped its preflight because the existing `babylon-js` branch is not merged. Its log shows no branch-deletion phase was reached. No experimental branch was merged to bypass that condition.

## Isolated motorcycle follow-up

Candidate `756f587e29f25e5f1ea0023ac2660759f027799d` aligns the motorcycle tracker's wet line width with the existing shared planner. It has not been published to main. A local integration at `42f1566` additionally includes the required simulation-version and record-compatibility update; that integration is also outside main.

The original eight-rider, two-lap Poggio Alto rain race passes on the candidate, with zero impact and zero crashes. The full original contact file passed 21/22 locally, with a clear-weather impact failure of `0.9833333333333334`. An independent same-runtime baseline control reproduces that exact clear failure without the patch. Both use Node 24.22.3, while CI selects Node 22. The clear failure therefore is not established as a new regression from wet scaling.

A bounded observer recorded 58,184 rider updates before the first native dry fall: water stayed exactly zero and path width stayed exactly one. The candidate's dry full-width offset and curvature retain the original values. Focused steering/path/braking checks passed 64/64; lint, format and typecheck passed.

The identical isolated clear case then passed once on each source using the exact CI Node 22.23.4 binary for both the guard and Vitest. Baseline took 39.703 seconds; candidate took 41.450 seconds. No assertion or deadline changed. This separates the local Node 24 dry failure from the wet-path patch.

[Hosted paired race run 44647781041](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44647781041) tests candidate `5f23cf60923638bd03b29df9c7b533c536e8624f`, tree `97674f9a9e89ecb7a00427a11310cd5743daf121`, against pinned main `f80309f`. Both jobs run the complete original contact and bike-session files under Node 22, including the original mixed GP/superbike case.

The candidate has finished: **22/22 original contact cases pass**, including the wet race; **13/14 original bike-session cases pass**. Its only original failure is the existing mixed-class pace assertion, with GP `91.13427179346363 s` versus superbike `90.36337145755091 s`, exactly matching the retained complete baseline. All **128 focused/identity cases**, scoped lint and typecheck pass. Source/runtime identities and artifact digests are verified. The fresh paired baseline remains pending, so this is not yet an acceptance claim for main.

The compact [local runtime controls](evidence/wet-path-runtime-20261119/README.md) preserve the source identities and the Node 24/Node 22 distinction without replacing that hosted comparison.

The older retained-uniform experiment and broader GP steering/admission trials remain outside main. Their historical results are in the preceding continuation reports; this publication does not change their acceptance status.
