# Assignment 44 — motion review and bounded near-limit gear continuation

## Result and ownership

Independent review found a new, reproducible defect in the interrupted gear controller: shortening a complete Bézier handoff to preserve an outward tangent near a travel limit could compress a large subsequent movement into a tiny interval. The curve could be mathematically C1 while its rate became arbitrarily large. Float32 seed rounding then changed that tiny interval enough to make recorded reconstruction disagree with the controller.

The coordinator granted this assignment ownership of `src/simulation/offroad/mx-gear-stroke.ts` and the new `tests/motocross-shift-extrema.test.ts`. The correction retains the full established handoff duration for movement toward the new target and limits only the local continuation of the incoming tangent. No reader, protocol, adapter, model definition, material, environment, vehicle specification, gearbox acceptance rule, or existing assertion was changed by this assignment.

**All 60 distinct targeted cases passed across five files:** the 22 existing shift-continuity, interrupted-contact and foot-reconstruction cases; 29 unchanged control-animation cases; and nine new regressions. The exact previous helper produces three failures in the new nine-case suite. All four existing dense foot/selector mesh sweeps and the 64,000-pose recorded-trajectory comparison passed unchanged.

## Reproduction and causal evidence

The pre-assignment helper was reconstructed in scratch and verified against its recorded SHA-256, `a4f599f2a9088b5ceb03c3670db811de046bba1ee742a61b9028fcf3892d205b`. A temporary Vite import alias routes the controller, actual writer and reader to that exact helper without changing the repository. The same new tests then report **six passed and three failed**. Restoring the accepted helper makes all nine pass.

The failures establish three observations:

- At an ordinary 240 Hz command boundary, `19/240` seconds after a downshift, boot-clearance rate reaches **761.172 normalized units/s at the particular failing sample**, exceeding the independently derived 157.733 bound for that incoming state.
- The expanded actual-writer/reader matrix reaches **0.318601 channel error**, against the unchanged `2e-5` reconstruction allowance. It includes selector and normalized foot channels, so this aggregate is not a distance in metres.
- A local finite-difference join check sees excessive rate variation across its small sampling interval. This does **not** establish that the previous polynomial was analytically discontinuous; its compressed movement produces very high local acceleration despite the formal C1 join.

A separate full-stroke diagnostic samples the whole 270 ms stroke and densely samples the former short bridge. Its measured peaks are distinct from the single failing unit-test sample above:

| Accepted interruption | Channel | Previous peak | Corrected peak | Unit |
| --- | --- | ---: | ---: | --- |
| Down → down at `27/240` s | Selector | 86.2226 | 8.91892 | rad/s |
| Down → up at `27/240` s | Selector | 87.5298 | 15.2374 | rad/s |
| Down → either at `19/240` s | Clearance | 1,196.3747 | 149.5111 | normalized units/s |
| Down → up at 0.114999 s | Selector | 222,220.2243 | 15.3333 | rad/s |
| Down → either at 0.079999 s | Clearance | 1,010,087.5510 | 150.0000 | normalized units/s |

The first three rows are reachable on the normal 240 Hz clock. The final two exercise legal controller intervals above the 60 ms acceptance minimum but are not normal 240 Hz grid times. They challenge behavior arbitrarily close to an extremum rather than claim those exact input times occur in ordinary gameplay.

The original focused 60-case selector-extremum serialization probe spans clocks 0, 3,600 and 1,048,576 seconds. Its maximum channel error falls from **0.219999999 to 7.96676e-8**. The broader new test additionally covers clearance and cover extrema, two snapshot cadences, and both sides of the limited-continuation boundary.

## Why the correction stays bounded

Let `T` be the original handoff duration, `v` the incoming channel rate, and `r` the remaining travel in that rate's direction. The new target still follows the original duration `T`. When the original initial Bézier control would leave its travel envelope, a zero-initial-rate base curve carries that target movement, while the incoming tangent is continued by

`v * t * (1 - t / τ)^2`, for `0 <= t <= τ`, with `τ = min(T, 0.99 * 3 * r / |v|)`.

The correction is zero after `τ`. It begins with the measured velocity and reaches zero value and velocity at `τ`, so its join to the full-duration base is C1. Its derivative is `v * (1 - u) * (1 - 3u)`, where `u = t/τ`; its magnitude never exceeds `|v|`, regardless of how small `τ` becomes. A short interval therefore cannot accelerate the distant target through its full stroke.

Restricting the zero-initial-rate base Bézier to `[0, τ]` leaves its first control at the initial position. The correction changes only that control by `v*τ/3`, within 99% of the available travel. The other restricted controls remain inside the base curve's mechanical hull. The complete curve stays bounded for every intermediate time, not merely the sampled points in a test.

If `τ = T`, the implementation retains the original ordinary Bézier evaluation, including its floating-point operation order. Isolated strokes keep their original direct route evaluation. Their canonical endpoints and 260 ms completion remain unchanged. The covered-boot route still reaches its clearance waypoint before crossing the selector sleeve.

Cover's existing stopping interval can itself become short, but its endpoint displacement is proportional to that interval and its incoming rate. It does not send a distant cover target through the short interval; the later cover crossing keeps its established timing. The new regression checks all three channels, including this distinction.

A provisional piecewise coast was rejected during this assignment: although its branch could be made continuous, near-limit Float32 room error still retimed its entire far-target curve. That provisional construction is absent from the accepted source. The accepted local correction limits quantization effects to the small local movement.

## Preserved behavior and live consumers

The canonical golden trace contains **32,412 Float64 position/rate values** from both isolated directions over 270 ms. Its exact SHA-256 remains `147209b832093c423474a267d1ecf1b9726943211412b8118e93db4546e31399`.

A separate 400-command sequence, with legal intervals from 60 to 258 ms and a long initial clock, compares the complete initial-condition seed captured at each accepted command. **All 400 accepted-state seeds are bit-identical between the previous and corrected controllers.** This is a comparison of the state at command acceptance, after earlier handoffs have rejoined their routes. The interrupted trajectories between those command boundaries intentionally change and are not claimed to be identical.

The actual snapshot writer and existing foot reader use the same pure evaluator and existing seed fields. No new bytes, tags, event IDs, clocks, mutable playback cache, or render-time integration are introduced. The dedicated selector, cover and clearance channels retain radian/normalized-position units, with rates measured per simulation second. Event age uses the recorded adapter clock; the existing split-clock fields preserve sub-frame timing independently of the Float32 race header.

The new actual-rig checks inspect MX250 and MX450 at both mid and high detail, using the real writer's values for the corresponding bike and the same three authored sleeve stations as the established regressions. The unchanged 3 mm overlap limit and positive-contact controls pass. These targeted checks cover 264 existing-rig poses, including positive controls; the older dense matrices supply broader sampled coverage.

An independent review by assignment 45 also exercised 832 accepted seeds and 49,398 channel observations around continuation boundaries and extrema on the final helper. Its report owns that separate evidence; those observations are not included in the 60-test count here.

## Other motion contracts reviewed

The automatic posture controller uses the analytic critically damped response to a held target. Starting from a bounded reset at rest, its nonnegative response keeps bounded command histories bounded. Ordinary target changes retain position and velocity. The adapter's flight path advances stance separately from the automatic body owner, avoiding a competing reset. The AI handling investigation remains assignment 40's separate integration responsibility; reviewing the pure controller does not certify its policy on every course.

The automatic/manual blend's published derivative matches both partial derivatives of its local neutral join. At zero manual displacement, the manual derivative is `1 - automatic²`; at either ±0.15 join edge, the correction and its first derivative vanish. The mapping is C1, not C2. Its `poseRate()` combines the actual automatic and manual rates in normalized units per second. The physical manual displacement and airborne momentum exchange remain owned by `RiderWeight.step()` and the adapter, rather than by the visual blend.

The live rig and PresentedFrame route their foot fields through the same recorded sampler; stance, dab and body use the shared snapshot field sampler. The renderer diff against task baseline `b527a7e` is restricted to the previously approved import changes and three foot-reader calls. Removing exactly those authorized regions leaves **120,818 protected bytes identical**, including model construction. Their SHA-256 is `64191ea3c7484a70c9d7b6a3715ff2c546c0e4e556ee9bd439eb59fe5771cb9e`. No authored character or motorcycle geometry was changed.

## Acceptance commands and provenance

Run from the repository root:

```sh
npx vitest run tests/motocross-shift-continuity.test.ts \
  tests/motocross-interrupted-shift-contact.test.ts \
  tests/motocross-foot-reconstruction.test.ts
npx vitest run tests/motocross-shift-extrema.test.ts
npx vitest run tests/motocross-control-animation.test.ts
npx eslint src/simulation/offroad/mx-gear-stroke.ts tests/motocross-shift-extrema.test.ts
npx prettier --check tests/motocross-shift-extrema.test.ts
git diff --check -- src/simulation/offroad/mx-gear-stroke.ts tests/motocross-shift-extrema.test.ts
```

The three existing shift/reconstruction files passed 22/22 on helper `4abd3193e4b4f14baa1db131090c7fe75feb0617f1f68b20dba050984c479b54`. The final helper differs only in two clarifying comments; reconstructing those old comments reproduces that exact hash. The final new nine-case and 29-case control-animation runs use the final helper below. ESLint, new-test Prettier and changed-file whitespace checks passed. No full TypeScript, whole-repository, native-browser or hardware-performance claim is made by this assignment; final integration remains with the coordinator.

| Accepted input | SHA-256 |
| --- | --- |
| `src/simulation/offroad/mx-gear-stroke.ts` | `b2d6e6f437835bc52e9f55c43a6ee9e073e552314f6b9ae82d3d06adbbd5f91f` |
| `tests/motocross-shift-extrema.test.ts` | `ce3f5ed0edc32e806509f2e34878d0f4f69f6cb562b2e32b85932e3a3a7cdecf` |
| Unchanged foot reader | `2bc6a16ba88d105f452e0f73231977f67fc5f3ff7b8bb57cad4ff845e287edb1` |
| Unchanged snapshot writer | `a2e64a4b27d4d0d11c86697836e6487a616691a35bf8976cf866c60072a4077d` |

Reproduction scripts, exact pre-assignment helper, temporary alias config, before/after Vitest JSON/logs, extrema probes, full-stroke rate observations, accepted-input hashes and the protected-renderer receipt are under `/workspace/scratch/e91efca799c8/validation/motion-review-a44/`. Their named entry points are `extrema.mjs`, `rates.mjs`, and `before-vitest.config.mjs`. Use `MX44_BEFORE=1` for the exact previous extrema probe; the normal invocation uses current source. The previous-helper alias is only a diagnostic and is not part of the repository configuration.

These results establish bounded simulated control motion and faithful recorded reconstruction in the stated cases. They do not measure anatomical acceleration, physical-GPU frame rate, every continuous mesh contact, or perceived fluidity on target hardware. Extremely coarse or missing-event recordings retain the existing complete-pose fallback. Long-clock foot precision does not remove the separate whole-chassis hold when the Float32 header time repeats.

Production and test ownership are returned to the coordinator. This report and the two owned implementation/test files are the assignment's only repository writes; no git history, index, branch or publication was changed, and no additional agent was created.
