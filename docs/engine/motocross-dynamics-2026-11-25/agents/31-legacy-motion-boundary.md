# Assignment 31 — legacy foot-motion boundary compatibility

## Result

Restored the original linear release/reapplication of unmarked motocross foot controls across rider-state edges. The unchanged existing regression now returns **0.10000000149011612** at alpha 0.5 from a recorded selector angle of approximately 0.2, instead of snapping to zero.

Only `src/rendering/offroad/mx-foot-pose.ts` changes production behavior. The sampler now checks whether both optional trajectory markers are zero before rejecting endpoints without active foot controls. Those wholly unmarked pairs use their original linear interpolation of sanitized endpoints; an inactive endpoint contributes neutral controls.

The marked trajectory path and every existing fallback rule remain unchanged. No model, geometry, material, asset, environment, vehicle specification, protocol layout, or `bike.ts` changes were made.

## Reproduction and focused coverage

Before the correction, the unchanged `tests/motocross-motion-boundary.test.ts` failed its rider-state release assertion. Running it together with the new `tests/motocross-foot-boundary.test.ts` produced **3 failures and 10 passes**: the existing failure plus one new boundary regression for each MX bike. After the correction, all thirteen boundary tests pass without changing any expected value or tolerance.

The eight new tests cover the distinctions that matter to this guard ordering:

| Interval or input | Verified behavior |
| --- | --- |
| Both endpoints unmarked | Original linear channels, including release and return through lowside, highside, separated and remount states on both MX bikes. |
| One valid marked endpoint and one unmarked endpoint, both riding | Existing mixed-format linear behavior is preserved in either endpoint order. |
| Marked interval with an inactive endpoint | Select a complete nearest endpoint; do not introduce a new linear path through missing or stale trajectory data. |
| Malformed marked seed | Keep the measured endpoint fallback. Clearing its marker restores the existing interpretation of the optional bytes as absent. |
| Unmarked non-finite/out-of-range foot positions | Interpolate sanitized positions; do not treat these bare positions as a malformed optional trajectory. |
| Equal race/header times | The shared chassis presentation alpha holds the older pose until the exact newer endpoint. |
| Equal or rewound adapter clocks with forward header times | The foot sampler selects complete measured endpoints. |
| Crash count, rider-clock reset, or stroke reset | Preserve complete measured endpoints and exact endpoint samples. |

Presentation agreement is checked using the same `presentationAlpha` and discrete rider state consumed by the live reader. An inactive rider keeps the drawn foot controls neutral until its riding endpoint; the raw legacy channel can still interpolate toward that endpoint. A reversed header-time pair remains rejected by `PresentedFrame`, while the standalone recorded-foot sampler retains its established complete-endpoint fallback. Inputs remain unmodified.

## Verification

```sh
npx vitest run \
  tests/motocross-foot-boundary.test.ts \
  tests/motocross-motion-boundary.test.ts \
  tests/motocross-control-animation.test.ts \
  tests/motocross-machine-animation.test.ts
```

**47 tests passed across four files**, exit code zero.

```sh
npx vitest run tests/motocross-foot-reconstruction.test.ts \
  -t 'recorded motocross foot trajectory|draws the same reconstructed feet'
```

**7 tests passed, 4 skipped**, exit code zero. This includes the existing 64,000-pose trajectory comparison, interruption/reset/corruption contracts, compact replay transport, and the actual live reader/`PresentedFrame` agreement through detail changes and seeks for both MX bikes. The four dense mesh-contact sweeps were intentionally excluded at the coordinator's request: the marked trajectory path is unchanged, and the final integrated run owns that full coverage.

```sh
npx eslint src/rendering/offroad/mx-foot-pose.ts tests/motocross-foot-boundary.test.ts
```

Focused ESLint passed, exit code zero. Total targeted execution: **54 tests passed across five files**, with the four explicitly deferred mesh cases above. No full TypeScript check or git operation was run. Assignment 29 independently reran its ten real-journal replay tests together with the five unchanged motion-boundary and eight new foot-boundary tests: **23/23 passed**, including its endpoint/buffer immutability checks.

## Ownership returned

- `src/rendering/offroad/mx-foot-pose.ts`
- `tests/motocross-foot-boundary.test.ts`
- This report.
