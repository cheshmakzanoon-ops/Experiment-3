# Bounded Mesa browser uniform-transport sensitivity check

This is a nonpublishing diagnostic on `babylon-js`, not a native Electron
qualification or a production transport change. `main` is untouched.

## Question and boundary

Does the existing Mesa browser workload behave consistently differently between
Babylon's native-default and forced-standalone uniform transports? The existing
fixture disables engine-wide UBOs for the latter; this cannot isolate grounding
uploads from other materials. It never enables UBOs against Babylon's driver
exceptions, spoofs the user agent, or changes the shipped application's policy.

`f996583` passed all 15 SwiftShader GPU journeys and Windows/macOS native
journeys. Required Linux Mesa still failed: its seventh normal draw remained
pending after 230 completed preparation operations, before authored-model import,
followed by GPU exit 512. Earlier Mesa failures predate live grounding and vary
in phase. Neither this failure nor a browser pass establishes its root cause.

## Fixed experiment

`.github/workflows/babylon-mesa-transport-review.yml` runs exactly two independent
paired jobs on Ubuntu 22.04. Each invokes the existing full live Formula scene
and complete isolated grounding tests in **both** transports: four tests per
pair, eight total, no additional retries. All original models, geometry, shaders,
physics, pixel/resource assertions, fixture deadlines and Playwright settings
remain unchanged. The existing integration job's 20-minute budget is retained.
This selected diagnostic subset does not replace the full acceptance suite.

It reuses `scripts/browser-backend.ts`, `browser-backend-setup.ts` and the normal
official CI dependency installation. The setup must observe actual llvmpipe,
reject SwiftShader fallback and validate a framebuffer pixel before tests.
No new launch flags are added. The existing browser Mesa configuration includes
its existing blocklist setting and bounded 120-second watchdog; native policy
is not changed. **Playwright Chromium is not Electron 45.2.1 / Chromium
156.0.8078.75 from the failed native run.** Browser/desktop launch policy and
execution route differ, so even all eight passes cannot qualify native Linux.

Each separately named artifact retains standard screenshots, reports, failure
traces, progress, observed backend, build commit/fingerprint, package-lock hash,
Playwright/Chromium/Node versions and the unexecuted Electron dependency version.
Review actual per-test transport receipts, failures and screenshots, not just
the workflow status. A setup failure is missing evidence, not a transport result.

## Decision and stopping rule

- Repeated default failures with standalone successes support only a
  browser/Mesa transport-sensitivity hypothesis, not a repair or native cause.
- Faults in both transports, or inconsistent pair results, end this hypothesis
  without extra retries or an expanding infrastructure investigation.
- Both transports passing leaves native failure unexplained; do not change
  production transport or claim Linux qualification.

The initial push trigger is restricted to this workflow path and `babylon-js`.
After this single observation, retire that trigger to manual-only. Read-only
repository permissions, disabled checkout credential persistence and artifact-only
outputs prevent release/deployment steps; there are no writes to Git branches.

## Reproduction

Use the workflow on `babylon-js`. On an equivalently provisioned Linux/Xvfb host,
after the existing normal build and Playwright Chromium installation, one pair is:

```sh
APEX_BROWSER_BACKEND=mesa LIBGL_ALWAYS_SOFTWARE=true GALLIUM_DRIVER=llvmpipe \
  xvfb-run -a -s '-screen 0 1920x1080x24' \
  npx playwright test e2e/babylon-surface-parity.spec.ts \
  --grep 'full actual Formula scenes prepare and complete both canonical venue workloads|isolated Formula grounding applies qualified original sky/sun attenuation to native road and paint terms'
```

The workflow matrix supplies the two planned repetitions; failed tests are not
retried. The original plan above is retained; the completed result is recorded below.


## Completed bounded result and automatic-trigger retirement

[Run 41294269727](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41294269727)
completed both planned pairs on exact `0979c6afae978614a8b393269dfa8043c93ff223`.
Its application fingerprint equals qualified application source `f996583`:
`e402919509adc82f51f43de9349cd9c791b6d3816cd0f8d3bac4f7be838fa0da`.
Both jobs observed Chromium 140.0.7339.186 and ANGLE Mesa/llvmpipe LLVM 15.0.7,
OpenGL 4.5, on Ubuntu 22.04.

- All **four full live-scene cases passed**, covering both transports in both
  repetitions and both canonical circuits per case.
- All **four isolated cases failed** at the original Three reference gate:
  `Required native grounding term invalid/absent: three/flat-one/sky`.
  This is not evidence of a Babylon transport failure or of native Linux repair.
- Each job therefore records two passes and two failures. Failures are retained;
  no assertions or tolerances are relaxed and there are no additional retries.

Artifacts (SHA-256 verified):

- Pair 1, `13078244191`, 9,337,867 bytes:
  `1de6ff9d308039eda45c29eaf5258b8d1c09d72a76ead63c025e5fd272bf6442`.
- Pair 2, `13078668591`, 9,336,956 bytes:
  `a47632f6982b822f7f0c417a7a567b6af69d821b021fb21e06127bcca74e4433`.

The automatic push trigger is retired. The workflow retains only an explicit
workflow_dispatch definition for future authorized use; no automatic follow-on
run is requested. Current evidence does not justify changing production uniform
transport or driver policy. Native Linux remains unqualified and unexplained.

Independent audit found the same precise reference issue in all four failures:
required indirect-diffuse bit 4 was absent both before and after on **9,025 of
11,844 road interior pixels**; paint had zero missing pixels. Both receivers had
zero invalid or unexpectedly active terms. `referenceQualified` and
`candidateConstructed` are false, with only `original-reference` in the phase
list. Three completed 10/10 draws and 2/2 preparations without context loss;
Babylon submitted zero draws for each failed isolated case. No reference-term
threshold or support mask is changed to turn these failures green.

All eight successful live venue receipts (two venues × two modes × two pairs)
have correct initial/moved uploads, stable effects/geometry/resources, four
completed frames, GL0 and disposal to zero resources. Sixteen live screenshots
reduce to four byte-identical images across modes and repetitions. These retain
the existing diagnostic-proxy/environment limitations. No live transport
sensitivity was observed here; native Linux's separate failure stays open.
