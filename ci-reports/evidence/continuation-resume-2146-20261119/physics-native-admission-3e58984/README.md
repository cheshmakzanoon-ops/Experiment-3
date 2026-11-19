# Frozen 3e diagnostic evidence: mixed pace, GP4 fall and native steering admission

This package preserves the last rejected-source diagnostic boundary. Source **3e58984936a9e1ba2821580688a723fb93053fa4** is observer-only on the contact/throttle source7ac. It passes the directly executed Ardennes1000 and snapshot cases, but fails original mixed3303 pace. No signed-admission production edit or closed-loop success is asserted here. The subsequently authorized implementation belongs to a different worktree and needs its own receipts.

## What the original mixed pair proves

| Source | GP best | Superbike best | SBK minus GP |
| --- | ---: | ---: | ---: |
| 7ac509f | 88.34598141873684 s | 89.66195334860015 s | +1.3159719298633092 s |
| 3e58984 | 92.15861774982307 s | 89.90506409359712 s | -2.2535536562259466 s |

The candidate exactly reproduces its original failed lap pair. GP2 loses2.5166666667s in its second-lap1850–2150m window. All37 retained candidate allocation trials there leave pedals unchanged when only the residual historical force term is replaced on a clone. That is a window-specific negative result; the baseline has10 changed allocations among15 trials there, and other candidate locations show changes in both directions. It does not justify changing the reserve policy.

The original pair uses all original options, timesteps, seed3303 and limits. The7ac run checks38164 pure observations and1552 exact original allocation replays; the3e run checks38937 and1656. Those total observation counts exceed retained selected fixture/hash-pair counts. Full recorded outputs, including every retained bin, trial and selected state, are compressed losslessly under `raw/`. The exact recorder and summarizer are included.

## Actual incident and caution chain

The separately guarded3e recording stops at GP4's first fall plus two minimal outer updates. At tick18366/substep1, simulation time153.05000000002514s, second-lap station1931.934944540114m, the core crosses its absolute-lean guard: lean1.2507595372371019rad, rate+1.391863119844436rad/s, impact0 and contactCrashfalse. The native fall wrapper runs exactly once. The recorded stack identifies Bike.ts1187. This is a native roll fall, not a demonstrated collision-triggered event.

At the same outer-step end, marshal bookkeeping emits CONTACT and RIDER_DOWN_LOWSIDE for car4 and local-yellow events/flags for cars2/5. CONTACT occurs after the native fall; it must not be used as evidence of an earlier collision. At the next outer update, GP2's target changes46.720225005268254→25m/s and the decision becomes LOCAL CAUTION / NO OVERTAKING. This closes the incident/caution link that the earlier pair report correctly left unresolved.

The full onset output contains960 retained rows, their1920 live-before/live-after query hash pairs, all selected full native fixtures, fall/event records and reference matches. The recorder checks5628 observations in total; all were asserted live-state preserving, but only the retained1920 pairs are inspectable in the ring. The raw output is preserved byte-for-byte by gzip. The original full mixed reference fixture at18024/substep2 matches its native plant input exactly.

## Native physical authority, then the exact early controller

The first authority replay fixes actual allocated Fx/post-longitudinal speed and original trim. It demonstrates attainable commands through the original native97% inverse, maximum bar, one-substep slew limit, tyre relaxation and physical roll integration. It does not treat a steady curve endpoint as immediately delivered force. Its JSON name `steadyDeliveredInterval` means the conditional affine front-force-plus-held-rear-preview range; it is not a solved steady two-axle equilibrium. The sampled actual delivered values are the physical evidence.

The later early-admission v3 replay source-extracts the exact3e controller and first reproduces four original full native rows. Its only diagnostic substitution is the final lateral admission. It keeps19 named support, stopping-energy, rate, raw-demand and reserve values equal. It also retains the literal original trim/anti-windup law. Native bounds use the early pre-pedal speed, prior signed Fx, current contacts and original rear preview.

With K=yawDamping*Iy/frontArm and v=max(speed,3), the requested acceleration interval is `(Ffront+Frear+K*yaw)/(mass+K/v)`. The native front endpoints come from its existing17 projected combined-slip samples and97% margin. This request interval differs from the conditional delivered-force interval. The original stopping/recovery scalar is not replaced with either interval.

| Saved state | Original admitted request | Diagnostic request | Actual original→diagnostic bar | Native roll acceleration |
| --- | ---: | ---: | --- | --- |
| Rear unloaded18204/2 |0.4925 |9.445299727159815 |0.004871276152773902→0.024871276152773902 |+0.8066281355937205→-4.357577218034388rad/s² |
| Reload18274/2 |13.797987017393941 |26.078928643737513 |-0.05768115006410847→-0.037681150064108465 |+4.4234597046944755→-0.44475626990180317rad/s² |

Both precursor trims and actual pedal allocations remain unchanged. Much of the improvement is native steering gyro torque, so this is usable roll authority, not exclusively lateral tyre force. At the final fall, the original law's saturation branch and trim do change slightly under the admitted value, but the next state is still a lowside. No immediate final-state rescue or race success is claimed.

The no-front fixture and two synthetic standalone boundary controls retain exact two-step behavior. Additional curve/preview queries leave two-step commands, plant inputs/outputs and every nonscratch physical state unchanged. The native reusable force output and preparation caches/stamps are scratch; they are explicitly excluded from that equality, not from actual command/output checks. The second step repeats the saved input/contact values and is not a live AI/suspension continuation.

## Integrity and replay

`evidence-index.json` identifies every packaged byte stream, raw and compressed SHA256, original source path and guard-manifest mapping. Five successful guards protect the same immutable inputs; the7ac source archive has its own smaller manifest. Canonical manifests are stored once per SHA, losslessly gzipped. No duplicate932-file source archives are included; source commits and the already retained exact patch reconstruct them.

Decompress raw inputs with Python `gzip.decompress` or `gzip -dc` into a new evidence directory. Invoke each `.mjs` with Node's `--experimental-transform-types`, the exact source worktree, and the same argument order recorded in its guard JSON. Do not overwrite the frozen outputs. The native and early replay scripts take SOURCE INPUT_JSON OUTPUT_JSON; the recording scripts additionally take their pinned observer/reference inputs as shown in their guards. Existing signed source hashes, script hashes, input hashes and successful guard exit/stability must all agree before treating a replay as equivalent.

The two initial early-proof harness failures are preserved separately. Version1 mistakenly included the native reusable force-result scratch in the physical equality; version2 included scratch cache stamps in whole-state next-step equality. Version3 names those scratch fields explicitly and proves unchanged physical evolution and commands. Those failed checks are diagnostic harness development, not source instability or discarded race failures.
