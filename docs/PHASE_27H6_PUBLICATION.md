# 27H.6 publication reconciliation and guarded activation

Runtime base: `d3305aba4feabe48ab5c9edecc39861c3ce982d6`, tree
`98f2e144e805e548916e85daf92c3cdde282e820`.
Saved local menu implementation: `9961d9309bb909e23e4f8027eea49fc00ec66ab2`.

## Retained work

Keep the reconciled racing presentation, slow-frame effects repair, drawing-buffer
assertions and existing menu tests from the newer candidate. Integrate the saved
menu's labelled focusable region, isolated navigation keydowns, responsive header/
footer sizing, six DOM regressions and early settings-click timeout. Retain the
concurrent menu repair's thin scrollbar and focus margins. Keyup propagation and
all existing race, weather, replay, input, physics and rendering contracts remain.
No authored asset, dependency, original CI workflow or simulation change is made.

## Remaining failed workload

Run `36185456033`, browser job `108239006930`, passed eleven cases and failed
only the cockpit wet-following case when its five-lap session finished. The trace
recorded 429 review frames and a longest wet-following interval of 0.965 seconds.
Among 289 pairs of diagnostic observations whose presented-frame counters differ
by exactly one, 101 intervals exceed the recorder's one-second continuity gate.
Near the first wet-following opportunity, individual intervals reach 1.2–1.5s.
A paused/repeated frame or a hidden interval cannot qualify as observed driving.

The cockpit functional workload now uses its ordinary graphics slider to select
50% internal rendering, while keeping the 640x400 interface, both real mirrors,
full rain/spray, all eight cars and the five-lap race. Other camera workloads keep
75%. The context and assertions record this distinction. Three-second following,
contact-water, same-rival and visible-frame requirements are NOT relaxed. The
independent default-quality wet/night, full-lap, mirror and pit journeys remain.
An interrupted run additionally retains its final diagnostics rather than only
a generic session-ended message. Software-renderer footage is not final-art or
physical-hardware performance acceptance.

## Publication transaction

The existing temporary capture workflow reconstructs an exact checksum-verified
candidate, runs fast menu checks and the complete browser and numerical suites,
and only then allows its publication job. The final job verifies all prerequisite
results, the source tree, the candidate's sole parent and the current main SHA.
It refuses concurrent changes and performs only a non-force forward update.
After a transport error it reads main before retrying, preventing blind duplicate
publication. It reads the final branch back and explicitly dispatches ordinary
CI, because a push using GITHUB_TOKEN does not itself trigger another push run.
Only the publishing job receives the added Actions-write permission required for
dispatch. Test workers remain read-only. No credentials are printed or retained.

Successful object upload, staging on main, test success and activation remain
separate states. The workflow summary and publication artifact identify the exact
result; this document does not predeclare a hosted pass or a successful release.
Temporary source capsules are absent from the activated game tree, but remain
recoverable in Git history. No new branch or unrelated project content is added.

## First hosted verification and strict workload contract

The independent cockpit run in `36193947794` completed and qualified its real
wet-following recording, then correctly failed an obsolete export assertion
which still expected 75% rather than the deliberately selected 50% resolution.
The test now declares the expected scale once and verifies that exact value both
before recording and in the exported configuration and actual drawing-buffer
dimensions. No range of accepted values or racing criterion is introduced.
Every test is rerun on the corrected source; the failed revision is not activated.
Revision-specific preflight concurrency avoids blocking a correction behind an
already-failed revision. The sole-parent/current-main checks remain the final
publication lock, so an obsolete candidate cannot overwrite newer staging.
