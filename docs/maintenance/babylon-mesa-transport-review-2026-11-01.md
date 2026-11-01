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
retried. This document records the plan, not a result.
