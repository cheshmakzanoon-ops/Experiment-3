# Assignment 56 — claims and test-oracle review

Wave 10; 26 November 2026. Bounded independent review of assignments
38, 39, 41, 43, 45, 48 and 51, the root airborne fuel-mass correction,
and the consolidated README, integration register, architecture and receipts.

## Disposition

**No concrete production release blocker was identified in this review.**
The inspected migrations measure actual physical phases, retain meaningful
independent geometric, momentum, energy or outcome checks, and preserve the
important adverse trajectories. They do not establish empirical motorcycle
fidelity, universal cadence independence, rendered quality or hosted CI success.

The reviewed runtime fingerprint is
`4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790`.
It was recomputed from the documented 1,129 inputs. No runtime or test was
changed and no test suite was rerun by this assignment. Recorded pass counts
below belong to the named existing receipts, not new execution by this reviewer.
The compact [review evidence](../evidence/56-claims-oracle-review.json) records
source and relevant receipt/test identities independently.

## Oracle and scenario findings

| Work | Finding and retained independent check |
| --- | --- |
| [38: landing outcomes](38-landing-oracles.md) | The test-side classifier re-expresses the unchanged landing policy against measured records, without calling the production verdict function. It asserts the exact eight adverse machine/venue/scenario identities and preserves the ordinary zero-crash scenarios and 0.15 m/s normal / 0.1 m/s shaft refinement bounds. This independently checks policy application; it does not independently establish that the chosen physical thresholds are correct in real motorcycles. |
| [39: first contact and observability](39-contact-oracles.md) | Event observers distinguish pre-projection state, completed first contact and later support. Geometry, normal speed and shaft velocities are independently reconstructed at the actual event. The former `signedForward < -0.1` fixture-strength gate was intentionally replaced; the real guard now requires negative forward speed, more than 1e-5 m/s closure for the old bare-clamp counterfactual, no more than 2e-9 m/s corrected closure and no more than 1e-8 J energy increase. Thus this is a disclosed fixture-strength change, not a claim that every historical assertion is identical. |
| [41: elapsed contact time](41-contact-time-contract.md) | Complete and supported durations are separately summed, free motion is analytically reconstructed with each interval's mass, and incoming event height/velocity remain tightly checked. Every later rotor impulse and public force-component integral is accounted for. The two added long-window cases must actually contain multiple complete and supported intervals; the original 13 cases remain. |
| [43: takeoff and touchdown](43-transition-oracles.md) | Momentum is checked at the conversion boundary, then independent drag/gravity and rotor laws describe the remaining elapsed intervals. The 24 native takeoffs and 108 analytic landing combinations remain. Original 10–12 decimal momentum/rotor assertions, geometric discrepancy guards and event-count assertions remain. Body pose velocity is checked separately from physical sprung heave. |
| [45: wheel pickup](45-wheel-pickup-contract.md) | The unchanged 0.01 m/s rolling band is observed at the tyre-force endpoint before terrain-frame resampling. The original pickup window remains strictly between 3/240 s and 0.2 s. Angular impulse, coordinate transport, slip work and kinetic-energy checks retain separate meanings. The finite midpoint work residual is disclosed, not called exact global conservation. |
| [48: animation fixtures](48-animation-contract.md) | The safe flight controller changes ordinary airborne inputs while preserving the approach, course, setup and original animation assertions. The formerly failing held-input MX450 Valley trajectory remains a dedicated six-cadence adverse regression: one `crash-flat` at every continuation cadence, with the original bottom-out limit. All 52 earlier tests remain plus this one new test. |
| [51: hard stops](51-contact-contracts.md) | The first physical interval must contain one stop solve; every actual interval allows at most one. Every later impulse is certified using its own mass, finite-difference geometry and pre/post velocities. The 2e-9 m/s non-penetration allowance, 1e-8 J passivity allowance, momentum and complementarity precision remain. Multiple physical impacts within a public call are not collapsed into one historical snapshot. |
| [51: deep median](51-contact-contracts.md) | The original 240 Hz approach and safety envelopes remain. Raw must produce exactly one independently observed rear-support loop-out; Sport must survive with actual throttle cut and rear-brake aid. The observer checks loaded rear support, unloaded front, positive pitch rate and CG projection behind rear support. Both original released-input replay and added held-input replay must reproduce exactly. |
| [Root: airborne mass](../reconciliation.md) | Each interval uses the actual `dynamics.mass` set before its fuel consumption. The analytic drag oracle composes those intervals without freezing fuel or calling the production drag helper for its expected result. Original speed/position/heading/lateral and ballistic precision remain; added tests require subdivision and a detectable failure of the former final-mass shortcut. |

The held-input animation regression starts every continuation from the **same
120 Hz airborne checkpoint**. It establishes the reported six continuation
outcomes, not cadence independence of six separately simulated approaches.
Its front brake is already zero; the record must not be described as a
held-front-brake crash. The finest reported bottom speed is about 7.063701 m/s
against the unchanged 7 m/s threshold. The safe pose driver and this adverse
physical trajectory answer separate questions and both remain tested.

The median result likewise has an explicit boundary: the whole native 120 Hz
approach differs from the 240/480/960 Hz approaches. The current Raw loop-out
and Sport survival at 240 Hz do not establish cadence-independent crash verdicts.
The reviewed report preserves the historical higher takeoff speed, current
lower speed, wheelie-aid counterfactual and unchanged crash-policy distinction.

## Observer transparency and count semantics

The inspected diagnostic wrappers call the original methods, copy mutable
impulse outputs when necessary, and restore methods in cleanup paths. Paired
observed/unobserved trajectories verify selected physical and latent state at
the same public updates. They are not complete serialized-world or GPU proofs.

| Existing evidence | Correct meaning |
| --- | --- |
| Assignment 45: 1,008 | Paired public states across six cadence/vehicle runs; not 1,008 separate test cases. |
| Assignment 51: 2,592 | 2,400 median states (two assists × 1,200 updates), plus 192 hard-stop states (two motorcycles × two contact modes × 48 updates), from four parameterized tests. Each state contains selected unrounded physical fields. |
| Root air-drag: 200 × 19 | Two motorcycles × 100 paired public states, each comparing 19 unrounded quantities. These are two added observer tests inside the 22-test file. |
| Assignment 52: 2,880 × 26 | Four CPU-audit trajectories × 720 public states, each comparing 26 quantities; distinct from 14,400 timed step calls and from its 181 unit tests. |

The consolidated documents correctly mark focused test results as overlapping
the broad MX/offroad sweep. The historical 1,723-case failure map cannot be
turned into a final distinct total by adding the 66, 53, 29 or 22 focused cases.
The seven-file 181-case shared-core set is expressly outside that sweep.

## Source attribution and limits

The current relevant test hashes agree with the retained 45, 48, 51 and root
receipts. Assignment 45's aggregate source is historical `a153c34d…`; its
adapter and ground source remain identical, while the later 49 repair changes
an AI traffic branch. Assignment 48 distinguishes its initial diagnosis from
the final `4c041cb3…` targeted run. Earlier 39/41/43 reports identify their
own intermediate source hashes and exploratory failures rather than presenting
them as final acceptance.

The master integration register treats historical pending statements as
checkpoint records and documents subsequent resolutions. The current full
unit sweep, unchanged default eleven-scenario offroad matrix, final agent
ledger and published-source hosted checks were still pending at this review;
their completed receipts must supply the final report values. The eight
full-grid races and one Valley event alone do not cover that default matrix.
The original baseline hosted CI failures are not evidence that the new source
has passed or failed hosted CI.

Current documentation preserves the meaningful limitations: sparse-impact
pose errors can reach tens of millimetres despite small means; C1 neutral
curvature remains; reduced spring/rotor work bounds are not global conservation;
the corridor and race-stop margins are narrow; authored draw geometry is not
the same as the reduced suspension force model. CPU timing is explicitly from
the shared executor, not a device FPS or GPU guarantee. Chromium failed before
page creation; no gameplay, framebuffer or GPU acceptance is claimed.

## Narrow documentation corrections

After notifying root and receiving approval, this assignment clarified two
architecture table rows directly against the runtime and transition tests:

1. `body.velocity.y` is the authoritative-pose secant of the **last physical
   interval**. Public machine fork/shock/steer rates instead use the public
   endpoint difference over the public duration.
2. Public mean tyre forces recover the time integrals of their local
   components. Reconstructing world impulse requires each interval's own
   wheel frame when heading changes; transforming the mean only by the final
   heading is insufficient.

Only that documentation, this report and its compact evidence were written.
No assets, models, characters, authored environments, runtime, tests, Git refs
or publication were modified. Ownership is released to root at handoff.
