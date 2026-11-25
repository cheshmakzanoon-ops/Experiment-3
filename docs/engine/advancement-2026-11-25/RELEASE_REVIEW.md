# Final engine release review

Assignment **60/60**, wave 10. **Ready to publish the final documentation and
evidence for the accepted engine checkpoint**, with the acceptance boundaries
below retained. This review found no new blocking implementation defect or
scope violation. It does not declare every repository workflow green, certify
physical hardware, or claim that a future publication has already happened.

The user requested sixty distinct assignments in ten waves, substantial
improvement to the underlying engine, publication to `main`, and no changes to
models, characters or environments. The implementation, measured results,
protected-content proof and completed review structure support that delivery.
The final push and its exact commit/tree verification remain the coordinator's
responsibility after this review is handed off.

The [review receipt](evidence/w10-release-review.json) records the independently
checked identities, paths, digests, acceptance records and publication checks.
This assignment used read-only source and Git inspection, lightweight hashing
and arithmetic. It ran no compiler, build, unit suite, browser or new benchmark,
and changed no source, tests, assets or Git state.

## Source and publication boundary

| Item                       | Independently checked identity             |
| -------------------------- | ------------------------------------------ |
| Original baseline          | `350119e8ec0606e8c5de5b3ab80df41104025679` |
| Accepted executable source | `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86` |
| Accepted source tree       | `5f466294eca0b188db58375a1caf4cd76088527b` |
| Observed publication base  | `ac4367bdf9a98a34a1123d7a325df41587a690e9` |
| Observed base tree         | `38594dfbacd5c71e17347835250b32a65063ce59` |
| Production `src` subtree   | `2d1bcc0f9b29f06761b8eb5c650bbbb53dd159a3` |

The accepted source, preceding `26efaeef` source and observed `ac4367b` base
have the same entire production subtree. The difference from `26efaeef` to the
accepted checkpoint includes the deliberate test-fixture cast repair and
test-only formatting/evidence updates. Its successful compiler and browser
results belong to the corrected commit, not to the failed earlier run.

`ac4367b` is a direct child of the accepted commit. All **25** changed paths
between those commits are CI reports. The local first-parent history contains
**22 commits after the original baseline, including 12 CI-report commits**;
those reports are preserved. At this review's recorded observation, all **56
staged paths** and all remaining unstaged/untracked delivery paths were inside
this advancement documentation/evidence directory. No executable, test,
configuration, harness or authored-content difference from the accepted
checkpoint existed outside documentation and CI reports.

Those counts describe an inspected snapshot. The coordinator will add this
review and the final ledger/status updates before publication. A new commit
hash is not predicted here; the final response and repository history must
identify the actually published commit. [Publication ancestry audit](w09f-publication-ancestry-audit.md).

## Engine scope and protected content

Exactly **25 production files** changed from the original baseline. Their
purposes are engine algorithms, packet ownership, frame admission, resource
lifetimes, input/modal ownership and record interpretation. The
[architecture guide](ENGINE_CHANGES.md) links every changed production file;
the [protected-content audit](w09e-protected-content-audit.md) reviews every
production hunk and the authored-content boundary of each file.

This final review independently reconciled all **1,758 protected manifest
entries** against the original tree, accepted tree, observed HEAD and current
index. All modes, object types and blob identities match. Their canonical
manifest SHA-256 is:

```text
f90b832132cf3c7d8f05204897ffed535d03254523a198119f67f2f79dbe5491
```

The retained independent audit additionally streamed all **263,530,318 bytes**
of protected working files and verified their Git and SHA-256 identities. This
final review carries that result forward through unchanged tracked content;
it did not repeat the entire 263 MB stream. It did freshly hash all **25
changed production files**, matching their accepted blobs and the audit's
worktree receipts.

The protected set includes all public assets, model-directory paths, character
and environment source, shaders, track and vehicle definitions, authoring tools
and the other unchanged production files. The renderer audit preserves all
**33 geometry/material construction expressions** and scene-constructor token
streams after excluding only the independently reviewed GPU-owner assignment.
The synthetic native test shader is a test fixture, not an authored game shader
or model change. Generated `supplied-player-lods.bin.gz` is absent; no unchanged
hash is invented for that nonexistent output.

These are source/content preservation statements. Scheduling and lifecycle
changes intentionally alter engine behavior, so content identity alone cannot
prove every rendered pixel or all gameplay outcomes identical.

## Exact-source acceptance matrix

The accepted [focused workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45592833399)
is run **45592833399**, job **139131185041**, at `774e62fa`. This review checked
the source/tree/lock identities, successful job steps, complete retained logs
and case index, then rehashed all **23 files** listed in the final manifest.
It also independently hashed the original downloaded archive: artifact
**15012585753**, **1,300,824 bytes**, SHA-256
`3ae96693bf5bc12acdbd449592ef36b94bd1d05ffa9a1ce492d24e401cb2598a`.
The archive contains a mixture of original members and normalized attachment
records; the manifest explicitly describes those transformations.

| Gate                            | Result and evidence                                                                               | Practical boundary                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Focused engine units            | **914 passed in 70 files**; unit log and selection manifest agree                                 | This is the documented selection, not the complete repository unit suite.                                                    |
| Full TypeScript                 | **Passed** in the exact-source chained compiler/build step                                        | Project checking retains existing compiler options; `.mjs` evidence tools are not TypeScript-checked.                        |
| Production build                | **Passed**, `product` / `full` at the accepted commit                                             | Build identity matches; successful bundling does not prove runtime or hardware behavior.                                     |
| Native browser/replay contracts | **47 unique cases passed**, one passed result each, retry zero; no errors, flaky or skipped cases | Native execution uses software ANGLE/Mesa llvmpipe and each fixture's stated scope.                                          |
| Changed-code ESLint             | **89 files, zero errors or warnings**, in the retained static audit                               | This is scoped lint acceptance, separate from full semantic/runtime gates.                                                   |
| Changed-file formatting         | **Not fully green**                                                                               | Ten files carry original file-level formatting debt; one task-created proof script intentionally retains its recorded bytes. |
| Protected content               | **Passed** for 1,758 checked paths and the reviewed engine-change boundary                        | Preserves authored source/content; does not establish every resulting scene image.                                           |
| Broader repository CI           | **Not accepted as globally green**                                                                | Four unit failures are proven on the original baseline; broader browser failures remain only partly classified.              |

The product fingerprint is
`08a29559c6223e8bef3d6c5af2229ea9421e1c6d9d9659e3144cd7c044267529`.
See the [unit audit](w09a-consolidated-unit-acceptance.md),
[static/build audit](w09b-build-static-acceptance.md),
[native audit](w09c-native-evidence-audit.md) and
[final result manifest](evidence/checkpoint-774e62f/result.json).

Earlier failed compiler/native checkpoints remain in [CHECKPOINTS](CHECKPOINTS.md)
with their own identities and evidence. The killed local consolidated test
attempt and exit-137 local semantic attempt remain incomplete. The successful
corrected-source run resolves the pending gates without reclassifying those
earlier attempts as successes.

### Native graphics limitation remains an open result

The strict shared-GPU ownership witness uses a test-only explicit `vec4`
uniform. Its complete red and green targets match all 256 bytes; fences are
released once, with no `gl.finish()` or remaining recorded Three resources.
That is useful evidence for gate ownership and publication ordering.

The independent **MeshBasic and raw `vec3` diagnostic paths still each differ
in 64 of 256 bytes**, through bulk, individual-pixel and Three readback. The
accepted case index retains **two explicit limitation annotations**. Passing
47 native cases therefore does not mean every material path passed, and does
not identify which native component causes the discrepancy. Clear, constant
shader, texture-upload and explicit-`vec4` controls constrain that diagnosis;
they do not certify physical graphics hardware or full-game image equivalence.

Other native results are similarly scoped. Two trusted BFCache cycles exercise
actual lifecycle methods, worker and context with a minimal UI, not every full
game route's BFCache eligibility. Audio checks exact supplied inputs and the
declared mixed-PCM budget with self-controls and a rejected real perturbation.
Controller samples are scripted although DOM, focus and RAF delivery are real.
None is a physical GPU, controller or audio-device validation.

## Improvements and measured tradeoffs

The engine changes provide several independent forms of benefit:

- **Less repeated numerical work:** conservative paved-lane candidates and
  exact surface/audio coefficient reuse preserve their tested arithmetic
  boundaries while improving repeated workloads.
- **More reliable ownership:** startup, retained-page visits, modal openings,
  input polling, audio graphs and shared WebGL contexts cannot be reclaimed or
  revived by the tested obsolete callbacks.
- **Controlled publication:** packet buffers have independent ownership, bytes
  are counted before successful transfers detach them, admitted render frames
  own completion fences, and dirty ranges avoid unnecessary complete uploads.
- **Correct record boundaries:** nonmonotonic ghosts use first forward passage,
  tiny exact endpoints retain recorded time, completed laps check their closing
  telemetry gap, and unsupported flashback modes retain no input journal.

[PERFORMANCE](PERFORMANCE.md) is the authoritative current statistical guide.
Assignment 57 independently recomputed **175 case/scope rows**, **1,567 measured
pairs** and **517 warmup pairs** across eight preserved artifacts; all **7,533
checks** matched. This final review checked that receipt and reconciled its
claims with the architecture and resource reports; it did not run the workloads
again or independently repeat all 7,533 calculations.

The principal gains are repeated paved queries at **1.76–3.70 times** the
original speed, steady-rain surface work with **38.4% less paired time**, and
combined rain/storm Simulation workloads with **11.88% / 12.14% less paired
time**. Warm audio waveform and active-update batches show large reductions;
current snapshot preparation starts only at **12 selected ready recipients**.
Revised overlapping dirty ranges preserve complete contents while publishing
much less data.

The unfavorable results remain material to the release. All-miss lane streams
are **2.19–2.67 times slower**. First-use audio, several surface cases and
every measured disjoint dirty-range size retain overhead. Snapshot preparation
was harmful for small recipient counts, which is why the accepted policy uses
ordinary encoding below twelve. The original and revised range experiments are
separate sessions, not a direct paired candidate-to-candidate comparison.
Overlapping timing scopes and subsystem percentages cannot be added to invent
a game-wide improvement. No report establishes whole-game FPS, native GPU
latency, retained heap/GC, physical-network latency or audible quality gains.

The [resource review](w10d-resource-bounds-acceptance.md) keeps the corresponding
costs explicit: **280 KiB per Track** of fixed surface payload, **640 KiB per
evaluated audio module instance**, and up to **72,008 bytes** for a validated
nonmonotonic ghost index. The new paved index caps entries at 2,048; existing
MX/SX retention remains uncapped. Supported flashback modes still retain
session-long input history, and replay metadata/persistent history can grow.
The Festival 90-second budget is **per GPU-admission wait**, checked between
yields, rather than a total preparation or compilation deadline. Finite native
cleanup observations do not prove a complete-game soak or a global memory cap.

## Remaining failures and continuation priorities

The [baseline-failure comparison](w09d-baseline-failure-classification.md)
reproduces the same four selected assertions on the actual original and accepted
source: the APX-01 livery material role, two catalogue/calibration hash
expectations, and dictionary validation with the same fourteen missing-key
records. It supports those precise baseline classifications. It does not prove
the entire unit suite green or authorize changing protected content to satisfy
expectations.

The broader earlier browser run retains real value/evaluation failures and
timeouts before cancellation, including Festival input/photo return, wheel
visibility, signed driver-pose and programme readiness cases. These were not
all reproduced against exact original `350119e8`; they cannot all be described
as pre-existing or caused by cancellation. The retained source review narrows
some possible causes but does not replace native execution.

These are explicit continuation targets, not hidden passes: characterize the
material-path discrepancy on an appropriate backend, compare the unresolved
browser cases at exact original/current source, and use the retained adverse
performance cases for any next optimization. Each follow-up needs its own
source identity and unchanged relevant assertions. No extra model, character
or environment edit follows from the current evidence.

## Sixty assignments and final publication checks

The [ledger](AGENTS.json) has **60 unique names**, sequential numbers 1–60 and
**exactly six entries in each of ten waves**. Assignments 1–59 were marked
complete at inspection; assignment 60 is this review and completes when its
files and findings are handed off. The real nested assignment 9 counts once.
Failed spawn attempts and later followup turns do not create extra entries.
The [evidence index](EVIDENCE_INDEX.md) maps the assignments to their delivered
reports. This verifies the recorded execution/handoff structure; Git alone is
not an independent log of agent invocation history.

After this handoff, the coordinator should complete the already authorized
publication in this order:

1. Mark assignment 60 complete, update the overview's completion statement, and
   stage all final documents/evidence, including the intentionally retained
   ignored `browser-backend.json`.
2. Confirm the final staged and working changes still preserve the accepted
   executable/test/configuration/harness identities. Inspect and preserve any
   newer remote commits before selecting the publication parent.
3. Publish the exact reviewed index tree with a non-forced `main` update guarded
   by the expected remote parent. Existing CI-report history must remain in
   ancestry.
4. Fetch the created commit, compare its actual parent/tree and intended files,
   verify the remote branch points to that commit or a preserved descendant,
   and confirm no intended delivery files remain uncommitted.
5. Report the actual final publication commit separately from accepted executable
   source `774e62fa` and its workflow. A documentation-only commit does not claim
   a new execution of the test suite.

Those checks make publication concrete and verifiable. They do not require a
new runtime run when the accepted executable inputs are unchanged. Any newly
discovered executable delta would instead need its own appropriate acceptance.
