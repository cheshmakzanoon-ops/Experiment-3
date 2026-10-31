# Automatic shift-cut recovery

## Scope and identity

The accepted controller mechanism preserves wheelspin-relieving upshifts and allows one normally coupled solve before an immediate cut-exit downshift when driven tyres have recovered longitudinal grip. This replaces neither the solver nor the previously rejected road-RPM guard. Publishing this changed behavior requires physics **v21**, with older records retained in their own categories.

Long-run evidence below used an isolated archive of `210ec1ee0bc77b27eb7a899d161cd3f272788a90`, with the exact controller patch but the archive's **v20 identity**. It does not claim that a later combined commit or native package has passed CI. Runtime: official **Node 22.23.4**, V8 **12.4.254.21-node.57**, Linux x64. Vehicle source SHA-256: `3255359bd4dd266a1c2e92eb3c5cdbdd01d10997292f3201160d529cfd85d707`.

## Why this differs from the rejected guard

At HF86's first sport shift-cut exit, wheel RPM is 7882.583, below the 8000 downshift floor, but the disconnected crankshaft remains at 11830.391 RPM. Driven slip is only 0.000501 times its existing longitudinal reference peak. Immediately downshifting restarts the cut before the clutch can couple. By contrast, the useful split-grip LSD downshift has a driven tyre at **21.2105 times** that reference peak.

The rule defers only a downshift at the existing cut boundary, with previous clutch engagement zero, engine RPM above the existing floor, positive throttle, zero brake, and every driven contact supported with `abs(slip) <= peakSlip`. It introduces no dwell timer, latch or tuned threshold. `load > 1` is the existing driveline support criterion. Contact/slip/peak data are from the previous solved substep, not a fresh road query or a guarantee of zero lateral slip. Automatic upshifts, manual ownership, torque, friction, shift duration, ratios and all acceptance bands remain unchanged.

## Measured gates

- Original **29 compatibility + 7 drivetrain tests pass**. Both split-grip vehicles retain all 600 full serialized state hashes and accepted shifts exactly: LSD **9.254304028 m/s**, open **7.977903698 m/s**, satisfying the unchanged 15% advantage.
- New parameterized cut-recovery tests: **36/36** across 1/240 and 1/120 s. Five unchanged related suites: **35/35**. Isolated TypeScript, focused lint and formatting pass.
- Manual/auto-disabled/reverse parity: **16 scenarios / 86,400 steps**, exact selected chassis/engine/wheel/fuel/battery state. A second equal-sized run explicitly retains automatic selection for manual-clutch/reverse ownership and is also identical.
- Full original continuous journey: **all checks pass**, 616.158089 s race time, maximum **80.167998 m/s**, gear 8, no retirements. Player classified with seven completed laps when leaders finished eight. All original input phases, telemetry, replay and CSV checks ran.
- Raw HF86 over **120 seconds at both dt** reaches **321.648865 km/h**, ending sixth gear with five upward shifts and **zero downshifts**. Sport strict results are below.
- Complete original **57-vehicle `--strict`** run: **0 OUT**, both dt, unchanged hashes/bands; stable input fingerprint `e3d04c6ef7d5d2ba82c8936eb5644c4f5ce313a28263bed6ae1b5081e202e363` (846 files). Executed 18:22:12–18:26:37 UTC. Archive Git identity is honestly null.

## Complete calibration deltas

Baseline is the actual clean `48bfd15134c0dce394f47a0b1ca528f9593d6857` Node22/v20 [CI calibration](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41225462578), job `124609229211`, artifact `13051997713`, not the stale committed report. Relevant simulation/harness/package files have zero diff between baseline48 and archive210.

These are **all changed target-metric pairs**, rounded here; every other target pair is exactly equal:

| Vehicle / metric | Baseline 1/240 / 1/120 | Candidate 1/240 / 1/120 |
|---|---:|---:|
| HF67 0–100, s | 4.062500 / 4.058333 | 3.883333 / 3.883333 |
| HF67 top, km/h | 276.286188 / 276.297074 | 276.300798 / 276.302147 |
| SK125 lateral80G | 1.991667 / 1.991996 | 1.957131 / 1.957436 |
| HF86 top, km/h | 124.086718 / 124.116063 | 321.630450 / 321.628530 |

Additional fitted/observational changes (base and aero coefficients, or labelled aero observations):

| Fields | Baseline | Candidate |
|---|---|---|
| HF67 braking fit, base / aero | 10.8847147276511 / 0.000721617036792 | 10.8847084460465 / 0.000721617539849 |
| TC2 lateral fit, base / aero | 12.5364340861690 / 0.000721093488294 | 12.5405233935917 / 0.000712990015781 |
| SK125 lateral fit, base / aero | 18.6026619750281 / 0.000806063116433 | 18.4338871408648 / 0.000906157562279 |
| HF86 braking fit, base / aero | 15.6606201513635 / 0.006771650913969 | 16.0016349110619 / 0.005571474100824 |
| HF86 aero sample, km/h / ClA / CdA / front share | 112.321578 / 3.197412 / 1.150721 / 0.380131 | 199.423220 / 3.009383 / 1.151948 / 0.379962 |

No definition or AI-envelope value changed. Different controller trajectories are disclosed, not described as globally bit-identical.

## Remaining failures and evidence boundaries

Fresh-report catalogue contracts remain **18 pass / 2 fail**, versus baseline **17 pass / 3 fail**. Only HF86's band failure is removed. XT1's margin remains exactly **0.014480327913144159 < 0.015**; XF2's braking fan fit remains **12.175238427525649**, versus declared **12.8**, with the original 0.05 tolerance. Their entire report entries are unchanged. Strict bands and these derived contracts are separate gates; no production generated fixture, specification or assertion was rewritten to hide them.

Initial reduced-archive checks lacked the committed lockfile and unrelated TypeScript fixture imports; exact base files restored them. A naive coarse-dt test copy assumed one internal solve, while both baseline and candidate perform two. Its two clock failures are retained; the parameterized test asserts exact existing substep arithmetic without relaxing a tolerance. Earlier harmful alternatives and all negative outcomes remain in evidence.

Retained executor evidence: `/workspace/shared/experiment3-evidence/210ec1e/hf86-grip-boundary/`, including `REPORT.md`, frozen patch/source, full logs and reports, `full57-comparison.json` (every exact changed field), baseline proofs and failed fixtures. This does **not** establish mixed GP/superbike pace acceptance, a complete unit-suite pass, native graphics acceptance or physical playtest quality. Those gates remain separate and unchanged.

## Final combined-source v21 checks

The publishing owner reran all 57 strict calibrations on the actual combined v21 source with Node 22.23.4. All bands pass and every measured vehicle entry exactly matches the isolated candidate above. Before/after scoped fingerprint is `9f6158a12a61b704527380ae00126ad2bbd772b02f9ace368f54dce9ae40c783` (848 inputs); source is the honestly dirty pre-publication `ba33a02` worktree. This is not a rewritten v20 receipt.

The same current source repeated the original continuous journey: 14/14 checks, race 616.158089 s, maximum 80.167998 m/s, gear 8, all cars classified. Its simulation fingerprint is `da351beca43baf256a39465337cb2c4501e3bea7f55ffbe058d69fe36ec31e67`.

Additional configuration-only coverage ran six HF86 cars for two laps at Parco Reale, seed 29030, retaining all original catalogue-race checks. All six completed and classified; no retirement, stuck time, impact, airborne time, penalty or warning was observed. Peak 298.4 km/h; best lap 106.464 s, slowest best 111.393 s; best average 195.9 km/h; race 238.47 s. The adapted harness differs only in selecting HF86 cars and recording evidence. No baseline run was necessary after the candidate passed, and no improvement-versus-baseline race claim is made.

The identity increment preserves v18/v19/v20 scoped and legacy records while new writes use v21. Full CI, native renderer/platform checks and physical-hardware playtesting remain open; local physics acceptance is not a commercial-readiness claim.
