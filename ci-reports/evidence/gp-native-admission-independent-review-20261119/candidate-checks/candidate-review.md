# Native signed GP command admission: frozen candidate

Candidate: `f79c088bba9d407be8273d03f36721b67e7308d3`, parent `3e58984936a9e1ba2821580688a723fb93053fa4`, tree `3083b99420162eadfa4ea2d5612413f8e10af9a9`.

This is an isolated, unaccepted physics candidate. The frozen source contains two production changes, one additive native test file and one saved-state fixture. Its original race gates are pending. It does not change simulation/protocol identity, original race tests, calibration, grip, assistance gains or deadlines.

## Why this change is justified

The original mixed seed 3303 recording at source 3e reproduces the failed GP/Superbike class-best pair: 92.15861774982307 versus 89.90506409359712 seconds. The dominant measured GP2 lost-progress window cannot be explained by replacing the residual historical reserve: all 37 sampled native allocation trials there retain the same pedals. A separate exact onset recording establishes a native GP4 roll fall, followed by marshal flags and GP2's local-caution speed target.

The native replay identifies an earlier control inconsistency. The supported target and stopping-energy policy deliberately use a conservative static axle-share capacity. The final force command was clipped by that same scalar even when the native front tyre could produce a useful transient response without rear support. That final scalar clipping could reverse the usable bar slew and its physical steering gyro torque.

The correction is confined to that final admission. It retains the existing supported target, raw requested-support reserve, stopping energy, rate choice and recovery scalar. It uses the existing native inverse's signed projected-force endpoints to admit the final command. No new tyre-force model or force budget is introduced.

## Signed mapping and phase

The existing front allocation is

`Ffront = (m + K/v) * a_request - Frear - K*yaw`,

where `K = yawDamping * yawInertia / frontArm` and `v = max(speed, 3)`.

The final request interval is therefore

`[(Fminimum + Frear + K*yaw)/(m + K/v), (Fmaximum + Frear + K*yaw)/(m + K/v)]`.

`Fminimum` and `Fmaximum` are the exact endpoints already used by `frontSteerFor`: its existing 17 projected combined-slip samples and existing 97% margin. `Frear` remains the original pure one-substep preview. The inputs are the original early controller speed, current contacts and prior signed longitudinal forces. Current pedal allocation and the plant still run afterward.

This requested-acceleration interval differs from `(Ffront + Frear)/m`. That latter expression is a conditional front-force-plus-held-rear-preview range, not a solved steady two-axle equilibrium. Neither interval replaces the sustained stopping-energy calculation. The saved finite-dt native outputs, including tyre relaxation, bar limits and steering gyro torque, establish the demonstrated local authority.

The implementation adds an optional invocation-local range output to the native inverse. The normal finite path prepares and inverts once. It clears the output on every invocation, advertises no range for null/nonfinite preparation and retains no keyed cache or persistent state. The controller passes the raw numeric force to the original bounded inverse, then applies the signed admitted request to the literal original trim/anti-windup law. The returned bar remains the inverse plus that updated trim.

When the optional range is absent or invalid, a second **pure inverse query** uses the complete original legacy force. This exception preserves force-dependent prescribed overrides as well as their trim admission. It does not add an actuator, wheel, suspension or contact integration. Native no-front and standalone paths keep their original scalar fallback. Original nonfinite inverse-return semantics are preserved; this change does not introduce a sanitization policy.

## Saved-state proof

The independently reviewed diagnostic extracted the original controller source and reproduced four retained original native steps. It preserves 19 named support, energy, rate, raw-demand and reserve values. The production candidate reproduces that diagnostic's finite-dt command, plant output and selected after-state records exactly in their JSON representation. JSON normalizes signed zero; nonzero values are not rounded or tolerance-expanded in these primary comparisons.

| Precursor | Original admitted request | New admitted request | Original → new bar | Original → new roll acceleration |
| --- | ---: | ---: | --- | --- |
| Rear unloaded, tick 18204/substep 2 | 0.4925 | 9.445299727159815 | 0.004871276152773902 → 0.024871276152773902 | +0.8066281355937205 → −4.357577218034388 rad/s² |
| Reload, tick 18274/substep 2 | 13.797987017393941 | 26.078928643737513 | −0.05768115006410847 → −0.037681150064108465 | +4.4234597046944755 → −0.44475626990180317 rad/s² |

Both precursor trims and actual pedal allocations remain unchanged. Reflected native controls establish the corresponding opposite-direction behavior. The final-fall fixture remains a lowside: its admission changes the saturation branch and trim slightly under the same original law, but it is already too late for the sampled command to prevent crossing the original lean guard. No immediate final-state rescue or closed-loop race success is claimed.

## Verification before race gates

| Check | Exact result |
| --- | --- |
| New native cases | 26/26 pass |
| Negative control: immutable 3e production, same new cases and fixture | 22 fail / 4 pass |
| Focused native composition | 127/127 pass: 26 new and 101 unchanged |
| TypeScript | Pass, 32.292195554 seconds wall time |
| ESLint on two production files and new test | Pass, 2.985148781 seconds wall time |
| Original four 51-case files | Byte-identical to published ffd2259 |

All positive checks share protected-input manifest `d63fb30a0514cdc592e48f846440427a2a01bcd27f1f8263c510d9afe139bd5c`. The negative composition has its own stable manifest. The candidate bytes were restored exactly only after that negative guard completed. `candidate-source.json` pins all four committed blobs, every guard/log hash, the unchanged original acceptance sources and the standalone patch.

The new tests cover both recorded precursor states, reflected turns, signed longitudinal force/camber, exact native-range/root parity, physical query purity and next-step behavior, stale-output invalidation, no-front behavior, two-step standalone parity, and complete force-dependent legacy fallbacks. They retain the actual final-fall after-state and record controller/plant metadata before the fall's reset, matching the independently sealed recording phase.

Two initial positive harness receipts are retained. The initial fixture adapter mistakenly compared JSON-normalized zero with JavaScript negative zero, assumed a rear preview on the standalone branch, and read controller/plant state after the fall reset. These were harness phase/serialization corrections. Production code and the recorded expected finite values were not changed to satisfy them. The final original native assertions were all unchanged.

## Acceptance boundary

Run the original mixed 3303 case first after immutable independent review. The authorized subsequent targets are Ardennes 1000, snapshot round-trip, Parco 5074, Vellamar 5222 and wet Poggio 30101. Expand to the unchanged original 51-case gate only if those targets pass. Any failure remains a rejection boundary and must be recorded against this exact source. Simulation identity can change only after broader acceptance.
