# Automatic shift stability · 2026-10-31

**Disposition: road-RPM guard rejected and rolled back after broader launch/driving regressions.** The calibration results below describe the rejected candidate, not a current-game acceptance claim. Strict HF-86 calibration remains a known failure after rollback.

## Reproduced failure

Frozen production source `80d9fe4` completes the full 57-vehicle calibration, but its strict mode fails one existing target: HF-86 top speed is 124.0867 / 124.1161 km/h at 1/240 / 1/120 s, outside the unchanged 305–345 km/h band. A separate 120-second full-throttle trace remains near that speed with 1,126 accepted first/second shifts. This is not the calibration fixture stopping early at a transient plateau.

At the first upshift, road speed is 123.028 km/h. Driven-wheel RPM is 11,605, above the 11,600 shift threshold; road-supported RPM is only 10,696 because the tyres are spinning. Second gear would have 8,551 RPM using wheel speed but only 7,881 using road contact speed, below its 8,000 downshift floor. The 91.7 ms power cut removes the slip, immediately requesting a downshift. A wheel-speed-only prospective-gear guard reproduces the original trace exactly and does not fix this loop.

## Narrow controller correction

`Vehicle` retains its existing driven-wheel upshift trigger. Before accepting an automatic upshift, it also requires that the next gear's road-supported RPM meets the existing downshift floor. This uses the previous solved substep's per-wheel contact tangent velocities, radii and loads, with the same driven axle or AWD carrier weighting as the current drivetrain. Unsupported driven contact cannot certify an upshift. It is a gear-selection check, not a velocity clamp or an added force.

Torque curves, engine power, limiter, ratios, clutch, manual shifting, tyre friction, braking and calibration bands are unchanged. The per-step scratch array is refreshed from actual wheel speeds before downstream drivetrain use. Signed backwards travel does not certify a forward upshift.

## Verified experiment results

- HF-86 waits only about 54 ms longer for the first shift, until road-supported second-gear RPM is 8,007.9. It then makes five upward shifts to sixth with no hunting.
- HF-86 top speed: **321.613182 / 321.615827 km/h**; 0–100 remains 2.98 / 2.97 s.
- Full strict registry: **57 vehicles, zero out-of-band comparisons**, on Node 24.22.1 and the CI-matched official Node 22.23.4. Fine/coarse target bands are unchanged. Runtime metric differences are floating-point epsilon, not a different acceptance target.
- HF-67 also avoids one premature upshift/downshift cycle: its first upshift waits about 29 ms, and 0–100 improves by about 0.179 s. Its top-speed change is below 0.02 km/h and remains in band. Every other registry comparison metric is unchanged.
- Controller regressions cover wheelspin, signed motion, supported/unsupported driven contacts, FWD/RWD/AWD weighting, reverse, manual shifting, disabled automatic shifting and manual clutch. Separate manual/raw/reverse controls retain exact state identity over 86,400 solved external steps.

These results qualify the narrow controller change locally. They do not certify every vehicle on every circuit, complete native rendering, or commercial readiness.

## Separate stale-report contracts remain open

Strict target-band success is not a claim that every calibration-derived contract passes. Re-running existing catalogue tests with freshly generated baseline data exposes two unchanged issues:

1. XT-1's lateral floor margin is about 1.448%, below its separate 1.5% engineering margin requirement.
2. XF-2's measured fan braking contribution is about 12.17524 m/s², versus authored AI fan base 12.8 under its existing 0.05 tolerance.

Both measurements are identical in baseline and candidate, including the XF-2 fitted values. The shift correction does not change either vehicle definition, AI envelope, tolerance or test. The checked-in calibration fixture is not evidence that fresh measurements satisfy these contracts. They require separate calibration/envelope work; no report or assertion has been altered to conceal them.

## CI ownership

The previous scenario job started the full vehicle command only after roughly 13 minutes 38 seconds and was cancelled at its 15-minute job cap before completion. Its command also omitted `--strict`, so printed `OUT` comparisons alone could not fail that invocation.

Vehicle calibration now has its own **required** 15-minute job and 13-minute execution step. It runs every registered vehicle with `--strict`, keeps the existing bands, seeds the disclosure document in a temporary output directory, and preserves both generated reports plus the complete log on failure. The original scenario job retains its 15-minute cap. Publication explicitly depends on the new calibration job as well as every previous gate.

## Broader regression and rollback

Exact Node 22 comparisons establish that the guard is not safe as a general automatic-shift rule:

- Original `1fe7e1d` passes all seven drivetrain tests. Guarded `56a2430` fails the unchanged split-grip launch: LSD speed 7.376571124 m/s does not exceed the required open-differential result × 1.15 (7.833239903 m/s).
- Original full continuous-driving journey passes every check, finishing at race time 614.641 s with maximum speed 80.167 m/s and gear 8. Guarded source retires the player with zero laps, maximum 19.264272985 m/s, gear 1 and prolonged grass time; the other AI entrants finish.
- Paired launch traces are identical through substep 2260. At substep 2261, on dry asphalt at 9.93 m/s, the original accepts a wheelspin-relieving first-to-second shift at 12,319 wheel RPM. The guard blocks it because road-supported next-gear RPM is 2,920, below 6,900. The original reaches normal following at 5.058 s; the guard never shifts and subsequently leaves the road.

Two narrower isolated alternatives also fail the unchanged split-grip requirement and are not accepted: waiting one existing shift-cut substep, and requiring engine RPM below the existing downshift floor. No new timer, threshold, power increase or test relaxation was accepted.

The production rollback restores the pre-guard `Vehicle` behavior exactly. Its implementation-specific road-RPM rejection tests encoded a disproved controller assumption; they are replaced by public launch/shift compatibility regressions while the original drivetrain, continuous-driving and strict calibration requirements remain unchanged. The rejected patches, tests and numerical receipts remain preserved in commit history and investigation evidence. The strict calibration job is retained and exposes the original HF-86 failure rather than hiding it.

Physics identity advances to v20 because the rollback changes recorded performance relative to v19. Existing v18/v19 ghosts and leaderboard categories remain separate and unchanged; new v20 personal bests use their own physics-scoped storage keys. A future anti-hunting correction must pass uniform calibration **and** wheelspin-relieving launch/continuous-driving checks before acceptance.
