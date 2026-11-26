# Agent 17 — upstream contact reconciliation review

Date: 2026-11-25. Wave 3, agent 5. Read-only review of the local agent 07/10/13 changes against `origin/main` at `39d9d497880e92801a7d77de6af2639b4186bfcc`. Reviewed reports 01, 07, 10 and 13, both contact helpers, both vehicle implementations, and the relevant local/upstream tests. Only this report was written. No production/test/model/character/environment edits, git mutations, installs, lifecycle commands, type checks, builds or test runs were performed.

## Reconciliation decision

Root's chosen reconciliation is appropriate:

1. Keep upstream's swept first-contact detection, partial contact interval, exact unsupported gravity/air drag and supported integration subdivisions.
2. Reapply agent 07's player-MX horizontal-momentum-preserving touchdown conversion. Upstream still uses the defective velocity projection.
3. Keep upstream's incoming `compressionFront/Rear` channels and final-pose `fork/shock` presentation as distinct documented quantities. The local agent 13 tests that require these channels to equal each other need reconciliation with that explicit contract.
4. Keep upstream's broader `motocrossCourse` coupled-stop gate, rather than silently narrowing it to local `playerMotocross` gating.
5. Retain a single positional public coupled-stop API. Agent 20 may transplant the local numerically stable implementation behind that API, preserve upstream defaults, and add reusable output without introducing a second same-name solver.

These recommendations concern dynamics and publication only. They require no authored-model, character, terrain or environment change.

## Landing momentum: retain the independent local fix

Upstream `vertical()` still assigns `flightSpeed * cos(slopeAt) + vy * sin(slopeAt)` on touchdown while retaining the sprung vertical velocity. Its new contact-time refinement does not remove this finite coordinate-transition error. Report 01 establishes the downslope energy injection; report 07 establishes its correction and independent regression coverage.

For player MX, preserve the **post-impulse** horizontal speed with `flightSpeed / cos(roadPitch)`. Continue using the existing non-player expression. Do not substitute the earlier `incomingForward` snapshot: that would erase a genuine hard-stop impulse. Preserve upstream boundary-based axle selection and incoming landing classification when inserting the conversion.

Upstream `firstFlightContact()` already preserves horizontal speed when it resamples the final terrain patch and changes the slope-relative storage basis. This is compatible with agent 07's correction. Its subsequent yaw-basis rotation and forward clamps remain a separate bounded-coordinate issue below.

## Endpoint publication: preserve the final resample

The implementations differ intentionally in channel semantics:

| Channel | Local agent 13 | Upstream |
| --- | --- | --- |
| `compressionFront/Rear` | Recomputed from final `cgY/pitch` inside `vertical()` | Incoming clamped compression used by the force step |
| `fork/shock` | Directly assigned from those compression channels | Recomputed from final pose and latest contact samples in `updateSuspensionAndTyres()` |
| Force channels | Incoming forces actually used by the original step | Incoming force observations retained while supported substeps may refresh internal forces |

Upstream's `firstFlightContact()` calls `vertical(remaining)`, advances horizontal position, applies the remaining yaw, then calls `sampleSuspensionContacts()` again. Therefore replacing its final travel calculation with `fork = compressionFront` would publish stale geometry even if compression were recomputed at the end of `vertical()`.

Keep the upstream final-pose presentation block. Check fork/shock, tyre compression and snapshot values against the final sampled pose. Do not restore the 20 ms filter or retune spring forces to satisfy the prior `<1 mm` travel premise documented in report 13. An actual final endpoint and an incoming numerical force state are different observables.

Tests that derive the whole compliant velocity increment from incoming `FF/FR * dt` also need care: upstream can use multiple supported stages. The pure projected-impact path remains a separate invariant; do not label all later spring work as impulse energy.

## One solver API and preserved compatibility

The overlapping exports are incompatible as written:

| Contract | Local | Upstream |
| --- | --- | --- |
| Signature | `(velocity, inertia, front|null, rear|null, out?)` | `(velocity, mass, pitchInertia, front?, rear?, yawInertia=Infinity)` |
| Optional components | All five velocity/row components required | Lateral, yaw, cross-grade and yaw arm default to zero |
| Inertia types | Exports `HardStopInertia` and `HardStopImpulses` | Positional masses; result inferred |
| Output reuse | Supported | New result allocated |
| Nearly redundant solve | Jacobian-difference active-set residuals; weighted-normal total projection | Squared-minor determinant; sum/difference solve; tolerance on single-contact residuals |

Both implementations address the same two-contact unilateral problem. The local kernel has an explicit passive total-projection construction and broader recorded sweeps, but this review did not execute a comparative numerical benchmark and does not assert an upstream numerical failure.

When adapting the local kernel behind the upstream API, retain upstream's zero defaults and accepted `yawInertia = Infinity` (`inverseYaw = 0`). Copying the local finite-yaw-inertia guard unchanged would reject valid existing upstream calls. Normalize optional values before difference calculations. If output reuse is added, overwrite both result fields on every return, including absent/separating contacts. Preserve upstream and local invariant coverage after adapting call syntax; the test filename `motocross-coupled-stops.test.ts` also collides.

## Remaining evidenced constraint: nonnegative forward speed

Both adapters clamp the horizontal result after normal impulses. The normal helper can be passive and complementary while the published adapter state penetrates again. Report 13 supplies the direct production reproduction; elementary two-contact momentum balance gives the same values:

| Input: horizontal 0.1 m/s, vertical −10 m/s, balanced two-stop pitch | Unclamped horizontal | Vertical after impulse | Horizontal after clamp | Closing after clamp |
| --- | ---: | ---: | ---: | ---: |
| Grade −0.5 | 4.08 | −2.04 | 4.08 | Approximately zero |
| Grade +0.5 | −3.92 | −1.96 | 0 | 1.96 m/s at both stops |

For the uphill case, a consistent active forward bound produces horizontal and vertical speed zero, total normal impulse divided by mass of 10 m/s, and forward-bound reaction divided by mass of 4.9 m/s. The current post-hoc clamp removes energy but violates contact feasibility; testing energy alone misses it. The local signed `vh` also remains available to damper-rate calculations after the stored speed is clamped, creating two different horizontal velocities inside the same step.

### Acceptance for a later combined-bound fix

- Include the nonnegative forward-speed bound in the same unilateral projection as the bottomed contact rows. In the current travel basis its row is `[1, 0, 0, 0, 0]`, alongside each contact row `[-grade, -crossGrade, 1, lever, -yawArm]`.
- A rare fixed-horizontal-zero branch is valid if it resolves the remaining contact active set, checks a nonnegative bound reaction, and applies the final combined momentum once. For a travel-aligned bound, the reaction is `sum(grade_i * impulse_i) - mass * incomingHorizontal`.
- Verify nonnegative impulses/reaction, nonclosing active stops, complementarity and passive impact energy **after adapter publication**, plus nonbinding equivalence to the current helper.
- Include single/both stops, an initially separating stop activated by coupling, uphill/downhill controls, bank and yaw, near-redundant rows, and isolated `vertical(0)` impact diagnostics before finite-step support work.
- Cover a yawed touchdown whose final tyre-frame forward component becomes negative. `landingTyreVelocity()` is followed by another clamp, and upstream applies a further yaw rotation during the partial interval. A constraint solved only in the old travel frame does not by itself protect the final stored frame.

## Road angle and compliant work remain separate

Both versions still compute `roadPitch = asin(clamp((front.y - rear.y) / L, -0.6, 0.6))`, although the sampled contact span is horizontal. The chord angle is `atan2(front.y - rear.y, L)`. At grade 0.6 the present angle is 0.643501 rad versus the geometric 0.540420 rad; horizontal conversion is 0.8 versus 0.857493, and the gravity factor is 0.6 versus 0.514496. Decide separately whether an angle/grade safety limit remains, and check both travel directions and slope-relative speed conversion. Do not change `settlePose()`'s inverse-sine equation, which solves different rotated free-wheel geometry.

The compliant pitch arm versus compression-Jacobian discrepancy from report 01 is also retained. Upstream explicitly acknowledges it in the supported-substep frequency estimate. A torque-only change is not part of this merge; it needs a deliberate reduced-model decision and a work/energy check.

## Release

Findings and the bounded-speed acceptance example were sent to root. Root confirmed the upstream API, scope, incoming compression and final-pose presentation decisions. This review is complete and ownership of this report is released; no further exploratory work is pending.
