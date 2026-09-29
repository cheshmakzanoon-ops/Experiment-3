# A26 publication validation — 2026-09-29

## Exact source reconciliation

The twelve retained A26 candidate files from GitHub Actions run `36637889921`
were applied to shared main `b64ca65bb2b2975455a987962d5374ac49039654`.
Every candidate file matched its retained byte size, SHA-256 and Git blob SHA.
The resulting source/asset tree before this publication note is
`bc15af7da6ecf94602b8c450b69835a7b013cb67`; the local Git tree and the tree
accepted by GitHub are identical.

The newer A21 frontage integration is preserved. A22 source, GLB and manifest,
A24, A31, A33, A34, A35, the central renderer/circuit, dependency lock, player
assets and physics are unchanged by A26. Only `hero-garage.ts` gains the
asset-loading/ownership hook. Seven A26-only temporary recovery/transfer paths
are removed; the read-only A26 authoring verification workflow is retained.

## Fresh combined-source checks

`npm run check` completed with exit code 0 on the reconciled source:

- ESLint passed.
- Vitest: 1,387 tests in 143 files passed.
- TypeScript checking and the Vite production build passed.
- Vite reported its existing large-chunk warning; it was not hidden or treated
  as a test failure.

The retained `.blend` was opened successfully in Blender 5.2.2 LTS. Its editable,
export and reference-guide collections are present. The validated GLB was not
regenerated or substituted during publication.

## Browser evidence and limits

The unchanged hosted candidate receipt
`A26_OVERHEAD_GARAGE_SERVICE_RIG_VALIDATION.json` records all nine passing
A26/A22 browser cases, including production startup/practice entry and scripted
moving scene surveys in day, sunset, wet day and wet night. That run used the
pre-A21 candidate baseline `6071a3454a401bdc6b4fef7a67821580b7a4ab8a` and
SwiftShader; it is not relabelled as a fresh test of the newer A21 integration.

An additional local attempt selected the three A21/A22/A26 production-startup
cases. The SwiftShader framebuffer/adapter check passed under Xvfb, but every
case stopped at initial navigation with `net::ERR_BLOCKED_BY_ADMINISTRATOR`
for localhost, before application code loaded. These three cases are not
reported as passes or as evidence of an application regression. The earlier
attempt without an X display could not initialize WebGL2; Xvfb resolved that
backend setup issue without any repository/configuration changes. Browser
policy was not disabled or bypassed.

Post-publication CI must be read separately; this note does not predeclare its
outcome. Final art approval, a complete driven pit-entry/service/exit review,
cockpit-camera repair and representative physical-GPU performance approval
remain open. No separately hosted website redeployment is claimed.

## Retained verification-log hashes

`a26-final-check.log` SHA-256: `b8eb0f472f6f022494a9476129387ecdd6a26d40580a4fe4add0443e12e6cc23`.

`a26-final-browser.log` SHA-256: `d4d7336f2ef5581a635f50bbabbe6ac112ab344fd80084f1c8a1650dcc9da61d`.
