# Independent review of the native signed GP command candidate

Reviewed on 2026-11-19. This review made no production edits, did not start a new race, and did not alter the candidate worktree. It independently repeated the two short saved-state replays on immutable 3e source and inspected the existing f79 candidate checks.

## Verdict

The published saved-state proof is reproducible and refers to the same physical trajectory as our earlier history-only candidate. The f79 implementation follows that proof without an identified static source defect. It is nevertheless **unaccepted**: its completed, source-stable original mixed seed 3303 test fails the unchanged GP pace assertion. A valid local command-authority correction does not establish that the race failure is solved.

The latest completed original checks reviewed here are mixed 3303, Ardennes 1000, and snapshot round-trip. No full original 51-case acceptance result is claimed. Candidate identity remains unchanged pending acceptance.

## Source and recording identity

| Item | Identity / finding |
| --- | --- |
| Our history-only source | `0594a2b43b9a2769085efa1e1835243927fbb705` |
| Published proof source | `3e58984936a9e1ba2821580688a723fb93053fa4` |
| Signed-command candidate | `f79c088bba9d407be8273d03f36721b67e7308d3`, parent 3e |
| Candidate tree | `3083b99420162eadfa4ea2d5612413f8e10af9a9` |
| Candidate working tree | Clean; all four changed files exactly match committed blobs |
| 0594 to 3e production difference | Explanatory comments only in `src/simulation/bike.ts`; executable source is identical |
| 0594 to 3e tests | Additive current-history test renamed with a small test-only edit; original four gate files unchanged |
| Original gate sources on f79 | All four SHA-256 hashes match the retained ffd originals |

The independently recorded 0594 GP4 onset and the published 3e onset share 914 native observations. All 22,850 comparisons match exactly: input, native plant inputs, seven native plant outputs, twelve selected after-state values, front inverse arguments/result, and rear preview arguments/result. The event is the same first fall at race time 153.05000000002514 s, station 1931.934944540114 m, tick 18366/substep 1. The native absolute-lean guard fires; the later marshal CONTACT label does not establish a physical impact.

The published package index (`fc3a55f2f6ef02129f5f14f5201f16f124849240325faa330b3f1bfcf19f546c`) verifies all 36 indexed artifacts and expanded compressed streams. See `integrity.json` and `independent-onset-parity.json`.

## Independent saved-state reproduction

Both published replay scripts were executed against the existing clean 3e worktree, with output outside the source tree. Each guard protected 7,462 inputs, remained source-stable, and completed successfully. Both output files are byte-identical to the committed results, not merely numerically close.

| Replay | Wall time | Output SHA-256 |
| --- | ---: | --- |
| Native force authority | 1.12652718 s | `62f4e2c79d15e1dab1267ad087a71584436d4b53921e8bfc8e72d93753de7866` |
| Early signed command admission v3 | 1.151835576 s | `609044726e5b41a44a6e3262637ed5bed545f261bb6511405f4202b249a30a62` |

Their common source manifest is `fef411d46a63776f737664428bf8e9fe74d46b871b19aeb61a373014791b4aca`. Receipts, logs, results, and `reproduction-parity.json` are retained alongside this review.

## What the native proof establishes

The existing final force allocation is

`Ffront = (m + K/v) * a_request - Frear - K*yaw`,

where `K = yawDamping * yawInertia / frontArm` and `v = max(speed, 3)`. The native inverse already clamps its requested front force into the existing 97% reserved interval obtained from its 17 signed, projected combined-slip samples. Mapping those endpoints back through this affine relation defines a signed **request** interval. It is not the instantaneous delivered acceleration, a steady two-axle cornering capacity, or a replacement for stopping energy.

The original controller clamps the final request to a symmetric sustained-capacity bound. At two saved precursor states that clamp discards an available native front command and selects the opposite bar slew. The replay changes only final command admission, then executes the native finite-dt actuator and plant with unchanged contacts, original pedals, grip, bar limits, slew limits, and relaxation.

| Saved precursor | Original → signed admitted request (m/s²) | Original → signed actual bar (rad) | Original → signed roll acceleration (rad/s²) |
| --- | --- | --- | --- |
| Rear unloaded, tick 18204/substep 2 | 0.4925 → 9.445299727159815 | 0.004871276152773902 → 0.024871276152773902 | +0.8066281355937205 → −4.357577218034388 |
| Reload, tick 18274/substep 2 | 13.797987017393941 → 26.078928643737513 | −0.05768115006410847 → −0.037681150064108465 | +4.4234597046944755 → −0.44475626990180317 |

The response includes the real steering gyro torque, whose sign reverses with bar slew. This is not a conclusion drawn solely from a large difference between predicted and measured force. Nineteen named pre-trim values covering support, reaction, stopping work, target, rate, raw demand, and reserve remain exact. Both precursor trims and actual pedals remain unchanged. Both precursor incoming roll rates are already negative; the result improves recovery acceleration and should not be described as reversing an incoming positive roll rate.

The final-fall saved fixture still falls in both variants. Its small response difference is too late to avert the original lean guard. The second replay step reuses saved input/contact; it is a frozen native continuation, not an AI-and-suspension race continuation. Two earlier selected timestamps are outside the retained ring, so this is not a complete reconstruction of every proposed onset.

## f79 implementation review

Only `bike.ts` and `motogp-physics.ts` change in production. The new test and saved-state fixture are additive.

The native inverse exposes its existing reserved endpoints through an optional invocation-local object. It clears that object on each invocation, advertises no valid range on unavailable or nonfinite preparation, and retains no range cache or new physical state. The original sampling, reserved endpoints, nearest-root selection, and bisection arithmetic remain intact.

The road-GP controller passes raw demand through the original inverse, whose existing native clamp selects the bounded force. It maps the returned interval to admitted acceleration for the literal original trim law. The normal valid path performs one rear preview and one inverse. If metadata or the inverse is invalid, a second pure inverse query uses the full legacy force; this preserves force-dependent prescribed overrides as well as legacy trim. Neither query advances wheels, suspension, contact relaxation, or actuators. The reordered pure previews do not consume trim.

Target support, current-history observation, stopping work, recovery scalar, assistance gains, requested-support reserve, and longitudinal allocation formulas are unchanged. No target-admission memory or filter is introduced. Existing manual and standalone gates retain their original paths. Static review found no blocker in this implementation slice.

The native tests cover the four retained original fixtures, reflected precursor turns, finite signed longitudinal force/camber cases, root/range parity, query purity and next-step behavior, stale metadata clearing, missing/invalid-range complete legacy fallback, no-front behavior, and standalone two-step parity. The original negative-control source fails 22 of the 26 new cases and passes four; its bytes were restored only after the separate guard completed.

The primary scope limit remains important: both demonstrated changing onset states have zero applied longitudinal forces. The broader tests establish inverse parity for nonzero signed forces, but do not prove all closed-loop combinations of later pedal allocation and early inverse timing. The current use of early speed and prior signed Fx is unchanged by this patch. Retaining the literal anti-windup law also does not prove its global behavior under every wider admitted interval.

## Existing candidate checks independently inspected

All positive candidate checks below share protected-input manifest `d63fb30a0514cdc592e48f846440427a2a01bcd27f1f8263c510d9afe139bd5c`. Every listed guard is terminal, source-stable, with no changed paths. Receipt, log, and manifest hashes were checked against actual files; see `candidate-review-integrity.json`.

| Check | Existing terminal result | Wall time |
| --- | --- | ---: |
| Focused native composition | 127/127 pass: 26 new, 101 unchanged | 28.437319593 s |
| TypeScript | Pass | 32.292195554 s |
| Scoped ESLint | Pass | 2.985148781 s |
| Original mixed seed 3303 | **Fail**: GP 90.93835068988787 s, SBK 89.74459670278252 s; unchanged `bike-session.test.ts:367` | 25.275095403 s |
| Original Ardennes seed 1000 | Pass | 17.1444871 s |
| Original snapshot round-trip | Pass | 8.021298116 s |

The mixed result supersedes the candidate README/source receipt's earlier “pending” status. It does not establish whether the former GP4 fall disappears, moves, or is replaced; no f79 first-fall recording was reviewed here. It also cannot be read as a uniform per-rider pace change because class-best ownership and incident effects can change across trajectories.

## Continuation boundary

Preserve f79 and its failure as an isolated, unaccepted candidate. Do not duplicate its native checks or completed original races, and do not claim original 51-case acceptance or bump simulation identity from this review. A further candidate observation, if pursued by its owner, should first identify the current original-race failure and its earliest native onset on this exact source. The existing implementation and proof remove the need to launch a parallel planner observer for the already demonstrated 3e command-admission mismatch.

## Locations

- Published proof: `/workspace/scratch/dac6891506fb/Experiment-3/ci-reports/evidence/continuation-resume-2146-20261119/physics-native-admission-3e58984/`
- Frozen candidate: `/workspace/scratch/dac6891506fb/gp-signed-admission-2245/`
- Candidate's original checks: `/workspace/scratch/dac6891506fb/signed-admission-evidence-2245/`
- Independent reproduction and review: `/workspace/scratch/1c4b13d5bcb1/engine-evidence/new-admission-review/`
