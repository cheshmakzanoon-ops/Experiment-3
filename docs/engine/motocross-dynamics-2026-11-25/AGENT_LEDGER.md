# Actual agent ledger and work ownership

**Final assignment closure: 2026-11-25 20:55:40 UTC.** The coordinator-maintained [actual roster](agent-roster.json) contains **60 distinct spawned agents**, numbered consecutively from 1 through 60, with **six in each of ten waves**. All **60 numbered assignment reports** are present. A59's preflight and A60's independent verification of the published code are complete. A50's final browser acceptance **failed**; its diagnostic and all processes have ended. Assignment completion does not convert a failed validation gate into a pass. The coordinator will separately publish and verify the documentation containing this ledger.

The project is organized into **ten logical waves of six assignments**. At most three subagents can run alongside the coordinator, so a six-assignment wave is dispatched within that concurrency limit. A logical wave is an ownership/review grouping, not a claim that six agents ran simultaneously or that every long acceptance job ended before documentation in the next wave began.

This ledger uses actual canonical names from the roster and existing numbered reports. All names below have the `/root/` prefix shown in the roster. Retries, interrupted executor recovery, messages, follow-up turns and the coordinator's integration work are **not additional agents**. A spawn request rejected before creation is not counted. The coordinator owns integration, source freeze, the Git index and publication; those actions are attributed where applicable rather than silently assigned to a subagent.

## Count and outcome interpretation

| Wave | Assigned range | Actual distinct agents observed | Purpose |
| --- | --- | ---: | --- |
| 1 | 01–06 | 6 | Findings and scope |
| 2 | 07–12 | 6 | Contact, control and presentation foundations |
| 3 | 13–18 | 6 | Live dynamics and recorded posture |
| 4 | 19–24 | 6 | Contact observation and continuous control |
| 5 | 25–30 | 6 | Consumer-level physics and replay |
| 6 | 31–36 | 6 | Integrated acceptance and causal diagnosis |
| 7 | 37–42 | 6 | Native/race integration and scope |
| 8 | 43–48 | 6 | Independent adversarial review and repair |
| 9 | 49–54 | 6 | Final frozen-source acceptance |
| 10 | 55–60 | 6 | Architecture, coverage and publication closure |

A completed assignment can be a shipped fix, a rigorous rejection, a discovered regression or a completed validation with a failed outcome. It does not mean every experimental patch shipped or every check was green. Earlier reports remain point-in-time evidence. The final acceptance source is the frozen source tree identified in [BUILD_PROVENANCE.md](BUILD_PROVENANCE.md); the complete code-change map is [CHANGE_COVERAGE.md](CHANGE_COVERAGE.md).

The coordinator published [source commit `39d9d497880e92801a7d77de6af2639b4186bfcc`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/39d9d497880e92801a7d77de6af2639b4186bfcc) to `main` with tree `b7f379a7aaea0f807b5623b2c981190c6d1a3a17` and sole parent `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`. [A60](agents/60-publication-verification.md) independently observed that actual branch update and then its CI-only child `6dc4c70515bfde48b27e2794bd97cdf1e1bd681d`, whose complete tree is `9fc26764430e29c7e0283be435b117682dd77fdf`. All accepted source remains identical. Root preserved that child by normal fast-forward before documentation publication. A58 independently confirms the local graph, the sole changed `ci-reports/benchmark-smoke.md` path, and unchanged code bytes. The distinct code, CI-receipt and future documentation trees must not be conflated.

## Wave 1 — Findings and scope

| Assignment and actual canonical suffix | Ownership/outcome | Evidence and final interpretation |
| --- | --- | --- |
| **01** · `w01_a01_physics_audit` | Audit | Reproduced axle-order residual and suspension work-conjugacy gap; fed A7/A18. [Report 01](agents/01-physics-audit.md). |
| **02** · `w01_a02_motion_audit` | Audit | Identified posture threshold/rate chatter and lost joint reversals; preserved existing deterministic rigs. [Report 02](agents/02-motion-audit.md). |
| **03** · `w01_a03_suspension_audit` | Audit | Measured spring-force versus visible-stroke timestamp mismatch; led to root integration, A13 and A32. [Report 03](agents/03-suspension-audit.md). |
| **04** · `w01_a04_transport_audit` | Audit | Reproduced common presented-foot mismatch and optional-payload boundaries; fed A11/A16/A23/A27. [Report 04](agents/04-transport-audit.md). |
| **05** · `w01_a05_camera_controls_audit` | Audit | Reproduced rate loss in legal interrupted shifts and sampled camera lead; fed controller/camera work. [Report 05](agents/05-camera-controls-audit.md). |
| **06** · `w01_a06_verification_audit` | Audit | Mapped the real app/worker/native test path and its manual-player, venue and graphics coverage limits. [Report 06](agents/06-verification-audit.md). |

## Wave 2 — Contact, control and presentation foundations

| Assignment and actual canonical suffix | Ownership/outcome | Evidence and final interpretation |
| --- | --- | --- |
| **07** · `w02_a07_coupled_stops` | Shipped helper | Implemented the coupled unilateral stop solve; root owns actual vehicle integration. [Report 07](agents/07-coupled-stops.md). |
| **08** · `w02_a08_posture` | Shipped controller | Implemented bounded continuous automatic posture and smooth targets; root integrated once-per-tick ownership. [Report 08](agents/08-posture.md). |
| **09** · `w02_a09_camera` | Shipped camera | Corrected measured heading-ramp response and retained discontinuity handling. [Report 09](agents/09-camera.md). |
| **10** · `w02_a10_ground_passivity` | Shipped physics | Replaced energy-adding explicit coordinate cross terms with passive frame rotation. [Report 10](agents/10-ground-passivity.md). |
| **11** · `w02_a11_snapshot_coherence` | Shipped presentation | Unified common motion/foot presentation and invalid marked-payload fallbacks; later extended by A27/A47. [Report 11](agents/11-snapshot-coherence.md). |
| **12** · `w02_a12_gear_continuity` | Shipped, refined later | Preserved incoming shift position/rate; final near-limit construction is A44, not this intermediate bridge alone. [Report 12](agents/12-gear-continuity.md). |

## Wave 3 — Live dynamics and recorded posture

| Assignment and actual canonical suffix | Ownership/outcome | Evidence and final interpretation |
| --- | --- | --- |
| **13** · `w03_a13_suspension_coherence` | Tests/review | Added live suspension force/timestamp and reset assertions without changing models or force laws. [Report 13](agents/13-suspension-coherence.md). |
| **14** · `w03_a14_reset_lifecycle` | Tests/discovery | Added actual reset/recovery regressions and exposed stale wheel publication; A15 coordinated the correction. [Report 14](agents/14-reset-lifecycle.md). |
| **15** · `w03_a15_ballistic_integration` | Shipped physics/reset | Integrated unsupported gravity coherently and repaired transient contact/remount wheel state. [Report 15](agents/15-ballistic-integration.md). |
| **16** · `w03_a16_posture_transport` | Shipped transport | Recorded standing/dab rates and reconstructed bounded posture with legacy/lifecycle fallbacks. [Report 16](agents/16-posture-transport.md). |
| **17** · `w03_a17_joint_reversals` | Shipped presentation | Preserved resolved joint extrema through mechanically bounded Hermite reconstruction. [Report 17](agents/17-joint-reversals.md). |
| **18** · `w03_a18_spring_geometry` | Diagnostic; fix rejected | Shipped spring-work diagnostic only; isolated torque-Jacobian correction broke sampled calibration and was not shipped. [Report 18](agents/18-spring-geometry.md). |

## Wave 4 — Contact observation and continuous control

| Assignment and actual canonical suffix | Ownership/outcome | Evidence and final interpretation |
| --- | --- | --- |
| **19** · `w04_a19_landing_observability` | Shipped observation | Distinguished closing overlap, preserved forecast phase and recorded supported full-travel crossings. [Report 19](agents/19-landing-observability.md). |
| **20** · `w04_a20_shift_contact` | Shipped controller | Coordinated interrupted boot clearance/cover; discovered endpoint-only replay clipping addressed in A27. [Report 20](agents/20-shift-contact.md). |
| **21** · `w04_a21_rider_blending` | Shipped controller | Added local C1 manual/automatic pose blending and exact tangent; finite physical rider stroke remains intact. [Report 21](agents/21-rider-blending.md). |
| **22** · `w04_a22_analytic_air_drag` | Shipped physics | Added analytic quadratic drag/travel, shared with prediction and scoped to eligible flight. [Report 22](agents/22-air-drag.md). |
| **23** · `w04_a23_body_transport` | Shipped transport | Recorded and reconstructed the actual blended body tangent at tail offset +20. [Report 23](agents/23-body-transport.md). |
| **24** · `w04_a24_camera_motion` | Shipped camera | Integrated measured roll/gaze ramps with existing discontinuity and motion-setting behavior. [Report 24](agents/24-camera-motion.md). |

## Wave 5 — Consumer-level physics and replay

| Assignment and actual canonical suffix | Ownership/outcome | Evidence and final interpretation |
| --- | --- | --- |
| **25** · `w05_a25_contact_time` | Shipped physics | Added endpoint-bracketed player first-contact timing and one supported remainder; later root basis repair is A36. [Report 25](agents/25-contact-time.md). |
| **26** · `w05_a26_stop_integration` | Tests/review | Validated the real coupled-stop consumer and retained the forward-only speed-clamp counterexample. [Report 26](agents/26-stop-integration.md). |
| **27** · `w05_a27_foot_reconstruction` | Shipped reconstruction | Recorded accepted-foot events/seed/clock and routed existing rig and PresentedFrame through one evaluator. [Report 27](agents/27-foot-reconstruction.md). |
| **28** · `w05_a28_supported_accuracy` | Shipped integration | Added capped supported-stage refinement without changing calibrated force/crash laws. [Report 28](agents/28-supported-accuracy.md). |
| **29** · `w05_a29_replay_motion` | Tests/replay | Exercised actual logged input, resimulation, compact replay, pause and seek through existing rigs. [Report 29](agents/29-replay-motion.md). |
| **30** · `w05_a30_scope_isolation` | Isolation/diagnostic | Compared real non-MX traces; root restored the legacy multiplication order. MX road-practice telemetry differences remain explicit. [Report 30](agents/30-scope-isolation.md). |

## Wave 6 — Integrated acceptance and causal diagnosis

| Assignment and actual canonical suffix | Ownership/outcome | Evidence and final interpretation |
| --- | --- | --- |
| **31** · `w06_a31_legacy_motion_boundary` | Shipped compatibility | Restored unmarked foot-control release/reapplication across rider-state edges. [Report 31](agents/31-legacy-motion-boundary.md). |
| **32** · `w06_a32_live_pose_coherence` | Tests/actual rigs | Verified live suspension reaches existing fork, wheels and swingarm; documented temporal/geometry limits. [Report 32](agents/32-live-pose-coherence.md). |
| **33** · `w06_a33_player_scenarios` | Benchmarks/tests | Added real independent-player flight, ground-control, rain and adverse scenarios; retained legitimate adverse crashes. [Report 33](agents/33-player-scenarios.md). |
| **34** · `w06_a34_integrated_units` | Integration findings | Recorded initial failed acceptance and baseline comparisons; the same regression files later pass in A49. [Report 34](agents/34-integrated-units.md). |
| **35** · `w06_a35_display_cadence` | Benchmark enhancement | Expanded actual-controller cadence coverage beyond naturally active race channels; final rerun is A54. [Report 35](agents/35-display-cadence.md). |
| **36** · `w06_a36_full_lap_regressions` | Causal review | Isolated root endpoint terrain-basis repair as the cause of resolved held-whip/full-lap regressions. [Report 36](agents/36-full-lap-regressions.md). |

## Wave 7 — Native/race integration and scope

| Assignment and actual canonical suffix | Ownership/outcome | Evidence and final interpretation |
| --- | --- | --- |
| **37** · `w07_a37_native_gameplay` | Earlier native pass | Completed the browser journey on an earlier source; four later runtime fixes prevent treating it as final-source acceptance. [Report 37](agents/37-native-gameplay.md). |
| **38** · `w07_a38_full_grid_races` | Earlier grid failure | Preserved seven-pass/one-fail matrix; A40 repaired the route discontinuity and A52 reran the full matrix. [Report 38](agents/38-full-grid-races.md). |
| **39** · `w07_a39_engine_cost` | Cost audit | Measured bounded contact/refinement work and reader operations; no unsupported FPS optimization or speedup claim. [Report 39](agents/39-engine-cost.md). |
| **40** · `w07_a40_grid_regression` | Shipped AI integration | Removed binary front-load eligibility from the existing shoulder guard; physical limits and geometry unchanged. [Report 40](agents/40-grid-regression.md). |
| **41** · `w07_a41_recording_contract` | Test-contract correction | Updated the strict full-tail oracle for intentional idle event metadata; retained car/road/invalid-buffer boundaries. [Report 41](agents/41-recording-contract.md). |
| **42** · `w07_a42_baseline_ci` | Baseline comparison | Reproduced the same four failures in a 52-case baseline/current comparison; no unrelated model/i18n/spec fix. [Report 42](agents/42-baseline-ci.md). |

## Wave 8 — Independent adversarial review and repair

| Assignment and actual canonical suffix | Ownership/outcome | Evidence and final interpretation |
| --- | --- | --- |
| **43** · `w08_a43_physics_review` | Independent physics review | Checked projection/KKT, contact-boundary and drag identities; retained reduced-model limitations. [Report 43](agents/43-physics-review.md). |
| **44** · `w08_a44_motion_review` | Review plus shipped fix | Repaired a newly reproduced near-extremum shift speed/Float32 defect using a bounded local incoming tangent. [Report 44](agents/44-motion-review.md). |
| **45** · `w08_a45_protocol_review` | Protocol review | Fuzzed real writer/reader boundaries and compact transport; identified global clock limit and the flex gap fixed by A47. [Report 45](agents/45-protocol-review.md). |
| **46** · `w08_a46_camera_lifecycle` | Review plus shipped fix | Repaired inherited old-flight landing recoil across a hidden touchdown/relaunch; preserved continuous camera history. [Report 46](agents/46-camera-lifecycle.md). |
| **47** · `w08_a47_replay_boundaries` | Review plus shipped fix | Rejected finite out-of-envelope optional fender payloads consistently; valid-input paths remain unchanged. [Report 47](agents/47-replay-boundaries.md). |
| **48** · `w08_a48_oracle_review` | Independent oracle review | Reviewed all changed existing test oracles and strengthened the first-contact heading/yaw observer. [Report 48](agents/48-oracle-review.md). |

## Wave 9 — Final frozen-source acceptance

| Assignment and actual canonical suffix | Ownership/outcome | Evidence and final interpretation |
| --- | --- | --- |
| **49** · `w09_a49_final_units` | Final unit acceptance | Completed 165 files / 1,836 passing cases with unchanged inputs; report and receipt are complete despite interrupted final thread state. [Report 49](agents/49-final-units.md). |
| **50** · `w09_a50_final_native` | Build passed; native failed | Completed final product build; preserved partial-playthrough target crash and the separate unchanged 20-minute diagnostic failure during settings-save. Cause remains unproven; all processes ended. [Report 50](agents/50-final-native.md). |
| **51** · `w09_a51_protected_scope` | Protected-scope acceptance | Verified 1,772 protected files and full inverse patches; no authored model/environment/specification changes. [Report 51](agents/51-protected-scope.md). |
| **52** · `w09_a52_final_races` | Final race/calibration acceptance | Completed eight races and 20 calibration configurations; first interrupted three-case attempt is preserved but excluded. [Report 52](agents/52-final-races.md). |
| **53** · `w09_a53_build_provenance` | Provenance acceptance | Independently matched accepted manifests and Vite fingerprint to the complete actual staged Git tree. [Report 53](agents/53-build-provenance.md). |
| **54** · `w09_a54_final_cadence` | Final cadence acceptance | Verified all eight recordings, 93,936 matrix / 79,344 scalar comparisons and 36,192 actual poses with zero measured differences. [Report 54](agents/54-final-cadence.md). |

## Wave 10 — Architecture, coverage and publication closure

| Assignment and actual canonical suffix | Ownership/outcome | Evidence and final interpretation |
| --- | --- | --- |
| **55** · `w10_a55_final_architecture` | Architecture complete | Documented all runtime contracts, exact tail layout, ownership and limits against final source. [Report 55](agents/55-final-architecture.md). |
| **56** · `w10_a56_final_handoff` | Handoff delivered | Wrote evidence-linked handoff/reproduction and reconciled checkpoints; root owns later reconciliation to completed native/publication evidence. [Report 56](agents/56-final-handoff.md). |
| **57** · `w10_a57_claims_limitations` | Claims/limits review complete | Independently reconciled headline receipts and remaining limitations. Its historical pending-native handoff is resolved by A50's final failed outcome. [Report 57](agents/57-claims-limitations.md). |
| **58** · `w10_a58_ledger_coverage` | Coverage and ledger complete | Mapped all 18 runtime paths to meaningful executed regressions; checked all 60 actual identities, report links and final publication/native outcomes. Follow-up is this same agent. [Report 58](agents/58-ledger-coverage.md). |
| **59** · `w10_a59_publication_preflight` | Preflight complete | Independently verified content, scope, parent/tree and acceptance provenance; retained failed native acceptance. This preflight preceded the actual branch update. [Report 59](agents/59-publication-preflight.md). |
| **60** · `w10_a60_publication_verification` | Code publication independently verified | Observed actual main at the code commit and subsequent CI-only child; verified accepted Git content, fingerprint, protected files and retained build. Excludes the future documentation commit. [Report 60](agents/60-publication-verification.md). |

## Publication and final closure boundary

The source commit is actually published. A59's preflight is complete, and A50's final diagnostic ended at 20:42:04 UTC with exit 1 after its original 20-minute limit. Low was selected but not successfully applied; the diagnostic reached no venue or gameplay captures. Its two GPU-process exit-code-9 observations do not prove an OOM, environmental or physics cause. Final native acceptance remains a failed validation gate, not a still-running task or an implicit pass.

A60 completed its independent verification of the real source publication and the source-equivalent CI successor. A58 read its actual report and evidence before recording completion, then checked all sixty identities and report links. The final documentation commit will include these reports and this ledger; root must separately publish and verify that commit. These reports do not claim to certify the later commit that will contain them.

A49's completion is grounded in its completed exit-zero receipt, full reporter and written report; an interrupted final agent turn does not erase those files or create a second run. A52's accepted evidence is its complete second attempt, while its first interrupted three-case log remains excluded. A50's earlier completed failing invocation and later completed failing diagnostic are one assignment, not extra agents. No sum of their attempts is used to inflate coverage.
