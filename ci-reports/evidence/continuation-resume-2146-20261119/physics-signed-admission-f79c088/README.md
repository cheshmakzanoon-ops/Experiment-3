# Rejected GP signed-command candidate f79c088

**The candidate remains rejected.** The original mixed seed3303 test fails with a fastest valid GP class lap of **90.93835068988787s** versus **89.74459670278252s** for the Superbike. These are lap times, not finish times. The first GP-faster assertion fails; the subsequent0.15s margin assertion is not reached. The candidate and all diagnostic evidence remain separate from application integration.

The source is `f79c088bba9d407be8273d03f36721b67e7308d3`, parent `3e58984936a9e1ba2821580688a723fb93053fa4`, tree `3083b99420162eadfa4ea2d5612413f8e10af9a9`. The four-file exact patch includes two production files plus the additive native test and its complete saved-state fixture. It changes no original acceptance test, calibration, grip, gain, deadline, simulation identity or snapshot layout. No full source archive is duplicated in this packet.

## Narrow change and mechanical proof

The earlier exact3e recording showed a native GP4 roll fall followed by yellow flags and GP2 caution. The static axle-share capacity also clipped the final transient steering request even where the native front tyre and bar actuator retained usable roll authority. Same-state native replays proved that local command loss without claiming it explained all lap pace.

This candidate changes only final road-GP command admission. It uses the existing native front inverse's17 projected combined-slip samples and existing97% margin. Its optional invocation-local output exposes exactly that invocation's reserved minimum/maximum. No persistent cache or additional force model is introduced. With `K = yawDamping*yawInertia/frontArm`, existing front allocation is `(mass + K/v)*a_request - Frear - K*yaw`, so the signed request endpoints are `(Ffront_endpoint + Frear + K*yaw)/(mass + K/v)`. Current early speed/contact/prior Fx and the original pure rear preview remain authoritative.

This request interval differs from `(Ffront + Frear)/mass`; the latter is conditional on the held rear preview and is not a solved steady two-axle equilibrium. Neither interval replaces the original supported target, recovery scalar, stopping energy, rate reference or uncapped requested-support reserve. The literal trim/anti-windup law remains. On the normal finite path, the native inverse runs once. Missing/invalid optional output triggers a second pure inverse with the complete legacy force; it does not repeat any physical integration. No-front/standalone and original nonfinite-return semantics remain explicit.

The independently sealed early-phase diagnostic and candidate native tests reproduce two helpful precursor commands. At rear-unloaded tick18204/substep2, native roll acceleration changes+0.8066281356 to-4.3575772180rad/s². At reload tick18274/substep2 it changes+4.4234597047 to-0.4447562699rad/s². Both precursor trims and pedals are unchanged, and mirrored turns pass. Native steering gyro torque contributes substantially. At the final-fall saved state, saturation/trim change slightly under the original law, but the next state still falls; there is no claim that the final state can be rescued immediately.

## Executed verification

| Check | Result |
| --- | --- |
|26 new native cases |26/26 pass |
|Same26 cases on immutable3e production |22 fail /4 pass |
|Focused native set |127/127 pass:26 new and101 unchanged |
|TypeScript |Pass |
|Scoped ESLint |Pass |
|Original mixed3303 |Pace fails;1 executed,13 skipped;21.947s test /25.275s guard |
|Original Ardennes1000 |Pass;1 executed,8 skipped;13.554s test /17.144s guard |
|Original snapshot |Pass;1 executed,13 skipped;2.463s test /8.021s guard |
|Bounded mixed observation |Exact original fastest-valid lap pair reproduced;30.183s guard |

All original finish, incident-bound, classification and no-stuck assertions preceding the mixed pace assertion pass. The original four51-case files are byte-identical to publishedffd2259. No Parco5074, Vellamar5222, wet Poggio30101, full51 or full unit-suite result is claimed for f79 after the known pace rejection. Those remain future gates for an independently justified later candidate.

The source at freeze, negative-control restoration and each guard/log/manifest are included. The negative overlay changed only the two production files to immutable3e; identical additive tests/fixture remained. Exact candidate bytes were restored after the negative guard completed. Initial new-test harness failures are retained separately: signed-zero JSON comparison and capturing controller/plant metadata before the fall reset were corrected, without changing expected finite values or original assertions.

## What the final recording establishes

The observation-only run uses the original scenario, seed, timesteps and400s simulation bound. It reuses the sealed mixed recorder; changes add only receipt pinning, native-fall observations, marshal transitions and a dense GP2 second-lap timeline. Its final fastest-valid class laps must equal the original failed test exactly.

There are **zero native fall calls for all six riders, zero crashes and no local-yellow events** in this bounded run. The retained marshal state contains green and chequered flags only. All1047 dense GP2 rows in second-lap1750–2300m have zero flags. The old GP4 fall→yellow→GP2 caution chain is absent. This establishes a different stability boundary on this exact source, while the original pace requirement still fails.

The winning GP is rider2, valid lap2. The winning Superbike is rider1, valid lap2:

|Native lap sector |GP2 |Superbike1 |
| --- | ---: | ---: |
|1 |29.625119825163182s |30.12235439548779s |
|2 |26.32418069871119s |25.644898038276494s |
|3 |34.9890501660135s |33.97734426901823s |

GP2's second-lap1850–2150m residence is4.6166666667s, versus7.2833333333s on3e and4.7666666667s on7ac. It recovers2.6666666667s in the formerly cautioned window and is0.15s faster than7ac there. Its complete valid lap improves93.5322206386→90.9383506899s relative to3e. Residual pace loss is therefore elsewhere in the changed field trajectory.

The baseline7ac GP2 fastest valid lap is88.3459814187s. Relative to that trajectory, f79 spends an extra0.45s at1500–1650m,0.508333s at2750–3000m, and0.441667s at3500–3750m. Baseline7ac has zero traffic-limited samples in those three windows; f79 has223,398 and311, alongside native-plan limits. The field separation, traffic constraints and selected route/control trajectory differ. These observations do not establish a uniform tyre, reserve or command slowdown, and do not authorize a new policy change. The7ac GP2 terminal sector record is not retained and is not inferred.

## Precise observation scope

The recorder runtime-checks37,300 pure current-history queries; only15 distinct selected fixture before/after hash pairs are retained. Its1,593 original allocation replays reproduce the actual f79-selected bar, trim, target, demand, post-bar boundary and native plant input. The1,053 additional retained hash pairs cover enumerable Bike and GP fields for all cars; they are not a hash of every Simulation, AI or marshal object.

Fall/flag observation runs before the inherited non-RACING continue and includes the terminal step. The lap/bin sampler skips that terminal phase, leaving11 retained lap events although final classification confirms all six riders completed two laps. The last car classifies after the terminal marshal update; no later race step runs. Five chequered events are retained. No sixth chequered row or twelfth lap event is invented, and no terminal observation is claimed to have been omitted from the fall/flag observer.

All recorded raw bytes are retained losslessly as gzip. `f79-mixed-summary.json` pins the full old3e/7ac recordings; `f79-comparison-records.json.gz` retains the selected original rows needed to recompute the comparison. The full older recordings are already in the separately sealed3e packet, not duplicated here. The new raw f79 file is7,028,498bytes before compression and has SHA256`ff64cb5dde5817aaf1078acede8c5188a5c9b629ae3c33423aa5a223bdd1b59c`.

## Reproduction and integrity

`package-index.json` pins every packaged stream, original raw digest and guard-manifest mapping. Manifests are stored once per SHA and compressed losslessly. The final native/type/lint/race/recording inputs share manifest`d63fb30a0514cdc592e48f846440427a2a01bcd27f1f8263c510d9afe139bd5c`; negative and development compositions have their own protected manifests.

Reconstruct an isolated exact3e source using its already retained Git commit/patch, then apply `source/f79c088-signed-admission.patch`. This is a reproduction instruction, not permission to integrate the rejected source. Decompress raw inputs to new paths. Each guard JSON records the precise original command and arguments; the recorder accepts SOURCE OUTPUT OBSERVER_SOURCE VARIANT ORIGINAL_MIXED_GUARD. Use the pinned375 observer implementation and the included original mixed receipt/log. Record new outputs separately, keeping the frozen bytes intact. The additive fixture and test are fully contained in the exact patch.

The independent reviewer sealed the four-file candidate and the recording's source, original-lap reference, script, guard and observation scopes. No further race or tuning work was run after this boundary.
