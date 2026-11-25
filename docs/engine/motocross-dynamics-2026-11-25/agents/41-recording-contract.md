# Assignment 41 — distinguish MX trajectory data from contact measurements

## Result

The recording failure was an obsolete whole-tail-zero expectation, not leaked car-contact data. The test now verifies the complete tagged contract and adds an adversarial inherited-data check. No production code changed.

The focused recording and foot-motion batch passed **29/29 tests across three files**. The original test reproduced **9 passed / 1 failed** before the correction, with only the documented trajectory marker and reset event differing from its old expectation.

## Independent contract review

`writeWheelContact` clears the complete 33-float contact tail before selecting its vehicle-specific writer. A freshly placed, ridden MX450 records a neutral accepted-shift trajectory: offset `+21` is its `RECORDED` marker and offset `+22` is the initial reset event identity. Both equal one. Every other slot remains zero in this placement fixture.

That optional trajectory does not advertise a measured wheel contact. The tail's leading car-contact mask remains zero. `sampleWheelContact` accepts a car wheel only when the corresponding bit of a mask from 0 through 15 is set. `hasRoadBikeContact` requires the distinct value 16 and the road-bike contract. Neither consumer interprets the MX trajectory marker or event as a physical contact.

The seed is explicitly neutral: its direction, age, initial angle/cover/clearance, rates, and split clock fields are all zero. Its recorded identity remains useful for distinguishing a placement/reset from a later accepted shift. Clearing those legitimate fields to satisfy the old test would discard the new recording contract.

## Test change

Only `tests/wheel-contact-recording.test.ts` changed. Its existing GPR1/MX450 placement test now:

1. Retains exact equality over **all 33 tail slots**. GPR1 still requires an entirely zero tail; MX450 requires only the documented marker and reset identity to be one, with all other 31 slots zero.
2. Explicitly requires the zero car-contact mask, the correct MX-foot eligibility, rejection by the road-contact reader, and schema acceptance.
3. Calls every one of the four actual car-contact readers with a previously valid output object and checks the complete neutral fallback, including clearing a stale displacement.
4. Repeats those checks after installing loaded, banked inherited car-hub/tire measurements and filling the output tail with `NaN`. A direct writer call must clear that stale buffer and reproduce the same exact vehicle-specific tail.

The existing invalid-wheel handling, replay persistence, schema-version rejection, and recorded-contact interpolation tests were retained. No tolerance or physics acceptance limit was relaxed, no payload region was excluded from comparison, and no model or environment definition was modified.

## Verification

| Check | Result |
| --- | --- |
| Original `wheel-contact-recording.test.ts` on integrated source | 9 passed, 1 failed; only offsets +21/+22 differed |
| Revised `wheel-contact-recording.test.ts` | 10/10 passed |
| `motocross-foot-reconstruction.test.ts` | 11/11 passed |
| `motocross-foot-boundary.test.ts` | 8/8 passed |
| Combined focused batch | 29/29, 76.91 seconds |
| Focused ESLint | Passed |
| Focused Prettier check | Passed |
| `git diff --check` for the changed test | Passed |

The existing foot reconstruction suite additionally exercises accepted-event reconstruction, optional-data fallbacks, compact replay, long clocks, actual rig clearance, and rendering-detail/seek consistency. Those checks were run unchanged. Their CPU execution time is a test duration on the shared host, not a gameplay frame-rate measurement.

Commands, from the repository root:

```sh
npx vitest run tests/wheel-contact-recording.test.ts --reporter=default --reporter=json --outputFile=test-results/a41-recording-contract/before.vitest.json
npx vitest run tests/wheel-contact-recording.test.ts tests/motocross-foot-boundary.test.ts tests/motocross-foot-reconstruction.test.ts --reporter=default --reporter=json --outputFile=test-results/a41-recording-contract/after.vitest.json
npx eslint tests/wheel-contact-recording.test.ts
npx prettier --check tests/wheel-contact-recording.test.ts
git diff --check -- tests/wheel-contact-recording.test.ts
```

## Provenance and scope

The original test's SHA-256 is `84555a22bf9322fd79a028aa137f8e0249566d8c760f5fc410780f8bb07bb555`, identical to the file read directly from baseline `b527a7e01ea247f0233a2ec4f2850639bafbd887`. Assignment 34 already recorded the original baseline's 10/10 pass; this assignment verified its file identity and reproduced the integrated-source failure, without repeating that baseline run.

The six recorded production inputs—protocol, writer, car-contact reader, MX-foot reader, gear-stroke controller, and motocross adapter—remained byte-identical through the focused batch. The adapter was `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17`. Assignment 40's separate AI-grid investigation may subsequently change that adapter; this report establishes the recording contract at the recorded revision, not final integrated acceptance.

After the batch, Prettier only wrapped one new assertion across three lines; it changed no expressions or test behavior. The tested and final test fingerprints are recorded separately rather than treating them as identical files.

Receipts are in `test-results/a41-recording-contract/`: initial and repaired Vitest JSON/logs, `before.json`, `tested-inputs.json`, `final-inputs.json`, and lint/format logs. The report and the single owned test are this assignment's only repository changes. No commit or publication was performed.
