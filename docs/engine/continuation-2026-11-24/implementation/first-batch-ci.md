# First published batch: remote validation

Inspected implementation commit: `1bb58c984b17cdfc38493547e3767474eff341b0`.

[Focused engine runtime validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45444357280) completed successfully. Its native-and-replay job checks the complete TypeScript project, builds the exact source without asset-generation hooks, and runs the native lifecycle and replay browser specifications on Mesa. This is evidence for that commit, not a prediction about subsequent edits or hardware GPU performance.

[Build and validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45444357605) separately passed validation, scenarios and offroad scenarios. At inspection, remaining browser jobs were still running. Unit partitions 1 and 3 failed the same four content expectations documented before this continuation:

| Test | Observed failure |
|---|---|
| `apx01-livery.test.ts` | Alloy-role expectation for the existing hero livery |
| `vehicle-catalogue.test.ts` | Existing `gpr1` calibration hash mismatch |
| `vehicle-catalogue-growth.test.ts` | Existing `gpr1` unchanged-catalogue hash mismatch |
| `i18n.test.ts` | Fourteen existing dictionary validation findings |

Partition 1 reported 2,158 passed / 2 failed; partition 3 reported 2,234 passed / 2 failed. These are partial CI results, not a whole-suite success claim. The engine continuation does not change model materials, vehicle tuning, translations, or those content assertions to conceal failures.
