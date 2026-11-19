# Vellamar 5222: independent onset and native replay

## Scope and source

These are recording-only diagnostics on rejected candidate `7ac509f9198ae5d5b06c9a17edd2177caa799115` in `/workspace/scratch/dac6891506fb/gp-runway`. They stop after the first original-race fall and do not represent a completed race gate. The original 76-case gate ended with 73 passes and three failures; none of its assertions or production inputs were changed for this analysis.

The v1 observer completed in 26.001663 seconds; the v2 observer with force-phase and incoming-state capture completed in 31.538908 seconds. Both guarded receipts report exit 0, all 7,460 protected inputs stable, no changed paths, and source manifest SHA-256 `b1ad6c361fadd12102f4e210b223a12eb65bc507a098e1415e5a0c87be90e2ce`. Their onset logs are byte-identical, SHA-256 `f49e94dba122f3ca0ca177f2199c32c1af697ecbdaf76d174c43f436d33ccac2`. Diagnostic execution success does not override the failed gate.

## First native fall

GP rider 4 falls at race time **156.45833333335537 s**, station **1901.1102254282177 m**, lateral position **-7.358529513420477 m**, while completing its second lap (`lap: 1`, `finishTime: 0`). This is a pre-finish incident. The captured stack points to the absolute lean-limit guard in `src/simulation/bike.ts:1155`; impact is zero and the native contact-crash flag is false.

At the transition, lean is **1.2547438277001017 rad**, lean rate **+2.0402928683595305 rad/s**, and speed **43.77134620012266 m/s**. The before/after native crash counter confirms a real transition from riding to lowside. The fall's retained controller proof belongs to that same tick and substep.

The current GP path intent is **-6.394669968335803 m/s²**. Current-contact normalization and inverse decoding agree exactly at the fall. Across the final four seconds, all 920 observed commands agree with the existing clamped normalization to at most **1.1102230246251565e-16** in normalized intent. There are 31 expected lean clamps and no speed-reset observation. Raw-versus-decoded acceleration differences at those clamps are saturation, not a mapping error.

## Exact replay of retained native state

The v2 recording preserves the complete incoming Bike and MotoGP state for selected substeps, including typed arrays and non-finite values. `replay-vellamar-native-state.mjs` restores them into the original native classes and invokes the original `Bike.step` once. It verifies source hashes before import. It makes no controller substitution and does not rerun a race.

All **five selected states** reproduce **75 values each exactly**, including the post-step body state, native front inverse and rear preview arguments/results, actual plant inputs, actual plant output before fall reset, and native current-preparation probe. Signed zero is treated as numerically equal because JSON does not preserve its sign. The selected states are the largest stored/current force difference, largest forecast difference, largest front-force phase difference, largest rear-force phase difference, and first fall. Detailed comparisons are in `vellamar5222-native-replay.json`.

At the first fall, the actual plant acceleration before the fall reset is **-3.1347527211869424 m/s²**. The end-of-step stored acceleration is zero because the native fall handler resets MotoGP state; it must not be mistaken for the contact result.

## Current reaction and stored force use different phases

The native observer clones the incoming MotoGP state and calls the unchanged plant with current contact preparation and a positive subnormal timestep. Its representable relaxation increment is zero. This still performs native stiffness scaling, friction/combined-slip clamping, and front-force projection; the difference is not solely a change in normal load.

The strongest example is at **156.19166666668895 s / 1889.111482640954 m**:

| Quantity | Value |
| --- | ---: |
| Current vertical contact reaction | 7.432178395244758 m/s² |
| Stored previous contact acceleration | 30.528689661867766 m/s² |
| Same incoming strain under current preparation | 8.95359443171762 m/s² |
| Actual next native plant acceleration | 9.058821358219346 m/s² |
| Forecast roll acceleration using stored force | -15.08159845097584 rad/s² |
| Forecast roll acceleration using current preparation | +1.1019145102496795 rad/s² |
| Forecast roll rate using stored force | +0.028020523457679358 rad/s |
| Forecast roll rate using current preparation | +0.9990313011312104 rad/s |

The same raw/decoded path intent is -4.776394716306777 m/s². Both the controller's signed longitudinal forces and the actual plant's signed longitudinal forces are zero at this state. Thus this local mismatch is present without a brake/drive phase difference. Front stiffness falls from 119105.56957413035 to 22270.478987048267, and rear stiffness from 55669.62016763638 to 23575.06666286719. Current-preparation acceleration is close to the actual next contact acceleration, which additionally includes finite relaxation, changed bar steering, and changed speed.

The largest ahead-angle difference is **0.03219932535725489 rad** at 155.92500000002252 s. At the fall itself, stored/current acceleration differs by **1.358169845500104 m/s²**, but forecast ahead angle differs by only **0.0008746362658178 rad**. The final four seconds contain substantial unloading and transient force differences; their magnitude alone does not prove why this trajectory later crosses the lean guard.

## Force-phase evidence and preceding trajectory

The front inverse receives the previous applied front longitudinal force. Its argument differs from the actual later contact force in **40 of 920** observed calls. The largest difference is **390.10388462056204 N** at 153.28333333335826 s: inverse front force -167.37342384720745 N versus actual -557.4773084677695 N. This occurs about 3.18 seconds before the fall. No front or rear braking appears in the final one-second incoming-state window.

The largest rear preview/plant longitudinal-force difference is **1536.8048327971671 N** at 155.54166666668954 s: the preview uses that previous drive force while the actual next contact receives zero after traction control. This state also has a major support increase; an unisolated force replacement would conflate both changes.

The final one-second incoming-state window contains 241 riding rows: 39 report airborne, 74 have an unloaded front, 101 an unloaded rear, 30 have positive applied drive, and zero have applied braking. These categories overlap. Earlier in the bounded history the vehicle commits a pass to the negative lateral side; by about 155.97 seconds it reaches roughly -8.62 m lateral position while its requested offset remains about -5.28 m. The first fall occurs after the planner has returned to `RACING LINE` / `settle`, with no active pass target. These are observations, not proof that the planner caused the fall.

## Saved-trajectory forecast at the existing horizon

The follow-up comparison uses the existing **0.06-second** forecast horizon and the exact recorded 1/240-second substep sequence. From origin index i before native roll integration, it interpolates between native **after-states i+13 and i+14**, at weight 0.4. These are the 14th and 15th future substeps, not an extra step later. Actual combined lean is body lean plus native `gpHangOffAngle`; native `leanRate` supplies the combined-CG roll-rate state. Adjacent recorded after/before lean, rate and rider offset match exactly, and the sequence has no gaps.

Of 920 observed origins, 907 have complete future horizons. Of those, 84 cross airborne/zero-support intervals and two cross the fall transition. The controller's existing captured rider phase is preserved in both forecasts.

| Population | Origins | Stored/current pose RMSE (rad) | Stored/current rate RMSE (rad/s) |
| --- | ---: | ---: | ---: |
| All complete horizons | 907 | 0.00817168 / 0.00556805 | 0.27485626 / 0.18948284 |
| Continuously supported, no fall | 821 | 0.00641008 / 0.00381872 | 0.21128018 / 0.12312881 |
| Airborne or zero-support crossing, no fall | 84 | 0.01781814 / 0.01379567 | 0.61140093 / 0.48519799 |
| Supported origins with both prior Fx zero | 110 | 0.01304587 / 0.00720300 | 0.44688536 / 0.25261022 |

On the 821 continuously supported origins, current preparation reduces pose RMSE by **40.43%** and rate RMSE by **41.72%**. The maximum supported pose error does not improve (0.03451603 versus 0.03501640 rad), and bias increases; this is a useful average prediction improvement, not uniform accuracy. All 907 complete origins have feasible prior signed Fx inside the current native `prepareSlip` circles, so the prior b3be9ab helper's extra early force clipping is nonbinding in this retained window. No recorded observation triggers a speed reset.

Exact per-origin errors, endpoint indices, force bounds and crossing flags are in `vellamar5222-forecast-horizon-rows.json.gz`; complete metrics and method are in `vellamar5222-forecast-horizon.json`. This comparison follows the saved trajectory; it does not establish that replacing the forecast in a feedback controller prevents the fall or passes the race.

## Reproduction and limitations

Run the analysis parser on either recording:

```sh
python3 analyze-vellamar-onset.py vellamar5222-force-phase-data.json vellamar5222-force-phase-analysis.json
```

Replay the five retained native states using the same frozen source:

```sh
node --no-warnings --experimental-transform-types replay-vellamar-native-state.mjs /workspace/scratch/dac6891506fb/gp-runway vellamar5222-force-phase-data.json vellamar5222-native-replay.json
```

The current-preparation probe is a native re-evaluation of saved strain, not a prediction of all later effects or a replacement trajectory. Its exact replay verifies capture fidelity and exposes the contact-phase mismatch locally. A causal fix still needs a minimal, separately isolated change and the unchanged original acceptance gates; this report makes no acceptance claim.
